//! IA (Claude) para a interface: guarda a chave da API e faz o pedido com streaming.
//!
//! A chave nunca vai para a interface. Vem de `ANTHROPIC_API_KEY` ou do arquivo
//! `ia.chave` na pasta de configuração do Seedy. A interface monta o corpo do pedido
//! (modelo, ferramentas, conversa); aqui só entram a autenticação e o transporte,
//! e cada evento SSE da resposta volta para a interface por um `Channel`.

use crate::tema::pasta_config;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tauri::ipc::Channel;

const VERSAO_DA_API: &str = "2026-10-21";
/// Se o modelo recusar por segurança, o próprio servidor tenta outro modelo.
const BETAS: &str = "server-side-fallback-2026-07-01";

fn arquivo_da_chave() -> PathBuf {
    pasta_config().join("ia.chave")
}

fn chave() -> Option<String> {
    std::env::var("ANTHROPIC_API_KEY")
        .ok()
        .or_else(|| fs::read_to_string(arquivo_da_chave()).ok())
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty())
}

fn endereco_base() -> String {
    std::env::var("ANTHROPIC_BASE_URL")
        .ok()
        .filter(|u| !u.trim().is_empty())
        .unwrap_or_else(|| "https://api.anthropic.com".into())
        .trim_end_matches('/')
        .to_string()
}

/// Há chave configurada? (a interface pergunta antes de abrir o chat)
#[tauri::command]
pub fn ia_tem_chave() -> bool {
    chave().is_some()
}

/// Grava a chave colada pelo usuário na pasta de configuração (só o dono lê, no Linux).
#[tauri::command]
pub fn ia_definir_chave(chave: String) -> Result<(), String> {
    let chave = chave.trim();
    if chave.is_empty() || chave.chars().any(char::is_whitespace) {
        return Err("chave inválida".into());
    }
    fs::create_dir_all(pasta_config()).map_err(|e| e.to_string())?;
    let caminho = arquivo_da_chave();
    fs::write(&caminho, chave).map_err(|e| format!("não consegui gravar a chave: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&caminho, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

#[tauri::command]
pub fn ia_esquecer_chave() -> Result<(), String> {
    match fs::remove_file(arquivo_da_chave()) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Envia um pedido à Messages API com `stream: true` e repassa cada evento (o JSON da
/// linha `data:`) pelo canal. Termina quando o servidor fecha o stream.
#[tauri::command]
pub async fn ia_mensagem(mut corpo: serde_json::Value, eventos: Channel<String>, modo: Option<String>) -> Result<(), String> {
    if modo.as_deref() == Some("assinatura") {
        return tauri::async_runtime::spawn_blocking(move || via_claude(&corpo, &eventos))
            .await
            .map_err(|e| e.to_string())?;
    }
    let chave = chave().ok_or("configure a chave da API da Anthropic (␣ a)")?;
    corpo["stream"] = serde_json::Value::Bool(true);
    tauri::async_runtime::spawn_blocking(move || {
        let agente = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(20))
            // Entre um evento e outro pode haver silêncio enquanto o modelo pensa.
            .timeout_read(Duration::from_secs(300))
            .build();
        let resposta = agente
            .post(&format!("{}/v1/messages", endereco_base()))
            .set("x-api-key", &chave)
            .set("anthropic-version", VERSAO_DA_API)
            .set("anthropic-beta", BETAS)
            .set("content-type", "application/json")
            .send_string(&corpo.to_string());
        let resposta = match resposta {
            Ok(r) => r,
            Err(ureq::Error::Status(codigo, r)) => {
                return Err(erro_da_api(codigo, &r.into_string().unwrap_or_default()));
            }
            Err(e) => return Err(format!("sem conexão com a API: {e}")),
        };
        for linha in BufReader::new(resposta.into_reader()).lines() {
            let linha = linha.map_err(|e| format!("a conexão caiu no meio da resposta: {e}"))?;
            if let Some(dados) = dados_do_evento(&linha) {
                if eventos.send(dados.to_string()).is_err() {
                    break; // a interface fechou o chat
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Versão do Claude Code instalado (`claude --version`), se houver. É ele que usa a assinatura.
#[tauri::command]
pub async fn ia_claude_estado() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut c = crate::web::comando_do_node("claude", &["--version".to_string()]);
        c.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
        crate::web::sem_janela(&mut c);
        let saida = c.output().ok()?;
        saida.status.success().then(|| String::from_utf8_lossy(&saida.stdout).trim().to_string())
    })
    .await
    .ok()
    .flatten()
}

/// Texto de um conteúdo da Messages API (string ou lista de blocos); só blocos de texto.
fn texto_do_conteudo(c: &serde_json::Value) -> String {
    match c {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(blocos) => blocos
            .iter()
            .filter_map(|b| match b["type"].as_str() {
                Some("text") => b["text"].as_str().map(str::to_string),
                Some("tool_result") => Some(texto_do_conteudo(&b["content"])),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("
"),
        _ => String::new(),
    }
}

/// O pedido da Messages API virado em um texto só para o `claude -p` (sistema + conversa).
fn prompt_do_corpo(corpo: &serde_json::Value) -> String {
    let mut saida = String::new();
    let sistema = texto_do_conteudo(&corpo["system"]);
    if !sistema.is_empty() {
        saida.push_str(&format!("{sistema}

"));
    }
    for m in corpo["messages"].as_array().into_iter().flatten() {
        let quem = if m["role"] == "assistant" { "Assistente" } else { "Usuário" };
        let t = texto_do_conteudo(&m["content"]);
        if !t.trim().is_empty() {
            saida.push_str(&format!("{quem}: {t}

"));
        }
    }
    saida
}

/// Modo assinatura: roda o `claude -p` (login do próprio Claude Code, sem ferramentas) e repassa
/// os eventos de stream, que já vêm no formato da Messages API dentro de `stream_event`.
fn via_claude(corpo: &serde_json::Value, eventos: &Channel<String>) -> Result<(), String> {
    use std::io::Write;
    let mut args: Vec<String> = ["-p", "--output-format", "stream-json", "--include-partial-messages", "--verbose", "--tools", ""]
        .map(String::from)
        .to_vec();
    if let Some(m) = corpo["model"].as_str().filter(|m| m.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.' || c == '[' || c == ']')) {
        args.extend(["--model".into(), m.into()]);
    }
    let mut c = crate::web::comando_do_node("claude", &args);
    c.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    crate::web::sem_janela(&mut c);
    let mut filho = c.spawn().map_err(|e| format!("não achei o Claude Code (`claude`) no PATH: {e}"))?;
    let mut entrada = filho.stdin.take().ok_or("sem stdin do claude")?;
    let prompt = prompt_do_corpo(corpo);
    std::thread::spawn(move || {
        let _ = entrada.write_all(prompt.as_bytes());
    });
    let erros = filho.stderr.take();
    let leitor_de_erros = std::thread::spawn(move || {
        let mut t = String::new();
        if let Some(mut e) = erros {
            let _ = std::io::Read::read_to_string(&mut e, &mut t);
        }
        t
    });
    let mut recebeu = false;
    let mut falha: Option<String> = None;
    for linha in BufReader::new(filho.stdout.take().ok_or("sem saída do claude")?).lines() {
        let linha = linha.map_err(|e| e.to_string())?;
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&linha) else { continue };
        match v["type"].as_str() {
            Some("stream_event") => {
                recebeu = true;
                if eventos.send(v["event"].to_string()).is_err() {
                    let _ = filho.kill();
                    break;
                }
            }
            Some("result") if v["is_error"] == true => falha = v["result"].as_str().map(str::to_string),
            _ => {}
        }
    }
    let estado = filho.wait().map_err(|e| e.to_string())?;
    let erros = leitor_de_erros.join().unwrap_or_default();
    if let Some(f) = falha {
        return Err(format!("o Claude Code recusou: {f}"));
    }
    if !estado.success() && !recebeu {
        let dica = if erros.to_lowercase().contains("login") { " (rode `claude` no terminal e faça /login)" } else { "" };
        return Err(format!("o Claude Code falhou: {}{dica}", erros.trim()));
    }
    Ok(())
}

/// Conteúdo de uma linha `data: ...` do SSE (as linhas `event:` e vazias são ignoradas).
fn dados_do_evento(linha: &str) -> Option<&str> {
    let dados = linha.strip_prefix("data:")?.trim_start();
    (!dados.is_empty()).then_some(dados)
}

/// Mensagem legível de um erro HTTP da API (`{"error": {"type", "message"}}`).
fn erro_da_api(codigo: u16, corpo: &str) -> String {
    let json: serde_json::Value = serde_json::from_str(corpo).unwrap_or_default();
    let msg = json["error"]["message"].as_str().unwrap_or("erro");
    match codigo {
        401 => "a API recusou a chave (inválida ou revogada): ␣ a para trocar".into(),
        429 => format!("limite de uso da API atingido, tente de novo em instantes ({msg})"),
        529 => "a API está sobrecarregada agora, tente de novo em instantes".into(),
        _ => format!("API {codigo}: {msg}"),
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn le_so_as_linhas_de_dados_do_sse() {
        assert_eq!(dados_do_evento("event: message_start"), None);
        assert_eq!(dados_do_evento(""), None);
        assert_eq!(dados_do_evento(r#"data: {"type":"ping"}"#), Some(r#"{"type":"ping"}"#));
        assert_eq!(dados_do_evento(r#"data:{"a":1}"#), Some(r#"{"a":1}"#));
    }

    #[test]
    fn prompt_junta_sistema_e_conversa() {
        let corpo = serde_json::json!({
            "system": [{"type": "text", "text": "Seja breve."}],
            "messages": [
                {"role": "user", "content": "oi"},
                {"role": "assistant", "content": [{"type": "text", "text": "olá"}, {"type": "tool_use", "id": "x", "name": "n", "input": {}}]},
                {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "x", "content": "ok"}]}
            ]
        });
        assert_eq!(prompt_do_corpo(&corpo), "Seja breve.

Usuário: oi

Assistente: olá

Usuário: ok

");
    }

    #[test]
    fn erro_da_api_mostra_o_motivo() {
        let corpo = r#"{"type":"error","error":{"type":"invalid_request_error","message":"max_tokens: too large"}}"#;
        assert_eq!(erro_da_api(400, corpo), "API 400: max_tokens: too large");
        assert!(erro_da_api(401, "").contains("chave"));
    }
}
