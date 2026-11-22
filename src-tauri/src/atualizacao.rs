//! Atualização do próprio Seedy: olha a última release do GitHub, baixa o instalador, confere o
//! tamanho e o SHA-256 publicado (`SHA256SUMS.txt` na release), fecha o app, instala e abre de novo.
//! Nada baixa sozinho: a interface avisa e o usuário decide. Com o repositório privado, usa a conta
//! do GitHub conectada (␣ G); com ele público, funciona sem conta.

use crate::git::ContaGithub;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

const REPOSITORIO: &str = "Node-23/Seedy";
/// Endereço da API: o do GitHub, ou um servidor local de teste (`SEEDY_ATUALIZACAO_URL=http://127.0.0.1:porta`).
fn api() -> String {
    match std::env::var("SEEDY_ATUALIZACAO_URL") {
        Ok(u) if u.starts_with("http://127.0.0.1:") || u.starts_with("http://localhost:") => u.trim_end_matches('/').to_string(),
        _ => "https://api.github.com".to_string(),
    }
}

const LIMITE_DO_INSTALADOR: u64 = 400 * 1024 * 1024;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Atualizacao {
    pub versao: String,
    pub atual: String,
    pub notas: String,
    pub tamanho: u64,
    /// Nome do arquivo que seria instalado (vazio quando não há instalador para este sistema).
    pub arquivo: String,
    /// Página da release (para ver as notas ou instalar na mão).
    pub pagina: String,
    /// A release publica o `SHA256SUMS.txt`: sem ele o Seedy não instala sozinho.
    pub confere: bool,
    /// Instalação automática possível aqui (instalador no Windows, AppImage no Linux).
    pub automatica: bool,
}

#[derive(Serialize, Clone)]
struct Progresso {
    lido: u64,
    total: u64,
}

struct Release {
    versao: String,
    notas: String,
    pagina: String,
    ativos: Vec<Ativo>,
}

struct Ativo {
    id: u64,
    nome: String,
    tamanho: u64,
    url_publica: String,
}

/// "v0.5.6" → [0, 5, 6] (ignora o que vem depois de `-`, como `-beta`).
fn numeros(versao: &str) -> Vec<u64> {
    versao
        .trim()
        .trim_start_matches('v')
        .split('-')
        .next()
        .unwrap_or("")
        .split('.')
        .map(|p| p.parse().unwrap_or(0))
        .collect()
}

pub fn eh_mais_nova(candidata: &str, atual: &str) -> bool {
    let (a, b) = (numeros(candidata), numeros(atual));
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
        if x != y {
            return x > y;
        }
    }
    false
}

fn token(estado: &State<'_, ContaGithub>) -> Option<String> {
    estado.token()
}

fn agente() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(20)).timeout(Duration::from_secs(900)).redirects(0).build()
}

fn ultima_release(token: Option<&str>) -> Result<Release, String> {
    let mut p = agente()
        .get(&format!("{}/repos/{REPOSITORIO}/releases/latest", api()))
        .set("Accept", "application/vnd.github+json")
        .set("User-Agent", "Seedy");
    if let Some(t) = token {
        p = p.set("Authorization", &format!("Bearer {t}"));
    }
    let r = match p.call() {
        Ok(r) => r,
        Err(ureq::Error::Status(404, _)) => {
            return Err(if token.is_some() {
                "o GitHub não achou nenhuma release do Seedy (ou esta conta não vê o repositório)".into()
            } else {
                "o repositório do Seedy ainda é privado: conecte a conta do GitHub (␣ G) para atualizar".into()
            })
        }
        Err(ureq::Error::Status(c, _)) => return Err(format!("o GitHub respondeu {c} ao procurar atualização")),
        Err(e) => return Err(format!("sem conexão para procurar atualização: {e}")),
    };
    let v: serde_json::Value = serde_json::from_str(&r.into_string().map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let ativos = v["assets"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|a| Ativo {
            id: a["id"].as_u64().unwrap_or(0),
            nome: a["name"].as_str().unwrap_or_default().to_string(),
            tamanho: a["size"].as_u64().unwrap_or(0),
            url_publica: a["browser_download_url"].as_str().unwrap_or_default().to_string(),
        })
        .collect();
    Ok(Release {
        versao: v["tag_name"].as_str().unwrap_or_default().trim_start_matches('v').to_string(),
        notas: v["body"].as_str().unwrap_or_default().to_string(),
        pagina: v["html_url"].as_str().unwrap_or_default().to_string(),
        ativos,
    })
}

/// O instalador desta plataforma, se a atualização automática vale para como o Seedy foi instalado.
fn escolher_ativo(r: &Release) -> Option<&Ativo> {
    #[cfg(windows)]
    {
        // Só quem instalou pelo instalador (tem o uninstall.exe ao lado) atualiza sozinho; o portátil, não.
        let exe = std::env::current_exe().ok()?;
        if !exe.parent()?.join("uninstall.exe").exists() {
            return None;
        }
        r.ativos.iter().find(|a| a.nome.ends_with("_x64-setup.exe"))
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::env::var_os("APPIMAGE")?;
        r.ativos.iter().find(|a| a.nome.ends_with(".AppImage") && (a.nome.contains("amd64") || a.nome.contains("x86_64")))
    }
    #[cfg(target_os = "macos")]
    {
        let _ = r;
        None
    }
}

fn montar(r: &Release) -> Atualizacao {
    let ativo = escolher_ativo(r);
    Atualizacao {
        versao: r.versao.clone(),
        atual: env!("CARGO_PKG_VERSION").to_string(),
        notas: r.notas.clone(),
        tamanho: ativo.map(|a| a.tamanho).unwrap_or(0),
        arquivo: ativo.map(|a| a.nome.clone()).unwrap_or_default(),
        pagina: r.pagina.clone(),
        confere: r.ativos.iter().any(|a| a.nome == "SHA256SUMS.txt"),
        automatica: ativo.is_some(),
    }
}

#[tauri::command]
pub fn atualizacao_versao() -> String {
    // Sobras de uma atualização anterior (o instalador baixado).
    let _ = std::fs::remove_dir_all(std::env::temp_dir().join("seedy-atualizacao"));
    env!("CARGO_PKG_VERSION").to_string()
}

/// Procura uma release mais nova que esta versão. `None`: está em dia.
#[tauri::command]
pub async fn atualizacao_verificar(estado: State<'_, ContaGithub>) -> Result<Option<Atualizacao>, String> {
    let t = token(&estado);
    tauri::async_runtime::spawn_blocking(move || {
        let r = ultima_release(t.as_deref())?;
        Ok(eh_mais_nova(&r.versao, env!("CARGO_PKG_VERSION")).then(|| montar(&r)))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Baixa um ativo da release (pela API, com a conta, quando o repositório é privado), seguindo
/// o redirecionamento para o armazenamento sem mandar o token para lá.
fn baixar(a: &Ativo, token: Option<&str>, destino: &mut dyn Write, ao_progredir: &mut dyn FnMut(u64)) -> Result<(u64, String), String> {
    let (mut url, mut com_token) = match token {
        Some(_) => (format!("{}/repos/{REPOSITORIO}/releases/assets/{}", api(), a.id), true),
        None => (a.url_publica.clone(), false),
    };
    for _ in 0..5 {
        let mut p = agente().get(&url).set("Accept", "application/octet-stream").set("User-Agent", "Seedy");
        if let (true, Some(t)) = (com_token, token) {
            p = p.set("Authorization", &format!("Bearer {t}"));
        }
        let r = match p.call() {
            Ok(r) => r,
            Err(ureq::Error::Status(c, _)) => return Err(format!("o GitHub respondeu {c} ao baixar {}", a.nome)),
            Err(e) => return Err(format!("não consegui baixar {}: {e}", a.nome)),
        };
        if (300..400).contains(&r.status()) {
            url = r.header("Location").ok_or("redirecionamento sem destino")?.to_string();
            com_token = false;
            continue;
        }
        let mut leitor = r.into_reader();
        let mut hash = Sha256::new();
        let mut buf = vec![0u8; 64 * 1024];
        let mut total = 0u64;
        loop {
            let n = leitor.read(&mut buf).map_err(|e| format!("o download foi interrompido: {e}"))?;
            if n == 0 {
                break;
            }
            total += n as u64;
            if total > LIMITE_DO_INSTALADOR {
                return Err("o arquivo da release é grande demais para ser um instalador do Seedy".into());
            }
            destino.write_all(&buf[..n]).map_err(|e| e.to_string())?;
            hash.update(&buf[..n]);
            ao_progredir(total);
        }
        return Ok((total, hash.finalize().iter().map(|b| format!("{b:02x}")).collect()));
    }
    Err("redirecionamentos demais ao baixar".into())
}

/// O hash de `nome` no `SHA256SUMS.txt` (linhas `hash  arquivo`, como o `sha256sum` escreve).
fn hash_publicado(soma: &str, nome: &str) -> Option<String> {
    soma.lines().find_map(|l| {
        let (h, resto) = l.split_once(char::is_whitespace)?;
        (resto.trim().trim_start_matches('*') == nome && h.len() == 64).then(|| h.to_lowercase())
    })
}

fn pasta_de_download() -> Result<PathBuf, String> {
    let p = std::env::temp_dir().join("seedy-atualizacao");
    std::fs::create_dir_all(&p).map_err(|e| format!("não consegui criar {}: {e}", p.display()))?;
    Ok(p)
}

/// Baixa, confere e instala a versão que a interface mostrou; fecha o Seedy e o abre de novo.
#[tauri::command]
pub async fn atualizacao_instalar(estado: State<'_, ContaGithub>, app: AppHandle, versao: String) -> Result<(), String> {
    let t = token(&estado);
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let r = ultima_release(t.as_deref())?;
        if r.versao != versao.trim_start_matches('v') || !eh_mais_nova(&r.versao, env!("CARGO_PKG_VERSION")) {
            return Err("a release mudou desde o aviso: verifique de novo".into());
        }
        let ativo = escolher_ativo(&r).ok_or("este Seedy não se atualiza sozinho (portátil, pacote do sistema ou macOS): baixe pela página da release")?;
        let soma = r.ativos.iter().find(|a| a.nome == "SHA256SUMS.txt").ok_or("a release não publicou o SHA256SUMS.txt: por segurança o Seedy não instala sozinho")?;
        let mut texto = Vec::new();
        baixar(soma, t.as_deref(), &mut texto, &mut |_| {})?;
        let esperado = hash_publicado(&String::from_utf8_lossy(&texto), &ativo.nome).ok_or_else(|| format!("o SHA256SUMS.txt não lista {}", ativo.nome))?;

        let destino = pasta_de_download()?.join(&ativo.nome);
        let parcial = destino.with_extension("baixando");
        let (bytes, hash) = {
            let mut f = File::create(&parcial).map_err(|e| e.to_string())?;
            let total = ativo.tamanho;
            let mut ultimo = 0u64;
            let r = baixar(ativo, t.as_deref(), &mut f, &mut |lido| {
                if lido - ultimo >= 256 * 1024 || lido == total {
                    ultimo = lido;
                    let _ = app2.emit("atualizacao-progresso", Progresso { lido, total });
                }
            });
            r.map_err(|e| {
                let _ = std::fs::remove_file(&parcial);
                e
            })?
        };
        if bytes != ativo.tamanho {
            let _ = std::fs::remove_file(&parcial);
            return Err(format!("o download veio com {bytes} bytes, esperava {}", ativo.tamanho));
        }
        if hash != esperado {
            let _ = std::fs::remove_file(&parcial);
            return Err("o SHA-256 do download não bate com o publicado na release: não instalei".into());
        }
        std::fs::rename(&parcial, &destino).map_err(|e| e.to_string())?;
        aplicar(&destino)
    })
    .await
    .map_err(|e| e.to_string())??;
    // O instalador espera o Seedy fechar.
    app.exit(0);
    Ok(())
}

#[cfg(windows)]
fn aplicar(instalador: &std::path::Path) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let script = pasta_de_download()?.join("atualizar.cmd");
    // Espera o Seedy sair, instala em silêncio, abre de novo (o Seedy reabre o último projeto) e se apaga.
    let texto = format!(
        "@echo off\r\ntimeout /t 3 /nobreak >nul\r\n\"{}\" /S\r\nstart \"\" \"{}\"\r\ndel \"%~f0\"\r\n",
        instalador.display(),
        exe.display()
    );
    std::fs::write(&script, texto).map_err(|e| e.to_string())?;
    // CREATE_NO_WINDOW | DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP; fora do job que mata os filhos do Seedy ao fechar.
    crate::processos::spawn_livre(std::process::Command::new("cmd").arg("/C").arg(&script), 0x0800_0208).map_err(|e| format!("não consegui rodar o instalador: {e}"))?;
    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn aplicar(novo: &std::path::Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let atual = PathBuf::from(std::env::var_os("APPIMAGE").ok_or("sem APPIMAGE")?);
    std::fs::set_permissions(novo, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    // Copia ao lado e troca por rename (atômico): o AppImage em uso continua válido até fechar.
    let lado = atual.with_extension("novo");
    std::fs::copy(novo, &lado).map_err(|e| format!("não consegui gravar ao lado de {}: {e}", atual.display()))?;
    std::fs::set_permissions(&lado, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    std::fs::rename(&lado, &atual).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(novo);
    std::process::Command::new("sh").arg("-c").arg(format!("sleep 2; exec '{}'", atual.display().to_string().replace('\'', r"'\''"))).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn aplicar(_novo: &std::path::Path) -> Result<(), String> {
    Err("no macOS a atualização é pela página da release".into())
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn compara_versoes() {
        assert!(eh_mais_nova("0.5.6", "0.5.5"));
        assert!(eh_mais_nova("v0.6.0", "0.5.9"));
        assert!(eh_mais_nova("1.0", "0.9.9"));
        assert!(!eh_mais_nova("0.5.5", "0.5.5"));
        assert!(!eh_mais_nova("0.5.4", "0.5.5"));
        assert!(!eh_mais_nova("0.5.6-beta", "0.5.6"));
    }

    #[test]
    fn le_o_hash_publicado() {
        let h = "a".repeat(64);
        let soma = format!("{h}  Seedy_0.5.6_x64-setup.exe\n{}  *outro.deb\n", "b".repeat(64));
        assert_eq!(hash_publicado(&soma, "Seedy_0.5.6_x64-setup.exe"), Some(h));
        assert_eq!(hash_publicado(&soma, "outro.deb"), Some("b".repeat(64)));
        assert_eq!(hash_publicado(&soma, "nao.exe"), None);
    }
}
