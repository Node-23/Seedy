//! Debug de Java: o plugin java-debug (carregado no jdtls) abre um servidor DAP numa
//! porta local; aqui fica só o transporte (TCP com cabeçalho Content-Length, como no
//! LSP). As mensagens DAP em si são montadas e lidas pela interface.

use sha1::{Digest, Sha1};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::State;

/// Versão fixa do plugin (Maven Central); trocar = versão + SHA-1 publicado.
const JAVA_DEBUG_VERSAO: &str = "0.53.1";
const JAVA_DEBUG_SHA1: &str = "dfc433d62cbb5bb71cfe87f1ee5363c549dccc92";

fn arquivo_do_plugin() -> PathBuf {
    crate::tema::pasta_config()
        .join("java-debug")
        .join(format!("com.microsoft.java.debug.plugin-{JAVA_DEBUG_VERSAO}.jar"))
}

/// Caminho do plugin java-debug para o jdtls carregar (baixa e confere na primeira vez).
#[tauri::command]
pub async fn java_debug_plugin() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let destino = arquivo_do_plugin();
        if destino.exists() {
            return Ok(destino.to_string_lossy().into_owned());
        }
        let url = format!(
            "https://repo1.maven.org/maven2/com/microsoft/java/com.microsoft.java.debug.plugin/{v}/com.microsoft.java.debug.plugin-{v}.jar",
            v = JAVA_DEBUG_VERSAO
        );
        let mut bytes = Vec::new();
        ureq::get(&url)
            .call()
            .map_err(|e| format!("não consegui baixar o java-debug: {e}"))?
            .into_reader()
            .read_to_end(&mut bytes)
            .map_err(|e| format!("download do java-debug interrompido: {e}"))?;
        let obtido = format!("{:x}", Sha1::digest(&bytes));
        if obtido != JAVA_DEBUG_SHA1 {
            return Err(format!("o java-debug baixado não confere (sha1 {obtido})"));
        }
        fs::create_dir_all(destino.parent().unwrap()).map_err(|e| e.to_string())?;
        let temporario = destino.with_extension("baixando");
        fs::write(&temporario, &bytes).map_err(|e| e.to_string())?;
        fs::rename(&temporario, &destino).map_err(|e| e.to_string())?;
        Ok(destino.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Default)]
pub struct SessoesDap {
    lista: Mutex<HashMap<u32, TcpStream>>,
    proximo: AtomicU32,
}

/// Conecta no servidor DAP do java-debug; cada mensagem recebida (JSON) vai para `mensagens`.
#[tauri::command]
pub fn dap_conectar(estado: State<'_, SessoesDap>, porta: u16, mensagens: Channel<String>, fim: Channel<()>) -> Result<u32, String> {
    let conexao = TcpStream::connect_timeout(&([127, 0, 0, 1], porta).into(), Duration::from_secs(10))
        .map_err(|e| format!("não consegui falar com o depurador (porta {porta}): {e}"))?;
    let leitura = conexao.try_clone().map_err(|e| e.to_string())?;
    let id = estado.proximo.fetch_add(1, Ordering::SeqCst) + 1;
    estado.lista.lock().unwrap_or_else(|e| e.into_inner()).insert(id, conexao);
    std::thread::spawn(move || {
        let mut leitor = BufReader::new(leitura);
        while let Some(m) = ler_mensagem(&mut leitor) {
            if mensagens.send(m).is_err() {
                break;
            }
        }
        let _ = fim.send(());
    });
    Ok(id)
}

#[tauri::command]
pub fn dap_enviar(estado: State<'_, SessoesDap>, id: u32, mensagem: String) -> Result<(), String> {
    let mut lista = estado.lista.lock().unwrap_or_else(|e| e.into_inner());
    let conexao = lista.get_mut(&id).ok_or("sessão de debug encerrada")?;
    conexao
        .write_all(format!("Content-Length: {}\r\n\r\n{mensagem}", mensagem.len()).as_bytes())
        .map_err(|e| format!("depurador: {e}"))
}

#[tauri::command]
pub fn dap_fechar(estado: State<'_, SessoesDap>, id: u32) {
    if let Some(c) = estado.lista.lock().unwrap_or_else(|e| e.into_inner()).remove(&id) {
        let _ = c.shutdown(Shutdown::Both);
    }
}

/// Lê uma mensagem `Content-Length: N\r\n\r\n<N bytes>`; None no fim da conexão.
fn ler_mensagem(leitor: &mut impl BufRead) -> Option<String> {
    let mut tamanho = None;
    loop {
        let mut linha = String::new();
        if leitor.read_line(&mut linha).ok()? == 0 {
            return None;
        }
        let linha = linha.trim_end();
        if linha.is_empty() {
            if tamanho.is_some() {
                break;
            }
            continue;
        }
        if let Some(v) = linha.strip_prefix("Content-Length:") {
            tamanho = v.trim().parse::<usize>().ok();
        }
    }
    let mut corpo = vec![0u8; tamanho?];
    leitor.read_exact(&mut corpo).ok()?;
    Some(String::from_utf8_lossy(&corpo).into_owned())
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn le_mensagens_enquadradas() {
        let dados = "Content-Length: 2\r\n\r\n{}Content-Length: 11\r\nContent-Type: x\r\n\r\n{\"seq\":1}..";
        let mut r = BufReader::new(dados.as_bytes());
        assert_eq!(ler_mensagem(&mut r).as_deref(), Some("{}"));
        assert_eq!(ler_mensagem(&mut r).as_deref(), Some("{\"seq\":1}.."));
        assert_eq!(ler_mensagem(&mut r), None);
    }
}
