//! Tema: cores, fontes e forma da interface.
//!
//! O tema fica num arquivo editável pelo usuário:
//! - Linux:   ~/.config/seedy/tema.json
//! - Windows: %APPDATA%\seedy\tema.json
//!
//! Na primeira execução o tema padrão é gravado lá. Qualquer alteração salva no
//! arquivo é enviada para a interface na hora (evento `tema-alterado`).

use notify::{EventKind, RecursiveMode, Watcher};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const TEMA_PADRAO: &str = include_str!("../../src/app/tema/tema-padrao.json");
const ARQUIVO_TEMA: &str = "tema.json";
const CONFIG_PADRAO: &str = include_str!("../../src/app/config/config-padrao.json");
const ARQUIVO_CONFIG: &str = "seedy.json";

#[derive(Serialize, Clone)]
pub struct Tema {
    pub caminho: String,
    pub conteudo: String,
}

pub fn pasta_config() -> PathBuf {
    dirs::config_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("seedy")
}

fn caminho_tema() -> PathBuf {
    pasta_config().join(ARQUIVO_TEMA)
}

pub fn garantir_tema_padrao() -> std::io::Result<()> {
    fs::create_dir_all(pasta_config())?;
    let caminho = caminho_tema();
    if !caminho.exists() {
        fs::write(caminho, TEMA_PADRAO)?;
    }
    let config = pasta_config().join(ARQUIVO_CONFIG);
    if !config.exists() {
        fs::write(config, CONFIG_PADRAO)?;
    }
    Ok(())
}

fn ler_config() -> Result<Tema, String> {
    let caminho = pasta_config().join(ARQUIVO_CONFIG);
    let conteudo = fs::read_to_string(&caminho).map_err(|e| format!("não consegui ler o seedy.json: {e}"))?;
    Ok(Tema { caminho: caminho.to_string_lossy().into_owned(), conteudo })
}

/// Configurações do Seedy (`seedy.json`, na mesma pasta do tema). Mesmo formato do tema:
/// caminho + conteúdo; a interface lê o JSON e completa com o padrão.
#[tauri::command]
pub fn config_carregar() -> Result<Tema, String> {
    ler_config()
}

#[tauri::command]
pub fn config_padrao() -> String {
    CONFIG_PADRAO.to_string()
}

fn ler_tema() -> Result<Tema, String> {
    let caminho = caminho_tema();
    let conteudo = fs::read_to_string(&caminho).map_err(|e| format!("não consegui ler o tema: {e}"))?;
    Ok(Tema {
        caminho: caminho.to_string_lossy().into_owned(),
        conteudo,
    })
}

#[tauri::command]
pub fn tema_carregar() -> Result<Tema, String> {
    ler_tema()
}

/// Conteúdo do tema padrão, para restaurar.
#[tauri::command]
pub fn tema_padrao() -> String {
    TEMA_PADRAO.to_string()
}

/// Bytes de um arquivo de fonte (.ttf, .otf, .woff2). Caminho relativo é
/// resolvido a partir da pasta de configuração do Seedy.
#[tauri::command]
pub fn fonte_bytes(caminho: String) -> Result<tauri::ipc::Response, String> {
    let informado = Path::new(&caminho);
    let completo = if informado.is_absolute() {
        informado.to_path_buf()
    } else {
        pasta_config().join(informado)
    };
    fs::read(&completo)
        .map(tauri::ipc::Response::new)
        .map_err(|e| format!("não consegui ler a fonte {}: {e}", completo.display()))
}

/// Observa a pasta de configuração e avisa a interface quando o tema mudar.
pub fn observar(app: AppHandle) {
    std::thread::spawn(move || {
        let (tx, rx) = mpsc::channel();
        let mut observador = match notify::recommended_watcher(tx) {
            Ok(o) => o,
            Err(e) => {
                eprintln!("seedy: não foi possível observar o tema: {e}");
                return;
            }
        };
        if let Err(e) = observador.watch(&pasta_config(), RecursiveMode::NonRecursive) {
            eprintln!("seedy: não foi possível observar {}: {e}", pasta_config().display());
            return;
        }
        while let Ok(resultado) = rx.recv() {
            let Ok(evento) = resultado else { continue };
            let tocou = |nome: &str| evento.paths.iter().any(|p| p.file_name().is_some_and(|n| n == nome));
            let (tema, config) = (tocou(ARQUIVO_TEMA), tocou(ARQUIVO_CONFIG));
            let alterou = matches!(evento.kind, EventKind::Modify(_) | EventKind::Create(_));
            if !alterou || !(tema || config) {
                continue;
            }
            // Editores gravam em várias etapas: espera assentar e descarta o resto da rajada.
            std::thread::sleep(Duration::from_millis(120));
            let (mut tema, mut config) = (tema, config);
            while let Ok(Ok(outro)) = rx.try_recv() {
                tema |= outro.paths.iter().any(|p| p.file_name().is_some_and(|n| n == ARQUIVO_TEMA));
                config |= outro.paths.iter().any(|p| p.file_name().is_some_and(|n| n == ARQUIVO_CONFIG));
            }
            if tema {
                if let Ok(t) = ler_tema() {
                    let _ = app.emit("tema-alterado", t);
                }
            }
            if config {
                if let Ok(c) = ler_config() {
                    let _ = app.emit("config-alterada", c);
                }
            }
        }
    });
}
