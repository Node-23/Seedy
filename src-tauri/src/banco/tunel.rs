//! Túnel SSH com o `ssh` do sistema (`ssh -N -L`): ele já lê o ~/.ssh/config, o
//! known_hosts, as chaves e o agente. Sem prompt (BatchMode): chave com senha precisa
//! estar no ssh-agent.

use serde::Serialize;
use std::io::Read;
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

pub struct Tunel {
    processo: Child,
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
        Ok(Self { processo, porta_local, alvo: alvo.to_string(), destino: format!("{host}:{porta}") })
    }

    pub fn info(&self) -> InfoTunel {
        InfoTunel { alvo: self.alvo.clone(), destino: self.destino.clone(), porta_local: self.porta_local, identidade: identidade(&self.alvo) }
    }
}

impl Drop for Tunel {
    fn drop(&mut self) {
        let _ = self.processo.kill();
        let _ = self.processo.wait();
    }
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
    fn recusa_destino_que_parece_opcao() {
        assert!(Tunel::abrir("-oProxyCommand=x", "localhost", 5432).is_err());
    }
}
