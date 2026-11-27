//! Janela de carregamento: aparece enquanto o projeto abre; depois some e entra a principal.

use tauri::{AppHandle, Manager};

const SPLASH: &str = "carregamento";
/// Se a interface não avisar que terminou (erro ao carregar), a principal aparece mesmo assim.
const LIMITE: std::time::Duration = std::time::Duration::from_secs(14);

fn mostrar_principal(app: &AppHandle) {
    let Some(splash) = app.get_webview_window(SPLASH) else { return };
    if let Some(principal) = app.get_webview_window("principal") {
        let _ = principal.show();
        let _ = principal.set_focus();
    }
    // `destroy` não pede para fechar: o `CloseRequested` fica só para o usuário fechando a splash.
    let _ = splash.destroy();
}

pub fn iniciar(app: &AppHandle) {
    if let Some(splash) = app.get_webview_window(SPLASH) {
        crate::icone::definir(&splash);
        let handle = app.clone();
        // Fechar a janela de carregamento desiste de abrir o Seedy.
        splash.on_window_event(move |evento| {
            if let tauri::WindowEvent::CloseRequested { .. } = evento {
                handle.exit(0);
            }
        });
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(LIMITE);
        mostrar_principal(&app);
    });
}

#[tauri::command]
pub fn carregamento_etapa(app: AppHandle, texto: String, projeto: Option<String>, percentual: u8) {
    let Some(splash) = app.get_webview_window(SPLASH) else { return };
    let dados = serde_json::json!({
        "texto": texto,
        "projeto": projeto,
        "percentual": percentual,
        "versao": app.package_info().version.to_string(),
    });
    let _ = splash.eval(format!("window.etapa && window.etapa({dados})"));
}

#[tauri::command]
pub fn carregamento_pronto(app: AppHandle) {
    mostrar_principal(&app);
}
