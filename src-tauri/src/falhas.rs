//! Pânico no núcleo vira uma "falha do Seedy" na interface, que pode ser enviada para análise.

use tauri::{AppHandle, Emitter};

pub fn observar(app: AppHandle) {
    let anterior = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        anterior(info);
        let detalhe = info.to_string();
        let app = app.clone();
        // Em outra thread: a que entrou em pânico pode estar segurando algo que o aviso precisa.
        std::thread::spawn(move || {
            let _ = app.emit("seedy://falha", detalhe);
        });
    }));
}
