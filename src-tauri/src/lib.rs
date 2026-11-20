//! Núcleo do Seedy.
//!
//! Cada módulo cuida de uma parte do sistema e expõe comandos para a interface
//! (Angular) via `invoke`. A regra é manter o núcleo pequeno: só o que precisa
//! de acesso ao sistema (arquivos, processos, PTY, Git) mora aqui.

mod arquivos;
mod git;
mod terminal;
mod tema;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(terminal::Terminais::default())
        .setup(|app| {
            tema::garantir_tema_padrao().map_err(|e| e.to_string())?;
            tema::observar(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            arquivos::pasta_inicial,
            arquivos::ler_pasta,
            arquivos::ler_arquivo,
            arquivos::gravar_arquivo,
            git::branch_atual,
            tema::tema_carregar,
            tema::tema_padrao,
            tema::fonte_bytes,
            terminal::terminal_abrir,
            terminal::terminal_escrever,
            terminal::terminal_redimensionar,
            terminal::terminal_fechar,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Seedy");
}
