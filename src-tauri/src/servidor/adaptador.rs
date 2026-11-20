//! Adaptador comum dos servidores de aplicação. Cada perfil roda numa pasta de
//! servidor própria ("base", no cache do Seedy): a instalação do usuário não é tocada.
//!
//! |                | JBoss / WildFly                         | Tomcat                                  |
//! |----------------|-----------------------------------------|-----------------------------------------|
//! | base           | `-Djboss.server.base.dir`               | `CATALINA_BASE`                         |
//! | iniciar        | `standalone.sh/.bat`                    | `catalina.sh/.bat run`                  |
//! | deploy         | `deployments/<ctx>.war/` + `.dodeploy`  | contexto apontando para a pasta         |
//! | debug          | `--debug <porta>`                       | `catalina jpda run` + `JPDA_ADDRESS`    |
//! | redeploy       | tocar o `.dodeploy`                     | tocar o XML do contexto                 |

use super::Perfil;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

pub trait Adaptador {
    /// Confere a instalação e devolve a versão (ou o erro do que falta).
    fn versao(&self, instalacao: &Path) -> Result<String, String>;
    /// Cria/atualiza a pasta de servidor do perfil. Devolve a pasta da aplicação.
    fn preparar(&self, p: &Perfil, base: &Path) -> Result<PathBuf, String>;
    fn comando(&self, p: &Perfil, base: &Path, debug: bool) -> Command;
    /// Pede ao servidor para recarregar a aplicação (depois do espelho atualizado).
    fn redeploy(&self, p: &Perfil, base: &Path) -> Result<(), String>;
}

pub fn de(tipo: &str) -> Result<Box<dyn Adaptador>, String> {
    match tipo {
        "wildfly" => Ok(Box::new(Wildfly)),
        "tomcat" => Ok(Box::new(Tomcat)),
        outro => Err(format!("servidor não suportado: {outro}")),
    }
}

/// O tipo pela cara da pasta de instalação.
pub fn detectar(instalacao: &Path) -> Option<&'static str> {
    if instalacao.join("standalone").join("configuration").is_dir() && instalacao.join("bin").join("standalone.sh").exists() {
        Some("wildfly")
    } else if instalacao.join("conf").join("server.xml").exists() && instalacao.join("bin").join("catalina.sh").exists() {
        Some("tomcat")
    } else {
        None
    }
}

/// Nome da aplicação no servidor: "/" vira ROOT.
pub fn nome_do_contexto(p: &Perfil) -> String {
    let c = p.contexto.trim().trim_matches('/');
    if c.is_empty() {
        "ROOT".into()
    } else {
        c.replace('/', "#")
    }
}

fn script(instalacao: &Path, nome: &str) -> PathBuf {
    let ext = if cfg!(windows) { "bat" } else { "sh" };
    instalacao.join("bin").join(format!("{nome}.{ext}"))
}

/// No Windows o .bat roda direto (o Rust escapa os argumentos); no Linux via `sh`,
/// porque o zip pode ter perdido a permissão de execução.
fn rodar_script(caminho: &Path) -> Command {
    if cfg!(windows) {
        Command::new(caminho)
    } else {
        let mut c = Command::new("sh");
        c.arg(caminho);
        c
    }
}

fn opcoes_comuns(p: &Perfil) -> String {
    // A saída do Java em UTF-8 (no Windows o padrão seria o code page do console).
    format!("{} -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8 -Dfile.encoding=UTF-8", p.opcoes_jvm.trim())
}

fn tocar(caminho: &Path) -> Result<(), String> {
    if caminho.exists() {
        fs::File::options()
            .write(true)
            .open(caminho)
            .and_then(|f| f.set_modified(std::time::SystemTime::now()))
            .map_err(|e| e.to_string())
    } else {
        fs::write(caminho, "").map_err(|e| e.to_string())
    }
}

fn copiar_pasta(de: &Path, para: &Path) -> Result<(), String> {
    fs::create_dir_all(para).map_err(|e| e.to_string())?;
    for e in fs::read_dir(de).map_err(|e| format!("{}: {e}", de.display()))?.flatten() {
        let alvo = para.join(e.file_name());
        if e.file_type().map_err(|e| e.to_string())?.is_dir() {
            copiar_pasta(&e.path(), &alvo)?;
        } else {
            fs::copy(e.path(), &alvo).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ---------- WildFly / JBoss ----------

pub struct Wildfly;

impl Adaptador for Wildfly {
    fn versao(&self, inst: &Path) -> Result<String, String> {
        if detectar(inst) != Some("wildfly") {
            return Err("não parece um WildFly/JBoss (faltam bin/standalone e standalone/configuration)".into());
        }
        // version.txt: "Wildfly Full 42.0.0.Final (WildFly Core ...)"; JBoss EAP tem o mesmo arquivo.
        Ok(fs::read_to_string(inst.join("version.txt"))
            .ok()
            .and_then(|t| t.lines().next().map(|l| l.split(" (").next().unwrap_or(l).replace(" - Version ", " ").trim().to_string()))
            .unwrap_or_else(|| "WildFly".into()))
    }

    fn preparar(&self, p: &Perfil, base: &Path) -> Result<PathBuf, String> {
        let inst = Path::new(&p.instalacao);
        let config = base.join("configuration");
        if !config.join("standalone.xml").exists() {
            copiar_pasta(&inst.join("standalone").join("configuration"), &config)?;
            // JSP recompilado quando muda (hot swap): modo de desenvolvimento do Undertow.
            let xml = config.join("standalone.xml");
            if let Ok(t) = fs::read_to_string(&xml) {
                let novo = jsp_em_desenvolvimento(&t);
                if novo != t {
                    fs::write(&xml, novo).map_err(|e| e.to_string())?;
                }
            }
        }
        let deployments = base.join("deployments");
        fs::create_dir_all(&deployments).map_err(|e| e.to_string())?;
        let ctx = nome_do_contexto(p);
        // Deploy explodido só sobe com o marcador .dodeploy.
        for marca in ["deployed", "failed", "undeployed", "isdeploying", "pending"] {
            let _ = fs::remove_file(deployments.join(format!("{ctx}.war.{marca}")));
        }
        tocar(&deployments.join(format!("{ctx}.war.dodeploy")))?;
        Ok(deployments.join(format!("{ctx}.war")))
    }

    fn comando(&self, p: &Perfil, base: &Path, debug: bool) -> Command {
        let mut c = rodar_script(&script(Path::new(&p.instalacao), "standalone"));
        c.arg(format!("-Djboss.server.base.dir={}", base.display()));
        // Todas as portas andam juntas (http 8080 → a do perfil; gerência 9990 também).
        let deslocamento = i32::from(p.porta_http) - 8080;
        if deslocamento != 0 {
            c.arg(format!("-Djboss.socket.binding.port-offset={deslocamento}"));
        }
        if debug {
            c.args(["--debug", &p.porta_debug.to_string()]);
        }
        // JAVA_OPTS substitui o padrão do standalone.conf: repõe o que ele tinha.
        c.env(
            "JAVA_OPTS",
            format!(
                "{} -XX:MetaspaceSize=96M -XX:MaxMetaspaceSize=512m -Djava.net.preferIPv4Stack=true -Djboss.modules.system.pkgs=org.jboss.byteman -Djava.awt.headless=true",
                opcoes_comuns(p)
            ),
        );
        c.env("NOPAUSE", "true");
        c.env("JBOSS_HOME", &p.instalacao);
        c
    }

    fn redeploy(&self, p: &Perfil, base: &Path) -> Result<(), String> {
        let ctx = nome_do_contexto(p);
        let d = base.join("deployments");
        let _ = fs::remove_file(d.join(format!("{ctx}.war.failed")));
        tocar(&d.join(format!("{ctx}.war.dodeploy")))
    }
}

/// `<jsp-config/>` → `<jsp-config development="true"/>` (só se ainda não estiver configurado).
fn jsp_em_desenvolvimento(xml: &str) -> String {
    if xml.contains("<jsp-config/>") {
        xml.replacen("<jsp-config/>", "<jsp-config development=\"true\"/>", 1)
    } else {
        xml.to_string()
    }
}

// ---------- Tomcat ----------

pub struct Tomcat;

impl Adaptador for Tomcat {
    fn versao(&self, inst: &Path) -> Result<String, String> {
        if detectar(inst) != Some("tomcat") {
            return Err("não parece um Tomcat (faltam bin/catalina e conf/server.xml)".into());
        }
        // RELEASE-NOTES: "Apache Tomcat Version 11.0.29".
        Ok(fs::read_to_string(inst.join("RELEASE-NOTES"))
            .ok()
            .and_then(|t| t.lines().find_map(|l| l.trim().strip_prefix("Apache Tomcat Version ").map(|v| format!("Tomcat {v}"))))
            .unwrap_or_else(|| "Tomcat".into()))
    }

    fn preparar(&self, p: &Perfil, base: &Path) -> Result<PathBuf, String> {
        let inst = Path::new(&p.instalacao);
        let conf = base.join("conf");
        if !conf.join("web.xml").exists() {
            copiar_pasta(&inst.join("conf"), &conf)?;
        }
        // server.xml refeito a cada início (as portas podem ter mudado no perfil).
        let original = fs::read_to_string(inst.join("conf").join("server.xml")).map_err(|e| format!("server.xml: {e}"))?;
        fs::write(conf.join("server.xml"), portas_do_tomcat(&original, p.porta_http)).map_err(|e| e.to_string())?;
        for pasta in ["logs", "temp", "work", "webapps"] {
            fs::create_dir_all(base.join(pasta)).map_err(|e| e.to_string())?;
        }
        let ctx = nome_do_contexto(p);
        let app = base.join("app").join(&ctx);
        fs::create_dir_all(&app).map_err(|e| e.to_string())?;
        let contextos = conf.join("Catalina").join("localhost");
        fs::create_dir_all(&contextos).map_err(|e| e.to_string())?;
        let xml = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!-- Gerado pelo Seedy: a aplicação é a pasta montada a partir do projeto. -->\n<Context docBase=\"{}\" reloadable=\"false\" />\n",
            escapar_xml(&app.to_string_lossy())
        );
        fs::write(contextos.join(format!("{ctx}.xml")), xml).map_err(|e| e.to_string())?;
        Ok(app)
    }

    fn comando(&self, p: &Perfil, base: &Path, debug: bool) -> Command {
        let mut c = rodar_script(&script(Path::new(&p.instalacao), "catalina"));
        if debug {
            c.arg("jpda");
            c.env("JPDA_ADDRESS", format!("localhost:{}", p.porta_debug));
            c.env("JPDA_TRANSPORT", "dt_socket");
            c.env("JPDA_SUSPEND", "n");
        }
        c.arg("run");
        c.env("CATALINA_HOME", &p.instalacao);
        c.env("CATALINA_BASE", base);
        c.env("CATALINA_OPTS", opcoes_comuns(p));
        c
    }

    fn redeploy(&self, p: &Perfil, base: &Path) -> Result<(), String> {
        // O Tomcat recarrega o contexto quando o XML dele muda.
        tocar(&base.join("conf").join("Catalina").join("localhost").join(format!("{}.xml", nome_do_contexto(p))))
    }
}

/// Troca a porta HTTP (8080) e desliga a porta de shutdown (o Seedy encerra o processo).
fn portas_do_tomcat(xml: &str, http: u16) -> String {
    xml.replacen("port=\"8080\"", &format!("port=\"{http}\""), 1).replacen("port=\"8005\"", "port=\"-1\"", 1)
}

fn escapar_xml(s: &str) -> String {
    s.replace('&', "&amp;").replace('"', "&quot;").replace('<', "&lt;").replace('>', "&gt;")
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn jsp_vira_modo_desenvolvimento_uma_vez() {
        let xml = "<servlet-container name=\"default\">\n<jsp-config/>\n</servlet-container>";
        let novo = jsp_em_desenvolvimento(xml);
        assert!(novo.contains("<jsp-config development=\"true\"/>"));
        assert_eq!(jsp_em_desenvolvimento(&novo), novo);
    }

    #[test]
    fn tomcat_troca_porta_e_desliga_shutdown() {
        let xml = r#"<Server port="8005" shutdown="SHUTDOWN"><Connector port="8080" protocol="HTTP/1.1" redirectPort="8443" /></Server>"#;
        let novo = portas_do_tomcat(xml, 8181);
        assert!(novo.contains(r#"<Server port="-1""#) && novo.contains(r#"<Connector port="8181""#));
    }

    #[test]
    fn contexto_raiz_e_aninhado() {
        let mut p = super::super::testes::perfil_de_teste("tomcat");
        p.contexto = "/".into();
        assert_eq!(nome_do_contexto(&p), "ROOT");
        p.contexto = "/loja/admin".into();
        assert_eq!(nome_do_contexto(&p), "loja#admin");
    }
}
