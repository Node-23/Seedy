//! Acesso ao sistema de arquivos: listar pastas, ler e gravar arquivos de texto.

use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Serialize)]
pub struct Entrada {
    pub nome: String,
    pub caminho: String,
    pub pasta: bool,
}

/// Pastas que não aparecem na árvore.
const IGNORADAS: &[&str] = &[".git"];

/// Pasta passada na linha de comando (`seedy /caminho/do/projeto`), se houver.
#[tauri::command]
pub fn pasta_inicial() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|a| !a.starts_with('-') && Path::new(a).is_dir())
        .and_then(|a| fs::canonicalize(a).ok())
        .map(|p| limpar_prefixo_windows(p.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn ler_pasta(caminho: String) -> Result<Vec<Entrada>, String> {
    let leitura = fs::read_dir(&caminho).map_err(|e| format!("não consegui abrir {caminho}: {e}"))?;
    let mut entradas: Vec<Entrada> = leitura
        .filter_map(Result::ok)
        .filter_map(|item| {
            let nome = item.file_name().to_string_lossy().into_owned();
            if IGNORADAS.contains(&nome.as_str()) {
                return None;
            }
            let pasta = item.file_type().map(|t| t.is_dir()).unwrap_or(false);
            Some(Entrada {
                nome,
                caminho: item.path().to_string_lossy().into_owned(),
                pasta,
            })
        })
        .collect();
    // Pastas primeiro, depois arquivos; ordem alfabética sem diferenciar maiúsculas.
    entradas.sort_by(|a, b| {
        b.pasta
            .cmp(&a.pasta)
            .then_with(|| a.nome.to_lowercase().cmp(&b.nome.to_lowercase()))
    });
    Ok(entradas)
}

#[tauri::command]
pub fn ler_arquivo(caminho: String) -> Result<String, String> {
    let bytes = fs::read(&caminho).map_err(|e| format!("não consegui ler {caminho}: {e}"))?;
    String::from_utf8(bytes).map_err(|_| "o arquivo é binário ou não está em UTF-8".to_string())
}

#[tauri::command]
pub fn gravar_arquivo(caminho: String, conteudo: String) -> Result<(), String> {
    fs::write(&caminho, conteudo).map_err(|e| format!("não consegui gravar {caminho}: {e}"))
}

/// No Windows, `canonicalize` devolve caminhos no formato `\\?\C:\...`.
fn limpar_prefixo_windows(caminho: String) -> String {
    caminho.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(caminho)
}
