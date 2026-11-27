//! A janela principal na tela de início fica do tamanho do cartão; ao abrir um projeto, volta ao que era.

use std::sync::Mutex;

use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Size, WebviewWindow};

/// O cartão da tela de início (mockup 30).
const INICIO: (f64, f64) = (980.0, 760.0);
/// Os limites da janela de trabalho (os mesmos do `tauri.conf.json`).
const MINIMO: (f64, f64) = (900.0, 560.0);
const PADRAO: (f64, f64) = (1440.0, 900.0);
/// Folga para a barra de tarefas em telas baixas.
const FOLGA: f64 = 60.0;

struct Antes {
    tamanho: PhysicalSize<u32>,
    posicao: Option<PhysicalPosition<i32>>,
    maximizada: bool,
}

static ANTES: Mutex<Option<Antes>> = Mutex::new(None);

/// O cartão, encolhido quando o monitor (em pixels lógicos) é menor que ele.
fn tamanho_do_inicio(monitor: Option<(f64, f64)>) -> (f64, f64) {
    let Some((largura, altura)) = monitor else { return INICIO };
    (INICIO.0.min(largura), INICIO.1.min(altura - FOLGA))
}

fn logico((largura, altura): (f64, f64)) -> Size {
    Size::Logical(LogicalSize::new(largura, altura))
}

fn encolher(janela: &WebviewWindow) -> tauri::Result<()> {
    let mut antes = ANTES.lock().unwrap_or_else(|e| e.into_inner());
    if antes.is_some() {
        return Ok(());
    }
    let maximizada = janela.is_maximized().unwrap_or(false);
    if maximizada {
        janela.unmaximize()?;
    }
    // Escondida (o Seedy abrindo direto no início) ainda não tem lugar: depois, vai para o meio.
    let posicao = if janela.is_visible().unwrap_or(false) { janela.outer_position().ok() } else { None };
    *antes = Some(Antes { tamanho: janela.inner_size()?, posicao, maximizada });
    let monitor = janela.current_monitor()?.map(|m| {
        let t = m.size().to_logical::<f64>(m.scale_factor());
        (t.width, t.height)
    });
    let tamanho = tamanho_do_inicio(monitor);
    janela.set_min_size(Some(logico(tamanho)))?;
    janela.set_size(logico(tamanho))?;
    janela.set_resizable(false)?;
    janela.set_maximizable(false)?;
    janela.center()
}

fn restaurar(janela: &WebviewWindow) -> tauri::Result<()> {
    let Some(antes) = ANTES.lock().unwrap_or_else(|e| e.into_inner()).take() else { return Ok(()) };
    janela.set_resizable(true)?;
    janela.set_maximizable(true)?;
    janela.set_min_size(Some(logico(MINIMO)))?;
    // Sem um tamanho guardado que preste, vale o padrão.
    if antes.tamanho.width == 0 || antes.tamanho.height == 0 {
        janela.set_size(logico(PADRAO))?;
    } else {
        janela.set_size(Size::Physical(antes.tamanho))?;
    }
    match antes.posicao {
        Some(p) => janela.set_position(p)?,
        None => janela.center()?,
    }
    if antes.maximizada {
        janela.maximize()?;
    }
    Ok(())
}

#[tauri::command]
pub fn janela_inicio(app: AppHandle, ativa: bool) -> Result<(), String> {
    let janela = app.get_webview_window("principal").ok_or("sem a janela principal")?;
    if ativa { encolher(&janela) } else { restaurar(&janela) }.map_err(|e| e.to_string())
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn cabe_no_monitor() {
        assert_eq!(tamanho_do_inicio(None), INICIO);
        assert_eq!(tamanho_do_inicio(Some((1920.0, 1080.0))), INICIO);
        assert_eq!(tamanho_do_inicio(Some((1093.0, 614.0))), (980.0, 554.0));
    }
}
