//! Git e GitHub.
//!
//! O núcleo só roda o `git` da máquina (respeita config, hooks e o gerenciador de
//! credenciais do usuário) e devolve a saída; quem entende a saída é a interface.
//! A conta do GitHub usa a mesma credencial do Git (no Windows, o Git Credential
//! Manager faz o login pelo navegador, como no IntelliJ). O token fica só aqui no
//! núcleo: a interface recebe o nome do usuário, nunca o token.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::State;

#[tauri::command]
pub fn branch_atual(raiz: String) -> Option<String> {
    let head = fs::read_to_string(Path::new(&raiz).join(".git").join("HEAD")).ok()?;
    let head = head.trim();
    match head.strip_prefix("ref: refs/heads/") {
        Some(branch) => Some(branch.to_string()),
        // HEAD destacado: mostra o hash curto.
        None => Some(head.chars().take(7).collect()),
    }
}

#[derive(Serialize)]
pub struct SaidaGit {
    pub codigo: i32,
    pub saida: String,
    pub erro: String,
}

pub(crate) fn comando_git(pasta: Option<&str>) -> Command {
    let mut c = Command::new("git");
    if let Some(p) = pasta {
        c.current_dir(p);
    }
    // Saída estável e sem cor; caminhos com acento sem escape; nunca pergunta no terminal
    // (o gerenciador de credenciais ainda pode abrir a janela de login dele).
    c.args(["-c", "core.quotepath=false", "-c", "color.ui=false", "-c", "core.pager=cat"])
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        // Nada de editor interativo (cherry-pick/rebase --continue usam a mensagem pronta).
        .env("GIT_EDITOR", "true")
        .env("GIT_SEQUENCE_EDITOR", "true")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c
}

pub(crate) fn rodar(mut c: Command, entrada: Option<&str>) -> Result<SaidaGit, String> {
    let mut filho = c.spawn().map_err(|e| format!("não consegui rodar o git (ele está instalado?): {e}"))?;
    if let Some(texto) = entrada {
        if let Some(mut stdin) = filho.stdin.take() {
            let _ = stdin.write_all(texto.as_bytes());
        }
    } else {
        drop(filho.stdin.take());
    }
    let saida = filho.wait_with_output().map_err(|e| e.to_string())?;
    Ok(SaidaGit {
        codigo: saida.status.code().unwrap_or(-1),
        saida: String::from_utf8_lossy(&saida.stdout).into_owned(),
        erro: String::from_utf8_lossy(&saida.stderr).into_owned(),
    })
}

/// Roda `git <args>` na pasta do projeto (ou sem pasta, para `clone`).
#[tauri::command]
pub async fn git(pasta: Option<String>, args: Vec<String>, entrada: Option<String>) -> Result<SaidaGit, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut c = comando_git(pasta.as_deref());
        c.args(&args);
        rodar(c, entrada.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------- GitHub ----------

#[derive(Default)]
pub struct ContaGithub(Mutex<Option<String>>);

#[derive(Serialize, Clone)]
pub struct Usuario {
    pub login: String,
    pub nome: Option<String>,
    pub avatar: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Repositorio {
    pub nome: String,
    pub dono: String,
    pub descricao: Option<String>,
    pub privado: bool,
    pub url_clone: String,
    pub atualizado: String,
}

const PEDIDO_GITHUB: &str = "protocol=https\nhost=github.com\n\n";

/// Lê a credencial do github.com pelo `git credential fill`. Com `interativo`, o
/// gerenciador de credenciais pode abrir o login no navegador; sem, só usa o que já tem.
fn token_do_git(interativo: bool) -> Result<String, String> {
    let mut c = comando_git(None);
    c.args(["credential", "fill"]);
    if !interativo {
        c.env("GCM_INTERACTIVE", "never");
    }
    let r = rodar(c, Some(PEDIDO_GITHUB))?;
    if r.codigo != 0 {
        return Err("sem credencial do GitHub".into());
    }
    r.saida
        .lines()
        .find_map(|l| l.strip_prefix("password="))
        .map(str::to_string)
        .filter(|t| !t.is_empty())
        .ok_or_else(|| "sem credencial do GitHub".into())
}

fn agente() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(Duration::from_secs(20)).build()
}

fn api_github(token: &str, caminho: &str) -> Result<serde_json::Value, String> {
    agente()
        .get(&format!("https://api.github.com{caminho}"))
        .set("Authorization", &format!("Bearer {token}"))
        .set("Accept", "application/vnd.github+json")
        .set("User-Agent", "Seedy")
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(401, _) => "o GitHub recusou a credencial (expirada ou revogada)".to_string(),
            outro => format!("GitHub: {outro}"),
        })?
        .into_string()
        .map_err(|e| e.to_string())
        .and_then(|texto| serde_json::from_str(&texto).map_err(|e| e.to_string()))
}

fn usuario(token: &str) -> Result<Usuario, String> {
    let u = api_github(token, "/user")?;
    Ok(Usuario {
        login: u["login"].as_str().unwrap_or_default().to_string(),
        nome: u["name"].as_str().map(str::to_string),
        avatar: u["avatar_url"].as_str().map(str::to_string),
    })
}

/// Conta conectada. `interativo` = o usuário pediu para conectar agora (pode abrir o navegador).
#[tauri::command]
pub async fn github_conta(estado: State<'_, ContaGithub>, interativo: bool) -> Result<Option<Usuario>, String> {
    let resultado = tauri::async_runtime::spawn_blocking(move || -> Result<Option<(String, Usuario)>, String> {
        let token = match token_do_git(interativo) {
            Ok(t) => t,
            Err(_) if !interativo => return Ok(None),
            Err(e) => return Err(format!("{e}: o login foi cancelado ou não há gerenciador de credenciais (use um token)")),
        };
        let u = usuario(&token)?;
        Ok(Some((token, u)))
    })
    .await
    .map_err(|e| e.to_string())??;
    let mut guardado = estado.0.lock().unwrap();
    *guardado = resultado.as_ref().map(|(t, _)| t.clone());
    Ok(resultado.map(|(_, u)| u))
}

/// Conecta com um token colado (Linux sem gerenciador, ou quem prefere token).
/// Guarda pelo `git credential approve`, no helper que o Git do usuário usa.
#[tauri::command]
pub async fn github_token(estado: State<'_, ContaGithub>, token: String) -> Result<Usuario, String> {
    let token = token.trim().to_string();
    let (token, u) = tauri::async_runtime::spawn_blocking(move || -> Result<(String, Usuario), String> {
        let u = usuario(&token)?;
        let mut c = comando_git(None);
        c.args(["credential", "approve"]);
        let pedido = format!("protocol=https\nhost=github.com\nusername={}\npassword={token}\n\n", u.login);
        let _ = rodar(c, Some(&pedido));
        Ok((token, u))
    })
    .await
    .map_err(|e| e.to_string())??;
    *estado.0.lock().unwrap() = Some(token);
    Ok(u)
}

/// Desconecta: o gerenciador de credenciais esquece o login do github.com.
#[tauri::command]
pub async fn github_desconectar(estado: State<'_, ContaGithub>) -> Result<(), String> {
    *estado.0.lock().unwrap() = None;
    tauri::async_runtime::spawn_blocking(|| {
        let mut c = comando_git(None);
        c.args(["credential", "reject"]);
        rodar(c, Some(PEDIDO_GITHUB)).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Repositórios da conta (dono, colaborador e organizações), mais recentes primeiro.
#[tauri::command]
pub async fn github_repositorios(estado: State<'_, ContaGithub>) -> Result<Vec<Repositorio>, String> {
    let token = estado.0.lock().unwrap().clone().ok_or("conecte a conta do GitHub primeiro")?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut saida = Vec::new();
        for pagina in 1..=5 {
            let lista = api_github(&token, &format!("/user/repos?per_page=100&sort=updated&page={pagina}"))?;
            let itens = lista.as_array().cloned().unwrap_or_default();
            if itens.is_empty() {
                break;
            }
            saida.extend(itens.iter().map(|r| Repositorio {
                nome: r["name"].as_str().unwrap_or_default().to_string(),
                dono: r["owner"]["login"].as_str().unwrap_or_default().to_string(),
                descricao: r["description"].as_str().map(str::to_string),
                privado: r["private"].as_bool().unwrap_or(false),
                url_clone: r["clone_url"].as_str().unwrap_or_default().to_string(),
                atualizado: r["updated_at"].as_str().unwrap_or_default().to_string(),
            }));
            if itens.len() < 100 {
                break;
            }
        }
        Ok(saida)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Pedido à API do GitHub em nome da conta conectada (criar PR, issue, listar branches...).
/// O token nunca sai do núcleo; só caminhos de repositório/usuário são aceitos.
#[tauri::command]
pub async fn github_api(
    estado: State<'_, ContaGithub>,
    metodo: String,
    caminho: String,
    corpo: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let token = estado.0.lock().unwrap().clone().ok_or("conecte a conta do GitHub primeiro (␣ G)")?;
    if !caminho_permitido(&caminho) {
        return Err(format!("caminho da API não permitido: {caminho}"));
    }
    let metodo = metodo.to_uppercase();
    if !matches!(metodo.as_str(), "GET" | "POST" | "PATCH") {
        return Err(format!("método não permitido: {metodo}"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let pedido = agente()
            .request(&metodo, &format!("https://api.github.com{caminho}"))
            .set("Authorization", &format!("Bearer {token}"))
            .set("Accept", "application/vnd.github+json")
            .set("User-Agent", "Seedy");
        let resposta = match corpo {
            Some(c) => pedido.set("Content-Type", "application/json").send_string(&c.to_string()),
            None => pedido.call(),
        };
        let texto = match resposta {
            Ok(r) => r.into_string().map_err(|e| e.to_string())?,
            Err(ureq::Error::Status(codigo, r)) => {
                let corpo = r.into_string().unwrap_or_default();
                return Err(erro_do_github(codigo, &corpo));
            }
            Err(e) => return Err(format!("GitHub: {e}")),
        };
        if texto.trim().is_empty() {
            return Ok(serde_json::Value::Null);
        }
        serde_json::from_str(&texto).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn caminho_permitido(caminho: &str) -> bool {
    (caminho.starts_with("/repos/") || caminho.starts_with("/user")) && !caminho.contains("..") && !caminho.contains("://")
}

/// Mensagem legível do erro do GitHub (o 422 traz o motivo em `errors[].message`).
fn erro_do_github(codigo: u16, corpo: &str) -> String {
    let json: serde_json::Value = serde_json::from_str(corpo).unwrap_or_default();
    let detalhes: Vec<String> = json["errors"]
        .as_array()
        .map(|a| a.iter().filter_map(|e| e["message"].as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    let principal = json["message"].as_str().unwrap_or("erro");
    match codigo {
        401 => "o GitHub recusou a credencial (expirada ou revogada)".into(),
        403 | 404 => format!("GitHub {codigo}: {principal} (a conta tem acesso a este repositório?)"),
        _ if !detalhes.is_empty() => format!("GitHub: {}", detalhes.join("; ")),
        _ => format!("GitHub {codigo}: {principal}"),
    }
}

/// Abre um endereço do GitHub no navegador padrão (o PR ou a issue recém-criados).
#[tauri::command]
pub fn abrir_no_navegador(url: String) -> Result<(), String> {
    if !url.starts_with("https://github.com/") || url.chars().any(|c| c.is_whitespace() || c == '"') {
        return Err("só abro endereços do github.com".into());
    }
    #[cfg(windows)]
    let mut c = {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new("rundll32");
        c.args(["url.dll,FileProtocolHandler", &url]).creation_flags(0x0800_0000);
        c
    };
    #[cfg(not(windows))]
    let mut c = {
        let mut c = Command::new("xdg-open");
        c.arg(&url);
        c
    };
    c.spawn().map(|_| ()).map_err(|e| format!("não consegui abrir o navegador: {e}"))
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn roda_git_e_devolve_codigo() {
        let r = rodar(
            {
                let mut c = comando_git(None);
                c.arg("--version");
                c
            },
            None,
        )
        .unwrap();
        assert_eq!(r.codigo, 0);
        assert!(r.saida.starts_with("git version"));
    }

    #[test]
    fn so_aceita_caminhos_de_repositorio_e_usuario() {
        assert!(caminho_permitido("/repos/dono/repo/pulls"));
        assert!(caminho_permitido("/user"));
        assert!(!caminho_permitido("/admin/users"));
        assert!(!caminho_permitido("/repos/../admin"));
        assert!(!caminho_permitido("https://outro.com/repos/x"));
    }

    #[test]
    fn erro_do_github_mostra_o_motivo() {
        let corpo = r#"{"message":"Validation Failed","errors":[{"message":"A pull request already exists for x:y."}]}"#;
        assert_eq!(erro_do_github(422, corpo), "GitHub: A pull request already exists for x:y.");
        assert!(erro_do_github(404, r#"{"message":"Not Found"}"#).contains("Not Found"));
    }
}
