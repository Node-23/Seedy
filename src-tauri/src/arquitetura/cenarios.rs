//! Os testes do projeto lidos do código (sem rodar nada): de que tipo são, se esperam um erro e
//! quais componentes e métodos tocam. A tela de testes e as regras de negócio usam isto para
//! mostrar o que está coberto, inclusive os cenários que dão errado.

use super::{Bruto, Fonte};
use regex::Regex;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

#[derive(Serialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TesteInfo {
    /// `Classe.metodo` (Java) ou `arquivo.spec.ts › título` (front).
    pub id: String,
    pub classe: String,
    pub metodo: String,
    pub caminho: String,
    pub relativo: String,
    pub linha: u32,
    /// unitario, integracao, api ou e2e.
    pub tipo: &'static str,
    /// O teste confere um erro (exceção, 4xx, 5xx): é um cenário que dá errado.
    pub espera_erro: bool,
    /// Ids dos componentes que a classe do teste cita (campos, imports).
    pub componentes: Vec<String>,
    /// Nomes dos métodos chamados no corpo do teste.
    pub chamadas: Vec<String>,
    /// Caminhos HTTP citados no corpo (`"POST /reservas"` quando o verbo aparece antes; senão `"/reservas"`).
    pub caminhos: Vec<String>,
    /// "java" ou "ts".
    pub linguagem: &'static str,
}

fn re(cache: &'static OnceLock<Regex>, padrao: &str) -> &'static Regex {
    cache.get_or_init(|| Regex::new(padrao).expect("regex"))
}

/// Pelo texto do teste: espera um erro?
pub fn espera_erro(nome: &str, corpo: &str, anotacoes: &str) -> bool {
    static MARCAS: OnceLock<Regex> = OnceLock::new();
    static NOME: OnceLock<Regex> = OnceLock::new();
    let marcas = re(
        &MARCAS,
        r"assertThrows|assertThatThrownBy|assertThatExceptionOfType|catchThrowable|\.isBadRequest|\.isConflict|\.isForbidden|\.isUnauthorized|\.isNotFound|\.isUnprocessableEntity|is4xxClientError|is5xxServerError|expectStatus\(\)\s*\.is[45]|\.statusCode\(\s*[45]\d\d|status\(\)\.is\([45]|\btoThrow|\.rejects\b|\.toBe\(\s*[45]\d\d\s*\)|assertEquals\(\s*[45]\d\d\b|isEqualTo\(\s*[45]\d\d|HttpStatus\.(BAD_REQUEST|CONFLICT|FORBIDDEN|UNAUTHORIZED|NOT_FOUND|UNPROCESSABLE|INTERNAL)",
    );
    let nome_erro = re(&NOME, r"(?i)^(nao|não|not|no|sem|deve(ria)?(falhar|lancar|recusar|rejeitar|negar)|erro|error|fail|invalid|reject|recus|nega|deny|denied|throw|lanca|bloque|proib|impede|expira|should(not|fail|throw|reject))");
    marcas.is_match(corpo) || anotacoes.contains("expected") || nome_erro.is_match(nome)
}

fn tipo_java(b: &Bruto, corpo_classe: &str) -> &'static str {
    let anots: HashSet<&str> = b.anots.iter().map(|a| a.nome.as_str()).collect();
    let usa_http = corpo_classe.contains("MockMvc") || corpo_classe.contains("mockMvc") || corpo_classe.contains("RestAssured") || corpo_classe.contains("TestRestTemplate") || corpo_classe.contains("WebTestClient");
    if anots.contains("WebMvcTest") || anots.contains("AutoConfigureMockMvc") || usa_http {
        return "api";
    }
    let nome = b.comp.nome.as_str();
    let caminho = b.comp.relativo.to_lowercase();
    if ["SpringBootTest", "DataJpaTest", "JdbcTest", "DataMongoTest", "Testcontainers", "QuarkusTest", "DataRedisTest", "RestClientTest"].iter().any(|a| anots.contains(a))
        || nome.ends_with("IT")
        || nome.ends_with("ITCase")
        || nome.ends_with("IntegrationTest")
        || caminho.contains("/integration")
        || caminho.contains("/it/")
    {
        return "integracao";
    }
    if caminho.contains("/e2e/") || nome.ends_with("E2E") || nome.ends_with("E2ETest") {
        return "e2e";
    }
    "unitario"
}

fn tipo_ts(relativo: &str) -> &'static str {
    let r = relativo.to_lowercase();
    if r.contains("/e2e/") || r.contains("/cypress/") || r.contains("/playwright/") || r.contains(".cy.") || r.contains(".e2e") {
        "e2e"
    } else {
        "unitario"
    }
}

/// Nomes de classes/serviços que o texto cita → ids dos componentes (não de teste).
fn componentes_citados(texto: &str, por_nome: &HashMap<&str, Vec<&str>>) -> Vec<String> {
    static IDENT: OnceLock<Regex> = OnceLock::new();
    let mut ids: Vec<String> = Vec::new();
    let mut vistos: HashSet<&str> = HashSet::new();
    for m in re(&IDENT, r"[A-Za-z_][A-Za-z0-9_]*").find_iter(texto) {
        let nome = m.as_str();
        if !vistos.insert(nome) {
            continue;
        }
        if let Some(l) = por_nome.get(nome) {
            ids.extend(l.iter().map(|s| s.to_string()));
        }
    }
    ids
}

/// Caminhos de API citados no teste (`mockMvc.perform(post("/reservas"))`, `.uri("/feiras/1")`).
fn caminhos_citados(corpo: &str) -> Vec<String> {
    static C: OnceLock<Regex> = OnceLock::new();
    let mut vistos: HashSet<String> = HashSet::new();
    re(&C, r#"(?:\b(get|post|put|delete|patch)\s*\(\s*)?"(/[A-Za-z0-9_\-./{}:?=&]*)""#)
        .captures_iter(corpo)
        .map(|c| match c.get(1) {
            Some(v) => format!("{} {}", v.as_str().to_uppercase(), &c[2]),
            None => c[2].to_string(),
        })
        .filter(|c| vistos.insert(c.clone()))
        .take(40)
        .collect()
}

fn metodos_chamados(corpo: &str) -> Vec<String> {
    static CHAMADA: OnceLock<Regex> = OnceLock::new();
    let mut vistos: HashSet<&str> = HashSet::new();
    re(&CHAMADA, r"\b([A-Za-z_][A-Za-z0-9_]*)\s*\(")
        .captures_iter(corpo)
        .map(|c| c.get(1).unwrap().as_str())
        .filter(|n| vistos.insert(n))
        .take(120)
        .map(String::from)
        .collect()
}

pub(super) fn descobrir(fontes: &[Fonte], brutos: &[Bruto]) -> Vec<TesteInfo> {
    static IT: OnceLock<Regex> = OnceLock::new();
    // `it('título')` e `test("título")`, com aspas simples, duplas ou crase. Sem referência para trás: o regex do Rust não tem.
    const PADRAO_IT: &str = r#"(?m)\b(?:it|test)(?:\.(?:only|skip))?\s*\(\s*(?:"([^"\n]+)"|'([^'\n]+)'|`([^`\n]+)`)"#;
    let mut por_nome: HashMap<&str, Vec<&str>> = HashMap::new();
    for b in brutos.iter().filter(|b| b.comp.papel != "teste") {
        por_nome.entry(b.comp.nome.as_str()).or_default().push(b.comp.id.as_str());
    }
    let mut saida: Vec<TesteInfo> = Vec::new();

    // Java: um teste é um método com @Test (ou variante) numa classe de teste.
    for b in brutos.iter().filter(|b| b.comp.papel == "teste" && b.comp.linguagem == "java") {
        let f = &fontes[b.fonte];
        let classe_texto = f.orig(b.classe_abre, b.classe_fecha);
        let tipo = tipo_java(b, classe_texto);
        let mut componentes = componentes_citados(classe_texto, &por_nome);
        // ReservaServiceTest testa o ReservaService, mesmo sem citá-lo num campo.
        let base = b.comp.nome.trim_end_matches("ITCase").trim_end_matches("Tests").trim_end_matches("Test").trim_end_matches("IT");
        for id in por_nome.get(base).into_iter().flatten() {
            if !componentes.iter().any(|c| c == id) {
                componentes.push(id.to_string());
            }
        }
        for m in &b.metodos {
            let eh_teste = m.anotacoes.iter().any(|a| matches!(a.nome.as_str(), "Test" | "ParameterizedTest" | "RepeatedTest" | "TestFactory" | "TestTemplate"));
            if !eh_teste {
                continue;
            }
            let corpo = m.corpo.map(|(a, z)| f.orig(a, z)).unwrap_or("");
            let anotacoes: String = m.anotacoes.iter().map(|a| format!("{}({})", a.nome, a.args)).collect::<Vec<_>>().join(" ");
            saida.push(TesteInfo {
                id: format!("{}.{}", b.comp.nome, m.nome),
                classe: b.comp.nome.clone(),
                metodo: m.nome.clone(),
                caminho: f.caminho.clone(),
                relativo: f.relativo.clone(),
                linha: f.linha(m.nome_pos),
                tipo,
                espera_erro: espera_erro(&m.nome, corpo, &anotacoes),
                componentes: componentes.clone(),
                chamadas: metodos_chamados(corpo),
                caminhos: caminhos_citados(corpo),
                linguagem: "java",
            });
        }
    }

    // Front: `it('...')` e `test('...')` dos .spec.ts, .test.ts e e2e.
    for f in fontes.iter().filter(|f| f.teste && f.ts) {
        let arquivo = f.relativo.rsplit('/').next().unwrap_or(&f.relativo).to_string();
        let tipo = tipo_ts(&f.relativo);
        let componentes = componentes_citados(&f.texto, &por_nome);
        for c in re(&IT, PADRAO_IT).captures_iter(&f.texto) {
            let titulo = c.get(1).or_else(|| c.get(2)).or_else(|| c.get(3)).map(|m| m.as_str()).unwrap_or("").to_string();
            let inicio = c.get(0).unwrap().start();
            // O corpo vai até o próximo it/test (aproximação boa para spec de uma classe).
            let resto = &f.texto[inicio..];
            let fim = re(&IT, PADRAO_IT).find_iter(&resto[1..]).next().map(|m| m.start() + 1).unwrap_or(resto.len());
            let corpo = &resto[..fim];
            saida.push(TesteInfo {
                id: format!("{arquivo} › {titulo}"),
                classe: arquivo.clone(),
                metodo: titulo.clone(),
                caminho: f.caminho.clone(),
                relativo: f.relativo.clone(),
                linha: f.linha(inicio),
                tipo,
                espera_erro: espera_erro(&titulo, corpo, ""),
                componentes: componentes.clone(),
                chamadas: metodos_chamados(corpo),
                caminhos: vec![],
                linguagem: "ts",
            });
        }
    }
    saida
}

/// Para as regras: ids dos testes que citam a mensagem, ou a exceção junto do método (ou a validação).
pub(super) fn testes_da_regra(
    mensagem: Option<&str>,
    excecao: Option<&str>,
    metodo: Option<&str>,
    validacao: Option<&str>,
    candidatos: &[(String, String)],
) -> Vec<String> {
    candidatos
        .iter()
        .filter(|(_, corpo)| {
            mensagem.is_some_and(|m| m.chars().count() >= 4 && corpo.contains(m))
                || (excecao.is_some_and(|e| corpo.contains(e)) && metodo.is_some_and(|mm| corpo.contains(&format!(".{mm}("))))
                || validacao.is_some_and(|c| corpo.contains(c) && (corpo.contains("iolation") || corpo.contains("400")))
        })
        .map(|(id, _)| id.clone())
        .collect()
}

