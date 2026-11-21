//! Banco de dados (Fase 3): perfis de conexão, senhas no cofre do sistema, sessões
//! abertas (com túnel SSH opcional), consultas, catálogo e exportação para CSV.
//!
//! Cada banco (PostgreSQL, MySQL, Oracle) é um `Driver` atrás da mesma interface.
//! Valores chegam à interface sempre como texto: a grade é somente leitura.

mod mysql;
mod oracle;
mod postgres;
pub mod sql;
mod tunel;

use crate::tema::pasta_config;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufWriter, Write};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::State;
use tunel::Tunel;

/// Uma conexão salva (sem a senha, que fica no cofre do sistema).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Perfil {
    pub id: String,
    pub nome: String,
    /// "local", "homolog" ou "producao" (define a cor e o padrão de somente leitura).
    pub ambiente: String,
    /// "postgres", "mysql" ou "oracle".
    pub tipo: String,
    pub host: String,
    pub porta: u16,
    /// Banco (PostgreSQL/MySQL) ou serviço (Oracle).
    pub banco: String,
    pub usuario: String,
    #[serde(default)]
    pub somente_leitura: bool,
    /// "desligado", "exigir" (cifra sem validar o certificado) ou "verificar".
    #[serde(default = "ssl_padrao")]
    pub ssl: String,
    /// Destino do túnel SSH (um Host do ~/.ssh/config ou usuario@servidor); `host`/`porta`
    /// passam a ser vistos de dentro desse servidor.
    #[serde(default)]
    pub ssh: Option<String>,
    /// Porta do servidor SSH (só vale com `ssh_usuario`).
    #[serde(default = "ssh_porta_padrao")]
    pub ssh_porta: u16,
    /// Com usuário, o túnel usa o cliente SSH embutido (senha ou chave); sem, o `ssh` do sistema.
    #[serde(default)]
    pub ssh_usuario: Option<String>,
    /// Arquivo da chave privada; vazio = entra com a senha. A senha (ou a frase da chave) fica no cofre.
    #[serde(default)]
    pub ssh_chave: Option<String>,
}

fn ssh_porta_padrao() -> u16 {
    22
}

fn ssl_padrao() -> String {
    "desligado".into()
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Coluna {
    pub nome: String,
    pub tipo: String,
}

/// Resultado de uma consulta: as linhas (até o limite) já como texto; `None` = NULL.
#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Resultado {
    pub colunas: Vec<Coluna>,
    pub linhas: Vec<Vec<Option<String>>>,
    /// Havia mais linhas que o limite.
    pub cortado: bool,
    /// Linhas alteradas (INSERT/UPDATE/DELETE), quando a instrução não devolve linhas.
    pub afetadas: Option<u64>,
    pub ms: u64,
}

/// O que cada banco sabe fazer.
pub trait Driver: Send {
    fn consultar(&mut self, sql: &str, limite: usize) -> Result<Resultado, String>;
    /// Escreve o resultado inteiro como CSV (com cabeçalho); devolve quantas linhas.
    fn exportar(&mut self, sql: &str, saida: &mut dyn Write) -> Result<u64, String>;
    fn versao(&mut self) -> String;
}

struct Sessao {
    perfil: Perfil,
    driver: Box<dyn Driver>,
    // Fica vivo enquanto a sessão existir (o Drop encerra o ssh).
    _tunel: Option<Tunel>,
}

/// Sessões abertas, por id do perfil. Cada uma tem seu próprio cadeado: uma consulta
/// demorada não trava as outras conexões.
#[derive(Default)]
pub struct Bancos(Mutex<HashMap<String, Arc<Mutex<Sessao>>>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InfoConexao {
    pub versao: String,
    pub tunel: Option<tunel::InfoTunel>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Schema {
    pub nome: String,
    pub tabelas: Vec<String>,
    pub views: Vec<String>,
    pub funcoes: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EntradaDoHistorico {
    pub sql: String,
    /// Segundos desde 1970.
    pub quando: u64,
    pub ms: u64,
    pub linhas: Option<u64>,
    pub erro: Option<String>,
}

// ---------- perfis e senhas ----------

fn arquivo_de_perfis() -> std::path::PathBuf {
    pasta_config().join("conexoes.json")
}

fn ler_perfis() -> Vec<Perfil> {
    fs::read_to_string(arquivo_de_perfis())
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn gravar_perfis(perfis: &[Perfil]) -> Result<(), String> {
    fs::create_dir_all(pasta_config()).map_err(|e| e.to_string())?;
    let texto = serde_json::to_string_pretty(perfis).map_err(|e| e.to_string())?;
    fs::write(arquivo_de_perfis(), texto).map_err(|e| format!("não consegui gravar as conexões: {e}"))
}

fn cofre(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("seedy-banco", id).map_err(|e| format!("cofre de senhas: {e}"))
}

fn senha_guardada(id: &str) -> Option<String> {
    cofre(id).ok()?.get_password().ok()
}

/// Senha do usuário SSH (ou frase da chave): outra entrada do cofre, ao lado da do banco.
fn cofre_ssh(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("seedy-banco-ssh", id).map_err(|e| format!("cofre de senhas: {e}"))
}

fn senha_ssh_guardada(id: &str) -> Option<String> {
    cofre_ssh(id).ok()?.get_password().ok()
}

#[tauri::command]
pub fn banco_tem_senha_ssh(id: String) -> bool {
    senha_ssh_guardada(&id).is_some()
}

#[tauri::command]
pub fn banco_perfis() -> Vec<Perfil> {
    ler_perfis()
}

/// Cria ou atualiza um perfil. `senha` = Some grava no cofre; Some("") apaga a guardada.
#[tauri::command]
pub fn banco_salvar_perfil(perfil: Perfil, senha: Option<String>, senha_ssh: Option<String>) -> Result<(), String> {
    if perfil.id.trim().is_empty() || perfil.nome.trim().is_empty() {
        return Err("o perfil precisa de nome".into());
    }
    if !matches!(perfil.tipo.as_str(), "postgres" | "mysql" | "oracle") {
        return Err(format!("banco não suportado: {}", perfil.tipo));
    }
    let mut perfis = ler_perfis();
    match perfis.iter_mut().find(|p| p.id == perfil.id) {
        Some(p) => *p = perfil.clone(),
        None => perfis.push(perfil.clone()),
    }
    gravar_perfis(&perfis)?;
    match senha.as_deref() {
        Some("") => {
            let _ = cofre(&perfil.id)?.delete_credential();
        }
        Some(s) => cofre(&perfil.id)?.set_password(s).map_err(|e| format!("cofre de senhas: {e}"))?,
        None => {}
    }
    match senha_ssh.as_deref() {
        Some("") => {
            let _ = cofre_ssh(&perfil.id)?.delete_credential();
        }
        Some(s) => cofre_ssh(&perfil.id)?.set_password(s).map_err(|e| format!("cofre de senhas: {e}"))?,
        None => {}
    }
    Ok(())
}

#[tauri::command]
pub fn banco_apagar_perfil(estado: State<'_, Bancos>, id: String) -> Result<(), String> {
    descartar(travar(&estado.0).remove(&id));
    let perfis: Vec<Perfil> = ler_perfis().into_iter().filter(|p| p.id != id).collect();
    gravar_perfis(&perfis)?;
    if let Ok(c) = cofre(&id) {
        let _ = c.delete_credential();
    }
    if let Ok(c) = cofre_ssh(&id) {
        let _ = c.delete_credential();
    }
    let _ = fs::remove_file(arquivo_de_historico(&id));
    Ok(())
}

#[tauri::command]
pub fn banco_tem_senha(id: String) -> bool {
    senha_guardada(&id).is_some()
}

// ---------- sessões ----------

/// Abre a conexão (e o túnel, se houver). Sem senha guardada nem informada, o erro é
/// "SEM_SENHA" (a interface pergunta). `lembrar` guarda a senha informada no cofre.
#[tauri::command]
pub async fn banco_conectar(estado: State<'_, Bancos>, id: String, senha: Option<String>, lembrar: bool) -> Result<InfoConexao, String> {
    let perfil = ler_perfis().into_iter().find(|p| p.id == id).ok_or("conexão não encontrada")?;
    let senha = match senha {
        Some(s) => s,
        None => senha_guardada(&id).ok_or("SEM_SENHA")?,
    };
    let (sessao, info) = tauri::async_runtime::spawn_blocking({
        let perfil = perfil.clone();
        let senha = senha.clone();
        move || abrir_sessao(perfil, &senha)
    })
    .await
    .map_err(|e| e.to_string())??;
    if lembrar {
        cofre(&id)?.set_password(&senha).map_err(|e| format!("cofre de senhas: {e}"))?;
    }
    descartar(travar(&estado.0).insert(id, Arc::new(Mutex::new(sessao))));
    Ok(info)
}

fn abrir_sessao(perfil: Perfil, senha: &str) -> Result<(Sessao, InfoConexao), String> {
    let servidor = perfil.ssh.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let usuario = perfil.ssh_usuario.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let tunel = match (servidor, usuario) {
        (Some(servidor), Some(usuario)) => {
            let chave = perfil.ssh_chave.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(String::from);
            let segredo = senha_ssh_guardada(&perfil.id).unwrap_or_default();
            if chave.is_none() && segredo.is_empty() {
                return Err("informe a senha do SSH na conexão (editar → túnel SSH)".into());
            }
            let config = tunel::ConfigSsh {
                servidor: servidor.into(),
                porta: perfil.ssh_porta,
                usuario: usuario.into(),
                chave,
                segredo,
                arquivo_hosts: pasta_config().join("ssh_servidores.json"),
            };
            Some(Tunel::abrir_nativo(config, &perfil.host, perfil.porta)?)
        }
        // Sem usuário: o `ssh` do sistema (um Host do ~/.ssh/config ou usuario@servidor).
        (Some(alvo), None) => Some(Tunel::abrir(alvo, &perfil.host, perfil.porta)?),
        _ => None,
    };
    let (host, porta) = match &tunel {
        Some(t) => ("127.0.0.1".to_string(), t.porta_local),
        None => (perfil.host.clone(), perfil.porta),
    };
    let mut driver: Box<dyn Driver> = match perfil.tipo.as_str() {
        "postgres" => Box::new(postgres::Postgres::conectar(&perfil, &host, porta, senha)?),
        "mysql" => Box::new(mysql::Mysql::conectar(&perfil, &host, porta, senha)?),
        "oracle" => Box::new(oracle::Oracle::conectar(&perfil, &host, porta, senha)?),
        outro => return Err(format!("banco não suportado: {outro}")),
    };
    let info = InfoConexao { versao: driver.versao(), tunel: tunel.as_ref().map(Tunel::info) };
    Ok((Sessao { perfil, driver, _tunel: tunel }, info))
}

#[tauri::command]
pub fn banco_desconectar(estado: State<'_, Bancos>, id: String) {
    descartar(travar(&estado.0).remove(&id));
}

#[tauri::command]
pub fn banco_conectados(estado: State<'_, Bancos>) -> Vec<String> {
    travar(&estado.0).keys().cloned().collect()
}

/// Trava o cadeado mesmo se outra thread entrou em pânico com ele (o estado continua válido).
fn travar<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Fecha a sessão numa thread comum: o cliente do PostgreSQL tem um runtime próprio e
/// não pode ser descartado dentro de uma thread do tokio.
fn descartar(sessao: Option<Arc<Mutex<Sessao>>>) {
    if let Some(s) = sessao {
        std::thread::spawn(move || drop(s));
    }
}

fn sessao(estado: &State<'_, Bancos>, id: &str) -> Result<Arc<Mutex<Sessao>>, String> {
    travar(&estado.0).get(id).cloned().ok_or_else(|| "conexão fechada: conecte de novo".into())
}

/// Roda o SQL (uma ou mais instruções; o resultado é o da última que devolve linhas).
/// Em conexão somente leitura, instruções que escrevem nem chegam ao banco.
#[tauri::command]
pub async fn banco_consultar(estado: State<'_, Bancos>, id: String, sql: String, limite: usize) -> Result<Resultado, String> {
    let s = sessao(&estado, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut s = travar(&s);
        let inicio = Instant::now();
        let r = consultar(&mut s, &sql, limite.clamp(1, 100_000));
        let ms = inicio.elapsed().as_millis() as u64;
        registrar(&s.perfil.id, &sql, ms, &r);
        r.map(|mut r| {
            r.ms = ms;
            r
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn consultar(s: &mut Sessao, sql: &str, limite: usize) -> Result<Resultado, String> {
    if sql::instrucoes(sql).is_empty() {
        return Err("nada para executar".into());
    }
    if s.perfil.somente_leitura {
        if let Some(i) = sql::instrucoes(sql).iter().find(|i| !sql::so_le(i)) {
            return Err(format!(
                "conexão somente leitura: \"{}\" altera o banco (desligue o somente leitura no perfil para escrever)",
                sql::primeira_palavra(i).to_uppercase()
            ));
        }
    }
    s.driver.consultar(sql, limite)
}

/// Exporta o resultado inteiro da consulta para um arquivo CSV.
#[tauri::command]
pub async fn banco_exportar_csv(estado: State<'_, Bancos>, id: String, sql: String, caminho: String) -> Result<u64, String> {
    let s = sessao(&estado, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut s = travar(&s);
        let instrucoes = sql::instrucoes(&sql);
        if instrucoes.len() != 1 || !sql::so_le(&instrucoes[0]) {
            return Err("exportar CSV aceita uma consulta (SELECT) por vez".to_string());
        }
        let arquivo = fs::File::create(&caminho).map_err(|e| format!("não consegui criar {caminho}: {e}"))?;
        let mut saida = BufWriter::new(arquivo);
        let n = s.driver.exportar(&instrucoes[0], &mut saida)?;
        saida.flush().map_err(|e| e.to_string())?;
        Ok(n)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------- catálogo (árvore e autocompletar) ----------

/// Schemas do banco com tabelas, views e funções.
#[tauri::command]
pub async fn banco_catalogo(estado: State<'_, Bancos>, id: String) -> Result<Vec<Schema>, String> {
    let s = sessao(&estado, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut s = travar(&s);
        let tipo = s.perfil.tipo.clone();
        catalogo(&tipo, s.driver.as_mut())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn catalogo(tipo: &str, d: &mut dyn Driver) -> Result<Vec<Schema>, String> {
    let (schemas, objetos, rotinas) = match tipo {
        "postgres" => (
            "select schema_name from information_schema.schemata where schema_name not like 'pg\\_%' and schema_name <> 'information_schema' order by 1",
            "select table_schema, table_name, table_type from information_schema.tables where table_schema not like 'pg\\_%' and table_schema <> 'information_schema' order by 1, 2",
            "select distinct routine_schema, routine_name from information_schema.routines where routine_schema not like 'pg\\_%' and routine_schema <> 'information_schema' order by 1, 2",
        ),
        "mysql" => (
            "select schema_name from information_schema.schemata where schema_name not in ('mysql','sys','performance_schema','information_schema') order by 1",
            "select table_schema, table_name, table_type from information_schema.tables where table_schema not in ('mysql','sys','performance_schema','information_schema') order by 1, 2",
            "select routine_schema, routine_name from information_schema.routines where routine_schema not in ('mysql','sys','performance_schema','information_schema') order by 1, 2",
        ),
        _ => (
            "select user from dual",
            "select user, table_name, 'BASE TABLE' from user_tables union all select user, view_name, 'VIEW' from user_views order by 2",
            "select user, object_name from user_objects where object_type in ('FUNCTION','PROCEDURE','PACKAGE') order by 2",
        ),
    };
    let mut lista: Vec<Schema> = d
        .consultar(schemas, 100_000)?
        .linhas
        .into_iter()
        .filter_map(|l| l.into_iter().next().flatten())
        .map(|nome| Schema { nome, tabelas: vec![], views: vec![], funcoes: vec![] })
        .collect();
    let achar = |lista: &mut Vec<Schema>, nome: &str| -> usize {
        match lista.iter().position(|s| s.nome == nome) {
            Some(i) => i,
            None => {
                lista.push(Schema { nome: nome.to_string(), tabelas: vec![], views: vec![], funcoes: vec![] });
                lista.len() - 1
            }
        }
    };
    for l in d.consultar(objetos, 100_000)?.linhas {
        if let [Some(schema), Some(nome), tipo] = &l[..] {
            let i = achar(&mut lista, schema);
            if tipo.as_deref().is_some_and(|t| t.contains("VIEW")) {
                lista[i].views.push(nome.clone());
            } else {
                lista[i].tabelas.push(nome.clone());
            }
        }
    }
    for l in d.consultar(rotinas, 100_000)?.linhas {
        if let [Some(schema), Some(nome)] = &l[..] {
            let i = achar(&mut lista, schema);
            lista[i].funcoes.push(nome.clone());
        }
    }
    Ok(lista)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColunaDeTabela {
    pub tabela: String,
    pub coluna: String,
    pub tipo: String,
}

/// Colunas de todas as tabelas/views de um schema (para a árvore e o autocompletar).
#[tauri::command]
pub async fn banco_colunas(estado: State<'_, Bancos>, id: String, schema: String) -> Result<Vec<ColunaDeTabela>, String> {
    let s = sessao(&estado, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut s = travar(&s);
        let literal = schema.replace('\'', "''");
        let consulta = match s.perfil.tipo.as_str() {
            "oracle" => "select table_name, column_name, data_type from user_tab_columns order by table_name, column_id".to_string(),
            _ => format!(
                "select table_name, column_name, data_type from information_schema.columns where table_schema = '{literal}' order by table_name, ordinal_position"
            ),
        };
        Ok(s.driver
            .consultar(&consulta, 100_000)?
            .linhas
            .into_iter()
            .filter_map(|l| match &l[..] {
                [Some(t), Some(c), tipo] => Some(ColunaDeTabela { tabela: t.clone(), coluna: c.clone(), tipo: tipo.clone().unwrap_or_default() }),
                _ => None,
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------- histórico ----------

const LIMITE_DO_HISTORICO: usize = 300;

fn arquivo_de_historico(id: &str) -> std::path::PathBuf {
    let seguro: String = id.chars().map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
    pasta_config().join("historico-sql").join(format!("{seguro}.json"))
}

fn ler_historico(id: &str) -> Vec<EntradaDoHistorico> {
    fs::read_to_string(arquivo_de_historico(id)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn registrar(id: &str, sql: &str, ms: u64, r: &Result<Resultado, String>) {
    let mut h = ler_historico(id);
    let quando = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let (linhas, erro) = match r {
        Ok(r) => (Some(r.afetadas.unwrap_or(r.linhas.len() as u64)), None),
        Err(e) => (None, Some(e.clone())),
    };
    // A mesma consulta de novo só sobe para o topo.
    h.retain(|e| e.sql.trim() != sql.trim());
    h.insert(0, EntradaDoHistorico { sql: sql.trim().to_string(), quando, ms, linhas, erro });
    h.truncate(LIMITE_DO_HISTORICO);
    let caminho = arquivo_de_historico(id);
    if let Some(p) = caminho.parent() {
        let _ = fs::create_dir_all(p);
    }
    if let Ok(t) = serde_json::to_string(&h) {
        let _ = fs::write(caminho, t);
    }
}

#[tauri::command]
pub fn banco_historico(id: String) -> Vec<EntradaDoHistorico> {
    ler_historico(&id)
}

/// Arquivo de console da conexão (um .sql na pasta de configuração, criado na primeira vez).
#[tauri::command]
pub fn banco_console(id: String) -> Result<String, String> {
    let perfil = ler_perfis().into_iter().find(|p| p.id == id).ok_or("conexão não encontrada")?;
    let pasta = pasta_config().join("consoles");
    fs::create_dir_all(&pasta).map_err(|e| e.to_string())?;
    let nome: String = perfil.nome.chars().map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).collect();
    let caminho = pasta.join(format!("{}-{}.sql", nome.to_lowercase(), &perfil.id[..perfil.id.len().min(6)]));
    if !caminho.exists() {
        let cabecalho = format!("-- console: {} ({})\n-- ctrl+⏎ executa a instrução sob o cursor (ou a seleção)\n\n", perfil.nome, perfil.tipo);
        fs::write(&caminho, cabecalho).map_err(|e| e.to_string())?;
    }
    Ok(caminho.to_string_lossy().into_owned())
}

// ---------- CSV ----------

/// Escreve uma linha de CSV (vírgula; aspas quando preciso; NULL = vazio).
pub fn linha_csv(saida: &mut dyn Write, campos: &[Option<String>]) -> Result<(), String> {
    let mut linha = String::new();
    for (i, c) in campos.iter().enumerate() {
        if i > 0 {
            linha.push(',');
        }
        if let Some(v) = c {
            if v.contains([',', '"', '\n', '\r']) {
                linha.push('"');
                linha.push_str(&v.replace('"', "\"\""));
                linha.push('"');
            } else {
                linha.push_str(v);
            }
        }
    }
    linha.push_str("\r\n");
    saida.write_all(linha.as_bytes()).map_err(|e| e.to_string())
}

/// Tira o `;` final (os drivers recebem uma instrução sem ele).
pub fn sem_ponto_e_virgula(sql: &str) -> &str {
    sql.trim().trim_end_matches(';').trim_end()
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn csv_com_aspas_e_nulos() {
        let mut v = Vec::new();
        linha_csv(&mut v, &[Some("a,b".into()), None, Some("diz \"oi\"".into()), Some("x".into())]).unwrap();
        assert_eq!(String::from_utf8(v).unwrap(), "\"a,b\",,\"diz \"\"oi\"\"\",x\r\n");
    }

    /// Perfis dos bancos de teste em Docker (ver README, "Testes do banco").
    fn perfil_de_teste(tipo: &str, somente_leitura: bool) -> Perfil {
        let (porta, usuario) = if tipo == "postgres" { (55432, "postgres") } else { (53306, "root") };
        Perfil {
            id: format!("teste-{tipo}"),
            nome: tipo.into(),
            ambiente: "local".into(),
            tipo: tipo.into(),
            host: "127.0.0.1".into(),
            porta,
            banco: "feira_db".into(),
            usuario: usuario.into(),
            somente_leitura,
            ssl: "desligado".into(),
            ssh: None,
            ssh_porta: 22,
            ssh_usuario: None,
            ssh_chave: None,
        }
    }

    fn exercitar(tipo: &str) {
        let (mut s, info) = abrir_sessao(perfil_de_teste(tipo, false), "seedy").unwrap();
        assert!(info.versao.contains("PostgreSQL") || info.versao.contains("MySQL"), "{}", info.versao);

        let r = consultar(&mut s, "select id, nome, data, cidade from feira order by id", 1000).unwrap();
        assert_eq!(r.colunas.iter().map(|c| c.nome.as_str()).collect::<Vec<_>>(), ["id", "nome", "data", "cidade"]);
        assert_eq!(r.linhas.len(), 4);
        assert_eq!(r.linhas[0][2].as_deref(), Some("2026-11-07"));
        assert_eq!(r.linhas[3][3], None, "NULL vira None");
        assert!(!r.colunas[1].tipo.is_empty(), "tipo da coluna");

        // Várias instruções: vale a última com linhas.
        let r = consultar(&mut s, "select 1; select nome from feira where id = 2", 1000).unwrap();
        assert_eq!(r.linhas, vec![vec![Some("Feira do Jockey".to_string())]]);

        // Escrita conta linhas afetadas.
        // (o MySQL só conta linhas que mudaram de verdade; por isso uma mudança real, desfeita depois)
        let r = consultar(&mut s, "update feira set cidade = 'Anápolis' where id = 4", 1000).unwrap();
        assert_eq!(r.afetadas, Some(1));
        consultar(&mut s, "update feira set cidade = null where id = 4", 1000).unwrap();

        // Limite corta.
        let r = consultar(&mut s, "select * from banca", 2).unwrap();
        assert_eq!(r.linhas.len(), 2);
        assert!(r.cortado);

        // Catálogo.
        let cat = catalogo(tipo, s.driver.as_mut()).unwrap();
        let feira_db = cat.iter().find(|x| x.nome == if tipo == "postgres" { "public" } else { "feira_db" }).unwrap();
        assert!(feira_db.tabelas.contains(&"feira".to_string()) && feira_db.tabelas.contains(&"banca".to_string()));
        assert!(feira_db.views.contains(&"resumo".to_string()));

        // CSV.
        let mut csv = Vec::new();
        let n = s.driver.exportar("select id, nome, cidade from feira order by id", &mut csv).unwrap();
        assert_eq!(n, 4);
        let texto = String::from_utf8(csv).unwrap();
        assert!(texto.lines().next().unwrap().starts_with("id,nome"), "{texto}");

        // Erro do banco chega legível.
        let e = consultar(&mut s, "select * from nao_existe", 10).unwrap_err();
        assert!(e.contains("nao_existe"), "{e}");

        // Somente leitura: o Seedy recusa antes, e o servidor também recusaria.
        let (mut ro, _) = abrir_sessao(perfil_de_teste(tipo, true), "seedy").unwrap();
        let e = consultar(&mut ro, "delete from banca", 10).unwrap_err();
        assert!(e.contains("somente leitura"), "{e}");
        let e = ro.driver.consultar("delete from banca where id < 0", 10).unwrap_err();
        assert!(e.to_lowercase().contains("read") || e.contains("READ ONLY") || e.contains("1792"), "servidor: {e}");
        assert!(consultar(&mut ro, "select count(*) from banca", 10).is_ok());
    }

    #[test]
    #[ignore = "precisa do PostgreSQL de teste (docker, porta 55432)"]
    fn postgres_de_verdade() {
        exercitar("postgres");
        // Tabela grande: o cursor busca só o limite.
        let (mut s, _) = abrir_sessao(perfil_de_teste("postgres", false), "seedy").unwrap();
        let r = consultar(&mut s, "select * from grande", 1000).unwrap();
        assert_eq!((r.linhas.len(), r.cortado), (1000, true));
        assert_eq!(r.colunas[0].tipo, "int4");
        let mut csv = Vec::new();
        assert_eq!(s.driver.exportar("select * from grande", &mut csv).unwrap(), 50_000);
    }

    #[test]
    #[ignore = "precisa do MySQL de teste (docker, porta 53306)"]
    fn mysql_de_verdade() {
        exercitar("mysql");
    }

    #[test]
    fn perfil_antigo_sem_campos_novos_carrega() {
        let p: Perfil = serde_json::from_str(
            r#"{"id":"1","nome":"Local","ambiente":"local","tipo":"postgres","host":"localhost","porta":5432,"banco":"feira_db","usuario":"postgres"}"#,
        )
        .unwrap();
        assert_eq!(p.ssl, "desligado");
        assert!(!p.somente_leitura && p.ssh.is_none());
    }
}
