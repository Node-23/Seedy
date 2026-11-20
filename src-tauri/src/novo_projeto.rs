//! Novo projeto (␣ N, mockup 12). Os modelos Java (Maven, WAR e simples) são gerados aqui;
//! o Spring Boot vem do start.spring.io (um .tgz extraído na pasta) e o Angular do `ng new`
//! (via npx). No fim, `git init` e o primeiro commit.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use tauri::ipc::Channel;

const SPRING: &str = "https://start.spring.io";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PedidoDeProjeto {
    /// "spring" | "maven" | "war" | "simples" | "angular"
    modelo: String,
    nome: String,
    /// Pasta final do projeto (já com o nome).
    pasta: String,
    grupo: String,
    pacote: String,
    java: u32,
    /// "maven" | "gradle" (só no Spring)
    build: String,
    /// "jar" | "war" (só no Spring)
    empacotamento: String,
    spring_boot: Option<String>,
    dependencias: Vec<String>,
    git: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjetoCriado {
    pasta: String,
    /// Classe com `main` (nome qualificado), quando o modelo tem uma.
    principal: Option<String>,
    /// Aviso que não impediu a criação (ex.: o commit não saiu).
    aviso: Option<String>,
}

/// Cria o projeto; cada etapa (e a saída do `ng new`) vai para `progresso`.
#[tauri::command]
pub async fn projeto_criar(pedido: PedidoDeProjeto, progresso: Channel<String>) -> Result<ProjetoCriado, String> {
    tauri::async_runtime::spawn_blocking(move || criar(&pedido, &|t: &str| {
        let _ = progresso.send(t.to_string());
    }))
    .await
    .map_err(|e| e.to_string())?
}

/// Metadados do start.spring.io (versões do Spring Boot, do Java e os iniciadores), em JSON.
#[tauri::command]
pub async fn spring_metadados() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        agente()
            .get(SPRING)
            .set("Accept", "application/vnd.initializr.v2.2+json")
            .call()
            .map_err(|e| format!("não consegui falar com o start.spring.io: {e}"))?
            .into_string()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn agente() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(15))
        .timeout_read(Duration::from_secs(60))
        .user_agent("Seedy")
        .build()
}

fn criar(p: &PedidoDeProjeto, avisar: &dyn Fn(&str)) -> Result<ProjetoCriado, String> {
    validar_nome(&p.nome)?;
    let pasta = PathBuf::from(&p.pasta);
    if pasta.exists() && fs::read_dir(&pasta).map(|mut d| d.next().is_some()).unwrap_or(true) {
        return Err(format!("a pasta {} já existe e não está vazia", pasta.display()));
    }
    let pacote = if p.pacote.trim().is_empty() { format!("{}.{}", p.grupo, pacote_do_nome(&p.nome)) } else { p.pacote.trim().to_string() };
    if p.modelo != "angular" {
        validar_pacote(&pacote)?;
    }
    let principal = match p.modelo.as_str() {
        "maven" => {
            avisar("gerando o projeto Maven…");
            modelo_maven(&pasta, p, &pacote)?;
            Some(format!("{pacote}.Main"))
        }
        "war" => {
            avisar("gerando o projeto web (WAR)…");
            modelo_war(&pasta, p, &pacote)?;
            None
        }
        "simples" => {
            avisar("gerando o projeto Java…");
            modelo_simples(&pasta, &pacote)?;
            Some(format!("{pacote}.Main"))
        }
        "spring" => {
            avisar("baixando do start.spring.io…");
            baixar_spring(&pasta, p, &pacote)?;
            Some(format!("{pacote}.{}Application", nome_de_classe(&p.nome)))
        }
        "angular" => {
            angular(&pasta, p, avisar)?;
            None
        }
        outro => return Err(format!("modelo desconhecido: {outro}")),
    };
    let aviso = if p.git { iniciar_git(&pasta, avisar) } else { None };
    avisar("pronto");
    Ok(ProjetoCriado { pasta: pasta.to_string_lossy().into_owned(), principal, aviso })
}

// ---------- nomes ----------

fn validar_nome(nome: &str) -> Result<(), String> {
    let ok = !nome.is_empty()
        && nome.len() <= 80
        && nome.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && nome.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.');
    if ok { Ok(()) } else { Err("o nome do projeto deve começar com letra e ter só letras, números, - _ .".into()) }
}

fn validar_pacote(pacote: &str) -> Result<(), String> {
    let ok = pacote.split('.').all(|parte| {
        parte.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_') && parte.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
    });
    if ok { Ok(()) } else { Err(format!("pacote inválido: {pacote}")) }
}

/// "feira-api" → "FeiraApi" (o mesmo que o start.spring.io faz no nome da classe).
fn nome_de_classe(nome: &str) -> String {
    let mut s: String = nome
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|p| !p.is_empty())
        .map(|p| {
            let mut cs = p.chars();
            cs.next().map(|c| c.to_ascii_uppercase().to_string() + cs.as_str()).unwrap_or_default()
        })
        .collect();
    if s.is_empty() || s.starts_with(|c: char| c.is_ascii_digit()) {
        s.insert_str(0, "App");
    }
    s
}

/// "feira-api" → "feiraapi" (parte final do pacote).
fn pacote_do_nome(nome: &str) -> String {
    let s: String = nome.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_ascii_lowercase();
    if s.starts_with(|c: char| c.is_ascii_digit()) { format!("app{s}") } else { s }
}

fn escrever(base: &Path, relativo: &str, conteudo: &str) -> Result<(), String> {
    let mut caminho = base.to_path_buf();
    for parte in relativo.split('/') {
        caminho.push(parte);
    }
    if let Some(pai) = caminho.parent() {
        fs::create_dir_all(pai).map_err(|e| format!("{}: {e}", pai.display()))?;
    }
    fs::write(&caminho, conteudo).map_err(|e| format!("{}: {e}", caminho.display()))
}

fn pasta_do_pacote(pacote: &str) -> String {
    pacote.replace('.', "/")
}

// ---------- modelos Java ----------

fn pom(p: &PedidoDeProjeto, empacotamento: &str, dependencias: &str, plugins: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>{grupo}</groupId>
    <artifactId>{nome}</artifactId>
    <version>1.0-SNAPSHOT</version>
    <packaging>{empacotamento}</packaging>

    <properties>
        <maven.compiler.release>{java}</maven.compiler.release>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    </properties>

    <dependencies>
{dependencias}    </dependencies>

    <build>
        <finalName>{nome}</finalName>
        <plugins>
{plugins}        </plugins>
    </build>
</project>
"#,
        grupo = p.grupo,
        nome = p.nome,
        java = p.java,
    )
}

fn modelo_maven(base: &Path, p: &PedidoDeProjeto, pacote: &str) -> Result<(), String> {
    let deps = r#"        <dependency>
            <groupId>org.junit.jupiter</groupId>
            <artifactId>junit-jupiter</artifactId>
            <version>5.11.4</version>
            <scope>test</scope>
        </dependency>
"#;
    let plugins = r#"            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-surefire-plugin</artifactId>
                <version>3.5.2</version>
            </plugin>
"#;
    escrever(base, "pom.xml", &pom(p, "jar", deps, plugins))?;
    let dir = pasta_do_pacote(pacote);
    escrever(base, &format!("src/main/java/{dir}/Main.java"), &main_java(pacote))?;
    escrever(
        base,
        &format!("src/test/java/{dir}/MainTest.java"),
        &format!(
            "package {pacote};\n\nimport static org.junit.jupiter.api.Assertions.assertEquals;\n\nimport org.junit.jupiter.api.Test;\n\nclass MainTest {{\n\n    @Test\n    void saudacao() {{\n        assertEquals(\"Olá, Seedy!\", Main.saudacao(\"Seedy\"));\n    }}\n}}\n"
        ),
    )?;
    escrever(base, "src/main/resources/.gitkeep", "")?;
    escrever(base, ".gitignore", "target/\n*.class\n.idea/\n.vscode/\n")
}

fn modelo_war(base: &Path, p: &PedidoDeProjeto, pacote: &str) -> Result<(), String> {
    let deps = r#"        <dependency>
            <groupId>jakarta.servlet</groupId>
            <artifactId>jakarta.servlet-api</artifactId>
            <version>6.0.0</version>
            <scope>provided</scope>
        </dependency>
"#;
    let plugins = r#"            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-war-plugin</artifactId>
                <version>3.4.0</version>
                <configuration>
                    <failOnMissingWebXml>false</failOnMissingWebXml>
                </configuration>
            </plugin>
"#;
    escrever(base, "pom.xml", &pom(p, "war", deps, plugins))?;
    let dir = pasta_do_pacote(pacote);
    escrever(
        base,
        &format!("src/main/java/{dir}/OlaServlet.java"),
        &format!(
            r#"package {pacote};

import jakarta.servlet.annotation.WebServlet;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;

@WebServlet("/ola")
public class OlaServlet extends HttpServlet {{

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {{
        String nome = req.getParameter("nome");
        resp.setContentType("text/plain; charset=UTF-8");
        resp.getWriter().println("Olá, " + (nome == null ? "mundo" : nome) + "!");
    }}
}}
"#
        ),
    )?;
    escrever(
        base,
        "src/main/webapp/index.jsp",
        &format!(
            "<%@ page contentType=\"text/html; charset=UTF-8\" %>\n<!doctype html>\n<html lang=\"pt-BR\">\n<head><meta charset=\"utf-8\"><title>{nome}</title></head>\n<body>\n  <h1>{nome}</h1>\n  <p><a href=\"ola?nome=Seedy\">dizer olá</a></p>\n</body>\n</html>\n",
            nome = p.nome
        ),
    )?;
    escrever(base, "src/main/webapp/WEB-INF/.gitkeep", "")?;
    escrever(base, ".gitignore", "target/\n*.class\n.idea/\n.vscode/\n")
}

fn modelo_simples(base: &Path, pacote: &str) -> Result<(), String> {
    escrever(base, &format!("src/{}/Main.java", pasta_do_pacote(pacote)), &main_java(pacote))?;
    escrever(base, ".gitignore", "bin/\nout/\n*.class\n.idea/\n.vscode/\n")
}

fn main_java(pacote: &str) -> String {
    format!(
        "package {pacote};\n\npublic class Main {{\n\n    public static void main(String[] args) {{\n        System.out.println(saudacao(args.length > 0 ? args[0] : \"mundo\"));\n    }}\n\n    static String saudacao(String nome) {{\n        return \"Olá, \" + nome + \"!\";\n    }}\n}}\n"
    )
}

// ---------- Spring Boot ----------

fn baixar_spring(base: &Path, p: &PedidoDeProjeto, pacote: &str) -> Result<(), String> {
    const RAIZ: &str = "seedy-raiz";
    let tipo = if p.build == "gradle" { "gradle-project" } else { "maven-project" };
    let java = p.java.to_string();
    let mut pedido = agente()
        .get(&format!("{SPRING}/starter.tgz"))
        .query("type", tipo)
        .query("language", "java")
        .query("groupId", &p.grupo)
        .query("artifactId", &p.nome)
        .query("name", &p.nome)
        .query("packageName", pacote)
        .query("packaging", if p.empacotamento == "war" { "war" } else { "jar" })
        .query("javaVersion", &java)
        .query("baseDir", RAIZ);
    if let Some(v) = p.spring_boot.as_deref().filter(|v| !v.is_empty()) {
        pedido = pedido.query("bootVersion", v);
    }
    if !p.dependencias.is_empty() {
        pedido = pedido.query("dependencies", &p.dependencias.join(","));
    }
    let resposta = match pedido.call() {
        Ok(r) => r,
        Err(ureq::Error::Status(codigo, r)) => {
            let corpo = r.into_string().unwrap_or_default();
            let msg = serde_json::from_str::<serde_json::Value>(&corpo)
                .ok()
                .and_then(|v| v["message"].as_str().map(String::from))
                .unwrap_or(corpo);
            return Err(format!("o start.spring.io recusou ({codigo}): {msg}"));
        }
        Err(e) => return Err(format!("não consegui falar com o start.spring.io: {e}")),
    };
    let mut bytes = Vec::new();
    resposta.into_reader().read_to_end(&mut bytes).map_err(|e| format!("download interrompido: {e}"))?;
    extrair_tgz(&bytes, RAIZ, base)
}

/// Extrai o .tgz tirando a pasta `raiz` do começo de cada caminho (e recusando `..`).
fn extrair_tgz(bytes: &[u8], raiz: &str, destino: &Path) -> Result<(), String> {
    let mut arquivo = tar::Archive::new(flate2::read::GzDecoder::new(bytes));
    fs::create_dir_all(destino).map_err(|e| e.to_string())?;
    for entrada in arquivo.entries().map_err(|e| format!("pacote inválido: {e}"))? {
        let mut entrada = entrada.map_err(|e| format!("pacote inválido: {e}"))?;
        let caminho = entrada.path().map_err(|e| e.to_string())?.into_owned();
        let Ok(relativo) = caminho.strip_prefix(raiz) else { continue };
        if relativo.as_os_str().is_empty() || relativo.components().any(|c| !matches!(c, Component::Normal(_))) {
            continue;
        }
        let alvo = destino.join(relativo);
        if entrada.header().entry_type().is_dir() {
            fs::create_dir_all(&alvo).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(pai) = alvo.parent() {
            fs::create_dir_all(pai).map_err(|e| e.to_string())?;
        }
        entrada.unpack(&alvo).map_err(|e| format!("{}: {e}", alvo.display()))?;
    }
    Ok(())
}

// ---------- Angular ----------

fn angular(pasta: &Path, p: &PedidoDeProjeto, avisar: &dyn Fn(&str)) -> Result<(), String> {
    let pai = pasta.parent().ok_or("pasta inválida")?;
    fs::create_dir_all(pai).map_err(|e| e.to_string())?;
    avisar("rodando ng new (baixa o Angular CLI na primeira vez)…");
    let args = [
        "-y",
        "@angular/cli@latest",
        "new",
        &p.nome,
        "--directory",
        &pasta.to_string_lossy(),
        "--routing",
        "--style=css",
        "--ssr=false",
        "--skip-git",
        "--defaults",
        "--interactive=false",
    ]
    .map(String::from);
    let mut c = comando_npx(&args);
    c.current_dir(pai)
        .env("NG_CLI_ANALYTICS", "false")
        .env("CI", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut filho = c.spawn().map_err(|e| format!("não consegui rodar o npx (o Node está instalado?): {e}"))?;
    let erro = filho.stderr.take().map(|e| {
        std::thread::spawn(move || BufReader::new(e).lines().map_while(Result::ok).collect::<Vec<_>>())
    });
    if let Some(saida) = filho.stdout.take() {
        for linha in BufReader::new(saida).lines().map_while(Result::ok) {
            if !linha.trim().is_empty() {
                avisar(&linha);
            }
        }
    }
    let status = filho.wait().map_err(|e| e.to_string())?;
    let erros = erro.and_then(|h| h.join().ok()).unwrap_or_default();
    if !status.success() {
        let ultimo = erros.iter().rev().find(|l| !l.trim().is_empty()).cloned().unwrap_or_default();
        return Err(format!("ng new falhou: {ultimo}"));
    }
    Ok(())
}

fn comando_npx(args: &[String]) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new("cmd");
        c.arg("/C").arg("npx").args(args).creation_flags(0x0800_0000);
        c
    }
    #[cfg(not(windows))]
    {
        let mut c = Command::new("npx");
        c.args(args);
        c
    }
}

// ---------- git ----------

/// `git init` + primeiro commit; devolve um aviso se algo não saiu (o projeto continua criado).
fn iniciar_git(pasta: &Path, avisar: &dyn Fn(&str)) -> Option<String> {
    avisar("git init + primeiro commit…");
    let dir = pasta.to_string_lossy().into_owned();
    let rodar = |args: &[&str]| {
        let mut c = crate::git::comando_git(Some(&dir));
        c.args(args);
        crate::git::rodar(c, None)
    };
    match rodar(&["init", "-q"]) {
        Ok(s) if s.codigo == 0 => {}
        Ok(s) => return Some(format!("git init falhou: {}", s.erro.trim())),
        Err(e) => return Some(e),
    }
    let _ = rodar(&["add", "-A"]);
    match rodar(&["commit", "-q", "-m", "projeto criado pelo Seedy"]) {
        Ok(s) if s.codigo == 0 => None,
        Ok(s) => Some(format!("repositório criado, mas o commit não saiu: {}", s.erro.trim())),
        Err(e) => Some(e),
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    fn pedido(modelo: &str, pasta: &Path) -> PedidoDeProjeto {
        PedidoDeProjeto {
            modelo: modelo.into(),
            nome: "feira-api".into(),
            pasta: pasta.to_string_lossy().into_owned(),
            grupo: "br.com.feira".into(),
            pacote: "".into(),
            java: 21,
            build: "maven".into(),
            empacotamento: "jar".into(),
            spring_boot: None,
            dependencias: vec![],
            git: false,
        }
    }

    #[test]
    fn nomes() {
        assert_eq!(nome_de_classe("feira-api"), "FeiraApi");
        assert_eq!(nome_de_classe("loja_virtual.web"), "LojaVirtualWeb");
        assert_eq!(nome_de_classe("3d"), "App3d");
        assert_eq!(pacote_do_nome("feira-api"), "feiraapi");
        assert!(validar_nome("feira-api").is_ok());
        assert!(validar_nome("../x").is_err());
        assert!(validar_nome("1x").is_err());
        assert!(validar_pacote("br.com.feira").is_ok());
        assert!(validar_pacote("br.com.1feira").is_err());
    }

    #[test]
    fn cria_maven_war_e_simples() {
        let base = std::env::temp_dir().join(format!("seedy-novo-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let maven = base.join("maven");
        let r = criar(&pedido("maven", &maven), &|_| {}).unwrap();
        assert_eq!(r.principal.as_deref(), Some("br.com.feira.feiraapi.Main"));
        assert!(maven.join("src/main/java/br/com/feira/feiraapi/Main.java").exists());
        assert!(maven.join("src/test/java/br/com/feira/feiraapi/MainTest.java").exists());
        let pom = fs::read_to_string(maven.join("pom.xml")).unwrap();
        assert!(pom.contains("<maven.compiler.release>21</maven.compiler.release>"));
        assert!(pom.contains("<artifactId>feira-api</artifactId>"));

        let war = base.join("war");
        assert!(criar(&pedido("war", &war), &|_| {}).unwrap().principal.is_none());
        assert!(war.join("src/main/webapp/index.jsp").exists());
        assert!(fs::read_to_string(war.join("pom.xml")).unwrap().contains("<packaging>war</packaging>"));

        let simples = base.join("simples");
        criar(&pedido("simples", &simples), &|_| {}).unwrap();
        assert!(simples.join("src/br/com/feira/feiraapi/Main.java").exists());

        // Pasta com arquivos: recusa.
        assert!(criar(&pedido("maven", &maven), &|_| {}).is_err());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn extrai_tirando_a_raiz_e_ignorando_saidas_da_pasta() {
        let mut tgz = Vec::new();
        {
            let gz = flate2::write::GzEncoder::new(&mut tgz, flate2::Compression::fast());
            let mut t = tar::Builder::new(gz);
            for (nome, dados) in [("r/pom.xml", "<p/>"), ("r/src/A.java", "class A {}"), ("fora.txt", "x")] {
                let mut h = tar::Header::new_gnu();
                h.set_size(dados.len() as u64);
                h.set_mode(0o644);
                h.set_cksum();
                t.append_data(&mut h, nome, dados.as_bytes()).unwrap();
            }
            t.into_inner().unwrap().finish().unwrap();
        }
        let destino = std::env::temp_dir().join(format!("seedy-tgz-{}", std::process::id()));
        let _ = fs::remove_dir_all(&destino);
        extrair_tgz(&tgz, "r", &destino).unwrap();
        assert_eq!(fs::read_to_string(destino.join("pom.xml")).unwrap(), "<p/>");
        assert!(destino.join("src").join("A.java").exists());
        assert!(!destino.join("fora.txt").exists());
        let _ = fs::remove_dir_all(&destino);
    }
}
