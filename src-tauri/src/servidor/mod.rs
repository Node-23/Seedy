//! Servidores de aplicação (Fase 5): JBoss/WildFly e Tomcat atrás do mesmo adaptador.
//! Perfis salvos, pasta de servidor própria por perfil, deploy explodido montado pelo
//! Seedy, hot swap enquanto roda, saída do servidor em streaming e debug (JDWP).

mod adaptador;
pub mod implantar;
pub(crate) mod processo;

use crate::tema::pasta_config;
use implantar::{Fonte, Sincronizador};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

/// Um servidor configurado para um projeto.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Perfil {
    pub id: String,
    pub nome: String,
    /// "wildfly" (também JBoss EAP) ou "tomcat".
    pub tipo: String,
    /// Pasta de instalação (JBOSS_HOME / CATALINA_HOME).
    pub instalacao: String,
    /// JAVA_HOME do servidor (None = o do sistema).
    #[serde(default)]
    pub jdk: Option<String>,
    #[serde(default = "porta_http_padrao")]
    pub porta_http: u16,
    #[serde(default = "porta_debug_padrao")]
    pub porta_debug: u16,
    #[serde(default = "opcoes_padrao")]
    pub opcoes_jvm: String,
    #[serde(default)]
    pub variaveis: BTreeMap<String, String>,
    /// Caminho da aplicação na URL ("/feira"; "/" = raiz).
    pub contexto: String,
    /// Raiz do projeto e, relativas a ela, a pasta web e a das classes compiladas.
    pub projeto: String,
    pub pasta_web: String,
    pub pasta_classes: String,
}

fn porta_http_padrao() -> u16 {
    8080
}
fn porta_debug_padrao() -> u16 {
    8787
}
fn opcoes_padrao() -> String {
    "-Xms256m -Xmx1024m".into()
}

#[derive(Serialize, Clone)]
#[serde(tag = "tipo", rename_all = "camelCase")]
pub enum Evento {
    /// Arquivos copiados/apagados na aplicação pelo hot swap.
    Copiados { arquivos: Vec<String> },
    /// O processo do servidor terminou.
    Encerrado { codigo: Option<i32> },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InfoExecucao {
    pub versao: String,
    pub url: String,
    pub porta_debug: Option<u16>,
    /// Pasta da aplicação explodida (dentro da pasta de servidor do perfil).
    pub aplicacao: String,
    pub copiados: usize,
    pub pid: u32,
}

struct Execucao {
    perfil: Perfil,
    base: PathBuf,
    aplicacao: PathBuf,
    pid: u32,
    url: String,
    porta_debug: Option<u16>,
    _sincronizador: Option<Sincronizador>,
}

/// Servidores rodando, por id do perfil.
#[derive(Default)]
pub struct Execucoes(Mutex<HashMap<String, Execucao>>);

impl Execucoes {
    /// Ao fechar o Seedy: nenhum servidor fica órfão.
    pub fn encerrar_todos(&self) {
        let pids: Vec<u32> = travar(&self.0).values().map(|e| e.pid).collect();
        for pid in pids {
            processo::encerrar_arvore(pid);
        }
    }
}

fn travar<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ---------- perfis ----------

fn arquivo_de_perfis() -> PathBuf {
    pasta_config().join("servidores.json")
}

fn ler_perfis() -> Vec<Perfil> {
    fs::read_to_string(arquivo_de_perfis()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn gravar_perfis(perfis: &[Perfil]) -> Result<(), String> {
    fs::create_dir_all(pasta_config()).map_err(|e| e.to_string())?;
    fs::write(arquivo_de_perfis(), serde_json::to_string_pretty(perfis).map_err(|e| e.to_string())?)
        .map_err(|e| format!("não consegui gravar os servidores: {e}"))
}

/// Pasta de servidor do perfil (configuração própria, deploy, logs).
fn pasta_base(id: &str) -> PathBuf {
    let seguro: String = id.chars().map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
    dirs::cache_dir().unwrap_or_else(std::env::temp_dir).join("seedy").join("servidores").join(seguro)
}

#[tauri::command]
pub fn servidor_perfis() -> Vec<Perfil> {
    ler_perfis()
}

#[tauri::command]
pub fn servidor_salvar_perfil(perfil: Perfil) -> Result<(), String> {
    if perfil.nome.trim().is_empty() {
        return Err("o servidor precisa de nome".into());
    }
    adaptador::de(&perfil.tipo)?;
    let mut perfis = ler_perfis();
    // Instalação trocada: a pasta de servidor antiga não vale mais.
    if let Some(antigo) = perfis.iter().find(|p| p.id == perfil.id) {
        if antigo.instalacao != perfil.instalacao || antigo.tipo != perfil.tipo {
            let _ = fs::remove_dir_all(pasta_base(&perfil.id));
        }
    }
    match perfis.iter_mut().find(|p| p.id == perfil.id) {
        Some(p) => *p = perfil,
        None => perfis.push(perfil),
    }
    gravar_perfis(&perfis)
}

#[tauri::command]
pub fn servidor_apagar_perfil(estado: State<'_, Execucoes>, id: String) -> Result<(), String> {
    if let Some(e) = travar(&estado.0).remove(&id) {
        processo::encerrar_arvore(e.pid);
    }
    gravar_perfis(&ler_perfis().into_iter().filter(|p| p.id != id).collect::<Vec<_>>())?;
    let _ = fs::remove_dir_all(pasta_base(&id));
    Ok(())
}

#[derive(Serialize)]
pub struct Instalacao {
    pub tipo: String,
    pub versao: String,
}

/// Que servidor está nesta pasta (para o formulário preencher sozinho).
#[tauri::command]
pub fn servidor_inspecionar(instalacao: String) -> Result<Instalacao, String> {
    let p = Path::new(&instalacao);
    let tipo = adaptador::detectar(p).ok_or("não achei um WildFly/JBoss nem um Tomcat nesta pasta")?;
    Ok(Instalacao { tipo: tipo.into(), versao: adaptador::de(tipo)?.versao(p)? })
}

// ---------- execução ----------

/// Monta a aplicação, sobe o servidor (com debug, se pedido) e liga o hot swap.
#[tauri::command]
pub async fn servidor_iniciar(
    app: AppHandle,
    estado: State<'_, Execucoes>,
    id: String,
    fontes: Vec<Fonte>,
    debug: bool,
    saida: Channel<Vec<String>>,
    eventos: Channel<Evento>,
    ambiente: Option<BTreeMap<String, String>>,
) -> Result<InfoExecucao, String> {
    if travar(&estado.0).contains_key(&id) {
        return Err("este servidor já está rodando".into());
    }
    let mut perfil = ler_perfis().into_iter().find(|p| p.id == id).ok_or("servidor não encontrado")?;
    // Variáveis do .env: valem por baixo das do perfil (o que o perfil define manda).
    if let Some(mut base) = ambiente {
        base.extend(std::mem::take(&mut perfil.variaveis));
        perfil.variaveis = base;
    }
    let para_subir = eventos.clone();
    let (info, execucao, processo) = tauri::async_runtime::spawn_blocking(move || subir(perfil, fontes, debug, saida, para_subir))
        .await
        .map_err(|e| e.to_string())??;
    let pid = execucao.pid;
    travar(&estado.0).insert(id.clone(), execucao);

    // Quando o processo acaba (parado, caiu ou saiu sozinho), avisa e esquece a execução.
    std::thread::spawn(move || {
        let codigo = processo.esperar();
        // O script pode sair e deixar o java vivo (Windows): encerra a árvore por garantia.
        processo::encerrar_arvore(pid);
        if let Some(estado) = app.try_state::<Execucoes>() {
            let mut m = travar(&estado.0);
            if m.get(&id).is_some_and(|x| x.pid == pid) {
                m.remove(&id);
            }
        }
        let _ = eventos.send(Evento::Encerrado { codigo });
    });
    Ok(info)
}

#[allow(clippy::type_complexity)]
fn subir(
    perfil: Perfil,
    fontes: Vec<Fonte>,
    debug: bool,
    saida: Channel<Vec<String>>,
    eventos: Channel<Evento>,
) -> Result<(InfoExecucao, Execucao, processo::Processo), String> {
    let ad = adaptador::de(&perfil.tipo)?;
    let instalacao = Path::new(&perfil.instalacao);
    let versao = ad.versao(instalacao)?;
    porta_livre(perfil.porta_http, "HTTP")?;
    if debug {
        porta_livre(perfil.porta_debug, "de debug")?;
    }
    let base = pasta_base(&perfil.id);
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let aplicacao = ad.preparar(&perfil, &base)?;
    let copiados = implantar::espelhar(&fontes, &aplicacao)?.len();

    let mut comando = ad.comando(&perfil, &base, debug);
    comando.current_dir(&base);
    if let Some(jdk) = perfil.jdk.as_deref().filter(|j| !j.trim().is_empty()) {
        comando.env("JAVA_HOME", jdk);
    }
    for (k, v) in &perfil.variaveis {
        comando.env(k, v);
    }
    let processo = processo::Processo::iniciar(comando, move |linhas| {
        let _ = saida.send(linhas);
    })?;
    let pid = processo.pid();

    let sincronizador = Sincronizador::iniciar(fontes, aplicacao.clone(), move |arquivos| {
        let _ = eventos.send(Evento::Copiados { arquivos });
    })
    .ok();
    let contexto = perfil.contexto.trim().trim_matches('/');
    let info = InfoExecucao {
        versao,
        url: format!("http://localhost:{}/{}", perfil.porta_http, contexto),
        porta_debug: debug.then_some(perfil.porta_debug),
        aplicacao: aplicacao.to_string_lossy().into_owned(),
        copiados,
        pid,
    };
    let execucao = Execucao { perfil, base, aplicacao, pid, url: info.url.clone(), porta_debug: info.porta_debug, _sincronizador: sincronizador };
    Ok((info, execucao, processo))
}

fn porta_livre(porta: u16, qual: &str) -> Result<(), String> {
    TcpListener::bind(("127.0.0.1", porta))
        .map(|_| ())
        .map_err(|_| format!("a porta {qual} {porta} já está em uso (outro servidor rodando?); troque no perfil"))
}

/// Para o servidor (a árvore de processos inteira).
#[tauri::command]
pub async fn servidor_parar(estado: State<'_, Execucoes>, id: String) -> Result<(), String> {
    let pid = travar(&estado.0).get(&id).map(|e| e.pid).ok_or("este servidor não está rodando")?;
    tauri::async_runtime::spawn_blocking(move || processo::encerrar_arvore(pid)).await.map_err(|e| e.to_string())
}

/// Refaz o espelho da aplicação (fontes podem ter mudado, ex.: jars) e manda recarregar.
#[tauri::command]
pub async fn servidor_redeploy(estado: State<'_, Execucoes>, id: String, fontes: Vec<Fonte>) -> Result<usize, String> {
    let (perfil, base, aplicacao) = {
        let m = travar(&estado.0);
        let e = m.get(&id).ok_or("este servidor não está rodando")?;
        (e.perfil.clone(), e.base.clone(), e.aplicacao.clone())
    };
    tauri::async_runtime::spawn_blocking(move || {
        let n = implantar::espelhar(&fontes, &aplicacao)?.len();
        adaptador::de(&perfil.tipo)?.redeploy(&perfil, &base)?;
        Ok(n)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmExecucao {
    pub id: String,
    pub url: String,
    pub porta_debug: Option<u16>,
}

/// Servidores rodando (a interface usa para se reencontrar depois de recarregar).
#[tauri::command]
pub fn servidor_em_execucao(estado: State<'_, Execucoes>) -> Vec<EmExecucao> {
    travar(&estado.0).iter().map(|(id, e)| EmExecucao { id: id.clone(), url: e.url.clone(), porta_debug: e.porta_debug }).collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RespostaHttp {
    pub status: u16,
    pub tipo: Option<String>,
    pub corpo: String,
    pub ms: u64,
}

/// Requisição HTTP à aplicação local (a IA testa a tela/endpoint depois de mudar o código).
#[tauri::command]
pub async fn servidor_http(metodo: String, url: String, corpo: Option<String>, tipo: Option<String>, cabecalhos: Option<Vec<(String, String)>>) -> Result<RespostaHttp, String> {
    let local = ["http://localhost:", "http://127.0.0.1:"].iter().any(|p| url.starts_with(p));
    if !local {
        return Err("só faço requisições para a aplicação local (http://localhost:…)".into());
    }
    let metodo = metodo.to_uppercase();
    if !matches!(metodo.as_str(), "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD") {
        return Err(format!("método não suportado: {metodo}"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let inicio = std::time::Instant::now();
        let agente = ureq::AgentBuilder::new().timeout(std::time::Duration::from_secs(60)).redirects(0).build();
        let mut pedido = agente.request(&metodo, &url);
        if let Some(t) = &tipo {
            pedido = pedido.set("Content-Type", t);
        }
        for (n, v) in cabecalhos.unwrap_or_default() {
            if !n.is_empty() && !n.contains(char::is_whitespace) {
                pedido = pedido.set(&n, &v);
            }
        }
        let resposta = match corpo {
            Some(c) => pedido.send_string(&c),
            None => pedido.call(),
        };
        let r = match resposta {
            Ok(r) | Err(ureq::Error::Status(_, r)) => r,
            Err(e) => return Err(format!("sem resposta de {url}: {e}")),
        };
        let status = r.status();
        let tipo = r.header("Content-Type").map(str::to_string);
        let mut texto = r.into_string().unwrap_or_default();
        if texto.len() > 20_000 {
            let mut corte = 20_000;
            while !texto.is_char_boundary(corte) {
                corte -= 1;
            }
            texto.truncate(corte);
            texto.push_str("\n[... resposta cortada em 20 mil caracteres]");
        }
        Ok(RespostaHttp { status, tipo, corpo: texto, ms: inicio.elapsed().as_millis() as u64 })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Abre a aplicação no navegador (só endereços locais).
#[tauri::command]
pub fn servidor_abrir_url(url: String) -> Result<(), String> {
    let local = ["http://localhost:", "http://127.0.0.1:"].iter().any(|p| url.starts_with(p));
    if !local || url.chars().any(|c| c.is_whitespace() || c == '"') {
        return Err("só abro endereços locais (http://localhost:…)".into());
    }
    #[cfg(windows)]
    let mut c = {
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new("rundll32");
        c.args(["url.dll,FileProtocolHandler", &url]).creation_flags(0x0800_0000);
        c
    };
    #[cfg(not(windows))]
    let mut c = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(&url);
        c
    };
    c.spawn().map(|_| ()).map_err(|e| format!("não consegui abrir o navegador: {e}"))
}

#[cfg(test)]
pub(crate) mod testes {
    use super::*;

    pub fn perfil_de_teste(tipo: &str) -> Perfil {
        Perfil {
            id: "teste".into(),
            nome: "teste".into(),
            tipo: tipo.into(),
            instalacao: String::new(),
            jdk: None,
            porta_http: 8080,
            porta_debug: 8787,
            opcoes_jvm: opcoes_padrao(),
            variaveis: BTreeMap::new(),
            contexto: "/feira".into(),
            projeto: String::new(),
            pasta_web: "src/main/webapp".into(),
            pasta_classes: "target/classes".into(),
        }
    }

    /// Sobe o servidor de verdade com um JSP, confere a página, o hot swap e o encerrar.
    /// Precisa de SEEDY_TESTE_<TIPO> (pasta de instalação) e SEEDY_TESTE_JDK.
    /// Um servidor de verdade por vez (o cargo roda os testes em paralelo).
    static UM_POR_VEZ: Mutex<()> = Mutex::new(());

    fn subir_de_verdade(tipo: &str, porta: u16, porta_debug: u16) {
        let _vez = UM_POR_VEZ.lock().unwrap_or_else(|e| e.into_inner());
        let (Ok(instalacao), Ok(jdk)) = (std::env::var(format!("SEEDY_TESTE_{}", tipo.to_uppercase())), std::env::var("SEEDY_TESTE_JDK")) else {
            panic!("defina SEEDY_TESTE_{} e SEEDY_TESTE_JDK", tipo.to_uppercase());
        };
        let raiz = std::env::temp_dir().join(format!("seedy-app-{tipo}"));
        let _ = fs::remove_dir_all(&raiz);
        let web = raiz.join("webapp");
        fs::create_dir_all(web.join("WEB-INF")).unwrap();
        fs::write(web.join("index.jsp"), "resposta=<%= 6 * 7 %>").unwrap();
        fs::write(web.join("WEB-INF/web.xml"), r#"<web-app xmlns="https://jakarta.ee/xml/ns/jakartaee" version="6.0"/>"#).unwrap();
        let mut p = perfil_de_teste(tipo);
        p.id = format!("teste-{tipo}");
        p.instalacao = instalacao;
        p.jdk = Some(jdk.clone());
        p.porta_http = porta;
        p.porta_debug = porta_debug;
        let fontes = vec![Fonte { origem: web.to_string_lossy().into(), destino: "".into() }];

        let ad = adaptador::de(tipo).unwrap();
        let base = pasta_base(&p.id);
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        let app = ad.preparar(&p, &base).unwrap();
        implantar::espelhar(&fontes, &app).unwrap();
        let mut c = ad.comando(&p, &base, true);
        c.current_dir(&base).env("JAVA_HOME", &jdk);
        let log = std::sync::Arc::new(Mutex::new(Vec::<String>::new()));
        let l2 = log.clone();
        let proc = processo::Processo::iniciar(c, move |linhas| l2.lock().unwrap().extend(linhas)).unwrap();
        let pid = proc.pid();
        let _sinc = Sincronizador::iniciar(fontes, app.clone(), |_| {}).unwrap();

        let pegar = || -> Option<String> {
            let mut s = std::net::TcpStream::connect_timeout(&([127, 0, 0, 1], porta).into(), std::time::Duration::from_millis(500)).ok()?;
            s.set_read_timeout(Some(std::time::Duration::from_secs(5))).ok()?;
            use std::io::{Read, Write};
            write!(s, "GET /feira/index.jsp HTTP/1.0\r\nHost: localhost\r\n\r\n").ok()?;
            let mut r = String::new();
            s.read_to_string(&mut r).ok()?;
            r.contains("200").then_some(r)
        };
        let esperar = |texto: &str| {
            for _ in 0..240 {
                if pegar().is_some_and(|r| r.contains(texto)) {
                    return true;
                }
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
            false
        };
        let ok = esperar("resposta=42");
        // Hot swap: o JSP muda na pasta do projeto e o servidor mostra a versão nova.
        let ok2 = ok && {
            fs::write(web.join("index.jsp"), "resposta=<%= 6 * 8 %>").unwrap();
            esperar("resposta=48")
        };
        processo::encerrar_arvore(pid);
        let codigo = proc.esperar();
        let saida = log.lock().unwrap().join("\n");
        assert!(ok, "a página não respondeu; saída do servidor:\n{saida}");
        assert!(ok2, "o hot swap do JSP não chegou; saída:\n{saida}");
        assert!(saida.contains(&porta_debug.to_string()), "debug não ligou; saída:\n{saida}");
        // Depois de encerrar, a porta volta a ficar livre (nenhum java órfão).
        std::thread::sleep(std::time::Duration::from_secs(2));
        assert!(porta_livre(porta, "HTTP").is_ok(), "o processo ficou vivo (código {codigo:?})");
        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&raiz);
    }

    #[test]
    #[ignore = "precisa de um Tomcat (SEEDY_TESTE_TOMCAT) e um JDK (SEEDY_TESTE_JDK)"]
    fn tomcat_de_verdade() {
        subir_de_verdade("tomcat", 18080, 18787);
    }

    #[test]
    #[ignore = "precisa de um WildFly (SEEDY_TESTE_WILDFLY) e um JDK (SEEDY_TESTE_JDK)"]
    fn wildfly_de_verdade() {
        subir_de_verdade("wildfly", 18180, 18788);
    }

    #[test]
    fn perfil_antigo_ganha_os_padroes() {
        let p: Perfil = serde_json::from_str(
            r#"{"id":"1","nome":"x","tipo":"tomcat","instalacao":"/opt/t","contexto":"/","projeto":"/p","pastaWeb":"web","pastaClasses":"bin"}"#,
        )
        .unwrap();
        assert_eq!((p.porta_http, p.porta_debug), (8080, 8787));
        assert!(p.opcoes_jvm.contains("Xmx"));
    }

    #[test]
    fn evento_vai_com_o_tipo() {
        let t = serde_json::to_string(&Evento::Copiados { arquivos: vec!["a.jsp".into()] }).unwrap();
        assert_eq!(t, r#"{"tipo":"copiados","arquivos":["a.jsp"]}"#);
    }
}
