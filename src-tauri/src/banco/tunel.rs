//! Túnel SSH com o `ssh` do sistema (`ssh -N -L`): ele já lê o ~/.ssh/config, o
//! known_hosts, as chaves e o agente. Sem prompt (BatchMode): chave com senha precisa
//! estar no ssh-agent.

use serde::Serialize;
use std::io::Read;
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

enum Fonte {
    Processo(Child),
    /// Cliente embutido: o aviso de parada e a thread com o runtime que atende as conexões.
    Nativo { parar: Option<tokio::sync::oneshot::Sender<()>>, fio: Option<std::thread::JoinHandle<()>>, identidade: Option<String> },
}

pub struct Tunel {
    fonte: Fonte,
    pub porta_local: u16,
    alvo: String,
    destino: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InfoTunel {
    pub alvo: String,
    pub destino: String,
    pub porta_local: u16,
    /// Chave que o ssh vai usar para esse destino (do `ssh -G`).
    pub identidade: Option<String>,
}

fn comando_ssh() -> Command {
    let mut c = Command::new("ssh");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c
}

impl Tunel {
    /// Abre `127.0.0.1:<porta livre>` → `host:porta` vistos de dentro de `alvo`.
    pub fn abrir(alvo: &str, host: &str, porta: u16) -> Result<Self, String> {
        if alvo.starts_with('-') || host.starts_with('-') {
            return Err("destino SSH inválido".into());
        }
        let porta_local = TcpListener::bind("127.0.0.1:0")
            .and_then(|l| l.local_addr())
            .map(|a| a.port())
            .map_err(|e| format!("sem porta local livre: {e}"))?;
        let mut processo = comando_ssh()
            .args([
                "-N",
                "-L",
                &format!("127.0.0.1:{porta_local}:{host}:{porta}"),
                "-o",
                "ExitOnForwardFailure=yes",
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=15",
                "-o",
                "ServerAliveInterval=30",
                "--",
                alvo,
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("não consegui rodar o ssh (está instalado e no PATH?): {e}"))?;

        // Pronto quando a porta local aceita conexão; se o ssh sair antes, mostra o porquê.
        let limite = Instant::now() + Duration::from_secs(25);
        loop {
            if let Ok(Some(_)) = processo.try_wait() {
                let mut erro = String::new();
                if let Some(mut e) = processo.stderr.take() {
                    let _ = e.read_to_string(&mut erro);
                }
                return Err(format!("túnel SSH para {alvo} falhou: {}", resumo(&erro)));
            }
            if TcpStream::connect_timeout(&([127, 0, 0, 1], porta_local).into(), Duration::from_millis(300)).is_ok() {
                break;
            }
            if Instant::now() > limite {
                let _ = processo.kill();
                return Err(format!("túnel SSH para {alvo}: tempo esgotado"));
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        Ok(Self { fonte: Fonte::Processo(processo), porta_local, alvo: alvo.to_string(), destino: format!("{host}:{porta}") })
    }

    pub fn info(&self) -> InfoTunel {
        let identidade = match &self.fonte {
            Fonte::Processo(_) => identidade(&self.alvo),
            Fonte::Nativo { identidade, .. } => identidade.clone(),
        };
        InfoTunel { alvo: self.alvo.clone(), destino: self.destino.clone(), porta_local: self.porta_local, identidade }
    }
}

impl Drop for Tunel {
    fn drop(&mut self) {
        match &mut self.fonte {
            Fonte::Processo(p) => {
                let _ = p.kill();
                let _ = p.wait();
            }
            Fonte::Nativo { parar, fio, .. } => {
                if let Some(p) = parar.take() {
                    let _ = p.send(());
                }
                if let Some(f) = fio.take() {
                    let _ = f.join();
                }
            }
        }
    }
}

/// Dados do túnel aberto pelo cliente embutido.
pub struct ConfigSsh {
    pub servidor: String,
    pub porta: u16,
    pub usuario: String,
    /// Arquivo da chave privada; vazio = autenticação por senha.
    pub chave: Option<String>,
    /// Senha do usuário (ou a frase-senha da chave, se houver chave).
    pub segredo: String,
    /// Onde ficam as impressões digitais dos servidores já vistos.
    pub arquivo_hosts: std::path::PathBuf,
}

/// Confere a chave do servidor com a guardada (na primeira vez, guarda e aceita).
struct Cliente {
    chave_id: String,
    arquivo: std::path::PathBuf,
    divergiu: std::sync::Arc<std::sync::Mutex<Option<String>>>,
}

impl russh::client::Handler for Cliente {
    type Error = russh::Error;

    async fn check_server_key(&mut self, chave: &russh::keys::PublicKey) -> Result<bool, Self::Error> {
        let atual = chave.fingerprint(russh::keys::HashAlg::Sha256).to_string();
        match conferir_servidor(&self.arquivo, &self.chave_id, &atual) {
            Ok(()) => Ok(true),
            Err(motivo) => {
                *self.divergiu.lock().unwrap_or_else(|e| e.into_inner()) = Some(motivo);
                Ok(false)
            }
        }
    }
}

/// Primeira vez: grava a impressão digital. Depois: precisa ser a mesma.
fn conferir_servidor(arquivo: &std::path::Path, id: &str, atual: &str) -> Result<(), String> {
    let mut mapa: std::collections::BTreeMap<String, String> =
        std::fs::read_to_string(arquivo).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    match mapa.get(id) {
        Some(guardada) if guardada == atual => Ok(()),
        Some(guardada) => Err(format!(
            "a chave do servidor {id} mudou (era {guardada}, agora {atual}); se você reinstalou o servidor, apague a entrada em {}",
            arquivo.display()
        )),
        None => {
            mapa.insert(id.to_string(), atual.to_string());
            if let Some(pasta) = arquivo.parent() {
                let _ = std::fs::create_dir_all(pasta);
            }
            let texto = serde_json::to_string_pretty(&mapa).map_err(|e| e.to_string())?;
            std::fs::write(arquivo, texto).map_err(|e| format!("não consegui guardar a chave do servidor: {e}"))
        }
    }
}

fn caminho_da_chave(caminho: &str) -> std::path::PathBuf {
    match (caminho.strip_prefix('~'), dirs::home_dir()) {
        (Some(resto), Some(casa)) => casa.join(resto.trim_start_matches(['/', '\\'])),
        _ => caminho.into(),
    }
}

impl Tunel {
    /// Abre `127.0.0.1:<porta livre>` → `host:porta` vistos de dentro do servidor SSH, entrando
    /// com usuário e senha (ou chave privada) pelo cliente embutido.
    pub fn abrir_nativo(c: ConfigSsh, host: &str, porta: u16) -> Result<Self, String> {
        if c.servidor.trim().is_empty() || c.usuario.trim().is_empty() {
            return Err("o túnel SSH precisa de servidor e usuário".into());
        }
        let alvo = format!("{}@{}:{}", c.usuario, c.servidor, c.porta);
        let destino = format!("{host}:{porta}");
        let identidade = c.chave.clone().filter(|k| !k.trim().is_empty());
        let (parar_tx, parar_rx) = tokio::sync::oneshot::channel::<()>();
        let (pronto_tx, pronto_rx) = std::sync::mpsc::channel::<Result<u16, String>>();
        let host_destino = host.to_string();
        let fio = std::thread::Builder::new()
            .name("seedy-tunel-ssh".into())
            .spawn(move || {
                let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
                    Ok(r) => r,
                    Err(e) => return drop(pronto_tx.send(Err(format!("runtime do túnel: {e}")))),
                };
                rt.block_on(async move {
                    match preparar(&c).await {
                        Ok((sessao, ouvinte)) => {
                            let porta_local = ouvinte.local_addr().map(|a| a.port()).unwrap_or(0);
                            let _ = pronto_tx.send(Ok(porta_local));
                            servir(sessao, ouvinte, host_destino, porta as u32, parar_rx).await;
                        }
                        Err(e) => drop(pronto_tx.send(Err(e))),
                    }
                });
            })
            .map_err(|e| format!("não consegui iniciar o túnel: {e}"))?;
        let porta_local = match pronto_rx.recv_timeout(Duration::from_secs(30)) {
            Ok(Ok(p)) => p,
            Ok(Err(e)) => {
                let _ = fio.join();
                return Err(e);
            }
            Err(_) => return Err(format!("túnel SSH para {alvo}: tempo esgotado")),
        };
        Ok(Self { fonte: Fonte::Nativo { parar: Some(parar_tx), fio: Some(fio), identidade }, porta_local, alvo, destino })
    }
}

/// Conecta, confere o servidor, entra e abre a porta local.
async fn preparar(c: &ConfigSsh) -> Result<(russh::client::Handle<Cliente>, tokio::net::TcpListener), String> {
    use russh::keys::PrivateKeyWithHashAlg;
    let alvo = format!("{}@{}:{}", c.usuario, c.servidor, c.porta);
    let config = std::sync::Arc::new(russh::client::Config {
        keepalive_interval: Some(Duration::from_secs(30)),
        inactivity_timeout: None,
        ..Default::default()
    });
    let divergiu = std::sync::Arc::new(std::sync::Mutex::new(None));
    let cliente = Cliente { chave_id: format!("{}:{}", c.servidor, c.porta), arquivo: c.arquivo_hosts.clone(), divergiu: divergiu.clone() };
    let conexao = tokio::time::timeout(Duration::from_secs(15), russh::client::connect(config, (c.servidor.as_str(), c.porta), cliente)).await;
    let mut sessao = match conexao {
        Err(_) => return Err(format!("túnel SSH para {alvo}: tempo esgotado ao conectar")),
        Ok(Err(e)) => {
            if let Some(m) = divergiu.lock().unwrap_or_else(|e| e.into_inner()).take() {
                return Err(m);
            }
            return Err(format!("túnel SSH para {alvo} falhou: {e}"));
        }
        Ok(Ok(s)) => s,
    };
    let resultado = match c.chave.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
        Some(arquivo) => {
            let frase = Some(c.segredo.as_str()).filter(|s| !s.is_empty());
            let chave = russh::keys::load_secret_key(caminho_da_chave(arquivo), frase)
                .map_err(|e| format!("não consegui ler a chave {arquivo}: {e}"))?;
            let hash = sessao.best_supported_rsa_hash().await.ok().flatten().flatten();
            sessao.authenticate_publickey(&c.usuario, PrivateKeyWithHashAlg::new(std::sync::Arc::new(chave), hash)).await
        }
        None => sessao.authenticate_password(&c.usuario, &c.segredo).await,
    }
    .map_err(|e| format!("túnel SSH para {alvo} falhou: {e}"))?;
    if !resultado.success() {
        return Err(format!("túnel SSH para {alvo}: usuário, senha ou chave recusados"));
    }
    let ouvinte = tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|e| format!("sem porta local livre: {e}"))?;
    Ok((sessao, ouvinte))
}

/// Atende as conexões na porta local até mandarem parar.
async fn servir(
    sessao: russh::client::Handle<Cliente>,
    ouvinte: tokio::net::TcpListener,
    host: String,
    porta: u32,
    mut parar: tokio::sync::oneshot::Receiver<()>,
) {
    let sessao = std::sync::Arc::new(sessao);
    loop {
        tokio::select! {
            _ = &mut parar => break,
            aceito = ouvinte.accept() => {
                let Ok((mut local, origem)) = aceito else { continue };
                let sessao = sessao.clone();
                let host = host.clone();
                tokio::spawn(async move {
                    if let Ok(canal) = sessao.channel_open_direct_tcpip(host, porta, origem.ip().to_string(), origem.port() as u32).await {
                        let mut remoto = canal.into_stream();
                        let _ = tokio::io::copy_bidirectional(&mut local, &mut remoto).await;
                    }
                });
            }
        }
    }
    let _ = sessao.disconnect(russh::Disconnect::ByApplication, "", "pt").await;
}

/// A chave que o ssh usaria (primeira `identityfile` existente do `ssh -G`).
fn identidade(alvo: &str) -> Option<String> {
    let saida = comando_ssh().args(["-G", "--", alvo]).stdin(Stdio::null()).output().ok()?;
    let texto = String::from_utf8_lossy(&saida.stdout);
    let casa = dirs::home_dir();
    texto
        .lines()
        .filter_map(|l| l.strip_prefix("identityfile "))
        .map(|caminho| {
            let real = match (caminho.strip_prefix("~"), &casa) {
                (Some(resto), Some(c)) => c.join(resto.trim_start_matches(['/', '\\'])),
                _ => caminho.into(),
            };
            (caminho.to_string(), real.exists())
        })
        .find(|(_, existe)| *existe)
        .map(|(c, _)| c)
}

/// O ssh escreve bytes fora do ASCII como `\ddd` (octal): `n\343o` → "não" (Latin-1).
fn sem_escapes_octais(texto: &str) -> String {
    let c: Vec<char> = texto.chars().collect();
    let mut saida = String::new();
    let mut i = 0;
    while i < c.len() {
        if c[i] == '\\' && i + 3 < c.len() && c[i + 1..=i + 3].iter().all(|d| ('0'..='7').contains(d)) {
            let valor = c[i + 1..=i + 3].iter().fold(0u32, |v, d| v * 8 + d.to_digit(8).unwrap_or(0));
            if let Some(ch) = char::from_u32(valor) {
                saida.push(ch);
                i += 4;
                continue;
            }
        }
        saida.push(c[i]);
        i += 1;
    }
    saida
}

/// A linha útil do erro do ssh (sem os avisos de "Warning: Permanently added").
fn resumo(stderr: &str) -> String {
    let stderr = &sem_escapes_octais(stderr);
    let linhas: Vec<&str> = stderr.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with("Warning:")).collect();
    let texto = linhas.last().copied().unwrap_or("o ssh saiu sem dizer o motivo");
    if texto.contains("Permission denied") {
        format!("{texto} (o Seedy usa chave ou ssh-agent; senha interativa não funciona)")
    } else if texto.contains("Host key verification failed") {
        format!("{texto} (conecte uma vez pelo terminal com `ssh` para aceitar a chave do servidor)")
    } else {
        texto.to_string()
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn resumo_explica_os_erros_comuns() {
        assert!(resumo("Warning: Permanently added 'x'\nuser@x: Permission denied (publickey).").contains("ssh-agent"));
        assert!(resumo("Host key verification failed.").contains("aceitar a chave"));
        assert_eq!(resumo(""), "o ssh saiu sem dizer o motivo");
        assert_eq!(sem_escapes_octais(r"host n\343o \351 conhecido"), "host não é conhecido");
    }

    #[test]
    fn servidor_novo_e_guardado_e_mudanca_e_recusada() {
        let arq = std::env::temp_dir().join(format!("seedy-hosts-{}.json", std::process::id()));
        let _ = std::fs::remove_file(&arq);
        assert!(conferir_servidor(&arq, "x:22", "SHA256:aaa").is_ok());
        assert!(conferir_servidor(&arq, "x:22", "SHA256:aaa").is_ok());
        assert!(conferir_servidor(&arq, "x:22", "SHA256:bbb").unwrap_err().contains("mudou"));
        assert!(conferir_servidor(&arq, "y:22", "SHA256:bbb").is_ok());
        let _ = std::fs::remove_file(&arq);
    }

    /// Precisa do container de teste: `docker run -p 2222:2222 -e USER_NAME=tunel -e USER_PASSWORD=tunel123
    /// -e PASSWORD_ACCESS=true --link <postgres>:db lscr.io/linuxserver/openssh-server`.
    #[test]
    #[ignore]
    fn tunel_nativo_com_senha_leva_ate_o_postgres() {
        use std::io::{Read, Write};
        let config = |senha: &str| ConfigSsh {
            servidor: "127.0.0.1".into(),
            porta: 2222,
            usuario: "tunel".into(),
            chave: None,
            segredo: senha.into(),
            arquivo_hosts: std::env::temp_dir().join("seedy-hosts-teste.json"),
        };
        assert!(Tunel::abrir_nativo(config("errada"), "db", 5432).err().unwrap().contains("recusados"));
        let t = Tunel::abrir_nativo(config("tunel123"), "db", 5432).unwrap();
        let mut s = TcpStream::connect(("127.0.0.1", t.porta_local)).unwrap();
        s.write_all(&[0, 0, 0, 8, 4, 0xd2, 0x16, 0x2f]).unwrap(); // SSLRequest do Postgres
        let mut r = [0u8; 1];
        s.read_exact(&mut r).unwrap();
        assert!(r[0] == b'S' || r[0] == b'N');
        drop(t);
    }

    #[test]
    fn recusa_destino_que_parece_opcao() {
        assert!(Tunel::abrir("-oProxyCommand=x", "localhost", 5432).is_err());
    }
}
