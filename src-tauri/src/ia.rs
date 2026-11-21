//! IA (Claude) para a interface: guarda a chave da API e faz o pedido com streaming.
//!
//! A chave nunca vai para a interface. Vem de `ANTHROPIC_API_KEY` ou do arquivo
//! `ia.chave` na pasta de configuração do Seedy. A interface monta o corpo do pedido
//! (modelo, ferramentas, conversa); aqui só entram a autenticação e o transporte,
//! e cada evento SSE da resposta volta para a interface por um `Channel`.

use crate::tema::pasta_config;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter};

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
pub async fn ia_mensagem(
    mut corpo: serde_json::Value,
    eventos: Channel<String>,
    modo: Option<String>,
    mcp: tauri::State<'_, crate::mcp::Mcp>,
    app: AppHandle,
) -> Result<(), String> {
    if modo.as_deref() == Some("assinatura") {
        let config_mcp = mcp.arquivo_de_config_do_claude();
        return tauri::async_runtime::spawn_blocking(move || via_claude(&corpo, &eventos, config_mcp, &app))
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
fn via_claude(corpo: &serde_json::Value, eventos: &Channel<String>, config_mcp: Option<PathBuf>, app: &AppHandle) -> Result<(), String> {
    use std::io::Write;
    let mut args: Vec<String> = ["-p", "--output-format", "stream-json", "--include-partial-messages", "--verbose", "--tools", ""]
        .map(String::from)
        .to_vec();
    if let Some(m) = corpo["model"].as_str().filter(|m| m.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.' || c == '[' || c == ']')) {
        args.extend(["--model".into(), m.into()]);
    }
    // As ferramentas da IDE (MCP do Seedy), e só elas: nada dos conectores da conta do usuário.
    if let Some(arquivo) = config_mcp {
        args.extend(["--mcp-config".into(), arquivo.to_string_lossy().into_owned(), "--strict-mcp-config".into(), "--allowedTools".into(), "mcp__seedy".into()]);
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
    let mut tradutor = Tradutor::default();
    let mut recebeu = false;
    let mut falha: Option<String> = None;
    for linha in BufReader::new(filho.stdout.take().ok_or("sem saída do claude")?).lines() {
        let linha = linha.map_err(|e| e.to_string())?;
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&linha) else { continue };
        match v["type"].as_str() {
            Some("stream_event") => {
                recebeu = true;
                let mut parar = false;
                for e in tradutor.traduzir(&v["event"]) {
                    if eventos.send(e.to_string()).is_err() {
                        parar = true;
                        break;
                    }
                }
                if parar {
                    let _ = filho.kill();
                    break;
                }
            }
            Some("rate_limit_event") => {
                guardar_evento_de_limite(&linha);
                if let Some(l) = limite_do_evento(&v) {
                    let _ = app.emit("ia-limites", l);
                }
            }
            Some("result") if v["is_error"] == true => falha = v["result"].as_str().map(str::to_string),
            _ => {}
        }
    }
    if recebeu {
        for e in tradutor.fim() {
            let _ = eventos.send(e.to_string());
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

/// O Claude Code roda as ferramentas sozinho, em vários turnos. A interface só quer o texto, como
/// uma mensagem única: aqui os blocos de texto seguem (reindexados), cada chamada de ferramenta
/// vira uma linha "⚙ nome" e o resto (thinking, fim de turno) some.
#[derive(Default)]
struct Tradutor {
    proximo: u64,
    /// Índice do bloco no turno atual → índice na mensagem única (só blocos de texto).
    mapa: HashMap<u64, u64>,
    comecou: bool,
}

impl Tradutor {
    fn linha_de_texto(&mut self, texto: &str) -> Vec<serde_json::Value> {
        let i = self.proximo;
        self.proximo += 1;
        vec![
            serde_json::json!({"type": "content_block_start", "index": i, "content_block": {"type": "text", "text": ""}}),
            serde_json::json!({"type": "content_block_delta", "index": i, "delta": {"type": "text_delta", "text": texto}}),
            serde_json::json!({"type": "content_block_stop", "index": i}),
        ]
    }

    fn traduzir(&mut self, ev: &serde_json::Value) -> Vec<serde_json::Value> {
        let mut saida = Vec::new();
        if !self.comecou {
            self.comecou = true;
            saida.push(serde_json::json!({"type": "message_start", "message": {"role": "assistant", "content": []}}));
        }
        let origem = ev["index"].as_u64().unwrap_or(0);
        match ev["type"].as_str() {
            Some("message_start") => self.mapa.clear(),
            Some("content_block_start") => match ev["content_block"]["type"].as_str() {
                Some("text") => {
                    self.mapa.insert(origem, self.proximo);
                    saida.push(serde_json::json!({"type": "content_block_start", "index": self.proximo, "content_block": {"type": "text", "text": ""}}));
                    self.proximo += 1;
                }
                Some("tool_use") => {
                    let nome = ev["content_block"]["name"].as_str().unwrap_or("ferramenta");
                    let nome = nome.strip_prefix("mcp__seedy__").unwrap_or(nome);
                    saida.extend(self.linha_de_texto(&format!("⚙ {nome}\n\n")));
                }
                _ => {}
            },
            Some("content_block_delta") => {
                if let (Some(&i), Some(t)) = (self.mapa.get(&origem), ev["delta"]["text"].as_str()) {
                    saida.push(serde_json::json!({"type": "content_block_delta", "index": i, "delta": {"type": "text_delta", "text": t}}));
                }
            }
            Some("content_block_stop") => {
                if let Some(i) = self.mapa.remove(&origem) {
                    saida.push(serde_json::json!({"type": "content_block_stop", "index": i}));
                }
            }
            _ => {}
        }
        saida
    }

    fn fim(&mut self) -> Vec<serde_json::Value> {
        vec![
            serde_json::json!({"type": "message_delta", "delta": {"stop_reason": "end_turn"}}),
            serde_json::json!({"type": "message_stop"}),
        ]
    }
}

/// Os últimos eventos de limite que o Claude Code mandou, crus, em `limites-eventos.log` (para
/// conferir o formato quando a tela mostra menos do que o esperado).
fn guardar_evento_de_limite(linha: &str) {
    let arquivo = pasta_config().join("limites-eventos.log");
    let mut linhas: Vec<String> = fs::read_to_string(&arquivo).map(|t| t.lines().map(String::from).collect()).unwrap_or_default();
    linhas.push(linha.trim().to_string());
    let sobra = linhas.len().saturating_sub(40);
    let _ = fs::create_dir_all(pasta_config());
    let _ = fs::write(&arquivo, linhas[sobra..].join("\n") + "\n");
}

/// Um limite de uso da assinatura (janela de 5 horas, semana) como o Claude Code informa.
#[derive(serde::Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Limite {
    /// Como veio: "five_hour", "seven_day", "seven_day_opus"...
    pub tipo: String,
    /// 0 a 100, quando o Claude Code informa a porcentagem usada.
    pub utilizacao: Option<f64>,
    /// Quando a janela renova (segundos desde 1970).
    pub reinicia_em: Option<i64>,
    /// "allowed", "allowed_warning", "rejected"...
    pub estado: Option<String>,
}

/// O evento `rate_limit_event` do stream-json do Claude Code. O formato muda entre versões, então
/// aceita os nomes em camelCase e snake_case e só exige o tipo da janela.
pub fn limite_do_evento(v: &serde_json::Value) -> Option<Limite> {
    let info = v.get("rate_limit_info").or_else(|| v.get("rateLimitInfo")).unwrap_or(v);
    let texto = |chaves: &[&str]| chaves.iter().find_map(|k| info.get(*k).and_then(|x| x.as_str())).map(String::from);
    let numero = |chaves: &[&str]| chaves.iter().find_map(|k| info.get(*k).and_then(|x| x.as_f64()));
    let tipo = texto(&["rateLimitType", "rate_limit_type"])?;
    let utilizacao = numero(&["utilization", "utilisation", "usedPercentage", "used_percentage"]).map(|u| if u <= 1.0 { u * 100.0 } else { u });
    let reinicia_em = numero(&["resetsAt", "resets_at", "resetAt"]).map(|t| if t > 1e12 { (t / 1000.0) as i64 } else { t as i64 });
    Some(Limite { tipo, utilizacao, reinicia_em, estado: texto(&["status"]) })
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
    fn tradutor_junta_os_turnos_numa_mensagem_so() {
        let mut t = Tradutor::default();
        let mut saida = Vec::new();
        for ev in [
            serde_json::json!({"type": "message_start"}),
            serde_json::json!({"type": "content_block_start", "index": 0, "content_block": {"type": "text"}}),
            serde_json::json!({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Vou subir."}}),
            serde_json::json!({"type": "content_block_stop", "index": 0}),
            serde_json::json!({"type": "content_block_start", "index": 1, "content_block": {"type": "tool_use", "name": "mcp__seedy__subir_servidor"}}),
            serde_json::json!({"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": "{}"}}),
            serde_json::json!({"type": "message_stop"}),
            serde_json::json!({"type": "message_start"}),
            serde_json::json!({"type": "content_block_start", "index": 0, "content_block": {"type": "text"}}),
            serde_json::json!({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Subiu."}}),
            serde_json::json!({"type": "content_block_stop", "index": 0}),
        ] {
            saida.extend(t.traduzir(&ev));
        }
        saida.extend(t.fim());
        let tipos: Vec<&str> = saida.iter().map(|e| e["type"].as_str().unwrap()).collect();
        assert_eq!(tipos.iter().filter(|t| **t == "message_start").count(), 1);
        assert!(!saida.iter().any(|e| e["content_block"]["type"] == "tool_use" || e["delta"]["type"] == "input_json_delta"));
        assert!(saida.iter().any(|e| e["delta"]["text"].as_str().is_some_and(|x| x.contains("⚙ subir_servidor"))));
        let inicios: Vec<u64> = saida.iter().filter(|e| e["type"] == "content_block_start").map(|e| e["index"].as_u64().unwrap()).collect();
        assert_eq!(inicios, vec![0, 1, 2]);
        assert_eq!(saida.last().unwrap()["type"], "message_stop");
    }

    #[test]
    fn le_o_evento_de_limite() {
        let v = serde_json::json!({"type": "rate_limit_event", "rate_limit_info": {"status": "allowed_warning", "resetsAt": 1730000000, "rateLimitType": "five_hour", "utilization": 0.78}});
        let l = limite_do_evento(&v).unwrap();
        assert_eq!((l.tipo.as_str(), l.reinicia_em, l.estado.as_deref()), ("five_hour", Some(1730000000), Some("allowed_warning")));
        assert!((l.utilizacao.unwrap() - 78.0).abs() < 1e-9);
        let so_tipo = serde_json::json!({"type": "rate_limit_event", "rate_limit_info": {"rateLimitType": "seven_day", "resetsAt": 1730000000000i64, "utilization": 34}});
        let l = limite_do_evento(&so_tipo).unwrap();
        assert_eq!((l.utilizacao, l.reinicia_em), (Some(34.0), Some(1730000000)));
        assert!(limite_do_evento(&serde_json::json!({"type": "rate_limit_event"})).is_none());
    }

    #[test]
    fn erro_da_api_mostra_o_motivo() {
        let corpo = r#"{"type":"error","error":{"type":"invalid_request_error","message":"max_tokens: too large"}}"#;
        assert_eq!(erro_da_api(400, corpo), "API 400: max_tokens: too large");
        assert!(erro_da_api(401, "").contains("chave"));
    }
}
