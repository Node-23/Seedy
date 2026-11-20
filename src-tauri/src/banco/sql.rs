//! Leitura leve de SQL: dividir em instruções (respeitando aspas, comentários e os
//! `$tag$` do PostgreSQL) e dizer se uma instrução escreve no banco.

/// Divide o texto em instruções pelo `;`, sem cortar dentro de strings, identificadores
/// entre aspas, comentários ou blocos `$tag$...$tag$`. Instruções vazias saem.
pub fn instrucoes(sql: &str) -> Vec<String> {
    let mut saida = Vec::new();
    let mut atual = String::new();
    let c: Vec<char> = sql.chars().collect();
    let mut i = 0;
    while i < c.len() {
        let ch = c[i];
        // Comentário de linha.
        if ch == '-' && c.get(i + 1) == Some(&'-') {
            while i < c.len() && c[i] != '\n' {
                atual.push(c[i]);
                i += 1;
            }
            continue;
        }
        // Comentário de bloco.
        if ch == '/' && c.get(i + 1) == Some(&'*') {
            atual.push_str("/*");
            i += 2;
            while i < c.len() && !(c[i] == '*' && c.get(i + 1) == Some(&'/')) {
                atual.push(c[i]);
                i += 1;
            }
            if i < c.len() {
                atual.push_str("*/");
                i += 2;
            }
            continue;
        }
        // Strings e identificadores entre aspas ('' e "" dobrados continuam dentro).
        if ch == '\'' || ch == '"' || ch == '`' {
            atual.push(ch);
            i += 1;
            while i < c.len() {
                atual.push(c[i]);
                if c[i] == ch {
                    if c.get(i + 1) == Some(&ch) {
                        atual.push(ch);
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }
        // $tag$ ... $tag$ (corpo de função no PostgreSQL).
        if ch == '$' {
            if let Some(tag) = tag_de_dolar(&c, i) {
                let fim_tag = i + tag.len();
                atual.extend(&c[i..fim_tag]);
                i = fim_tag;
                let alvo: Vec<char> = tag.chars().collect();
                while i < c.len() && !c[i..].starts_with(&alvo) {
                    atual.push(c[i]);
                    i += 1;
                }
                if i < c.len() {
                    atual.push_str(&tag);
                    i += alvo.len();
                }
                continue;
            }
        }
        if ch == ';' {
            empurrar(&mut saida, &mut atual);
            i += 1;
            continue;
        }
        atual.push(ch);
        i += 1;
    }
    empurrar(&mut saida, &mut atual);
    saida
}

fn tag_de_dolar(c: &[char], i: usize) -> Option<String> {
    // $$ ou $nome$ (nome: letras, dígitos, _; não começa com dígito).
    let mut j = i + 1;
    while j < c.len() && (c[j].is_alphanumeric() || c[j] == '_') {
        j += 1;
    }
    if j < c.len() && c[j] == '$' && !(j > i + 1 && c[i + 1].is_ascii_digit()) {
        Some(c[i..=j].iter().collect())
    } else {
        None
    }
}

fn empurrar(saida: &mut Vec<String>, atual: &mut String) {
    let t = atual.trim();
    if !sem_comentarios(t).trim().is_empty() {
        saida.push(t.to_string());
    }
    atual.clear();
}

/// O texto sem os comentários (para achar a primeira palavra da instrução).
pub fn sem_comentarios(sql: &str) -> String {
    let mut s = String::new();
    let c: Vec<char> = sql.chars().collect();
    let mut i = 0;
    while i < c.len() {
        if c[i] == '-' && c.get(i + 1) == Some(&'-') {
            while i < c.len() && c[i] != '\n' {
                i += 1;
            }
        } else if c[i] == '/' && c.get(i + 1) == Some(&'*') {
            i += 2;
            while i < c.len() && !(c[i] == '*' && c.get(i + 1) == Some(&'/')) {
                i += 1;
            }
            i += 2;
        } else {
            s.push(c[i]);
            i += 1;
        }
    }
    s
}

/// Primeira palavra da instrução, em minúsculas ("select", "with", "update"...).
pub fn primeira_palavra(instrucao: &str) -> String {
    sem_comentarios(instrucao)
        .trim_start()
        .trim_start_matches('(')
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .find(|p| !p.is_empty())
        .unwrap_or("")
        .to_lowercase()
}

/// Instrução que só lê (consulta). O resto é tratado como escrita.
pub fn so_le(instrucao: &str) -> bool {
    let p = primeira_palavra(instrucao);
    let leitura = ["select", "with", "values", "table", "show", "explain", "describe", "desc", "pragma", "set", "use"];
    if !leitura.contains(&p.as_str()) {
        return false;
    }
    // WITH ... INSERT/UPDATE/DELETE escreve; EXPLAIN ANALYZE executa de verdade.
    let texto = sem_comentarios(instrucao).to_lowercase();
    let palavras: Vec<&str> = texto.split(|c: char| !c.is_alphanumeric() && c != '_').filter(|w| !w.is_empty()).collect();
    if p == "with" && palavras.iter().any(|w| matches!(*w, "insert" | "update" | "delete" | "merge")) {
        return false;
    }
    if p == "explain" && palavras.get(1) == Some(&"analyze") {
        return palavras.iter().skip(2).all(|w| !matches!(*w, "insert" | "update" | "delete" | "merge"));
    }
    if p == "select" && palavras.windows(2).any(|w| w == ["for", "update"]) {
        return false;
    }
    // SET pode desligar o "somente leitura" da sessão (SET ... TRANSACTION READ WRITE).
    if p == "set" && palavras.iter().any(|w| matches!(*w, "transaction" | "characteristics" | "default_transaction_read_only" | "transaction_read_only")) {
        return false;
    }
    true
}

/// Consulta que dá para abrir como cursor no PostgreSQL (DECLARE ... CURSOR FOR).
pub fn cabe_em_cursor(instrucao: &str) -> bool {
    matches!(primeira_palavra(instrucao).as_str(), "select" | "with" | "values" | "table") && so_le(instrucao)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn divide_respeitando_strings_comentarios_e_dolar() {
        let sql = "select ';' as a; -- fim; aqui\nselect 2 /* ; */;\ncreate function f() returns int as $f$ begin; return 1; end $f$ language plpgsql;\n\n;";
        let v = instrucoes(sql);
        assert_eq!(v.len(), 3, "{v:?}");
        assert_eq!(v[0], "select ';' as a");
        assert!(v[1].contains("/* ; */"));
        assert!(v[2].ends_with("language plpgsql"));
    }

    #[test]
    fn aspas_dobradas_continuam_na_string() {
        assert_eq!(instrucoes("select 'it''s; ok'; select 1").len(), 2);
    }

    #[test]
    fn so_comentario_nao_e_instrucao() {
        assert!(instrucoes("-- nada\n/* nada */").is_empty());
    }

    #[test]
    fn classifica_leitura_e_escrita() {
        assert!(so_le("SELECT * FROM feira"));
        assert!(so_le("  -- comentário\n  with x as (select 1) select * from x"));
        assert!(!so_le("with x as (delete from feira returning *) select * from x"));
        assert!(!so_le("UPDATE feira SET nome = 'x'"));
        assert!(!so_le("drop table feira"));
        assert!(!so_le("select * from feira for update"));
        assert!(!so_le("explain analyze delete from feira"));
        assert!(so_le("explain select 1"));
        assert!(cabe_em_cursor("(select 1)"));
        assert!(!cabe_em_cursor("show tables"));
    }
}
