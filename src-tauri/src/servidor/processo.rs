//! O processo do servidor: roda o script, lê a saída em lotes e encerra a árvore
//! inteira (o .bat/.sh do servidor abre o java como processo filho).

use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

pub struct Processo {
    filho: Child,
}

impl Processo {
    /// Inicia o comando; cada lote de linhas (stdout e stderr juntos) vai para `saida`.
    pub fn iniciar(mut comando: Command, saida: impl Fn(Vec<String>) + Send + 'static) -> Result<Self, String> {
        comando.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            comando.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            comando.process_group(0); // o grupo inteiro sai junto no encerrar
        }
        let mut filho = comando.spawn().map_err(|e| format!("não consegui iniciar o servidor: {e}"))?;
        let (tx, rx) = mpsc::channel::<String>();
        if let Some(o) = filho.stdout.take() {
            ler_linhas(o, tx.clone());
        }
        if let Some(e) = filho.stderr.take() {
            ler_linhas(e, tx);
        }
        // Junta as linhas em lotes (um servidor subindo escreve centenas por segundo).
        std::thread::spawn(move || {
            let mut lote = Vec::new();
            let mut desde = Instant::now();
            loop {
                match rx.recv_timeout(Duration::from_millis(80)) {
                    Ok(l) => {
                        lote.push(l);
                        if lote.len() >= 400 || desde.elapsed() > Duration::from_millis(120) {
                            saida(std::mem::take(&mut lote));
                            desde = Instant::now();
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        if !lote.is_empty() {
                            saida(std::mem::take(&mut lote));
                        }
                        desde = Instant::now();
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        if !lote.is_empty() {
                            saida(lote);
                        }
                        break;
                    }
                }
            }
        });
        Ok(Self { filho })
    }

    pub fn pid(&self) -> u32 {
        self.filho.id()
    }

    /// Espera o processo acabar (para a thread que avisa "encerrado").
    pub fn esperar(mut self) -> Option<i32> {
        self.filho.wait().ok().and_then(|s| s.code())
    }
}

fn ler_linhas(r: impl Read + Send + 'static, tx: mpsc::Sender<String>) {
    std::thread::spawn(move || {
        let mut leitor = BufReader::new(r);
        let mut bytes = Vec::new();
        loop {
            bytes.clear();
            match leitor.read_until(b'\n', &mut bytes) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let linha = decodificar(&bytes);
                    if tx.send(linha.trim_end_matches(['\r', '\n']).to_string()).is_err() {
                        break;
                    }
                }
            }
        }
    });
}

/// UTF-8 quando for; senão Latin-1 (saída antiga de servidor no Windows).
fn decodificar(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => bytes.iter().map(|&b| b as char).collect(),
    }
}

/// Encerra o processo e todos os filhos (o java que o script abriu).
pub fn encerrar_arvore(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(0x0800_0000)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(unix)]
    {
        // Primeiro pede com educação; quem não sair em 5 s é derrubado.
        let grupo = format!("-{pid}");
        let _ = Command::new("kill").args(["-TERM", "--", &grupo]).status();
        let limite = Instant::now() + Duration::from_secs(5);
        while Instant::now() < limite {
            if Command::new("kill").args(["-0", &pid.to_string()]).status().map(|s| !s.success()).unwrap_or(true) {
                return;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        let _ = Command::new("kill").args(["-KILL", "--", &grupo]).status();
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn decodifica_utf8_e_latin1() {
        assert_eq!(decodificar("ação".as_bytes()), "ação");
        assert_eq!(decodificar(&[b'a', 0xE7, 0xE3, b'o']), "ação");
    }
}
