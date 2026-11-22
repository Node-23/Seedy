//! Ícone da janela no Windows. O Tao só põe o ícone pequeno na janela; sem o grande, a barra de
//! tarefas e o Alt+Tab ficam sem ícone (a janela não tem barra de título do sistema).

#[cfg(windows)]
pub fn definir(janela: &tauri::WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{CreateIconFromResourceEx, SendMessageW, ICON_BIG, LR_DEFAULTCOLOR, WM_SETICON};
    // O PNG de 256 x 256 vai direto como recurso de ícone (o Windows aceita PNG nesse formato).
    const PNG: &[u8] = include_bytes!("../icons/128x128@2x.png");
    let Ok(hwnd) = janela.hwnd() else { return };
    unsafe {
        let icone = CreateIconFromResourceEx(PNG.as_ptr(), PNG.len() as u32, 1, 0x0003_0000, 256, 256, LR_DEFAULTCOLOR);
        if !icone.is_null() {
            SendMessageW(hwnd.0 as _, WM_SETICON, ICON_BIG as usize, icone as isize);
        }
    }
}

#[cfg(not(windows))]
pub fn definir(_janela: &tauri::WebviewWindow) {}
