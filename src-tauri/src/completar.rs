//! Completar código enquanto digita (texto fantasma).
//!
//! No modo local o Seedy baixa uma vez o `llama-server` (llama.cpp) e um modelo pequeno de código,
//! confere o SHA-256 de cada um, liga o servidor só em `127.0.0.1`, com uma chave que só ele conhece,
//! e pede o preenchimento entre o que vem antes e o que vem depois do cursor (`/infill`).
//! No modo API o mesmo pedido vai para a Anthropic, com a chave do usuário.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::ipc::Channel;
use tauri::State;

/// Um arquivo a baixar, com versão fixa: trocar = endereço, tamanho e SHA-256 publicados.
struct Pacote {
    nome: &'static str,
    url: &'static str,
    tamanho: u64,
    sha256: &'static str,
}

/// llama.cpp b12819, com Vulkan (usa a placa de vídeo; sem ela, roda no processador). Licença MIT.
#[cfg(windows)]
const PROGRAMA: Pacote = Pacote {
    nome: "llama.zip",
    url: "https://github.com/ggml-org/llama.cpp/releases/download/b12819/llama-b12819-bin-win-vulkan-x64.zip",
    tamanho: 39_346_783,
    sha256: "09f07d25ca830a2613d7b1ea8ee650a9e1e410114604aeda440bfbd5cd6c2984",
};
#[cfg(not(windows))]
const PROGRAMA: Pacote = Pacote {
    nome: "llama.tar.gz",
    url: "https://github.com/ggml-org/llama.cpp/releases/download/b12819/llama-b12819-bin-ubuntu-vulkan-x64.tar.gz",
    tamanho: 37_325_974,
    sha256: "37f7a0528fbf586d59e2e703eefb6fd38b9e6d144797a45a91ac4ff8973b7f0c",
};

/// Qwen2.5-Coder 1.5B (base, feito para preencher o meio), quantizado em 4 bits. Licença Apache 2.0.
const MODELO: Pacote = Pacote {
    nome: "modelo.gguf",
    url: "https://huggingface.co/QuantFactory/Qwen2.5-Coder-1.5B-GGUF/resolve/73c3c696087d8d57a3005e31f2afe78f43059739/Qwen2.5-Coder-1.5B.Q4_K_M.gguf",
    tamanho: 986_048_352,
    sha256: "a9ccb6be802412e61e1acbee6287a23b11e56e94718560f910075c64b6194910",
};

/// O modelo da API: o mais barato e rápido.
const MODELO_DA_API: &str = "claude-haiku-5-5";

#[derive(Default)]
pub struct Completar {
    servidor: Mutex<Option<Servidor>>,
    /// Só um ligando de cada vez.
    ligando: Mutex<()>,
    baixando: AtomicBool,
    cancelar: AtomicBool,
}

struct Servidor {
    processo: Child,
    porta: u16,
    chave: String,
}

impl Completar {
    pub fn desligar(&self) {
        if let Some(mut s) = self.servidor.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = s.processo.kill();
            let _ = s.processo.wait();
        }
    }

    /// Porta e chave do servidor, se ele ainda está de pé.
    fn endereco(&self) -> Option<(u16, String)> {
        let mut guarda = self.servidor.lock().unwrap_or_else(|e| e.into_inner());
        let s = guarda.as_mut()?;
        if s.processo.try_wait().ok()?.is_some() {
            *guarda = None;
            return None;
        }
        Some((s.porta, s.chave.clone()))
    }
}

/// Os arquivos são grandes e só valem nesta máquina: pasta de cache, não a de configuração.
fn pasta() -> PathBuf {
    dirs::cache_dir().unwrap_or_else(std::env::temp_dir).join("seedy").join("completar")
}

fn nome_do_servidor() -> &'static str {
    if cfg!(windows) {
        "llama-server.exe"
    } else {
        "llama-server"
    }
}

fn achar_servidor(em: &Path) -> Option<PathBuf> {
    let entradas: Vec<_> = fs::read_dir(em).ok()?.flatten().map(|e| e.path()).collect();
    if let Some(p) = entradas.iter().find(|p| p.is_file() && p.file_name().is_some_and(|n| n == nome_do_servidor())) {
        return Some(p.clone());
    }
    entradas.iter().filter(|p| p.is_dir()).find_map(|p| achar_servidor(p))
}

fn modelo_pronto(base: &Path) -> bool {
    fs::metadata(base.join(MODELO.nome)).is_ok_and(|m| m.len() == MODELO.tamanho)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Estado {
    instalado: bool,
    rodando: bool,
    /// Quanto falta baixar, em bytes.
    falta: u64,
}

#[tauri::command]
pub fn completar_estado(estado: State<'_, Completar>) -> Estado {
    let base = pasta();
    let programa = achar_servidor(&base.join("llama")).is_some();
    let modelo = modelo_pronto(&base);
    let falta = if programa { 0 } else { PROGRAMA.tamanho } + if modelo { 0 } else { MODELO.tamanho };
    Estado { instalado: programa && modelo, rodando: estado.endereco().is_some(), falta }
}

#[derive(Serialize, Clone)]
pub struct Progresso {
    baixado: u64,
    total: u64,
}

/// Baixa para um arquivo ao lado e só troca o nome depois de conferir tamanho e SHA-256.
fn baixar_pacote(p: &Pacote, destino: &Path, cancelar: &AtomicBool, ao_avancar: &mut dyn FnMut(u64)) -> Result<(), String> {
    let temporario = destino.with_extension("baixando");
    let resposta = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(20))
        .timeout_read(Duration::from_secs(60))
        .build()
        .get(p.url)
        .set("User-Agent", "Seedy")
        .call()
        .map_err(|e| format!("não consegui baixar {}: {e}", p.nome))?;
    let mut leitor = resposta.into_reader();
    let mut arquivo = File::create(&temporario).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    let mut total = 0u64;
    let falha = loop {
        if cancelar.load(Ordering::SeqCst) {
            break Some("download cancelado".to_string());
        }
        let n = match leitor.read(&mut buf) {
            Ok(0) => break None,
            Ok(n) => n,
            Err(e) => break Some(format!("o download de {} foi interrompido: {e}", p.nome)),
        };
        hash.update(&buf[..n]);
        if let Err(e) = arquivo.write_all(&buf[..n]) {
            break Some(format!("não consegui gravar {} (falta espaço?): {e}", p.nome));
        }
        total += n as u64;
        ao_avancar(total);
    };
    drop(arquivo);
    let falha = falha.or_else(|| {
        let obtido = format!("{:x}", hash.finalize());
        (total != p.tamanho || obtido != p.sha256).then(|| format!("o {} baixado não confere com o publicado: não usei", p.nome))
    });
    if let Some(f) = falha {
        let _ = fs::remove_file(&temporario);
        return Err(f);
    }
    fs::rename(&temporario, destino).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn extrair(pacote: &Path, destino: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    // O tar do próprio Windows abre .zip (o de outros programas no PATH, não).
    let tar = PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into())).join("System32").join("tar.exe");
    let saida = Command::new(tar)
        .arg("-xf")
        .arg(pacote)
        .arg("-C")
        .arg(destino)
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .output()
        .map_err(|e| format!("não consegui extrair o llama.cpp: {e}"))?;
    saida.status.success().then_some(()).ok_or_else(|| format!("não consegui extrair o llama.cpp: {}", String::from_utf8_lossy(&saida.stderr)))
}

#[cfg(not(windows))]
fn extrair(pacote: &Path, destino: &Path) -> Result<(), String> {
    let gz = flate2::read::GzDecoder::new(File::open(pacote).map_err(|e| e.to_string())?);
    tar::Archive::new(gz).unpack(destino).map_err(|e| format!("não consegui extrair o llama.cpp: {e}"))
}

fn instalar(cancelar: &AtomicBool, progresso: &dyn Fn(Progresso)) -> Result<(), String> {
    let base = pasta();
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let falta_programa = achar_servidor(&base.join("llama")).is_none();
    let falta_modelo = !modelo_pronto(&base);
    let total = if falta_programa { PROGRAMA.tamanho } else { 0 } + if falta_modelo { MODELO.tamanho } else { 0 };
    let mut antes = 0;
    let mut ultimo = Instant::now();
    let mut avisar = |baixado: u64| {
        if ultimo.elapsed() >= Duration::from_millis(250) || baixado == total {
            ultimo = Instant::now();
            progresso(Progresso { baixado, total });
        }
    };
    if falta_programa {
        let pacote = base.join(PROGRAMA.nome);
        baixar_pacote(&PROGRAMA, &pacote, cancelar, &mut |n| avisar(n))?;
        // Extrai ao lado e troca no fim: pela metade não conta como instalado.
        let temporaria = base.join("llama.extraindo");
        let _ = fs::remove_dir_all(&temporaria);
        fs::create_dir_all(&temporaria).map_err(|e| e.to_string())?;
        extrair(&pacote, &temporaria)?;
        achar_servidor(&temporaria).ok_or("o pacote do llama.cpp não trouxe o llama-server")?;
        let _ = fs::remove_dir_all(base.join("llama"));
        fs::rename(&temporaria, base.join("llama")).map_err(|e| e.to_string())?;
        let _ = fs::remove_file(pacote);
        antes = PROGRAMA.tamanho;
    }
    if falta_modelo {
        baixar_pacote(&MODELO, &base.join(MODELO.nome), cancelar, &mut |n| avisar(antes + n))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn completar_baixar(app: tauri::AppHandle, progresso: Channel<Progresso>) -> Result<(), String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let estado = app.state::<Completar>();
        if estado.baixando.swap(true, Ordering::SeqCst) {
            return Err("o download já está em andamento".to_string());
        }
        estado.cancelar.store(false, Ordering::SeqCst);
        let r = instalar(&estado.cancelar, &|p| {
            let _ = progresso.send(p);
        });
        estado.baixando.store(false, Ordering::SeqCst);
        r
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn completar_cancelar(estado: State<'_, Completar>) {
    estado.cancelar.store(true, Ordering::SeqCst);
}

fn porta_livre() -> Result<u16, String> {
    TcpListener::bind("127.0.0.1:0").and_then(|l| l.local_addr()).map(|a| a.port()).map_err(|e| e.to_string())
}

/// Uma chave que muda a cada vez: só o Seedy conversa com o servidor dele.
fn nova_chave() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    (0..3).map(|_| format!("{:016x}", RandomState::new().build_hasher().finish())).collect()
}

fn iniciar_servidor() -> Result<Servidor, String> {
    let base = pasta();
    let exe = achar_servidor(&base.join("llama")).ok_or("o completar local ainda não foi baixado")?;
    if !modelo_pronto(&base) {
        return Err("o modelo ainda não foi baixado".into());
    }
    let porta = porta_livre()?;
    let chave = nova_chave();
    let log = File::create(base.join("llama-server.log")).map_err(|e| e.to_string())?;
    let dir = exe.parent().unwrap_or(&base).to_path_buf();
    let mut comando = Command::new(&exe);
    comando
        .arg("-m")
        .arg(base.join(MODELO.nome))
        .args(["--host", "127.0.0.1", "--port", &porta.to_string()])
        .args(["-c", "4096", "-ngl", "99", "-np", "1"])
        // Pela variável de ambiente a chave não aparece na lista de processos.
        .env("LLAMA_API_KEY", &chave)
        .current_dir(&dir)
        .stdin(Stdio::null())
        .stdout(log.try_clone().map_err(|e| e.to_string())?)
        .stderr(log);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        comando.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    comando.env("LD_LIBRARY_PATH", &dir);
    let processo = comando.spawn().map_err(|e| format!("não consegui ligar o llama-server: {e}"))?;
    Ok(Servidor { processo, porta, chave })
}

#[tauri::command]
pub async fn completar_ligar(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let estado = app.state::<Completar>();
        let _um_de_cada_vez = estado.ligando.lock().unwrap_or_else(|e| e.into_inner());
        if estado.endereco().is_some() {
            return Ok(());
        }
        let novo = iniciar_servidor()?;
        let porta = novo.porta;
        *estado.servidor.lock().unwrap_or_else(|e| e.into_inner()) = Some(novo);
        // Carregar o modelo leva alguns segundos; `/health` só responde 200 quando está pronto.
        let inicio = Instant::now();
        loop {
            if estado.endereco().is_none() {
                return Err(format!("o llama-server fechou ao ligar (veja {})", pasta().join("llama-server.log").display()));
            }
            if ureq::get(&format!("http://127.0.0.1:{porta}/health")).timeout(Duration::from_secs(2)).call().is_ok() {
                return Ok(());
            }
            if inicio.elapsed() > Duration::from_secs(120) {
                estado.desligar();
                return Err("o modelo demorou demais para carregar".into());
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn completar_desligar(estado: State<'_, Completar>) {
    estado.desligar();
}

#[tauri::command]
pub fn completar_remover(estado: State<'_, Completar>) -> Result<(), String> {
    estado.cancelar.store(true, Ordering::SeqCst);
    estado.desligar();
    match fs::remove_dir_all(pasta()) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("não consegui remover o modelo: {e}")),
        _ => Ok(()),
    }
}

/// O corpo do `/infill`: o servidor monta o pedido de "preencher o meio" do próprio modelo.
fn corpo_local(prefixo: &str, sufixo: &str, varias_linhas: bool) -> Value {
    // Linha em branco já é o fim: a interface cortaria ali de qualquer jeito.
    let parar: &[&str] = if varias_linhas { &["\n\n"] } else { &["\n"] };
    json!({
        "input_prefix": prefixo,
        "input_suffix": sufixo,
        "n_predict": if varias_linhas { 96 } else { 40 },
        "temperature": 0.1,
        "top_k": 40,
        "top_p": 0.9,
        "stop": parar,
        "cache_prompt": true,
        // Sugestão que demora mais que isso já não serve.
        "t_max_predict_ms": 2500,
    })
}

fn corpo_da_api(prefixo: &str, sufixo: &str, varias_linhas: bool) -> Value {
    let tamanho = if varias_linhas { "A few lines at most." } else { "Only the rest of the current line." };
    json!({
        "model": MODELO_DA_API,
        "max_tokens": if varias_linhas { 160 } else { 60 },
        "thinking": { "type": "disabled" },
        "output_config": { "effort": "low" },
        "system": format!("You complete code. Reply with only the text to insert at <CURSOR>, with no explanation, no markdown fences and without repeating what is already there. {tamanho} If nothing useful fits, reply with nothing."),
        "messages": [{ "role": "user", "content": format!("{prefixo}<CURSOR>{sufixo}") }],
    })
}

/// Tira cercas de markdown que o modelo às vezes põe e os espaços que sobram no fim.
fn arrumar(texto: &str) -> String {
    let mut t = texto.trim_end();
    if t.trim_start().starts_with("```") {
        t = t.trim_start().split_once('\n').map_or("", |(_, resto)| resto);
        t = t.trim_end().strip_suffix("```").unwrap_or(t).trim_end();
    }
    t.to_string()
}

fn pedir_local(porta: u16, chave: &str, corpo: &Value) -> Result<String, String> {
    let resposta = ureq::post(&format!("http://127.0.0.1:{porta}/infill"))
        .timeout(Duration::from_secs(8))
        .set("Authorization", &format!("Bearer {chave}"))
        .set("Content-Type", "application/json")
        .send_string(&corpo.to_string())
        .map_err(|e| format!("completar local: {e}"))?;
    let v: Value = serde_json::from_str(&resposta.into_string().map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(arrumar(v["content"].as_str().unwrap_or_default()))
}

fn pedir_api(corpo: &Value) -> Result<String, String> {
    let chave = crate::ia::chave().ok_or("completar pela API: configure a chave em Ctrl+, aba IA")?;
    let resposta = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(10))
        .build()
        .post(&format!("{}/v1/messages", crate::ia::endereco_base()))
        .set("x-api-key", &chave)
        .set("anthropic-version", crate::ia::VERSAO_DA_API)
        .set("content-type", "application/json")
        .send_string(&corpo.to_string());
    let resposta = match resposta {
        Ok(r) => r,
        Err(ureq::Error::Status(c, r)) => return Err(crate::ia::erro_da_api(c, &r.into_string().unwrap_or_default())),
        Err(e) => return Err(format!("sem conexão com a API: {e}")),
    };
    let v: Value = serde_json::from_str(&resposta.into_string().map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let texto: String = v["content"].as_array().into_iter().flatten().filter_map(|b| b["text"].as_str()).collect();
    Ok(arrumar(&texto))
}

#[tauri::command]
pub async fn completar_pedir(app: tauri::AppHandle, prefixo: String, sufixo: String, varias_linhas: bool, api: bool) -> Result<String, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        if api {
            return pedir_api(&corpo_da_api(&prefixo, &sufixo, varias_linhas));
        }
        let (porta, chave) = app.state::<Completar>().endereco().ok_or("o completar local não está ligado")?;
        pedir_local(porta, &chave, &corpo_local(&prefixo, &sufixo, varias_linhas))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod testes {
    use std::io::{BufRead, BufReader};

    use super::*;

    #[test]
    fn arruma_a_resposta() {
        assert_eq!(arrumar("return x;\n  \n"), "return x;");
        assert_eq!(arrumar("        return x;"), "        return x;", "o recuo do começo fica");
        assert_eq!(arrumar("```java\nreturn x;\n```"), "return x;");
        assert_eq!(arrumar("   \n"), "");
    }

    #[test]
    fn uma_linha_ou_varias() {
        assert_eq!(corpo_local("a", "b", false)["stop"][0], "\n");
        assert_eq!(corpo_local("a", "b", true)["input_suffix"], "b");
        let api = corpo_da_api("antes ", " depois", false);
        assert_eq!(api["messages"][0]["content"], "antes <CURSOR> depois");
        assert_eq!(api["model"], MODELO_DA_API);
    }

    #[test]
    fn manda_a_chave_e_le_o_conteudo() {
        let ouvinte = TcpListener::bind("127.0.0.1:0").unwrap();
        let porta = ouvinte.local_addr().unwrap().port();
        let servidor = std::thread::spawn(move || {
            let (mut conexao, _) = ouvinte.accept().unwrap();
            let mut leitor = BufReader::new(conexao.try_clone().unwrap());
            let (mut cabecalho, mut tamanho) = (String::new(), 0);
            loop {
                let mut linha = String::new();
                leitor.read_line(&mut linha).unwrap();
                if let Some(v) = linha.to_lowercase().strip_prefix("content-length:") {
                    tamanho = v.trim().parse().unwrap();
                }
                cabecalho.push_str(&linha);
                if linha == "\r\n" {
                    break;
                }
            }
            leitor.read_exact(&mut vec![0; tamanho]).unwrap();
            let corpo = r#"{"content":"nome;  "}"#;
            write!(conexao, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{corpo}", corpo.len()).unwrap();
            cabecalho
        });
        assert_eq!(pedir_local(porta, "segredo", &corpo_local("a", "", false)).unwrap(), "nome;");
        let cabecalho = servidor.join().unwrap();
        assert!(cabecalho.starts_with("POST /infill"));
        assert!(cabecalho.contains("Bearer segredo"));
    }

    #[test]
    fn chaves_diferentes() {
        assert_ne!(nova_chave(), nova_chave());
        assert_eq!(nova_chave().len(), 48);
    }
}
