//! PostgreSQL pelo crate `postgres` (protocolo simples: todo valor já chega como texto).

use super::{sem_ponto_e_virgula, sql, Coluna, Driver, Perfil, Resultado};
use postgres::{Client, Config, SimpleQueryMessage};
use std::io::{Read, Write};
use std::time::Duration;

pub struct Postgres {
    cliente: Client,
}

impl Postgres {
    pub fn conectar(p: &Perfil, host: &str, porta: u16, senha: &str) -> Result<Self, String> {
        let mut c = Config::new();
        c.host(host).port(porta).user(&p.usuario).password(senha).dbname(&p.banco).application_name("Seedy");
        c.connect_timeout(Duration::from_secs(10));
        let mut cliente = match p.ssl.as_str() {
            "desligado" => c.connect(postgres::NoTls),
            modo => {
                let tls = native_tls::TlsConnector::builder()
                    .danger_accept_invalid_certs(modo == "exigir")
                    .danger_accept_invalid_hostnames(modo == "exigir")
                    .build()
                    .map_err(|e| format!("TLS: {e}"))?;
                c.connect(postgres_native_tls::MakeTlsConnector::new(tls))
            }
        }
        .map_err(erro)?;
        if p.somente_leitura {
            // O próprio servidor recusa escrita nesta sessão.
            cliente.batch_execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY").map_err(erro)?;
        }
        Ok(Self { cliente })
    }

    /// Tipos das colunas (a preparação não executa nada); vazio se não der para preparar.
    fn tipos(&mut self, instrucao: &str) -> Vec<String> {
        self.cliente
            .prepare(instrucao)
            .map(|s| s.columns().iter().map(|c| c.type_().name().to_string()).collect())
            .unwrap_or_default()
    }

    /// SELECT aberto como cursor: busca só `limite + 1` linhas, mesmo numa tabela enorme.
    fn pelo_cursor(&mut self, instrucao: &str, limite: usize) -> Result<Resultado, postgres::Error> {
        let pedido = format!(
            "BEGIN; DECLARE seedy_cursor NO SCROLL CURSOR FOR {instrucao}; FETCH FORWARD {} FROM seedy_cursor; CLOSE seedy_cursor; COMMIT",
            limite + 1
        );
        match self.cliente.simple_query(&pedido) {
            Ok(m) => Ok(ler(m, limite)),
            Err(e) => {
                let _ = self.cliente.batch_execute("ROLLBACK");
                Err(e)
            }
        }
    }
}

impl Driver for Postgres {
    fn consultar(&mut self, texto: &str, limite: usize) -> Result<Resultado, String> {
        let instrucoes = sql::instrucoes(texto);
        let unica = instrucoes.len() == 1;
        let mut r = if unica && sql::cabe_em_cursor(&instrucoes[0]) {
            match self.pelo_cursor(sem_ponto_e_virgula(&instrucoes[0]), limite) {
                Ok(r) => r,
                // Alguns SELECTs não viram cursor; aí vai do jeito comum.
                Err(e) if e.to_string().contains("DECLARE") || e.to_string().contains("cursor") => {
                    ler(self.cliente.simple_query(texto).map_err(erro)?, limite)
                }
                Err(e) => return Err(erro(e)),
            }
        } else {
            ler(self.cliente.simple_query(texto).map_err(erro)?, limite)
        };
        if unica && !r.colunas.is_empty() {
            let tipos = self.tipos(sem_ponto_e_virgula(&instrucoes[0]));
            if tipos.len() == r.colunas.len() {
                for (c, t) in r.colunas.iter_mut().zip(tipos) {
                    c.tipo = t;
                }
            }
        }
        Ok(r)
    }

    fn exportar(&mut self, instrucao: &str, saida: &mut dyn Write) -> Result<u64, String> {
        let copia = format!("COPY ({}) TO STDOUT WITH (FORMAT csv, HEADER)", sem_ponto_e_virgula(instrucao));
        let mut leitor = self.cliente.copy_out(&copia).map_err(erro)?;
        let mut contador = ContaLinhasCsv::default();
        let mut buf = [0u8; 64 * 1024];
        loop {
            let n = leitor.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            contador.ler(&buf[..n]);
            saida.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        }
        Ok(contador.registros.saturating_sub(1))
    }

    fn versao(&mut self) -> String {
        self.cliente
            .simple_query("show server_version")
            .ok()
            .and_then(|m| {
                m.into_iter().find_map(|x| match x {
                    SimpleQueryMessage::Row(r) => r.get(0).map(|v| format!("PostgreSQL {v}")),
                    _ => None,
                })
            })
            .unwrap_or_else(|| "PostgreSQL".into())
    }
}

/// Junta as mensagens do protocolo simples: o resultado é o da última instrução que
/// devolveu linhas; sem nenhuma, as linhas afetadas da última.
fn ler(mensagens: Vec<SimpleQueryMessage>, limite: usize) -> Resultado {
    let mut r = Resultado::default();
    let mut colunas: Vec<Coluna> = vec![];
    let mut linhas: Vec<Vec<Option<String>>> = vec![];
    let mut cortado = false;
    let mut teve_linhas = false;
    for m in mensagens {
        match m {
            SimpleQueryMessage::RowDescription(cols) => {
                colunas = cols.iter().map(|c| Coluna { nome: c.name().to_string(), tipo: String::new() }).collect();
                linhas.clear();
                cortado = false;
            }
            SimpleQueryMessage::Row(linha) => {
                if linhas.len() < limite {
                    linhas.push((0..linha.len()).map(|i| linha.get(i).map(str::to_string)).collect());
                } else {
                    cortado = true;
                }
            }
            SimpleQueryMessage::CommandComplete(n) => {
                if !colunas.is_empty() {
                    teve_linhas = true;
                    r.colunas = std::mem::take(&mut colunas);
                    r.linhas = std::mem::take(&mut linhas);
                    r.cortado = cortado;
                    r.afetadas = None;
                } else if !teve_linhas {
                    r.afetadas = Some(n);
                }
            }
            _ => {}
        }
    }
    r
}

/// Conta registros de CSV (quebras de linha fora de aspas) enquanto o COPY passa.
#[derive(Default)]
struct ContaLinhasCsv {
    dentro_de_aspas: bool,
    registros: u64,
}

impl ContaLinhasCsv {
    fn ler(&mut self, bytes: &[u8]) {
        for &b in bytes {
            match b {
                b'"' => self.dentro_de_aspas = !self.dentro_de_aspas,
                b'\n' if !self.dentro_de_aspas => self.registros += 1,
                _ => {}
            }
        }
    }
}

fn erro(e: postgres::Error) -> String {
    match e.as_db_error() {
        Some(db) => {
            let mut s = format!("{}: {}", db.severity(), db.message());
            if let Some(d) = db.detail() {
                s.push_str(&format!(" ({d})"));
            }
            if let Some(dica) = db.hint() {
                s.push_str(&format!(" · dica: {dica}"));
            }
            s
        }
        None => {
            let t = e.to_string();
            let causa = std::error::Error::source(&e).map(|c| c.to_string()).unwrap_or_default();
            if causa.is_empty() || t.contains(&causa) {
                format!("PostgreSQL: {t}")
            } else {
                format!("PostgreSQL: {t}: {causa}")
            }
        }
    }
}

