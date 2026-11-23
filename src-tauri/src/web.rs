//! Fase 6 — Web (mockups 13 e 14). Os servidores de linguagem (TypeScript, Angular,
//! ESLint) e o Prettier são instalados com o npm na pasta de configuração do Seedy na
//! primeira vez; o js-debug (debug no navegador) vem dos releases do vscode-js-debug.
//! Aqui ficam só os processos: o protocolo (LSP/DAP) é da interface.

use crate::java::{encerrar_orfaos, registrar_lsp, Servidores};
use crate::servidor::processo::{encerrar_arvore, Processo};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tauri::State;

/// O que vai para a pasta web. O TypeScript fica no 5 (o typescript-language-server
/// precisa do tsserver.js); quando o projeto tem o dele, os servidores usam o do projeto.
const PACOTES: &[&str] = &[
    "typescript@5",
    "typescript-language-server@4",
    "@angular/language-server",
    "@angular/language-service",
    "vscode-langservers-extracted@4",
    "prettier@3",
];
const MARCA: &str = "seedy-web.json";

pub fn pasta_web() -> PathBuf {
    crate::tema::pasta_config().join("web")
}

pub(crate) fn sem_janela(c: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    let _ = c;
}

/// `npm`, `npx` etc.: no Windows são .cmd e precisam passar pelo cmd.
pub(crate) fn comando_do_node(programa: &str, args: &[String]) -> Command {
    #[cfg(windows)]
    {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(programa).args(args);
        c
    }
    #[cfg(not(windows))]
    {
        let mut c = Command::new(programa);
        c.args(args);
        c
    }
}

fn versao_do_node() -> Option<String> {
    let mut c = Command::new("node");
    c.arg("--version").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    sem_janela(&mut c);
    let saida = c.output().ok()?;
    saida.status.success().then(|| String::from_utf8_lossy(&saida.stdout).trim().to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EstadoWeb {
    /// Versão do Node no PATH (None = não instalado).
    node: Option<String>,
    instalado: bool,
}

#[tauri::command]
pub async fn web_estado() -> EstadoWeb {
    tauri::async_runtime::spawn_blocking(|| EstadoWeb { node: versao_do_node(), instalado: pasta_web().join(MARCA).exists() })
        .await
        .unwrap_or(EstadoWeb { node: None, instalado: false })
}

/// Instala os servidores de linguagem e o Prettier (`npm install` na pasta web).
#[tauri::command]
pub async fn web_instalar(progresso: Channel<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if versao_do_node().is_none() {
            return Err("o Node não está instalado (ou não está no PATH)".to_string());
        }
        let pasta = pasta_web();
        fs::create_dir_all(&pasta).map_err(|e| e.to_string())?;
        if !pasta.join("package.json").exists() {
            fs::write(pasta.join("package.json"), "{ \"name\": \"seedy-web\", \"private\": true }\n").map_err(|e| e.to_string())?;
        }
        let mut args: Vec<String> = ["install", "--no-audit", "--no-fund", "--loglevel=error"].map(String::from).to_vec();
        args.extend(PACOTES.iter().map(|p| p.to_string()));
        let _ = progresso.send(format!("npm install {}", PACOTES.join(" ")));
        let mut c = comando_do_node("npm", &args);
        c.current_dir(&pasta);
        let p = Processo::iniciar(c, move |linhas| {
            for l in linhas {
                let _ = progresso.send(l);
            }
        })?;
        match p.esperar() {
            Some(0) => {
                fs::write(pasta.join(MARCA), format!("{{ \"pacotes\": {:?} }}\n", PACOTES)).map_err(|e| e.to_string())?;
                Ok(())
            }
            codigo => Err(format!("o npm install falhou (código {codigo:?})")),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Script de cada servidor de linguagem dentro de node_modules.
fn script_do_servidor(tipo: &str) -> Option<PathBuf> {
    let m = pasta_web().join("node_modules");
    let p = match tipo {
        "ts" => m.join("typescript-language-server").join("lib").join("cli.mjs"),
        "angular" => m.join("@angular").join("language-server").join("index.js"),
        "eslint" => m.join("vscode-langservers-extracted").join("bin").join("vscode-eslint-language-server"),
        _ => return None,
    };
    p.exists().then_some(p)
}

/// Sobe o servidor de linguagem web do projeto (`ts`, `angular` ou `eslint`).
#[tauri::command]
pub fn lsp_web_iniciar(
    estado: State<'_, Servidores>,
    tipo: String,
    raiz: String,
    mensagens: Channel<String>,
    fim: Channel<()>,
) -> Result<u32, String> {
    let script = script_do_servidor(&tipo).ok_or("os servidores web ainda não foram instalados")?;
    encerrar_orfaos(&estado, &raiz, &tipo);
    let mut c = Command::new("node");
    c.arg(&script).arg("--stdio").current_dir(&raiz).stderr(Stdio::null());
    if tipo == "angular" {
        // O Angular Language Service procura o typescript e o próprio serviço primeiro no
        // projeto (mesma versão do Angular dele) e depois na pasta do Seedy.
        let locais = format!("{},{}", raiz, pasta_web().to_string_lossy());
        c.args(["--tsProbeLocations", &locais, "--ngProbeLocations", &locais]);
    }
    registrar_lsp(&estado, &tipo, raiz, c, mensagens, fim).map_err(|e| format!("não consegui iniciar o servidor {tipo}: {e}"))
}

// ---------- Prettier ----------

/// Formata com o Prettier do projeto (ou o do Seedy), respeitando o .prettierrc.
const FORMATAR_JS: &str = r#"
const { createRequire } = require('module');
const path = require('path');
const [raiz, arquivo, proprio] = process.argv.slice(1);
let prettier;
try { prettier = createRequire(path.join(raiz, 'package.json'))('prettier'); }
catch { prettier = createRequire(path.join(proprio, 'package.json'))('prettier'); }
let texto = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (texto += c));
process.stdin.on('end', async () => {
  try {
    const opcoes = (await prettier.resolveConfig(arquivo)) || {};
    process.stdout.write(await prettier.format(texto, { ...opcoes, filepath: arquivo }));
  } catch (e) {
    process.stderr.write(String((e && e.message) || e));
    process.exit(2);
  }
});
"#;

#[tauri::command]
pub async fn web_formatar(raiz: String, caminho: String, texto: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut c = Command::new("node");
        c.arg("-e").arg(FORMATAR_JS).arg(&raiz).arg(&caminho).arg(pasta_web()).current_dir(&raiz);
        c.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        sem_janela(&mut c);
        let mut filho = c.spawn().map_err(|e| format!("não consegui rodar o Prettier (o Node está instalado?): {e}"))?;
        filho.stdin.take().ok_or("sem stdin")?.write_all(texto.as_bytes()).map_err(|e| e.to_string())?;
        let saida = filho.wait_with_output().map_err(|e| e.to_string())?;
        if saida.status.success() {
            Ok(String::from_utf8_lossy(&saida.stdout).into_owned())
        } else {
            let erro = String::from_utf8_lossy(&saida.stderr);
            Err(format!("prettier: {}", erro.lines().next().unwrap_or("falhou")))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------- tarefas (scripts do package.json, npm install) ----------

#[derive(Default)]
pub struct Tarefas {
    lista: Arc<Mutex<HashMap<String, u32>>>,
}

impl Tarefas {
    pub fn encerrar_todas(&self) {
        for (_, pid) in self.lista.lock().unwrap_or_else(|e| e.into_inner()).drain() {
            encerrar_arvore(pid);
        }
    }
}

/// Roda um comando do projeto (ex.: `npm run start`) com a saída em lotes de linhas.
#[tauri::command]
pub fn tarefa_iniciar(
    estado: State<'_, Tarefas>,
    id: String,
    raiz: String,
    comando: Vec<String>,
    saida: Channel<Vec<String>>,
    fim: Channel<Option<i32>>,
    ambiente: Option<HashMap<String, String>>,
) -> Result<u32, String> {
    let (programa, args) = comando.split_first().ok_or("comando vazio")?;
    // Mesmo id ainda rodando (a interface recarregou e perdeu o controle dele): encerra o anterior.
    let anterior = estado.lista.lock().unwrap().remove(&id);
    if let Some(pid) = anterior {
        encerrar_arvore(pid);
    }
    let mut c = comando_do_node(programa, args);
    // Sem cores nem navegador abrindo sozinho: a saída vai para o painel.
    c.current_dir(&raiz).env("FORCE_COLOR", "0").env("NO_COLOR", "1").env("BROWSER", "none").env("NG_CLI_ANALYTICS", "false");
    // Variáveis da configuração de execução (Alt+Shift+F10 → argumentos, ambiente e JVM).
    if let Some(vars) = ambiente {
        c.envs(vars);
    }
    let p = Processo::iniciar(c, move |linhas| {
        let _ = saida.send(linhas);
    })?;
    let pid = p.pid();
    let lista = estado.lista.clone();
    lista.lock().unwrap().insert(id.clone(), pid);
    std::thread::spawn(move || {
        let codigo = p.esperar();
        lista.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
        let _ = fim.send(codigo);
    });
    Ok(pid)
}

#[tauri::command]
pub fn tarefa_parar(estado: State<'_, Tarefas>, id: String) {
    let pid = estado.lista.lock().unwrap().get(&id).copied();
    if let Some(pid) = pid {
        encerrar_arvore(pid);
    }
}

/// Alguém está escutando nesta porta de 127.0.0.1? (Tenta ocupá-la: sem conectar, para não gastar a única
/// conexão que um servidor de debug JDWP aceita.)
#[tauri::command]
pub fn porta_em_uso(porta: u16) -> bool {
    escutando(porta)
}

/// No Windows, o Java escuta com SO_REUSEADDR e outro processo consegue ocupar a mesma porta: tentar
/// ocupá-la não prova nada. Lê a tabela TCP do sistema.
#[cfg(windows)]
fn escutando(porta: u16) -> bool {
    use windows_sys::Win32::NetworkManagement::IpHelper::{GetTcpTable, MIB_TCPTABLE, MIB_TCP_STATE_LISTEN};
    let mut tamanho: u32 = 0;
    unsafe {
        GetTcpTable(std::ptr::null_mut(), &mut tamanho, 0); // só descobre o tamanho
        let mut memoria = vec![0u8; tamanho as usize + 4096];
        let tabela = memoria.as_mut_ptr() as *mut MIB_TCPTABLE;
        tamanho = memoria.len() as u32;
        if GetTcpTable(tabela, &mut tamanho, 0) != 0 {
            return false;
        }
        let linhas = std::slice::from_raw_parts((*tabela).table.as_ptr(), (*tabela).dwNumEntries as usize);
        linhas.iter().any(|l| l.Anonymous.dwState == MIB_TCP_STATE_LISTEN as u32 && u16::from_be(l.dwLocalPort as u16) == porta)
    }
}

#[cfg(not(windows))]
fn escutando(porta: u16) -> bool {
    std::net::TcpListener::bind(("0.0.0.0", porta)).is_err() || std::net::TcpListener::bind(("127.0.0.1", porta)).is_err()
}

// ---------- js-debug (debug no navegador) ----------

#[derive(Default)]
pub struct JsDebug {
    processo: Mutex<Option<(u16, Child)>>,
}

impl JsDebug {
    pub fn encerrar(&self) {
        if let Some((_, mut filho)) = self.processo.lock().unwrap_or_else(|e| e.into_inner()).take() {
            encerrar_arvore(filho.id());
            let _ = filho.wait();
        }
    }
}

fn script_jsdebug() -> PathBuf {
    pasta_web().join("js-debug").join("src").join("dapDebugServer.js")
}

/// Baixa o js-debug (o adaptador DAP de JavaScript do VS Code) do último release.
fn garantir_jsdebug() -> Result<(), String> {
    if script_jsdebug().exists() {
        return Ok(());
    }
    let agente = ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(15)).timeout_read(Duration::from_secs(120)).user_agent("Seedy").build();
    let release: serde_json::Value = agente
        .get("https://api.github.com/repos/microsoft/vscode-js-debug/releases/latest")
        .call()
        .map_err(|e| format!("não consegui consultar o js-debug: {e}"))?
        .into_string()
        .map_err(|e| e.to_string())
        .and_then(|t| serde_json::from_str(&t).map_err(|e| e.to_string()))?;
    let url = release["assets"]
        .as_array()
        .and_then(|l| {
            l.iter().find_map(|a| {
                let nome = a["name"].as_str()?;
                (nome.starts_with("js-debug-dap-") && nome.ends_with(".tar.gz")).then(|| a["browser_download_url"].as_str().map(String::from))?
            })
        })
        .ok_or("o release do js-debug não tem o pacote DAP")?;
    let mut bytes = Vec::new();
    agente.get(&url).call().map_err(|e| format!("não consegui baixar o js-debug: {e}"))?.into_reader().read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    let destino = pasta_web();
    fs::create_dir_all(&destino).map_err(|e| e.to_string())?;
    // O pacote traz a pasta js-debug/ na raiz.
    tar::Archive::new(flate2::read::GzDecoder::new(bytes.as_slice())).unpack(&destino).map_err(|e| format!("não consegui extrair o js-debug: {e}"))?;
    script_jsdebug().exists().then_some(()).ok_or_else(|| "o pacote do js-debug veio sem o dapDebugServer.js".to_string())
}

fn porta_livre() -> Result<u16, String> {
    let l = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    Ok(l.local_addr().map_err(|e| e.to_string())?.port())
}

/// Porta do servidor DAP do js-debug (sobe na primeira vez, ou de novo com `reiniciar`; baixa se faltar).
#[tauri::command]
pub async fn jsdebug_iniciar(estado: State<'_, JsDebug>, reiniciar: bool) -> Result<u16, String> {
    // Sessão nova: um js-debug novo (encerrar o anterior fecha junto navegadores que sobraram).
    if reiniciar {
        estado.encerrar();
    }
    {
        let mut atual = estado.processo.lock().unwrap();
        if let Some((porta, filho)) = atual.as_mut() {
            if matches!(filho.try_wait(), Ok(None)) {
                return Ok(*porta);
            }
            *atual = None;
        }
    }
    tauri::async_runtime::spawn_blocking(garantir_jsdebug).await.map_err(|e| e.to_string())??;
    let porta = porta_livre()?;
    let mut c = Command::new("node");
    c.arg(script_jsdebug()).arg(porta.to_string()).arg("127.0.0.1").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    sem_janela(&mut c);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        c.process_group(0);
    }
    let filho = c.spawn().map_err(|e| format!("não consegui iniciar o js-debug (o Node está instalado?): {e}"))?;
    *estado.processo.lock().unwrap() = Some((porta, filho));
    // Espera o servidor aceitar conexões.
    let pronto = tauri::async_runtime::spawn_blocking(move || {
        let limite = Instant::now() + Duration::from_secs(15);
        while Instant::now() < limite {
            if TcpStream::connect_timeout(&([127, 0, 0, 1], porta).into(), Duration::from_millis(300)).is_ok() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(150));
        }
        false
    })
    .await
    .unwrap_or(false);
    if pronto {
        Ok(porta)
    } else {
        estado.encerrar();
        Err("o js-debug não respondeu".into())
    }
}

/// Navegadores para o debug: Edge e/ou Chrome instalados (o js-debug acha o executável).
#[tauri::command]
pub fn web_navegadores() -> Vec<String> {
    let mut lista = Vec::new();
    #[cfg(windows)]
    {
        let bases = [std::env::var("ProgramFiles(x86)").ok(), std::env::var("ProgramFiles").ok(), std::env::var("LOCALAPPDATA").ok()];
        let existe = |rel: &str| bases.iter().flatten().any(|b| Path::new(b).join(rel).exists());
        if existe("Microsoft\\Edge\\Application\\msedge.exe") {
            lista.push("edge".to_string());
        }
        if existe("Google\\Chrome\\Application\\chrome.exe") {
            lista.push("chrome".to_string());
        }
    }
    #[cfg(not(windows))]
    {
        let no_path = |p: &str| std::env::var_os("PATH").map(|v| std::env::split_paths(&v).any(|d| d.join(p).exists())).unwrap_or(false);
        if ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].iter().any(|p| no_path(p)) {
            lista.push("chrome".to_string());
        }
        if ["microsoft-edge", "microsoft-edge-stable"].iter().any(|p| no_path(p)) {
            lista.push("edge".to_string());
        }
    }
    lista
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn servidores_desconhecidos_nao_tem_script() {
        assert!(script_do_servidor("cobol").is_none());
    }

    #[test]
    fn porta_livre_e_valida() {
        assert!(porta_livre().unwrap() > 0);
    }
}
