//! Servidor MCP do Seedy (Fase 7): a IA de fora (o Claude Code no terminal) opera a IDE.
//!
//! Transporte HTTP do MCP (JSON-RPC por POST em `/mcp`), só em 127.0.0.1 e com token.
//! As ferramentas são definidas e executadas pela interface (onde estão o editor, o jdtls,
//! o servidor de aplicação e o banco): aqui cada `tools/call` vira o evento `mcp-chamada`
//! e a resposta volta pelo comando `mcp_responder`.

use crate::tema::pasta_config;
use rand::RngCore;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tiny_http::{Header, Request, Response, Server};

const PORTA_INICIAL: u16 = 47823;
/// Uma proposta de edição espera a decisão do usuário: o limite é generoso.
const ESPERA_MAXIMA: Duration = Duration::from_secs(15 * 60);
const VERSAO_DO_PROTOCOLO: &str = "2025-06-18";

const INSTRUCOES: &str = "Ferramentas do Seedy, a IDE aberta pelo usuário: abrir arquivos no editor, ver os erros de \
compilação do Java (jdtls), operar o servidor de aplicação (subir, parar, redeploy, ler o log), fazer requisições \
HTTP à aplicação local e consultar os bancos configurados (só leitura). Para alterar código, prefira propor_edicao: \
a mudança aparece como diff para o usuário aceitar ou recusar, e a resposta diz o que ele decidiu.";

#[derive(Default)]
struct Interno {
    ferramentas: Value,
    pendentes: HashMap<u64, mpsc::Sender<Result<String, String>>>,
}

pub struct Mcp {
    interno: Arc<Mutex<Interno>>,
    proximo: Arc<AtomicU64>,
    porta: Mutex<Option<u16>>,
    token: String,
}

impl Default for Mcp {
    fn default() -> Self {
        Self { interno: Arc::default(), proximo: Arc::default(), porta: Mutex::new(None), token: token() }
    }
}

fn travar<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Token guardado na pasta de configuração (o mesmo entre execuções: o Claude Code
/// registra o servidor uma vez só).
fn token() -> String {
    let arquivo = pasta_config().join("mcp.token");
    if let Ok(t) = fs::read_to_string(&arquivo) {
        let t = t.trim().to_string();
        if t.len() >= 32 {
            return t;
        }
    }
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    let t: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let _ = fs::create_dir_all(pasta_config());
    let _ = fs::write(&arquivo, &t);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&arquivo, fs::Permissions::from_mode(0o600));
    }
    t
}

/// Sobe o servidor numa porta livre a partir de 47823 (chamado no início do app).
pub fn iniciar(app: AppHandle, mcp: &Mcp) {
    let servidor = (PORTA_INICIAL..PORTA_INICIAL + 20).find_map(|p| Server::http(("127.0.0.1", p)).ok().map(|s| (s, p)));
    let Some((servidor, porta)) = servidor else {
        eprintln!("seedy: MCP sem porta livre");
        return;
    };
    *travar(&mcp.porta) = Some(porta);
    let interno = mcp.interno.clone();
    let proximo = mcp.proximo.clone();
    let token = mcp.token.clone();
    std::thread::spawn(move || {
        for pedido in servidor.incoming_requests() {
            let (app, interno, proximo, token) = (app.clone(), interno.clone(), proximo.clone(), token.clone());
            // Uma thread por pedido: uma proposta de edição pode esperar o usuário.
            std::thread::spawn(move || atender(pedido, &app, &interno, &proximo, &token));
        }
    });
}

fn cabecalho(pedido: &Request, nome: &'static str) -> Option<String> {
    pedido.headers().iter().find(|h| h.field.equiv(nome)).map(|h| h.value.as_str().to_string())
}

fn json_resp(corpo: Value) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(corpo.to_string())
        .with_header(Header::from_bytes("Content-Type", "application/json").expect("cabeçalho válido"))
}

fn atender(mut pedido: Request, app: &AppHandle, interno: &Arc<Mutex<Interno>>, proximo: &AtomicU64, token: &str) {
    if pedido.url().split('?').next() != Some("/mcp") {
        let _ = pedido.respond(Response::empty(404));
        return;
    }
    // Contra DNS rebinding: navegador de outro site não fala com o servidor.
    if let Some(origem) = cabecalho(&pedido, "Origin") {
        if !["http://localhost", "http://127.0.0.1"].iter().any(|o| origem.starts_with(o)) {
            let _ = pedido.respond(Response::empty(403));
            return;
        }
    }
    if cabecalho(&pedido, "Authorization").as_deref() != Some(&format!("Bearer {token}")) {
        let _ = pedido.respond(Response::empty(401));
        return;
    }
    if pedido.method().as_str() != "POST" {
        // Sem stream SSE: tudo responde no próprio POST.
        let _ = pedido.respond(Response::empty(405));
        return;
    }
    let mut corpo = String::new();
    if pedido.as_reader().read_to_string(&mut corpo).is_err() {
        let _ = pedido.respond(Response::empty(400));
        return;
    }
    let Ok(mensagem) = serde_json::from_str::<Value>(&corpo) else {
        let _ = pedido.respond(json_resp(json!({"jsonrpc": "2.0", "id": null, "error": {"code": -32700, "message": "JSON inválido"}})));
        return;
    };
    match responder(&mensagem, app, interno, proximo) {
        Some(r) => {
            let _ = pedido.respond(json_resp(r));
        }
        // Notificação (sem id): só confirma o recebimento.
        None => {
            let _ = pedido.respond(Response::empty(202));
        }
    }
}

/// Resposta JSON-RPC para uma mensagem; None para notificações.
fn responder(m: &Value, app: &AppHandle, interno: &Arc<Mutex<Interno>>, proximo: &AtomicU64) -> Option<Value> {
    let id = m.get("id")?.clone();
    let resultado = if m["method"] == "tools/call" {
        Ok(chamar(m["params"].clone(), app, interno, proximo))
    } else {
        let ferramentas = travar(interno).ferramentas.clone();
        resposta_simples(m, &ferramentas)
    };
    Some(envelope(id, resultado))
}

/// Os métodos que não precisam da interface (initialize, ping, tools/list).
fn resposta_simples(m: &Value, ferramentas: &Value) -> Result<Value, (i64, String)> {
    match m["method"].as_str().unwrap_or_default() {
        "initialize" => {
            let pedida = m["params"]["protocolVersion"].as_str().unwrap_or(VERSAO_DO_PROTOCOLO);
            let versao = if ["2025-06-18", "2025-03-26", "2024-11-05"].contains(&pedida) { pedida } else { VERSAO_DO_PROTOCOLO };
            Ok(json!({
                "protocolVersion": versao,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": "seedy", "version": env!("CARGO_PKG_VERSION") },
                "instructions": INSTRUCOES,
            }))
        }
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": if ferramentas.is_array() { ferramentas.clone() } else { json!([]) } })),
        outro => Err((-32601, format!("método desconhecido: {outro}"))),
    }
}

fn envelope(id: Value, resultado: Result<Value, (i64, String)>) -> Value {
    match resultado {
        Ok(r) => json!({ "jsonrpc": "2.0", "id": id, "result": r }),
        Err((codigo, msg)) => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": codigo, "message": msg } }),
    }
}

#[derive(Serialize, Clone)]
struct Chamada {
    id: u64,
    nome: String,
    argumentos: Value,
}

/// Repassa a ferramenta para a interface e espera o resultado.
fn chamar(params: Value, app: &AppHandle, interno: &Arc<Mutex<Interno>>, proximo: &AtomicU64) -> Value {
    let nome = params["name"].as_str().unwrap_or_default().to_string();
    let id = proximo.fetch_add(1, Ordering::SeqCst) + 1;
    let (tx, rx) = mpsc::channel();
    travar(interno).pendentes.insert(id, tx);
    let chamada = Chamada { id, nome: nome.clone(), argumentos: params.get("arguments").cloned().unwrap_or(json!({})) };
    let resposta = if app.emit("mcp-chamada", chamada).is_err() {
        Err("o Seedy não conseguiu repassar a chamada para a interface".to_string())
    } else {
        rx.recv_timeout(ESPERA_MAXIMA).unwrap_or_else(|_| Err(format!("{nome}: sem resposta da interface do Seedy")))
    };
    travar(interno).pendentes.remove(&id);
    match resposta {
        Ok(texto) => json!({ "content": [{ "type": "text", "text": texto }], "isError": false }),
        Err(erro) => json!({ "content": [{ "type": "text", "text": erro }], "isError": true }),
    }
}

// ---------- comandos da interface ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InfoMcp {
    pub url: Option<String>,
    /// Comando para registrar o servidor no Claude Code (inclui o token).
    pub comando: Option<String>,
}

impl Mcp {
    /// Configuração (`--mcp-config`) para o `claude -p` usar as ferramentas do Seedy, ou None
    /// se o servidor MCP não subiu. Vai num arquivo na pasta de configuração (o token já mora lá).
    pub fn arquivo_de_config_do_claude(&self) -> Option<std::path::PathBuf> {
        let porta = (*travar(&self.porta))?;
        let config = json!({"mcpServers": {"seedy": {
            "type": "http",
            "url": format!("http://127.0.0.1:{porta}/mcp"),
            "headers": {"Authorization": format!("Bearer {}", self.token)}
        }}});
        let caminho = pasta_config().join("mcp-claude.json");
        fs::write(&caminho, config.to_string()).ok()?;
        Some(caminho)
    }
}

#[tauri::command]
pub fn mcp_info(estado: State<'_, Mcp>) -> InfoMcp {
    let porta = *travar(&estado.porta);
    let url = porta.map(|p| format!("http://127.0.0.1:{p}/mcp"));
    let comando = url
        .as_ref()
        .map(|u| format!("claude mcp add --scope user --transport http seedy {u} --header \"Authorization: Bearer {}\"", estado.token));
    InfoMcp { url, comando }
}

/// A interface informa as ferramentas (nome, descrição, input_schema) que o MCP oferece.
#[tauri::command]
pub fn mcp_definir_ferramentas(estado: State<'_, Mcp>, ferramentas: Value) {
    travar(&estado.interno).ferramentas = ferramentas;
}

#[tauri::command]
pub fn mcp_responder(estado: State<'_, Mcp>, id: u64, resultado: Option<String>, erro: Option<String>) {
    if let Some(tx) = travar(&estado.interno).pendentes.remove(&id) {
        let _ = tx.send(match erro {
            Some(e) => Err(e),
            None => Ok(resultado.unwrap_or_default()),
        });
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn initialize_lista_e_metodo_desconhecido() {
        let f = json!([{ "name": "abrir_arquivo", "inputSchema": { "type": "object" } }]);
        let init = resposta_simples(&json!({"method": "initialize", "params": {"protocolVersion": "2025-03-26"}}), &f).unwrap();
        assert_eq!(init["protocolVersion"], "2025-03-26");
        assert_eq!(init["serverInfo"]["name"], "seedy");
        let velha = resposta_simples(&json!({"method": "initialize", "params": {"protocolVersion": "1999-01-01"}}), &f).unwrap();
        assert_eq!(velha["protocolVersion"], VERSAO_DO_PROTOCOLO);
        assert_eq!(resposta_simples(&json!({"method": "tools/list"}), &f).unwrap()["tools"][0]["name"], "abrir_arquivo");
        assert_eq!(resposta_simples(&json!({"method": "x"}), &f).unwrap_err().0, -32601);
        let e = envelope(json!(7), Err((-32601, "x".into())));
        assert_eq!((e["id"].as_i64(), e["error"]["code"].as_i64()), (Some(7), Some(-32601)));
    }
}
