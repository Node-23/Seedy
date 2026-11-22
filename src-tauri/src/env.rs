//! Arquivos `.env` do projeto: o Seedy lê as variáveis e as passa para o que ele roda (a classe
//! `main`, o servidor de aplicação, scripts, testes e os comandos da IA). Aqui fica só a leitura;
//! quem escolhe o arquivo e junta com as outras variáveis é a interface.

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VariavelEnv {
    pub nome: String,
    pub valor: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ArquivoEnv {
    pub nome: String,
    /// Quantas variáveis o arquivo define.
    pub variaveis: usize,
    /// `.env.example`, `.env.sample`, `.env.template`: modelo, não valores de verdade.
    pub modelo: bool,
}

fn nome_valido(n: &str) -> bool {
    let mut c = n.chars();
    c.next().is_some_and(|p| p.is_ascii_alphabetic() || p == '_') && c.all(|x| x.is_ascii_alphanumeric() || x == '_' || x == '.')
}

/// Troca `${VAR}` e `${VAR:-padrão}` pelo valor já lido neste arquivo ou, na falta, do ambiente do sistema.
fn expandir(valor: &str, lidas: &HashMap<String, String>) -> String {
    let c: Vec<char> = valor.chars().collect();
    let mut saida = String::new();
    let mut i = 0;
    while i < c.len() {
        if c[i] == '$' && c.get(i + 1) == Some(&'{') {
            if let Some(fim) = c[i + 2..].iter().position(|&x| x == '}') {
                let dentro: String = c[i + 2..i + 2 + fim].iter().collect();
                let (nome, padrao) = match dentro.split_once(":-") {
                    Some((n, p)) => (n.to_string(), Some(p.to_string())),
                    None => (dentro.clone(), None),
                };
                if nome_valido(&nome) {
                    let v = lidas.get(&nome).cloned().or_else(|| std::env::var(&nome).ok()).filter(|v| !v.is_empty()).or(padrao).unwrap_or_default();
                    saida.push_str(&v);
                    i += fim + 3;
                    continue;
                }
            }
        }
        saida.push(c[i]);
        i += 1;
    }
    saida
}

/// Lê um `.env`: `NOME=valor`, `export NOME=valor`, aspas simples (literal) e duplas (com `\n`, `\"`
/// e `${VAR}`), comentários com `#`, valores em várias linhas entre aspas duplas. Linha inválida é ignorada.
pub fn ler_env(texto: &str) -> Vec<VariavelEnv> {
    let texto = texto.strip_prefix('\u{feff}').unwrap_or(texto).replace("\r\n", "\n");
    let c: Vec<char> = texto.chars().collect();
    let mut i = 0;
    let mut lidas: HashMap<String, String> = HashMap::new();
    let mut ordem: Vec<String> = Vec::new();
    while i < c.len() {
        // Começo da linha: espaços, comentário ou linha vazia.
        while i < c.len() && (c[i] == ' ' || c[i] == '\t') {
            i += 1;
        }
        if i >= c.len() {
            break;
        }
        if c[i] == '\n' || c[i] == '#' {
            while i < c.len() && c[i] != '\n' {
                i += 1;
            }
            i += 1;
            continue;
        }
        let ini = i;
        while i < c.len() && c[i] != '\n' && c[i] != '=' {
            i += 1;
        }
        if i >= c.len() || c[i] != '=' {
            i += 1; // sem "=": ignora a linha
            continue;
        }
        let mut chave: String = c[ini..i].iter().collect::<String>().trim().to_string();
        if let Some(resto) = chave.strip_prefix("export ") {
            chave = resto.trim().to_string();
        }
        i += 1; // o "="
        while i < c.len() && (c[i] == ' ' || c[i] == '\t') {
            i += 1;
        }
        let valido = nome_valido(&chave);
        let valor = if i < c.len() && c[i] == '"' {
            i += 1;
            let mut v = String::new();
            while i < c.len() && c[i] != '"' {
                if c[i] == '\\' && i + 1 < c.len() {
                    match c[i + 1] {
                        'n' => v.push('\n'),
                        't' => v.push('\t'),
                        '"' => v.push('"'),
                        '\\' => v.push('\\'),
                        '$' => v.push('$'),
                        outro => {
                            v.push('\\');
                            v.push(outro);
                        }
                    }
                    i += 2;
                } else {
                    v.push(c[i]);
                    i += 1;
                }
            }
            i += 1; // a aspa de fechar
            while i < c.len() && c[i] != '\n' {
                i += 1; // o que vier depois da aspa (comentário) não conta
            }
            expandir(&v, &lidas)
        } else if i < c.len() && c[i] == '\'' {
            i += 1;
            let mut v = String::new();
            while i < c.len() && c[i] != '\'' {
                v.push(c[i]);
                i += 1;
            }
            i += 1;
            while i < c.len() && c[i] != '\n' {
                i += 1;
            }
            v
        } else {
            let ini_valor = i;
            while i < c.len() && c[i] != '\n' {
                i += 1;
            }
            let bruto: String = c[ini_valor..i].iter().collect();
            // Comentário no fim: " # ..." (o "#" colado no valor faz parte dele, como em cores e URLs).
            let sem_comentario = match bruto.find(" #") {
                Some(p) => &bruto[..p],
                None => bruto.as_str(),
            };
            expandir(sem_comentario.trim(), &lidas)
        };
        if valido {
            if !lidas.contains_key(&chave) {
                ordem.push(chave.clone());
            }
            lidas.insert(chave, valor);
        }
    }
    ordem.into_iter().map(|nome| VariavelEnv { valor: lidas[&nome].clone(), nome }).collect()
}

fn eh_arquivo_env(nome: &str) -> bool {
    nome == ".env" || (nome.starts_with(".env.") && nome.len() > 5) || (nome.ends_with(".env") && nome.len() > 4 && !nome.contains(['/', '\\']))
}

fn eh_modelo(nome: &str) -> bool {
    let n = nome.to_lowercase();
    n.ends_with(".example") || n.ends_with(".sample") || n.ends_with(".template") || n.ends_with(".dist")
}

/// Os `.env*` da raiz do projeto, com quantas variáveis cada um define.
#[tauri::command]
pub fn env_arquivos(raiz: String) -> Vec<ArquivoEnv> {
    let mut lista: Vec<ArquivoEnv> = fs::read_dir(&raiz)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().is_file())
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| eh_arquivo_env(n))
        .map(|nome| {
            let variaveis = fs::read_to_string(Path::new(&raiz).join(&nome)).map(|t| ler_env(&t).len()).unwrap_or(0);
            ArquivoEnv { modelo: eh_modelo(&nome), nome, variaveis }
        })
        .collect();
    // `.env` primeiro, os modelos por último.
    lista.sort_by(|a, b| (a.modelo, a.nome != ".env", &a.nome).cmp(&(b.modelo, b.nome != ".env", &b.nome)));
    lista
}

/// As variáveis de um `.env` da raiz (só o nome do arquivo, sem pasta).
#[tauri::command]
pub fn env_ler(raiz: String, arquivo: String) -> Result<Vec<VariavelEnv>, String> {
    if !eh_arquivo_env(&arquivo) || arquivo.contains(['/', '\\']) {
        return Err(format!("{arquivo} não é um arquivo .env"));
    }
    let texto = fs::read_to_string(Path::new(&raiz).join(&arquivo)).map_err(|e| format!("não consegui ler {arquivo}: {e}"))?;
    Ok(ler_env(&texto))
}

#[cfg(test)]
mod testes {
    use super::*;

    fn v(texto: &str) -> Vec<(String, String)> {
        ler_env(texto).into_iter().map(|x| (x.nome, x.valor)).collect()
    }

    #[test]
    fn le_o_basico() {
        let r = v("A=1\nB = dois\n# comentário\n\nexport C=tres\nVAZIA=\n");
        assert_eq!(r, vec![("A".into(), "1".into()), ("B".into(), "dois".into()), ("C".into(), "tres".into()), ("VAZIA".into(), "".into())]);
    }

    #[test]
    fn aspas_comentarios_e_igual_no_valor() {
        let r = v("URL=jdbc:postgresql://h:5432/db?a=b\nCOR=#fff\nSEM=valor # comentario\nDUPLA=\"com # hashtag\" # fim\nSIMPLES='a $B \\n'\n");
        assert_eq!(r[0].1, "jdbc:postgresql://h:5432/db?a=b");
        assert_eq!(r[1].1, "#fff");
        assert_eq!(r[2].1, "valor");
        assert_eq!(r[3].1, "com # hashtag");
        assert_eq!(r[4].1, "a $B \\n");
    }

    #[test]
    fn escapes_e_varias_linhas() {
        let r = v("A=\"linha1\\nlinha2 \\\"x\\\"\"\nCHAVE=\"-----BEGIN\nmeio\n-----END\"\nDEPOIS=ok\n");
        assert_eq!(r[0].1, "linha1\nlinha2 \"x\"");
        assert_eq!(r[1].1, "-----BEGIN\nmeio\n-----END");
        assert_eq!(r[2], ("DEPOIS".into(), "ok".into()));
    }

    #[test]
    fn expande_variaveis() {
        let r = v("HOST=db\nURL=jdbc://${HOST}:5432/${BANCO:-padrao}\nLITERAL='${HOST}'\nSEM=${NAO_EXISTE_SEEDY_XYZ}\n");
        assert_eq!(r[1].1, "jdbc://db:5432/padrao");
        assert_eq!(r[2].1, "${HOST}");
        assert_eq!(r[3].1, "");
    }

    #[test]
    fn crlf_bom_e_linhas_invalidas() {
        let r = v("\u{feff}A=1\r\nlixo sem igual\r\n1INVALIDO=x\r\nB=2\r\n");
        assert_eq!(r, vec![("A".into(), "1".into()), ("B".into(), "2".into())]);
    }

    #[test]
    fn repetida_fica_com_a_ultima_na_primeira_posicao() {
        assert_eq!(v("A=1\nB=2\nA=3\n"), vec![("A".into(), "3".into()), ("B".into(), "2".into())]);
    }

    #[test]
    fn so_aceita_nome_de_env_sem_pasta() {
        assert!(eh_arquivo_env(".env") && eh_arquivo_env(".env.local") && eh_arquivo_env("prod.env"));
        assert!(!eh_arquivo_env("pom.xml") && !eh_arquivo_env(".envrc") && !eh_arquivo_env(".env."));
        assert!(env_ler("/tmp".into(), "../.env".into()).is_err());
        assert!(eh_modelo(".env.example") && !eh_modelo(".env.local"));
    }
}
