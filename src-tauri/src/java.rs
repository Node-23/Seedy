//! Inteligência de Java: acha um JDK 25+, baixa e verifica o Eclipse JDT Language
//! Server (jdtls) e conversa com ele por LSP (JSON-RPC sobre stdio).
//!
//! O núcleo só move bytes: o protocolo LSP (mensagens, capacidades, Monaco) fica
//! na interface. Aqui ficam o que precisa do sistema — processos, disco e rede.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs::{self, File};
use std::hash::{Hash, Hasher};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::State;

/// Versão fixa do jdtls: atualizar = trocar as três constantes (o hash vem do `.sha256` publicado).
const JDTLS_VERSAO: &str = "1.63.0";
const JDTLS_ARQUIVO: &str = "jdt-language-server-1.63.0-202610191322.tar.gz";
const JDTLS_SHA256: &str = "b1f2abe0b3cccb462cf64fb4a5587c7d09df60cf8be7748b152cbd89d018bdc4";
/// O jdtls 1.63 roda em Java 25 ou mais novo (o projeto pode usar qualquer versão:
/// o JDK do projeto vem do pom.xml/build.gradle). Subir junto com JDTLS_VERSAO.
const JAVA_MINIMO: u32 = 25;

#[derive(Serialize, Clone, Debug)]
pub struct Jdk {
    pub home: String,
    pub versao: String,
    pub maior: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EstadoJava {
    pub jdk: Option<Jdk>,
    pub jdtls_instalado: bool,
    pub versao_jdtls: &'static str,
    pub java_minimo: u32,
}

#[derive(Serialize, Clone)]
#[serde(tag = "fase", rename_all = "camelCase")]
pub enum Progresso {
    Baixando { baixado: u64, total: Option<u64> },
    Verificando,
    Extraindo,
    Pronto,
}

#[derive(Serialize)]
pub struct Iniciado {
    pub id: u32,
    /// PID do Seedy: o jdtls encerra sozinho se o Seedy morrer (initialize.processId).
    pub pid: u32,
    /// Arquivo de preferências do compilador (vai em `java.settings.url`).
    pub preferencias: String,
}

/// Preferências do compilador Java que o jdtls usa (formato `.prefs` do Eclipse).
/// Fica na pasta de configuração do Seedy, para o usuário editar como o tema.
const PREFERENCIAS_PADRAO: &str = "# Preferências do compilador Java usadas pelo jdtls (formato .prefs do Eclipse).
# Valores: error, warning, info, ignore. Depois de mudar, reinicie o jdtls (Ctrl+Shift+Espaço, l).
org.eclipse.jdt.core.compiler.problem.unusedImport=warning
org.eclipse.jdt.core.compiler.problem.unusedLocal=warning
org.eclipse.jdt.core.compiler.problem.unusedPrivateMember=warning
org.eclipse.jdt.core.compiler.problem.unusedParameter=ignore
";

fn garantir_preferencias() -> Result<PathBuf, String> {
    let caminho = crate::tema::pasta_config().join("jdtls.prefs");
    if !caminho.exists() {
        fs::create_dir_all(caminho.parent().unwrap_or(Path::new("."))).map_err(|e| e.to_string())?;
        fs::write(&caminho, PREFERENCIAS_PADRAO).map_err(|e| format!("não consegui criar {}: {e}", caminho.display()))?;
    }
    Ok(caminho)
}

// ---------- JDK ----------

fn executavel_java(home: &Path) -> PathBuf {
    home.join("bin").join(if cfg!(windows) { "java.exe" } else { "java" })
}

/// Lê `JAVA_VERSION` do arquivo `release` do JDK: "21.0.13" → 21, "1.8.0_211" → 8.
fn versao_do_jdk(home: &Path) -> Option<(String, u32)> {
    let release = fs::read_to_string(home.join("release")).ok()?;
    let versao = versao_do_release(&release)?;
    executavel_java(home).is_file().then_some(versao)
}

fn versao_do_release(release: &str) -> Option<(String, u32)> {
    let linha = release.lines().find(|l| l.starts_with("JAVA_VERSION="))?;
    let v = linha["JAVA_VERSION=".len()..].trim().trim_matches('"').to_string();
    let maior = match v.strip_prefix("1.") {
        Some(resto) => resto.split('.').next()?.parse().ok()?,
        None => v.split(|c: char| !c.is_ascii_digit()).next()?.parse().ok()?,
    };
    Some((v, maior))
}

/// Lugares onde os instaladores costumam pôr JDKs, em cada sistema.
fn candidatos_jdk() -> Vec<PathBuf> {
    let mut homes: Vec<PathBuf> = ["SEEDY_JAVA_HOME", "JAVA_HOME"]
        .iter()
        .filter_map(|v| std::env::var_os(v).map(PathBuf::from))
        .collect();

    let mut pastas: Vec<PathBuf> = Vec::new();
    if cfg!(windows) {
        for base in ["ProgramFiles", "ProgramW6432"].iter().filter_map(std::env::var_os) {
            let base = PathBuf::from(base);
            for fornecedor in ["Eclipse Adoptium", "Java", "Microsoft", "Zulu", "Amazon Corretto", "BellSoft", "Semeru"] {
                pastas.push(base.join(fornecedor));
            }
        }
    } else {
        pastas.extend(["/usr/lib/jvm", "/usr/java", "/opt/java", "/Library/Java/JavaVirtualMachines"].map(PathBuf::from));
    }
    if let Some(casa) = dirs::home_dir() {
        pastas.push(casa.join(".jdks"));
        pastas.push(casa.join(".sdkman").join("candidates").join("java"));
    }
    for pasta in pastas {
        let Ok(itens) = fs::read_dir(&pasta) else { continue };
        for item in itens.filter_map(Result::ok) {
            let p = item.path();
            homes.push(p.join("Contents").join("Home")); // macOS
            homes.push(p);
        }
    }
    homes
}

/// Todos os JDKs encontrados (qualquer versão), sem repetir, do mais novo ao mais velho.
pub fn todos_os_jdks() -> Vec<Jdk> {
    let mut vistos = std::collections::HashSet::new();
    let mut jdks: Vec<Jdk> = candidatos_jdk()
        .into_iter()
        .filter_map(|home| {
            let (versao, maior) = versao_do_jdk(&home)?;
            // Só JDK (com javac); um JRE sozinho não compila o projeto.
            let javac = home.join("bin").join(if cfg!(windows) { "javac.exe" } else { "javac" });
            if !javac.is_file() {
                return None;
            }
            let real = fs::canonicalize(&home).unwrap_or_else(|_| home.clone());
            vistos.insert(real).then(|| Jdk { home: home.to_string_lossy().into_owned(), versao, maior })
        })
        .collect();
    jdks.sort_by(|a, b| numeros(&b.versao).cmp(&numeros(&a.versao)));
    jdks
}

/// O JDK do jdtls: o escolhido pelo usuário (se ainda existir e servir) ou o mais novo encontrado.
pub fn achar_jdk(escolhido: Option<&str>) -> Option<Jdk> {
    if let Some(home) = escolhido.filter(|h| !h.is_empty()) {
        if let Some((versao, maior)) = versao_do_jdk(Path::new(home)) {
            if maior >= JAVA_MINIMO {
                return Some(Jdk { home: home.to_string(), versao, maior });
            }
        }
    }
    todos_os_jdks().into_iter().find(|j| j.maior >= JAVA_MINIMO)
}

/// "21.0.13" → [21, 0, 13]; "1.8.0_211" → [8, 0, 211]: para ordenar como número, não texto.
fn numeros(versao: &str) -> Vec<u32> {
    let v = versao.strip_prefix("1.").unwrap_or(versao);
    v.split(|c: char| !c.is_ascii_digit()).filter_map(|p| p.parse().ok()).collect()
}

/// JDKs instalados: para escolher o do jdtls e para os "runtimes" dos projetos
/// (um projeto Java 8 compila contra o JDK 8, um Java 21 contra o 21...).
#[tauri::command]
pub fn java_jdks() -> Vec<Jdk> {
    todos_os_jdks()
}

/// O JDK que o projeto pede para o Maven e o Gradle rodarem: o menor instalado que seja pelo menos da
/// versão declarada no pom.xml / build.gradle. (Rodar com um JDK muito mais novo costuma quebrar o
/// Lombok e outros processadores de anotação; o `JAVA_HOME` do sistema não é lembrado.)
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JdkDoProjeto {
    pub home: String,
    pub versao: String,
    /// A versão que o projeto declara (17, 21...).
    pub declarada: u32,
}

/// "1.8", "1_8" e "8" viram 8; "17" e "17.0" viram 17.
fn versao_de_java(texto: &str) -> Option<u32> {
    let limpo = texto.trim().trim_matches(|c| c == '"' || c == '\'');
    let sem_prefixo = limpo.strip_prefix("1.").or_else(|| limpo.strip_prefix("1_")).unwrap_or(limpo);
    let n: u32 = sem_prefixo.split(['.', '_']).next()?.parse().ok()?;
    (5..=99).contains(&n).then_some(n)
}

/// A versão de Java que o pom.xml ou o build.gradle da raiz declaram, se declaram.
pub fn versao_declarada(raiz: &Path) -> Option<u32> {
    use regex::Regex;
    if let Ok(pom) = fs::read_to_string(raiz.join("pom.xml")) {
        for tag in ["maven.compiler.release", "java.version", "maven.compiler.source", "maven.compiler.target", "release", "source", "target"] {
            let re = Regex::new(&format!(r"<{}>\s*([0-9._]+)\s*</{}>", regex::escape(tag), regex::escape(tag))).ok()?;
            if let Some(v) = re.captures(&pom).and_then(|c| versao_de_java(&c[1])) {
                return Some(v);
            }
        }
    }
    for nome in ["build.gradle", "build.gradle.kts"] {
        if let Ok(g) = fs::read_to_string(raiz.join(nome)) {
            for padrao in [
                r"JavaLanguageVersion\.of\(\s*(\d+)",
                r"(?:sourceCompatibility|targetCompatibility)\s*=?\s*(?:JavaVersion\.VERSION_)?['\x22]?([0-9._]+)",
                r"jvmTarget\s*=?\s*['\x22]?([0-9._]+)",
            ] {
                if let Some(v) = Regex::new(padrao).ok().and_then(|re| re.captures(&g)).and_then(|c| versao_de_java(&c[1])) {
                    return Some(v);
                }
            }
        }
    }
    None
}

/// O menor JDK instalado que atende a versão declarada.
pub fn escolher_jdk(jdks: &[Jdk], declarada: u32) -> Option<Jdk> {
    jdks.iter().filter(|j| j.maior >= declarada).min_by_key(|j| j.maior).cloned()
}

#[tauri::command]
pub fn java_jdk_do_projeto(raiz: String) -> Option<JdkDoProjeto> {
    let declarada = versao_declarada(Path::new(&raiz))?;
    let jdk = escolher_jdk(&todos_os_jdks(), declarada)?;
    Some(JdkDoProjeto { home: jdk.home, versao: jdk.versao, declarada })
}

// ---------- jdtls: instalação ----------

fn pasta_jdtls() -> PathBuf {
    crate::tema::pasta_config().join("jdtls").join(JDTLS_VERSAO)
}

fn lancador(pasta: &Path) -> Option<PathBuf> {
    fs::read_dir(pasta.join("plugins")).ok()?.filter_map(Result::ok).map(|e| e.path()).find(|p| {
        let nome = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        nome.starts_with("org.eclipse.equinox.launcher_") && nome.ends_with(".jar")
    })
}

#[tauri::command]
pub fn java_estado(jdk: Option<String>) -> EstadoJava {
    EstadoJava {
        jdk: achar_jdk(jdk.as_deref()),
        jdtls_instalado: lancador(&pasta_jdtls()).is_some(),
        versao_jdtls: JDTLS_VERSAO,
        java_minimo: JAVA_MINIMO,
    }
}

/// Baixa o jdtls, confere o SHA-256 e extrai na pasta de configuração do Seedy.
#[tauri::command]
pub async fn jdtls_instalar(progresso: Channel<Progresso>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || instalar(&progresso))
        .await
        .map_err(|e| e.to_string())?
}

fn instalar(progresso: &Channel<Progresso>) -> Result<(), String> {
    let destino = pasta_jdtls();
    if lancador(&destino).is_some() {
        let _ = progresso.send(Progresso::Pronto);
        return Ok(());
    }
    let pai = destino.parent().ok_or("pasta do jdtls inválida")?;
    fs::create_dir_all(pai).map_err(|e| format!("não consegui criar {}: {e}", pai.display()))?;
    let baixado = pai.join(format!("{JDTLS_VERSAO}.baixando"));
    let extraindo = pai.join(format!("{JDTLS_VERSAO}.extraindo"));

    let url = format!("https://download.eclipse.org/jdtls/milestones/{JDTLS_VERSAO}/{JDTLS_ARQUIVO}");
    let resposta = ureq::get(&url).call().map_err(|e| format!("não consegui baixar o jdtls: {e}"))?;
    let total = resposta.header("Content-Length").and_then(|v| v.parse().ok());
    let mut leitor = resposta.into_reader();
    let mut arquivo = File::create(&baixado).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    let mut lido: u64 = 0;
    let mut avisado: u64 = 0;
    loop {
        let n = leitor.read(&mut buffer).map_err(|e| format!("download interrompido: {e}"))?;
        if n == 0 {
            break;
        }
        arquivo.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
        hash.update(&buffer[..n]);
        lido += n as u64;
        if lido - avisado >= 512 * 1024 {
            avisado = lido;
            let _ = progresso.send(Progresso::Baixando { baixado: lido, total });
        }
    }
    drop(arquivo);

    let _ = progresso.send(Progresso::Verificando);
    let obtido = format!("{:x}", hash.finalize());
    if obtido != JDTLS_SHA256 {
        let _ = fs::remove_file(&baixado);
        return Err(format!("o arquivo baixado não confere (sha256 {obtido}); tente de novo"));
    }

    let _ = progresso.send(Progresso::Extraindo);
    let _ = fs::remove_dir_all(&extraindo);
    fs::create_dir_all(&extraindo).map_err(|e| e.to_string())?;
    let gz = flate2::read::GzDecoder::new(File::open(&baixado).map_err(|e| e.to_string())?);
    tar::Archive::new(gz)
        .unpack(&extraindo)
        .map_err(|e| format!("não consegui extrair o jdtls: {e}"))?;
    let _ = fs::remove_dir_all(&destino);
    fs::rename(&extraindo, &destino).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&baixado);
    let _ = progresso.send(Progresso::Pronto);
    Ok(())
}

// ---------- jdtls: processo e LSP ----------

struct Servidor {
    entrada: ChildStdin,
    processo: Child,
    raiz: String,
    /// "java", "ts", "angular", "eslint": um de cada por projeto.
    tipo: String,
}

impl Servidor {
    fn encerrar(mut self) {
        drop(self.entrada);
        let _ = self.processo.kill();
        let _ = self.processo.wait();
    }
}

#[derive(Default)]
pub struct Servidores {
    lista: Mutex<HashMap<u32, Servidor>>,
    proximo_id: AtomicU32,
}

/// Pasta de trabalho do jdtls (índices, cache do Maven/Gradle), uma por projeto.
fn pasta_dados(raiz: &str) -> PathBuf {
    let mut h = DefaultHasher::new();
    raiz.hash(&mut h);
    let nome = Path::new(raiz).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    dirs::cache_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("seedy")
        .join("jdtls")
        .join(format!("{nome}-{:016x}", h.finish()))
}

#[tauri::command]
pub fn lsp_iniciar(
    estado: State<'_, Servidores>,
    raiz: String,
    mensagens: Channel<String>,
    fim: Channel<()>,
    jdk: Option<String>,
) -> Result<Iniciado, String> {
    encerrar_orfaos(&estado, &raiz, "java");
    let jdk = achar_jdk(jdk.as_deref()).ok_or(format!("nenhum JDK {JAVA_MINIMO}+ encontrado (defina SEEDY_JAVA_HOME)"))?;
    let pasta = pasta_jdtls();
    let jar = lancador(&pasta).ok_or("o jdtls ainda não foi baixado")?;
    let configuracao = pasta.join(if cfg!(windows) {
        "config_win"
    } else if cfg!(target_os = "macos") {
        "config_mac"
    } else {
        "config_linux"
    });
    let preferencias = garantir_preferencias()?;
    let dados = pasta_dados(&raiz);
    fs::create_dir_all(&dados).map_err(|e| e.to_string())?;
    let log = File::create(dados.join("seedy-stderr.log")).map_err(|e| e.to_string())?;

    let mut comando = Command::new(executavel_java(Path::new(&jdk.home)));
    comando
        .args([
            "-Declipse.application=org.eclipse.jdt.ls.core.id1",
            "-Dosgi.bundles.defaultStartLevel=4",
            "-Declipse.product=org.eclipse.jdt.ls.core.product",
            "-Dlog.level=WARNING",
            // .project/.classpath/.settings no cache do jdtls, não no projeto do usuário.
            // Precisa ser propriedade da JVM: o jdtls lê antes de qualquer configuração.
            "-Djava.import.generatesMetadataFilesAtProjectRoot=false",
            "-Xms256m",
            "-Xmx2G",
            "-XX:+UseParallelGC",
            "--add-modules=ALL-SYSTEM",
            "--add-opens",
            "java.base/java.util=ALL-UNNAMED",
            "--add-opens",
            "java.base/java.lang=ALL-UNNAMED",
            "-jar",
        ])
        .arg(&jar)
        .arg("-configuration")
        .arg(&configuracao)
        .arg("-data")
        .arg(&dados)
        .current_dir(&raiz)
        .stderr(Stdio::from(log));
    let id = registrar_lsp(&estado, "java", raiz, comando, mensagens, fim).map_err(|e| format!("não consegui iniciar o jdtls: {e}"))?;
    Ok(Iniciado { id, pid: std::process::id(), preferencias: preferencias.to_string_lossy().into_owned() })
}

/// Um servidor de cada tipo por projeto: se a interface recarregou, o anterior fica órfão — encerra.
pub(crate) fn encerrar_orfaos(estado: &Servidores, raiz: &str, tipo: &str) {
    let orfaos: Vec<u32> =
        estado.lista.lock().unwrap().iter().filter(|(_, s)| s.raiz == raiz && s.tipo == tipo).map(|(id, _)| *id).collect();
    for id in orfaos {
        if let Some(s) = estado.lista.lock().unwrap().remove(&id) {
            s.encerrar();
        }
    }
}

/// Sobe um servidor LSP (stdio) e o registra: as mensagens dele vão para `mensagens`;
/// `lsp_enviar`/`lsp_parar` valem para qualquer tipo.
pub(crate) fn registrar_lsp(
    estado: &Servidores,
    tipo: &str,
    raiz: String,
    mut comando: Command,
    mensagens: Channel<String>,
    fim: Channel<()>,
) -> Result<u32, String> {
    comando.stdin(Stdio::piped()).stdout(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const SEM_JANELA: u32 = 0x0800_0000; // CREATE_NO_WINDOW
        comando.creation_flags(SEM_JANELA);
    }
    let mut processo = comando.spawn().map_err(|e| e.to_string())?;
    let entrada = processo.stdin.take().ok_or("sem stdin do servidor")?;
    let saida = processo.stdout.take().ok_or("sem stdout do servidor")?;

    std::thread::spawn(move || {
        let mut leitor = BufReader::new(saida);
        while let Ok(Some(mensagem)) = ler_mensagem(&mut leitor) {
            if mensagens.send(mensagem).is_err() {
                break;
            }
        }
        let _ = fim.send(());
    });

    let id = estado.proximo_id.fetch_add(1, Ordering::Relaxed);
    estado.lista.lock().unwrap().insert(id, Servidor { entrada, processo, raiz, tipo: tipo.to_string() });
    Ok(id)
}

#[tauri::command]
pub fn lsp_enviar(estado: State<'_, Servidores>, id: u32, mensagem: String) -> Result<(), String> {
    let mut lista = estado.lista.lock().unwrap();
    let servidor = lista.get_mut(&id).ok_or("o servidor de linguagem não está rodando")?;
    let tipo = servidor.tipo.clone();
    escrever_mensagem(&mut servidor.entrada, &mensagem).map_err(|e| format!("{} não respondeu: {e}", if tipo == "java" { "jdtls" } else { &tipo }))
}

#[tauri::command]
pub fn lsp_parar(estado: State<'_, Servidores>, id: u32) {
    let servidor = estado.lista.lock().unwrap().remove(&id);
    if let Some(s) = servidor {
        s.encerrar();
    }
}

/// Uma mensagem LSP: cabeçalhos (`Content-Length: n`), linha vazia, `n` bytes de JSON.
fn ler_mensagem<R: BufRead>(leitor: &mut R) -> io::Result<Option<String>> {
    let mut tamanho: Option<usize> = None;
    loop {
        let mut linha = String::new();
        if leitor.read_line(&mut linha)? == 0 {
            return Ok(None);
        }
        let linha = linha.trim_end();
        if linha.is_empty() {
            if tamanho.is_some() {
                break;
            }
            continue;
        }
        if let Some(valor) = linha.strip_prefix("Content-Length:") {
            tamanho = valor.trim().parse().ok();
        }
    }
    let mut corpo = vec![0u8; tamanho.unwrap_or(0)];
    leitor.read_exact(&mut corpo)?;
    Ok(Some(String::from_utf8_lossy(&corpo).into_owned()))
}

fn escrever_mensagem<W: Write>(escritor: &mut W, mensagem: &str) -> io::Result<()> {
    write!(escritor, "Content-Length: {}\r\n\r\n", mensagem.len())?;
    escritor.write_all(mensagem.as_bytes())?;
    escritor.flush()
}

#[cfg(test)]
mod testes {
    use super::*;

    fn jdk(maior: u32) -> Jdk {
        Jdk { home: format!("/jdk-{maior}"), versao: maior.to_string(), maior }
    }

    #[test]
    fn versao_declarada_do_pom_e_do_gradle() {
        let base = std::env::temp_dir().join(format!("seedy-jdk-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let escrever = |pasta: &str, nome: &str, texto: &str| {
            let d = base.join(pasta);
            fs::create_dir_all(&d).unwrap();
            fs::write(d.join(nome), texto).unwrap();
            d
        };
        let a = escrever("a", "pom.xml", "<properties><maven.compiler.source>17</maven.compiler.source><maven.compiler.target>17</maven.compiler.target></properties>");
        assert_eq!(versao_declarada(&a), Some(17));
        let b = escrever("b", "pom.xml", "<properties><java.version>1.8</java.version></properties>");
        assert_eq!(versao_declarada(&b), Some(8));
        let c = escrever("c", "pom.xml", "<properties><maven.compiler.release>21</maven.compiler.release><java.version>11</java.version></properties>");
        assert_eq!(versao_declarada(&c), Some(21), "release manda");
        let d = escrever("d", "build.gradle", "java { toolchain { languageVersion = JavaLanguageVersion.of(21) } }");
        assert_eq!(versao_declarada(&d), Some(21));
        let e = escrever("e", "build.gradle", "sourceCompatibility = '17'\ntargetCompatibility = '17'");
        assert_eq!(versao_declarada(&e), Some(17));
        let f = escrever("f", "build.gradle.kts", "java { sourceCompatibility = JavaVersion.VERSION_11 }");
        assert_eq!(versao_declarada(&f), Some(11));
        let g = escrever("g", "pom.xml", "<project><artifactId>x</artifactId></project>");
        assert_eq!(versao_declarada(&g), None);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn escolhe_o_menor_jdk_que_atende() {
        let todos = vec![jdk(25), jdk(21), jdk(8)];
        assert_eq!(escolher_jdk(&todos, 17).map(|j| j.maior), Some(21), "17 não está instalado: vai o 21, não o 25");
        assert_eq!(escolher_jdk(&todos, 21).map(|j| j.maior), Some(21));
        assert_eq!(escolher_jdk(&todos, 8).map(|j| j.maior), Some(8));
        assert_eq!(escolher_jdk(&todos, 26).map(|j| j.maior), None);
        assert_eq!(versao_de_java("1.8"), Some(8));
        assert_eq!(versao_de_java("17.0"), Some(17));
        assert_eq!(versao_de_java("abc"), None);
    }

    #[test]
    fn le_versao_do_release() {
        assert_eq!(versao_do_release("IMPLEMENTOR=\"x\"\nJAVA_VERSION=\"21.0.13\"\n"), Some(("21.0.13".into(), 21)));
        assert_eq!(versao_do_release("JAVA_VERSION=\"1.8.0_211\""), Some(("1.8.0_211".into(), 8)));
        assert_eq!(versao_do_release("JAVA_VERSION=\"25\""), Some(("25".into(), 25)));
        assert_eq!(versao_do_release("OS_NAME=Linux"), None);
    }

    #[test]
    fn versoes_ordenam_como_numero() {
        assert!(numeros("21.0.13") > numeros("21.0.7"));
        assert!(numeros("25") > numeros("21.0.13"));
        assert_eq!(numeros("1.8.0_211"), vec![8, 0, 211]);
    }

    #[test]
    fn mensagens_lsp_vao_e_voltam() {
        let mut bytes = Vec::new();
        escrever_mensagem(&mut bytes, r#"{"id":1,"texto":"ação"}"#).unwrap();
        escrever_mensagem(&mut bytes, "{}").unwrap();
        let mut leitor = BufReader::new(bytes.as_slice());
        assert_eq!(ler_mensagem(&mut leitor).unwrap().as_deref(), Some(r#"{"id":1,"texto":"ação"}"#));
        assert_eq!(ler_mensagem(&mut leitor).unwrap().as_deref(), Some("{}"));
        assert_eq!(ler_mensagem(&mut leitor).unwrap(), None);
    }

    #[test]
    fn pasta_de_dados_e_por_projeto() {
        assert_ne!(pasta_dados("/a/projeto"), pasta_dados("/b/projeto"));
        assert_eq!(pasta_dados("/a/projeto"), pasta_dados("/a/projeto"));
    }
}
