//! Histórico local (mockup 47): cópias dos arquivos do projeto para recuperar o que não foi
//! commitado. Ficam na pasta de dados do usuário, fora do projeto e fora do Git:
//! `<dados>/seedy/historico/<projeto>/` com `indice.json` e um arquivo por conteúdo (pelo hash,
//! então conteúdos iguais não se repetem). Guarda por 7 dias, até 200 MB por projeto.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const VALIDADE_MS: u64 = 7 * 24 * 60 * 60 * 1000;
const LIMITE_TOTAL: u64 = 200 * 1024 * 1024;
const LIMITE_DE_ARQUIVO: u64 = 1024 * 1024;
/// Pastas de saída e dependências: nunca entram.
const FORA: &[&str] = &[".git", "node_modules", "target", "build", "out", "dist", ".gradle", ".angular"];
/// Quantos arquivos, no máximo, ao guardar uma pasta inteira (antes de apagar).
const LIMITE_DA_PASTA: usize = 500;

/// Uma gravação de cada vez: o índice é um arquivo só.
static TRAVA: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Versao {
    /// Caminho relativo ao projeto, com "/".
    pub caminho: String,
    /// Milissegundos desde 1970.
    pub quando: u64,
    pub motivo: String,
    pub hash: String,
    pub tamanho: u64,
    /// Linhas a mais e a menos em relação à versão anterior do mesmo arquivo.
    pub mais: u32,
    pub menos: u32,
}

fn agora() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn hexa(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn pasta_do_projeto(raiz: &str) -> PathBuf {
    let normal: PathBuf = Path::new(raiz).components().collect();
    let mut chave = normal.to_string_lossy().into_owned();
    if cfg!(windows) {
        chave = chave.to_lowercase();
    }
    dirs::data_local_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("seedy")
        .join("historico")
        .join(&hexa(chave.as_bytes())[..16])
}

/// Caminho relativo ao projeto (com "/"), se estiver dentro dele e fora das pastas ignoradas.
fn relativo(raiz: &str, caminho: &Path) -> Option<String> {
    let raiz: PathBuf = Path::new(raiz).components().collect();
    let caminho: PathBuf = caminho.components().collect();
    let mut dele = caminho.components();
    for parte in raiz.components() {
        let outra = dele.next()?;
        let igual = if cfg!(windows) {
            parte.as_os_str().to_string_lossy().eq_ignore_ascii_case(&outra.as_os_str().to_string_lossy())
        } else {
            parte == outra
        };
        if !igual {
            return None;
        }
    }
    let mut partes = Vec::new();
    for parte in dele {
        let Component::Normal(nome) = parte else { return None };
        let nome = nome.to_string_lossy().into_owned();
        if FORA.contains(&nome.as_str()) {
            return None;
        }
        partes.push(nome);
    }
    (!partes.is_empty()).then(|| partes.join("/"))
}

fn ler_indice(pasta: &Path) -> Vec<Versao> {
    fs::read_to_string(pasta.join("indice.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn gravar_indice(pasta: &Path, indice: &[Versao]) -> Result<(), String> {
    let temporario = pasta.join("indice.json.novo");
    fs::write(&temporario, serde_json::to_vec(indice).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&temporario, pasta.join("indice.json")).map_err(|e| e.to_string())
}

/// Linhas que entraram e saíram, contando linhas iguais (aproximado, só para o resumo).
fn contar(antes: &str, depois: &str) -> (u32, u32) {
    let mut saldo: HashMap<&str, i64> = HashMap::new();
    for l in depois.lines() {
        *saldo.entry(l).or_default() += 1;
    }
    for l in antes.lines() {
        *saldo.entry(l).or_default() -= 1;
    }
    saldo.values().fold((0, 0), |(mais, menos), &n| if n > 0 { (mais + n as u32, menos) } else { (mais, menos + (-n) as u32) })
}

/// Tira o que venceu e, passando do limite, os mais antigos; apaga os conteúdos sem dono.
fn limpar(pasta: &Path, indice: &mut Vec<Versao>, quando: u64) {
    let antes = indice.len();
    indice.retain(|v| quando.saturating_sub(v.quando) <= VALIDADE_MS);
    let mut vistos = HashSet::new();
    let mut total = 0;
    let mut corte = 0;
    // Do mais novo para o mais antigo (o índice cresce no fim).
    for (i, v) in indice.iter().enumerate().rev() {
        if vistos.insert(v.hash.clone()) {
            total += v.tamanho;
        }
        if total > LIMITE_TOTAL {
            corte = i + 1;
            break;
        }
    }
    indice.drain(..corte);
    if indice.len() == antes {
        return;
    }
    let usados: HashSet<&str> = indice.iter().map(|v| v.hash.as_str()).collect();
    let Ok(arquivos) = fs::read_dir(pasta.join("conteudos")) else { return };
    for a in arquivos.flatten() {
        if !usados.contains(a.file_name().to_string_lossy().as_ref()) {
            let _ = fs::remove_file(a.path());
        }
    }
}

/// Guarda `conteudo` como versão de `caminho` (relativo). Igual à última versão: nada a fazer.
fn guardar_em(pasta: &Path, caminho: &str, conteudo: &str, motivo: &str, quando: u64) -> Result<bool, String> {
    if conteudo.len() as u64 > LIMITE_DE_ARQUIVO || conteudo.contains('\0') {
        return Ok(false);
    }
    let _trava = TRAVA.lock().map_err(|e| e.to_string())?;
    let conteudos = pasta.join("conteudos");
    fs::create_dir_all(&conteudos).map_err(|e| e.to_string())?;
    let mut indice = ler_indice(pasta);
    let hash = hexa(conteudo.as_bytes());
    let anterior = indice.iter().rev().find(|v| v.caminho == caminho);
    if anterior.is_some_and(|v| v.hash == hash) {
        return Ok(false);
    }
    let (mais, menos) = match anterior.and_then(|v| fs::read_to_string(conteudos.join(&v.hash)).ok()) {
        Some(texto) => contar(&texto, conteudo),
        None => (0, 0),
    };
    let destino = conteudos.join(&hash);
    if !destino.exists() {
        fs::write(&destino, conteudo).map_err(|e| e.to_string())?;
    }
    indice.push(Versao { caminho: caminho.into(), quando, motivo: motivo.into(), hash, tamanho: conteudo.len() as u64, mais, menos });
    limpar(pasta, &mut indice, quando);
    gravar_indice(pasta, &indice)?;
    Ok(true)
}

/// Os arquivos de texto de uma pasta (para guardar antes de apagar).
fn arquivos_de(pasta: &Path, saida: &mut Vec<PathBuf>) {
    let Ok(entradas) = fs::read_dir(pasta) else { return };
    for e in entradas.flatten() {
        if saida.len() >= LIMITE_DA_PASTA {
            return;
        }
        let caminho = e.path();
        match e.file_type() {
            Ok(t) if t.is_dir() => {
                if !FORA.contains(&e.file_name().to_string_lossy().as_ref()) {
                    arquivos_de(&caminho, saida);
                }
            }
            Ok(t) if t.is_file() => saida.push(caminho),
            _ => {}
        }
    }
}

/// Guarda uma versão. Sem `conteudo`, lê do disco (numa pasta, cada arquivo dela).
#[tauri::command]
pub async fn historico_guardar(raiz: String, caminho: String, motivo: String, conteudo: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let pasta = pasta_do_projeto(&raiz);
        let alvo = PathBuf::from(&caminho);
        if let Some(texto) = conteudo {
            if let Some(rel) = relativo(&raiz, &alvo) {
                guardar_em(&pasta, &rel, &texto, &motivo, agora())?;
            }
            return Ok(());
        }
        let mut arquivos = Vec::new();
        if alvo.is_dir() {
            arquivos_de(&alvo, &mut arquivos);
        } else {
            arquivos.push(alvo);
        }
        for a in arquivos {
            let Some(rel) = relativo(&raiz, &a) else { continue };
            if fs::metadata(&a).map_or(true, |m| !m.is_file() || m.len() > LIMITE_DE_ARQUIVO) {
                continue;
            }
            // Binário (não é UTF-8) fica de fora.
            let Ok(texto) = fs::read_to_string(&a) else { continue };
            guardar_em(&pasta, &rel, &texto, &motivo, agora())?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// As versões guardadas, da mais nova para a mais antiga; com `caminho`, só as dele.
#[tauri::command]
pub async fn historico_listar(raiz: String, caminho: Option<String>) -> Result<Vec<Versao>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let so = match caminho {
            Some(c) => match relativo(&raiz, Path::new(&c)) {
                Some(rel) => Some(rel),
                None => return Ok(Vec::new()),
            },
            None => None,
        };
        let limite = agora().saturating_sub(VALIDADE_MS);
        let mut lista = ler_indice(&pasta_do_projeto(&raiz));
        lista.retain(|v| v.quando >= limite && so.as_ref().is_none_or(|rel| rel == &v.caminho));
        lista.reverse();
        Ok(lista)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn historico_ler(raiz: String, hash: String) -> Result<String, String> {
    if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("versão inválida".into());
    }
    fs::read_to_string(pasta_do_projeto(&raiz).join("conteudos").join(hash)).map_err(|_| "essa versão já não está guardada".into())
}

#[cfg(test)]
mod testes {
    use super::*;

    fn pasta(nome: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("seedy-historico-{nome}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        p
    }

    #[test]
    fn guarda_sem_repetir_e_conta_as_linhas() {
        let p = pasta("guarda");
        assert!(guardar_em(&p, "A.java", "um\ndois\n", "salvo", 1000).unwrap());
        assert!(!guardar_em(&p, "A.java", "um\ndois\n", "salvo", 2000).unwrap());
        assert!(guardar_em(&p, "A.java", "um\ntres\nquatro\n", "salvo", 3000).unwrap());
        let indice = ler_indice(&p);
        assert_eq!(indice.len(), 2);
        assert_eq!((indice[1].mais, indice[1].menos), (2, 1));
        assert_eq!(fs::read_to_string(p.join("conteudos").join(&indice[0].hash)).unwrap(), "um\ndois\n");
        fs::remove_dir_all(p).unwrap();
    }

    #[test]
    fn versoes_vencidas_saem_com_o_conteudo() {
        let p = pasta("vence");
        guardar_em(&p, "A.java", "velho", "salvo", 1000).unwrap();
        let velho = ler_indice(&p)[0].hash.clone();
        guardar_em(&p, "A.java", "novo", "salvo", 1000 + VALIDADE_MS + 1).unwrap();
        assert_eq!(ler_indice(&p).len(), 1);
        assert!(!p.join("conteudos").join(velho).exists());
        fs::remove_dir_all(p).unwrap();
    }

    #[test]
    fn so_o_que_e_do_projeto_entra() {
        let raiz = std::env::temp_dir().join("projeto");
        let r = raiz.to_string_lossy().into_owned();
        assert_eq!(relativo(&r, &raiz.join("src").join("A.java")), Some("src/A.java".into()));
        assert_eq!(relativo(&r, &raiz.join(".env")), Some(".env".into()));
        assert_eq!(relativo(&r, &raiz.join("target").join("A.class")), None);
        assert_eq!(relativo(&r, &raiz), None);
        assert_eq!(relativo(&r, &std::env::temp_dir().join("outro").join("A.java")), None);
        assert_eq!(relativo(&r, &raiz.join("..").join("fora.txt")), None);
    }
}
