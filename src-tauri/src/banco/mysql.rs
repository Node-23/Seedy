//! MySQL/MariaDB pelo crate `mysql` (protocolo de texto).

use super::{linha_csv, Coluna, Driver, Perfil, Resultado};
use mysql::prelude::Queryable;
use mysql::{Conn, OptsBuilder, SslOpts, Value};
use std::io::Write;
use std::time::Duration;

pub struct Mysql {
    conexao: Conn,
}

impl Mysql {
    pub fn conectar(p: &Perfil, host: &str, porta: u16, senha: &str) -> Result<Self, String> {
        let mut opcoes = OptsBuilder::new()
            .ip_or_hostname(Some(host))
            .tcp_port(porta)
            .user(Some(&p.usuario))
            .pass(Some(senha))
            .db_name(Some(&p.banco).filter(|b| !b.is_empty()))
            .tcp_connect_timeout(Some(Duration::from_secs(10)));
        if p.ssl != "desligado" {
            opcoes = opcoes.ssl_opts(SslOpts::default().with_danger_accept_invalid_certs(p.ssl == "exigir"));
        }
        let mut conexao = Conn::new(opcoes).map_err(erro)?;
        if p.somente_leitura {
            conexao.query_drop("SET SESSION TRANSACTION READ ONLY").map_err(erro)?;
        }
        Ok(Self { conexao })
    }
}

impl Driver for Mysql {
    fn consultar(&mut self, sql: &str, limite: usize) -> Result<Resultado, String> {
        let mut r = Resultado::default();
        let mut teve_linhas = false;
        let mut resultado = self.conexao.query_iter(sql).map_err(erro)?;
        // Várias instruções = vários conjuntos; vale o último que devolve linhas.
        while let Some(mut conjunto) = resultado.iter() {
            let colunas: Vec<Coluna> = conjunto
                .columns()
                .as_ref()
                .iter()
                .map(|c| Coluna { nome: c.name_str().to_string(), tipo: nome_do_tipo(c.column_type()) })
                .collect();
            if colunas.is_empty() {
                if !teve_linhas {
                    r.afetadas = Some(conjunto.affected_rows());
                }
                // Consome o conjunto (sem linhas) antes do próximo.
                for linha in conjunto.by_ref() {
                    linha.map_err(erro)?;
                }
                continue;
            }
            let mut linhas = Vec::new();
            let mut cortado = false;
            for linha in conjunto.by_ref() {
                let linha = linha.map_err(erro)?;
                if linhas.len() < limite {
                    linhas.push(linha.unwrap().into_iter().map(texto).collect());
                } else {
                    cortado = true;
                }
            }
            teve_linhas = true;
            r.colunas = colunas;
            r.linhas = linhas;
            r.cortado = cortado;
            r.afetadas = None;
        }
        Ok(r)
    }

    fn exportar(&mut self, sql: &str, saida: &mut dyn Write) -> Result<u64, String> {
        let mut resultado = self.conexao.query_iter(sql).map_err(erro)?;
        let mut n = 0;
        if let Some(mut conjunto) = resultado.iter() {
            let cabecalho: Vec<Option<String>> = conjunto.columns().as_ref().iter().map(|c| Some(c.name_str().to_string())).collect();
            linha_csv(saida, &cabecalho)?;
            for linha in conjunto.by_ref() {
                let campos: Vec<Option<String>> = linha.map_err(erro)?.unwrap().into_iter().map(texto).collect();
                linha_csv(saida, &campos)?;
                n += 1;
            }
        }
        Ok(n)
    }

    fn versao(&mut self) -> String {
        let (a, b, c) = self.conexao.server_version();
        format!("MySQL {a}.{b}.{c}")
    }
}

/// Valor como texto (no protocolo de texto quase tudo chega como bytes).
fn texto(v: Value) -> Option<String> {
    match v {
        Value::NULL => None,
        Value::Bytes(b) => Some(String::from_utf8_lossy(&b).into_owned()),
        Value::Int(i) => Some(i.to_string()),
        Value::UInt(u) => Some(u.to_string()),
        Value::Float(f) => Some(f.to_string()),
        Value::Double(d) => Some(d.to_string()),
        Value::Date(a, m, d, h, mi, s, us) => Some(if h == 0 && mi == 0 && s == 0 && us == 0 {
            format!("{a:04}-{m:02}-{d:02}")
        } else if us == 0 {
            format!("{a:04}-{m:02}-{d:02} {h:02}:{mi:02}:{s:02}")
        } else {
            format!("{a:04}-{m:02}-{d:02} {h:02}:{mi:02}:{s:02}.{us:06}")
        }),
        Value::Time(neg, dias, h, mi, s, us) => {
            let horas = dias * 24 + h as u32;
            let sinal = if neg { "-" } else { "" };
            Some(if us == 0 { format!("{sinal}{horas:02}:{mi:02}:{s:02}") } else { format!("{sinal}{horas:02}:{mi:02}:{s:02}.{us:06}") })
        }
    }
}

/// `MYSQL_TYPE_VAR_STRING` → `varchar`, como o MySQL chama na DDL.
fn nome_do_tipo(t: mysql::consts::ColumnType) -> String {
    let bruto = format!("{t:?}").trim_start_matches("MYSQL_TYPE_").to_lowercase();
    match bruto.as_str() {
        "var_string" | "varchar" => "varchar",
        "string" => "char",
        "tiny" => "tinyint",
        "short" => "smallint",
        "int24" => "mediumint",
        "long" => "int",
        "longlong" => "bigint",
        "newdecimal" | "decimal" => "decimal",
        "newdate" => "date",
        "tiny_blob" | "medium_blob" | "long_blob" | "blob" => "text",
        outro => return outro.to_string(),
    }
    .to_string()
}

fn erro(e: mysql::Error) -> String {
    match e {
        mysql::Error::MySqlError(m) => format!("MySQL {}: {}", m.code, m.message),
        outro => format!("MySQL: {outro}"),
    }
}
