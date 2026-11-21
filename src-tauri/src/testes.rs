//! Resultado dos testes: lê os relatórios JUnit XML que o Maven (surefire/failsafe) e o Gradle
//! deixam no projeto. Quem roda o comando é a interface (a mesma tarefa dos scripts); aqui só se lê
//! o que ficou.

use regex::Regex;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

#[derive(Serialize, Clone, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResultadoTeste {
    /// Nome simples da classe (sem o pacote).
    pub classe: String,
    pub metodo: String,
    /// "ok", "falhou" ou "ignorado".
    pub estado: &'static str,
    pub segundos: f64,
    pub mensagem: Option<String>,
    pub detalhe: Option<String>,
    /// Veio do failsafe (testes de integração) em vez do surefire.
    pub integracao: bool,
}

fn desescapar(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&#10;", "\n").replace("&#13;", "").replace("&amp;", "&")
}

fn atributos(texto: &str) -> Vec<(String, String)> {
    static ATRIB: OnceLock<Regex> = OnceLock::new();
    let re = ATRIB.get_or_init(|| Regex::new(r#"([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)""#).unwrap());
    re.captures_iter(texto).map(|c| (c[1].to_string(), desescapar(&c[2]))).collect()
}

/// Um arquivo `TEST-*.xml` (formato JUnit/surefire).
pub fn ler_relatorio(xml: &str, integracao: bool) -> Vec<ResultadoTeste> {
    static CASO: OnceLock<Regex> = OnceLock::new();
    static FALHA: OnceLock<Regex> = OnceLock::new();
    let caso = CASO.get_or_init(|| Regex::new(r"(?s)<testcase\b([^>]*?)(?:/>|>(.*?)</testcase>)").unwrap());
    let falha = FALHA.get_or_init(|| Regex::new(r"(?s)<(failure|error)\b([^>]*?)(?:/>|>(.*?)</(?:failure|error)>)").unwrap());
    let mut saida = Vec::new();
    for c in caso.captures_iter(xml) {
        let attrs = atributos(&c[1]);
        let pega = |k: &str| attrs.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone()).unwrap_or_default();
        let classname = pega("classname");
        let nome = pega("name");
        // Teste parametrizado: "metodo(int)[1]" / "metodo[1]" vira "metodo".
        let metodo = nome.split(['(', '[']).next().unwrap_or(&nome).trim().to_string();
        let corpo = c.get(2).map(|m| m.as_str()).unwrap_or("");
        let mut r = ResultadoTeste {
            classe: classname.rsplit('.').next().unwrap_or(&classname).to_string(),
            metodo,
            estado: "ok",
            segundos: pega("time").replace(',', ".").parse().unwrap_or(0.0),
            mensagem: None,
            detalhe: None,
            integracao,
        };
        if let Some(f) = falha.captures(corpo) {
            r.estado = "falhou";
            let a = atributos(&f[2]);
            r.mensagem = a.iter().find(|(n, _)| n == "message").map(|(_, v)| v.clone());
            let detalhe = desescapar(f.get(3).map(|m| m.as_str()).unwrap_or("").trim());
            r.detalhe = (!detalhe.is_empty()).then_some(detalhe);
        } else if corpo.contains("<skipped") {
            r.estado = "ignorado";
        }
        saida.push(r);
    }
    saida
}

fn relatorios_em(pasta: &Path, integracao: bool, saida: &mut Vec<ResultadoTeste>, profundidade: u8) {
    let Ok(entradas) = fs::read_dir(pasta) else { return };
    for e in entradas.flatten() {
        let caminho = e.path();
        if caminho.is_dir() && profundidade < 3 {
            relatorios_em(&caminho, integracao, saida, profundidade + 1);
        } else if caminho.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("TEST-") && n.ends_with(".xml")) {
            if let Ok(xml) = fs::read_to_string(&caminho) {
                saida.extend(ler_relatorio(&xml, integracao));
            }
        }
    }
}

/// Tudo o que os relatórios de Maven e Gradle têm hoje, a partir da raiz (e dos módulos filhos).
fn lista_de_modulos(raiz: &Path) -> Vec<PathBuf> {
    let mut v = vec![raiz.to_path_buf()];
    if let Ok(es) = fs::read_dir(raiz) {
        for e in es.flatten() {
            let p = e.path();
            let nome = e.file_name().to_string_lossy().to_string();
            if p.is_dir() && !nome.starts_with('.') && nome != "node_modules" && nome != "target" && nome != "build" && (p.join("pom.xml").exists() || p.join("build.gradle").exists() || p.join("build.gradle.kts").exists()) {
                v.push(p);
            }
        }
    }
    v
}

#[tauri::command]
pub async fn testes_relatorios(raiz: String) -> Result<Vec<ResultadoTeste>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut saida = Vec::new();
        for m in lista_de_modulos(Path::new(&raiz)) {
            relatorios_em(&m.join("target").join("surefire-reports"), false, &mut saida, 0);
            relatorios_em(&m.join("target").join("failsafe-reports"), true, &mut saida, 0);
            relatorios_em(&m.join("build").join("test-results"), false, &mut saida, 0);
        }
        saida
    })
    .await
    .map_err(|e| e.to_string())
}

/// Como rodar: o comando para o tipo escolhido (Maven ou Gradle, com o wrapper quando existe).
#[tauri::command]
pub async fn testes_comando(raiz: String, tipo: String, filtro: Option<String>) -> Result<Vec<String>, String> {
    // Pode baixar o Maven na primeira vez: fora da thread principal.
    tauri::async_runtime::spawn_blocking(move || montar_comando(raiz, tipo, filtro)).await.map_err(|e| e.to_string())?
}

const MAVEN_VERSAO: &str = "3.9.9";

/// Há um executável com esse nome (com as extensões do Windows) em alguma pasta do PATH?
fn no_path(nome: &str) -> bool {
    let Some(caminhos) = std::env::var_os("PATH") else { return false };
    let extensoes: &[&str] = if cfg!(windows) { &["", ".cmd", ".bat", ".exe"] } else { &[""] };
    std::env::split_paths(&caminhos).any(|p| extensoes.iter().any(|e| p.join(format!("{nome}{e}")).is_file()))
}

/// O Maven do próprio Seedy (baixado do Maven Central na primeira vez), para quem não o tem
/// instalado e o projeto não traz `mvnw`.
fn maven_do_seedy() -> Result<String, String> {
    use sha2::{Digest, Sha512};
    use std::io::Read;
    let pasta = crate::tema::pasta_config().join("maven");
    let nome = format!("apache-maven-{MAVEN_VERSAO}");
    let bin = pasta.join(&nome).join("bin").join(if cfg!(windows) { "mvn.cmd" } else { "mvn" });
    if bin.exists() {
        return Ok(bin.to_string_lossy().into_owned());
    }
    let url = format!("https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/{MAVEN_VERSAO}/{nome}-bin.tar.gz");
    let baixar = |u: &str| ureq::get(u).call().map_err(|e| format!("não consegui baixar o Maven: {e}"));
    let mut bytes = Vec::new();
    baixar(&url)?.into_reader().read_to_end(&mut bytes).map_err(|e| format!("download do Maven interrompido: {e}"))?;
    let esperado = baixar(&format!("{url}.sha512"))?.into_string().map_err(|e| e.to_string())?;
    let obtido = format!("{:x}", Sha512::digest(&bytes));
    if esperado.split_whitespace().next() != Some(obtido.as_str()) {
        return Err("o Maven baixado não confere (sha512); tente de novo".into());
    }
    let extraindo = pasta.join("extraindo");
    let _ = fs::remove_dir_all(&extraindo);
    fs::create_dir_all(&extraindo).map_err(|e| e.to_string())?;
    tar::Archive::new(flate2::read::GzDecoder::new(&bytes[..]))
        .unpack(&extraindo)
        .map_err(|e| format!("não consegui extrair o Maven: {e}"))?;
    let _ = fs::remove_dir_all(pasta.join(&nome));
    fs::rename(extraindo.join(&nome), pasta.join(&nome)).map_err(|e| e.to_string())?;
    let _ = fs::remove_dir_all(&extraindo);
    Ok(bin.to_string_lossy().into_owned())
}

fn montar_comando(raiz: String, tipo: String, filtro: Option<String>) -> Result<Vec<String>, String> {
    let raiz = PathBuf::from(raiz);
    let windows = cfg!(windows);
    let wrapper = |nome: &str, ext_win: &str| -> String {
        let local = raiz.join(if windows { format!("{nome}{ext_win}") } else { nome.to_string() });
        if local.exists() {
            if windows { local.to_string_lossy().into_owned() } else { format!("./{nome}") }
        } else {
            nome.to_string()
        }
    };
    if raiz.join("pom.xml").exists() {
        let mvn = wrapper("mvnw", ".cmd");
        let mvn = if mvn != "mvnw" {
            mvn
        } else if no_path("mvn") {
            "mvn".to_string()
        } else {
            maven_do_seedy()?
        };
        let mut c = vec![mvn];
        match (tipo.as_str(), filtro) {
            ("unitario", None) => c.push("test".into()),
            ("unitario", Some(f)) => c.extend(["test".into(), format!("-Dtest={f}"), "-Dsurefire.failIfNoSpecifiedTests=false".into()]),
            // Sem o surefire (testes de unidade), só o failsafe roda.
            ("integracao" | "api", f) => {
                c.extend(["verify".into(), "-Dtest=NenhumTestePorAqui".into(), "-Dsurefire.failIfNoSpecifiedTests=false".into()]);
                if let Some(f) = f {
                    c.push(format!("-Dit.test={f}"));
                }
            }
            (_, Some(f)) => c.extend(["verify".into(), format!("-Dtest={f}"), format!("-Dit.test={f}"), "-Dsurefire.failIfNoSpecifiedTests=false".into(), "-Dfailsafe.failIfNoSpecifiedTests=false".into()]),
            _ => c.push("verify".into()),
        }
        c.push("-B".into());
        return Ok(c);
    }
    if raiz.join("build.gradle").exists() || raiz.join("build.gradle.kts").exists() {
        let g = wrapper("gradlew", ".bat");
        let g = if g == "gradlew" { "gradle".to_string() } else { g };
        let mut c = vec![g, if tipo == "integracao" { "integrationTest".into() } else { "test".into() }];
        if let Some(f) = filtro {
            c.extend(["--tests".into(), f]);
        }
        return Ok(c);
    }
    Err("não achei pom.xml nem build.gradle neste projeto".into())
}

#[cfg(test)]
mod testes {
    use super::*;

    const XML: &str = r#"<?xml version="1.0"?>
<testsuite name="br.com.feira.reserva.ReservaServiceTest" tests="3" failures="1">
  <testcase name="reservaBancaLivre" classname="br.com.feira.reserva.ReservaServiceTest" time="0.012"/>
  <testcase name="naoReservaEmFeiraLotada" classname="br.com.feira.reserva.ReservaServiceTest" time="0.048">
    <failure message="expected: &lt;409&gt; but was: &lt;200&gt;" type="org.opentest4j.AssertionFailedError">org.opentest4j.AssertionFailedError: x
	at ReservaServiceTest.naoReservaEmFeiraLotada(ReservaServiceTest.java:41)</failure>
  </testcase>
  <testcase name="estorna(int)[1]" classname="br.com.feira.pagamento.PagamentoServiceTest" time="0">
    <skipped/>
  </testcase>
</testsuite>"#;

    #[test]
    fn le_o_relatorio_junit() {
        let r = ler_relatorio(XML, false);
        assert_eq!(r.len(), 3);
        assert_eq!((r[0].classe.as_str(), r[0].metodo.as_str(), r[0].estado), ("ReservaServiceTest", "reservaBancaLivre", "ok"));
        assert_eq!(r[1].estado, "falhou");
        assert_eq!(r[1].mensagem.as_deref(), Some("expected: <409> but was: <200>"));
        assert!(r[1].detalhe.as_deref().unwrap().contains("ReservaServiceTest.java:41"));
        assert!((r[1].segundos - 0.048).abs() < 1e-9);
        assert_eq!((r[2].metodo.as_str(), r[2].estado), ("estorna", "ignorado"));
    }
}

#[cfg(test)]
mod testes_maven {
    /// Baixa o Maven de verdade (rede): `cargo test --lib maven_do_seedy -- --ignored`.
    #[test]
    #[ignore]
    fn maven_do_seedy_baixa_e_roda() {
        let mvn = super::maven_do_seedy().unwrap();
        let saida = std::process::Command::new(&mvn).arg("-v").output().unwrap();
        let texto = String::from_utf8_lossy(&saida.stdout);
        assert!(texto.contains("Apache Maven 3.9.9"), "{texto}");
    }
}
