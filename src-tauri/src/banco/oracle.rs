//! Oracle pelo crate `oracle` (ODPI-C). Precisa do Oracle Instant Client na máquina.

use super::{linha_csv, sem_ponto_e_virgula, Coluna, Driver, Perfil, Resultado};
use oracle::{Connection, Row};
use std::io::Write;

pub struct Oracle {
    conexao: Connection,
    somente_leitura: bool,
}

impl Oracle {
    pub fn conectar(p: &Perfil, host: &str, porta: u16, senha: &str) -> Result<Self, String> {
        let destino = format!("//{host}:{porta}/{}", p.banco);
        let mut conexao = Connection::connect(&p.usuario, senha, destino).map_err(erro)?;
        // Somente leitura no Oracle é por transação (SET TRANSACTION READ ONLY): sem
        // autocommit, para a transação de leitura durar a instrução inteira.
        conexao.set_autocommit(!p.somente_leitura);
        Ok(Self { conexao, somente_leitura: p.somente_leitura })
    }

    fn rodar(&mut self, sql: &str, limite: usize) -> Result<Resultado, String> {
        let texto = sem_ponto_e_virgula_exceto_plsql(sql);
        let mut stmt = self.conexao.statement(&texto).build().map_err(erro)?;
        let mut r = Resultado::default();
        if stmt.is_query() {
            let linhas = stmt.query(&[]).map_err(erro)?;
            r.colunas = linhas
                .column_info()
                .iter()
                .map(|c| Coluna { nome: c.name().to_string(), tipo: c.oracle_type().to_string().to_lowercase() })
                .collect();
            for linha in linhas {
                let linha = linha.map_err(erro)?;
                if r.linhas.len() < limite {
                    r.linhas.push(valores(&linha));
                } else {
                    r.cortado = true;
                    break;
                }
            }
        } else {
            stmt.execute(&[]).map_err(erro)?;
            r.afetadas = Some(stmt.row_count().map_err(erro)?);
        }
        Ok(r)
    }
}

impl Driver for Oracle {
    fn consultar(&mut self, sql: &str, limite: usize) -> Result<Resultado, String> {
        // Uma instrução por vez (o Oracle não aceita várias no mesmo envio fora de PL/SQL).
        let instrucoes = super::sql::instrucoes(sql);
        let plsql = matches!(super::sql::primeira_palavra(sql).as_str(), "begin" | "declare" | "create");
        let lista = if plsql { vec![sql.to_string()] } else { instrucoes };
        let mut ultimo = Resultado::default();
        for instrucao in lista {
            if self.somente_leitura {
                let _ = self.conexao.rollback();
                self.conexao.execute("SET TRANSACTION READ ONLY", &[]).map_err(erro)?;
            }
            let r = self.rodar(&instrucao, limite);
            if self.somente_leitura {
                let _ = self.conexao.rollback();
            }
            let r = r?;
            if !r.colunas.is_empty() || ultimo.colunas.is_empty() {
                ultimo = r;
            }
        }
        Ok(ultimo)
    }

    fn exportar(&mut self, sql: &str, saida: &mut dyn Write) -> Result<u64, String> {
        let linhas = self.conexao.query(sem_ponto_e_virgula(sql), &[]).map_err(erro)?;
        let cabecalho: Vec<Option<String>> = linhas.column_info().iter().map(|c| Some(c.name().to_string())).collect();
        linha_csv(saida, &cabecalho)?;
        let mut n = 0;
        for linha in linhas {
            linha_csv(saida, &valores(&linha.map_err(erro)?))?;
            n += 1;
        }
        Ok(n)
    }

    fn versao(&mut self) -> String {
        self.conexao.server_version().map(|(v, _)| format!("Oracle {v}")).unwrap_or_else(|_| "Oracle".into())
    }
}

fn valores(linha: &Row) -> Vec<Option<String>> {
    (0..linha.sql_values().len())
        .map(|i| match linha.get::<usize, Option<String>>(i) {
            Ok(v) => v,
            // Tipos sem conversão direta para texto (LOB, objetos): a forma de exibição.
            Err(_) => Some(linha.sql_values()[i].to_string()),
        })
        .collect()
}

/// Blocos PL/SQL terminam em `END;` (o `;` faz parte); o resto vai sem ele.
fn sem_ponto_e_virgula_exceto_plsql(sql: &str) -> String {
    let p = super::sql::primeira_palavra(sql);
    let corpo = super::sql::sem_comentarios(sql).to_lowercase();
    let e_bloco = matches!(p.as_str(), "begin" | "declare")
        || (p == "create" && ["procedure", "function", "package", "trigger", "type"].iter().any(|w| corpo.contains(w)));
    if e_bloco {
        sql.trim().to_string()
    } else {
        sem_ponto_e_virgula(sql).to_string()
    }
}

fn erro(e: oracle::Error) -> String {
    let t = e.to_string();
    if t.contains("DPI-1047") {
        return "Oracle: falta o Oracle Instant Client nesta máquina. Baixe em \
                https://www.oracle.com/database/technologies/instant-client/downloads.html, \
                descompacte e ponha a pasta no PATH (Windows) ou em LD_LIBRARY_PATH (Linux); depois reabra o Seedy."
            .into();
    }
    format!("Oracle: {t}")
}
