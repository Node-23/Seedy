//! Terminal integrado: um PTY de verdade por aba.
//!
//! Linux: usa o shell do usuário ($SHELL). Windows: PowerShell via ConPTY.
//! A saída do processo vai para a interface por um `Channel` (streaming),
//! e a interface manda o que for digitado com `terminal_escrever`.

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::State;

struct Sessao {
    mestre: Box<dyn MasterPty + Send>,
    escritor: Box<dyn Write + Send>,
    processo: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct Terminais {
    sessoes: Mutex<HashMap<u32, Sessao>>,
    proximo_id: AtomicU32,
}

fn tamanho(colunas: u16, linhas: u16) -> PtySize {
    PtySize {
        rows: linhas.max(1),
        cols: colunas.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn comando_shell() -> CommandBuilder {
    if cfg!(windows) {
        let mut cmd = CommandBuilder::new("powershell.exe");
        cmd.arg("-NoLogo");
        cmd
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
        let mut cmd = CommandBuilder::new(shell);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd
    }
}

/// Abre um terminal novo e devolve o id dele.
#[tauri::command]
pub fn terminal_abrir(
    estado: State<'_, Terminais>,
    pasta: Option<String>,
    colunas: u16,
    linhas: u16,
    saida: Channel<String>,
    fim: Channel<()>,
) -> Result<u32, String> {
    let par = native_pty_system()
        .openpty(tamanho(colunas, linhas))
        .map_err(|e| format!("não consegui abrir o PTY: {e}"))?;

    let mut cmd = comando_shell();
    if let Some(p) = pasta.filter(|p| std::path::Path::new(p).is_dir()) {
        cmd.cwd(p);
    }
    let processo = par
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("não consegui iniciar o shell: {e}"))?;
    drop(par.slave);

    let mut leitor = par.master.try_clone_reader().map_err(|e| e.to_string())?;
    let escritor = par.master.take_writer().map_err(|e| e.to_string())?;

    std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        let mut pendente: Vec<u8> = Vec::new();
        loop {
            match leitor.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pendente.extend_from_slice(&buffer[..n]);
                    let texto = drenar_utf8(&mut pendente);
                    if !texto.is_empty() && saida.send(texto).is_err() {
                        break;
                    }
                }
            }
        }
        let _ = fim.send(());
    });

    let id = estado.proximo_id.fetch_add(1, Ordering::SeqCst) + 1;
    estado.sessoes.lock().map_err(|e| e.to_string())?.insert(
        id,
        Sessao {
            mestre: par.master,
            escritor,
            processo,
        },
    );
    Ok(id)
}

#[tauri::command]
pub fn terminal_escrever(estado: State<'_, Terminais>, id: u32, dados: String) -> Result<(), String> {
    let mut sessoes = estado.sessoes.lock().map_err(|e| e.to_string())?;
    let sessao = sessoes.get_mut(&id).ok_or("terminal não encontrado")?;
    sessao.escritor.write_all(dados.as_bytes()).map_err(|e| e.to_string())?;
    sessao.escritor.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_redimensionar(
    estado: State<'_, Terminais>,
    id: u32,
    colunas: u16,
    linhas: u16,
) -> Result<(), String> {
    let sessoes = estado.sessoes.lock().map_err(|e| e.to_string())?;
    let sessao = sessoes.get(&id).ok_or("terminal não encontrado")?;
    sessao.mestre.resize(tamanho(colunas, linhas)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_fechar(estado: State<'_, Terminais>, id: u32) -> Result<(), String> {
    if let Some(mut sessao) = estado.sessoes.lock().map_err(|e| e.to_string())?.remove(&id) {
        let _ = sessao.processo.kill();
    }
    Ok(())
}

/// Converte o que já chegou em texto UTF-8, guardando bytes de um caractere
/// que ainda está pela metade para a próxima leitura.
fn drenar_utf8(pendente: &mut Vec<u8>) -> String {
    match std::str::from_utf8(pendente) {
        Ok(texto) => {
            let saida = texto.to_owned();
            pendente.clear();
            saida
        }
        Err(erro) if erro.error_len().is_none() => {
            let valido = erro.valid_up_to();
            let saida = String::from_utf8_lossy(&pendente[..valido]).into_owned();
            pendente.drain(..valido);
            saida
        }
        Err(_) => {
            let saida = String::from_utf8_lossy(pendente).into_owned();
            pendente.clear();
            saida
        }
    }
}


#[cfg(test)]
mod testes {
    use super::drenar_utf8;

    #[test]
    fn guarda_caractere_incompleto() {
        let mut p = "olá".as_bytes().to_vec();
        let ultimo = p.pop().unwrap();
        assert_eq!(drenar_utf8(&mut p), "ol");
        p.push(ultimo);
        assert_eq!(drenar_utf8(&mut p), "á");
        assert!(p.is_empty());
    }
}
