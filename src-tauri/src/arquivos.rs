//! Acesso ao sistema de arquivos: listar pastas, ler e gravar arquivos de texto.

use serde::Serialize;
use std::fs;
use std::io::Write;
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
    // A pasta pode não existir ainda (ex.: `.seedy/regras.md` na primeira vez).
    if let Some(pai) = std::path::Path::new(&caminho).parent() {
        if !pai.as_os_str().is_empty() && !pai.exists() {
            fs::create_dir_all(pai).map_err(|e| format!("não consegui criar {}: {e}", pai.display()))?;
        }
    }
    fs::write(&caminho, conteudo).map_err(|e| format!("não consegui gravar {caminho}: {e}"))
}

/// Cria um arquivo novo (e as pastas do caminho). Nunca sobrescreve.
#[tauri::command]
pub fn criar_arquivo(caminho: String, conteudo: String) -> Result<(), String> {
    let destino = Path::new(&caminho);
    if let Some(pai) = destino.parent() {
        fs::create_dir_all(pai).map_err(|e| format!("não consegui criar {}: {e}", pai.display()))?;
    }
    let mut arquivo = fs::OpenOptions::new().write(true).create_new(true).open(destino).map_err(|e| match e.kind() {
        std::io::ErrorKind::AlreadyExists => format!("já existe: {caminho}"),
        _ => format!("não consegui criar {caminho}: {e}"),
    })?;
    arquivo.write_all(conteudo.as_bytes()).map_err(|e| format!("não consegui gravar {caminho}: {e}"))
}

#[tauri::command]
pub fn criar_pasta(caminho: String) -> Result<(), String> {
    if Path::new(&caminho).exists() {
        return Err(format!("já existe: {caminho}"));
    }
    fs::create_dir_all(&caminho).map_err(|e| format!("não consegui criar {caminho}: {e}"))
}

#[tauri::command]
pub fn caminho_existe(caminho: String) -> bool {
    Path::new(&caminho).exists()
}

/// Copia um arquivo ou uma pasta inteira. Nunca sobrescreve; links simbólicos ficam de fora.
fn copiar_arvore(origem: &Path, destino: &Path) -> std::io::Result<()> {
    let tipo = fs::symlink_metadata(origem)?.file_type();
    if tipo.is_dir() {
        fs::create_dir(destino)?;
        for item in fs::read_dir(origem)? {
            let item = item?;
            copiar_arvore(&item.path(), &destino.join(item.file_name()))?;
        }
    } else if tipo.is_file() {
        let mut de = fs::File::open(origem)?;
        let mut para = fs::OpenOptions::new().write(true).create_new(true).open(destino)?;
        std::io::copy(&mut de, &mut para)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn copiar_caminho(origem: String, destino: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (de, para) = (Path::new(&origem), Path::new(&destino));
        if para.exists() {
            return Err(format!("já existe: {destino}"));
        }
        if para.starts_with(de) {
            return Err("não dá para colar uma pasta dentro dela mesma".to_string());
        }
        copiar_arvore(de, para).map_err(|e| format!("não consegui copiar para {destino}: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Renomeia sem sobrescrever. Só mudar maiúsculas e minúsculas vale (no Windows é "o mesmo" arquivo).
#[tauri::command]
pub fn renomear_caminho(origem: String, destino: String) -> Result<(), String> {
    if Path::new(&destino).exists() && origem.to_lowercase() != destino.to_lowercase() {
        return Err(format!("já existe: {destino}"));
    }
    fs::rename(&origem, &destino).map_err(|e| format!("não consegui renomear: {e}"))
}

/// Manda para a Lixeira: apagar pela árvore dá para desfazer.
#[tauri::command]
pub async fn apagar_para_lixeira(caminho: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !Path::new(&caminho).exists() {
            return Err(format!("não existe mais: {caminho}"));
        }
        para_a_lixeira(&caminho)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(windows)]
fn para_a_lixeira(caminho: &str) -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::{SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, FOF_WANTNUKEWARNING, FO_DELETE, SHFILEOPSTRUCTW};
    // A lista de caminhos termina com dois zeros, e só aceita barra invertida.
    let de: Vec<u16> = caminho.replace('/', "\\").encode_utf16().chain([0, 0]).collect();
    let mut operacao: SHFILEOPSTRUCTW = unsafe { std::mem::zeroed() };
    operacao.wFunc = FO_DELETE;
    operacao.pFrom = de.as_ptr();
    // WANTNUKEWARNING: onde não há Lixeira (pen drive, rede), o Windows avisa antes de apagar de vez.
    operacao.fFlags = (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT | FOF_WANTNUKEWARNING) as u16;
    let codigo = unsafe { SHFileOperationW(&mut operacao) };
    if codigo != 0 {
        return Err(format!("não consegui mandar para a Lixeira (código {codigo}); algum programa está usando o arquivo?"));
    }
    if operacao.fAnyOperationsAborted != 0 {
        return Err("não apagado".into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn para_a_lixeira(caminho: &str) -> Result<(), String> {
    let saida = std::process::Command::new("gio").args(["trash", "--", caminho]).output().map_err(|e| format!("não consegui mandar para a lixeira (precisa do gio): {e}"))?;
    saida.status.success().then_some(()).ok_or_else(|| format!("não consegui mandar para a lixeira: {}", String::from_utf8_lossy(&saida.stderr).trim()))
}

/// Mostra o item no gerenciador de arquivos do sistema (no Windows, já selecionado).
#[tauri::command]
pub fn abrir_no_explorador(caminho: String) -> Result<(), String> {
    let item = Path::new(&caminho);
    if !item.exists() {
        return Err(format!("não existe mais: {caminho}"));
    }
    #[cfg(windows)]
    let mut comando = {
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new("explorer.exe");
        // O explorer lê a própria linha de comando: as aspas vão em volta só do caminho.
        let nativo = caminho.replace('/', "\\");
        let alvo = if item.is_dir() { format!("\"{nativo}\"") } else { format!("/select,\"{nativo}\"") };
        c.raw_arg(alvo);
        c
    };
    #[cfg(not(windows))]
    let mut comando = {
        let pasta = if item.is_dir() { item } else { item.parent().unwrap_or(item) };
        let mut c = std::process::Command::new(if cfg!(target_os = "macos") { "open" } else { "xdg-open" });
        c.arg(pasta);
        c
    };
    // Fica de pé depois que o Seedy fechar.
    crate::processos::spawn_livre(&mut comando, 0).map(|_| ()).map_err(|e| format!("não consegui abrir o explorador de arquivos: {e}"))
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn renomeia_sem_sobrescrever_e_apaga_para_a_lixeira() {
        let raiz = std::env::temp_dir().join(format!("seedy-renomear-{}", std::process::id()));
        let _ = fs::remove_dir_all(&raiz);
        fs::create_dir_all(&raiz).unwrap();
        let texto = |n: &str| raiz.join(n).to_string_lossy().into_owned();
        fs::write(texto("a.txt"), "1").unwrap();
        fs::write(texto("b.txt"), "2").unwrap();
        assert!(renomear_caminho(texto("a.txt"), texto("b.txt")).unwrap_err().starts_with("já existe"));
        renomear_caminho(texto("a.txt"), texto("A.txt")).unwrap();
        renomear_caminho(texto("A.txt"), texto("c.txt")).unwrap();
        assert_eq!(fs::read_to_string(texto("c.txt")).unwrap(), "1");
        #[cfg(windows)]
        {
            para_a_lixeira(&texto("c.txt")).unwrap();
            assert!(!raiz.join("c.txt").exists());
        }
        let _ = fs::remove_dir_all(&raiz);
    }

    #[test]
    fn cria_e_copia_sem_sobrescrever() {
        let raiz = std::env::temp_dir().join(format!("seedy-arquivos-{}", std::process::id()));
        let _ = fs::remove_dir_all(&raiz);
        let texto = |p: &Path| p.to_string_lossy().into_owned();
        let a = raiz.join("pacote/dentro/A.java");
        criar_arquivo(texto(&a), "class A {}".into()).unwrap();
        assert!(criar_arquivo(texto(&a), "outro".into()).unwrap_err().starts_with("já existe"));
        assert_eq!(fs::read_to_string(&a).unwrap(), "class A {}");
        assert!(criar_pasta(texto(&raiz.join("pacote"))).is_err());

        let copia = raiz.join("copia");
        copiar_arvore(&raiz.join("pacote"), &copia).unwrap();
        assert_eq!(fs::read_to_string(copia.join("dentro/A.java")).unwrap(), "class A {}");
        assert!(copiar_arvore(&a, &copia.join("dentro/A.java")).is_err(), "não sobrescreve");
        let _ = fs::remove_dir_all(&raiz);
    }
}

/// No Windows, `canonicalize` devolve caminhos no formato `\\?\C:\...`.
fn limpar_prefixo_windows(caminho: String) -> String {
    caminho.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(caminho)
}
