//! Git — por enquanto só o nome da branch atual, lido direto de `.git/HEAD`.
//! A árvore de commits, diff e merge entram numa fase própria (ver ROADMAP.md).

use std::fs;
use std::path::Path;

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
