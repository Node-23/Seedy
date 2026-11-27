//! Pânico no núcleo vira uma "falha do Seedy" na interface, que pode ser enviada para análise.
//! Ele também é gravado em disco: se derrubar o app, o aviso aparece na próxima abertura.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

const LIMITE: usize = 8000;

static APP: OnceLock<AppHandle> = OnceLock::new();
static ENTROU_EM_PANICO: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Deserialize)]
pub struct Falha {
    versao: String,
    /// Milissegundos desde 1970.
    quando: u64,
    detalhe: String,
}

fn arquivo() -> PathBuf {
    crate::tema::pasta_config().join("ultima-falha.json")
}

/// Instala o gancho de pânico. É a primeira coisa do `run`, para pegar também os erros da inicialização.
pub fn registrar() {
    let anterior = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        anterior(info);
        let detalhe = info.to_string();
        ENTROU_EM_PANICO.store(true, Ordering::SeqCst);
        anotar(&arquivo(), &detalhe);
        if let Some(app) = APP.get().cloned() {
            // Em outra thread: a que entrou em pânico pode estar segurando algo que o aviso precisa.
            std::thread::spawn(move || {
                let _ = app.emit("seedy://falha", detalhe);
            });
        }
    }));
}

/// A partir daqui há interface para avisar na hora.
pub fn observar(app: AppHandle) {
    let _ = APP.set(app);
}

/// O Seedy fechou normalmente: um pânico desta sessão não o derrubou e já foi mostrado.
pub fn saiu_bem() {
    if ENTROU_EM_PANICO.load(Ordering::SeqCst) {
        let _ = fs::remove_file(arquivo());
    }
}

fn ler(arquivo: &Path) -> Option<Falha> {
    serde_json::from_str(&fs::read_to_string(arquivo).ok()?).ok()
}

/// Junta ao que já houver: num pânico em cascata, o primeiro é o que explica.
fn anotar(arquivo: &Path, detalhe: &str) {
    let quando = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
    let mut falha = ler(arquivo).unwrap_or(Falha { versao: env!("CARGO_PKG_VERSION").into(), quando, detalhe: String::new() });
    if !falha.detalhe.is_empty() {
        falha.detalhe.push_str("\n\n");
    }
    falha.detalhe.push_str(detalhe);
    falha.detalhe = falha.detalhe.chars().take(LIMITE).collect();
    if let (Some(pasta), Ok(json)) = (arquivo.parent(), serde_json::to_string(&falha)) {
        let _ = fs::create_dir_all(pasta);
        let _ = fs::write(arquivo, json);
    }
}

/// Lê e apaga: cada falha é oferecida uma vez só.
fn tomar(arquivo: &Path) -> Option<Falha> {
    let falha = ler(arquivo);
    let _ = fs::remove_file(arquivo);
    falha
}

#[tauri::command]
pub fn falha_anterior() -> Option<Falha> {
    tomar(&arquivo())
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn guarda_ate_alguem_ler() {
        let pasta = std::env::temp_dir().join(format!("seedy-falha-{}", std::process::id()));
        let arquivo = pasta.join("ultima-falha.json");
        let _ = fs::remove_dir_all(&pasta);
        assert!(tomar(&arquivo).is_none());

        anotar(&arquivo, "primeiro");
        anotar(&arquivo, "segundo");
        let falha = tomar(&arquivo).unwrap();
        assert_eq!(falha.detalhe, "primeiro\n\nsegundo");
        assert_eq!(falha.versao, env!("CARGO_PKG_VERSION"));
        assert!(falha.quando > 0);
        assert!(tomar(&arquivo).is_none(), "oferecida uma vez só");

        anotar(&arquivo, &"é".repeat(LIMITE * 2));
        assert_eq!(tomar(&arquivo).unwrap().detalhe.chars().count(), LIMITE);

        fs::write(&arquivo, "lixo").unwrap();
        assert!(tomar(&arquivo).is_none());
        assert!(!arquivo.exists());
        let _ = fs::remove_dir_all(&pasta);
    }
}
