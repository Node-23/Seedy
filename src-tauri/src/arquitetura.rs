//! Fase 9 — Entender o sistema. Lê o código do projeto (Spring Boot, Java EE/Jakarta e
//! Angular) e devolve:
//! - os componentes, cada um com o papel (camada) e o domínio;
//! - as chamadas entre os métodos, inclusive do front para a API (pela URL do HttpClient);
//! - os desvios de cada método (`if (...) throw`, `orElseThrow`, `return` com status HTTP);
//! - as regras de negócio candidatas (exceções de negócio, validações, rotinas, permissões).
//!
//! É uma leitura do texto, sem compilar: nada de jdtls nem tsserver, então funciona logo ao
//! abrir o projeto, e o front e o back entram no mesmo grafo.

use crate::busca::{percorrer, relativo};
use regex::Regex;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::OnceLock;

/// Arquivos maiores que isso não são lidos (gerados, minificados).
const TAMANHO_MAXIMO: u64 = 768 * 1024;
/// Um projeto maior que isso é lido só até aqui.
const LIMITE_ARQUIVOS: usize = 8000;

// ---------- o que volta para a interface ----------

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Analise {
    /// "Spring Boot 3.3", "Angular 19"...
    pub tecnologias: Vec<String>,
    pub componentes: Vec<Componente>,
    pub regras: Vec<Regra>,
    /// Arquivos lidos (para o "52 classes" do topo).
    pub arquivos: usize,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Componente {
    pub id: String,
    pub nome: String,
    pub caminho: String,
    pub relativo: String,
    pub linha: u32,
    pub pacote: String,
    /// "java" ou "ts".
    pub linguagem: &'static str,
    /// tela, front, entrada, job, servico, repositorio, entidade, excecao, tratador, teste, outro.
    pub papel: &'static str,
    pub dominio: String,
    /// Anotações/decorators da classe, sem argumentos ("RestController", "Service"...).
    pub anotacoes: Vec<String>,
    /// Ids dos componentes que este usa (injeção, campos, construtor).
    pub usa: Vec<String>,
    pub estende: Option<String>,
    pub implementa: Vec<String>,
    /// Rota base (`@RequestMapping`, `@Path`, `@WebServlet`).
    pub rota: Option<String>,
    /// Entidade: nome da tabela. Repositório: a tabela da entidade dele.
    pub tabela: Option<String>,
    /// Repositório: id da entidade.
    pub entidade: Option<String>,
    /// Sistema externo que este chama por HTTP (cliente Feign, RestTemplate, WebClient).
    pub externo: Option<String>,
    /// Componente Angular: seletor e o arquivo do template.
    pub seletor: Option<String>,
    pub template: Option<String>,
    pub metodos: Vec<Metodo>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Metodo {
    pub nome: String,
    pub linha: u32,
    pub linha_fim: u32,
    pub params: Vec<String>,
    pub anotacoes: Vec<String>,
    /// Endpoint: verbo e rota completa (base da classe + a do método).
    pub http: Option<Endpoint>,
    /// `@Scheduled`/`@Schedule`: o que está entre os parênteses.
    pub agendado: Option<String>,
    pub chamadas: Vec<Chamada>,
    pub desvios: Vec<Desvio>,
    /// Front: chamadas do HttpClient (e para qual endpoint do back cada uma vai).
    pub http_saida: Vec<HttpSaida>,
    /// Componente Angular: onde o template chama este método (`(click)="reservar()"`).
    pub gatilhos: Vec<Gatilho>,
    /// O corpo usa um cliente HTTP (vai para o sistema externo do componente).
    pub usa_externo: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint {
    pub verbo: String,
    pub rota: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Chamada {
    /// Id do componente chamado.
    pub alvo: String,
    pub metodo: String,
    pub linha: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Desvio {
    pub linha: u32,
    /// O que está no `if (...)`, ou "<expressão> vazio" no `orElseThrow`. Sem condição: sempre.
    pub condicao: Option<String>,
    /// "lança RegraNegocioException", "return ResponseEntity.status(...)".
    pub acao: String,
    pub excecao: Option<String>,
    pub mensagem: Option<String>,
    pub status: Option<u16>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HttpSaida {
    pub verbo: String,
    /// Como ficou a URL depois de trocar os campos conhecidos (`{}` onde não deu).
    pub url: String,
    pub linha: u32,
    /// Endpoint do back que atende: id do componente e o método.
    pub alvo: Option<Chamada>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Gatilho {
    pub caminho: String,
    pub linha: u32,
    pub evento: String,
    /// Texto do botão/elemento ("Reservar").
    pub texto: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Lugar {
    pub caminho: String,
    pub relativo: String,
    pub linha: u32,
    pub detalhe: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Regra {
    /// Estável entre análises (tipo, classe, método e o texto da condição).
    pub chave: String,
    /// excecao, desvio, validacao, agendada, permissao.
    pub tipo: &'static str,
    pub componente: String,
    pub metodo: Option<String>,
    pub dominio: String,
    pub caminho: String,
    pub linha: u32,
    pub linha_fim: u32,
    pub condicao: Option<String>,
    pub mensagem: Option<String>,
    pub excecao: Option<String>,
    pub status: Option<u16>,
    /// Anotações de validação, a expressão do `@Scheduled`, a do `@PreAuthorize`...
    pub detalhe: String,
    pub aparece_em: Vec<Lugar>,
    pub teste: Option<Lugar>,
}

#[tauri::command]
pub async fn arquitetura_analisar(raiz: String) -> Result<Analise, String> {
    tauri::async_runtime::spawn_blocking(move || analisar(Path::new(&raiz)))
        .await
        .map_err(|e| e.to_string())
}

// ---------- leitura dos arquivos ----------

struct Fonte {
    caminho: String,
    relativo: String,
    texto: String,
    /// O mesmo texto com comentários e o miolo das strings trocados por espaços (mesmos bytes).
    mascara: String,
    inicios: Vec<usize>,
    teste: bool,
    ts: bool,
}

impl Fonte {
    fn nova(caminho: String, relativo: String, texto: String) -> Self {
        let mascara = mascarar(&texto);
        let mut inicios = vec![0];
        inicios.extend(texto.bytes().enumerate().filter(|(_, b)| *b == b'\n').map(|(i, _)| i + 1));
        let ts = relativo.ends_with(".ts");
        let nome = relativo.rsplit('/').next().unwrap_or("");
        let teste = relativo.contains("src/test/")
            || nome.ends_with(".spec.ts")
            || nome.ends_with("Test.java")
            || nome.ends_with("Tests.java")
            || nome.ends_with("IT.java");
        Self { caminho, relativo, texto, mascara, inicios, teste, ts }
    }

    fn linha(&self, pos: usize) -> u32 {
        self.inicios.partition_point(|&i| i <= pos) as u32
    }

    fn m(&self) -> &[u8] {
        self.mascara.as_bytes()
    }

    fn orig(&self, de: usize, ate: usize) -> &str {
        self.texto.get(de..ate).unwrap_or("")
    }
}

/// Troca comentários e o conteúdo das strings por espaços, mantendo as quebras de linha e as
/// aspas: as posições continuam valendo no texto original e chaves/parênteses dentro de
/// strings não atrapalham.
fn mascarar(texto: &str) -> String {
    let b = texto.as_bytes();
    let mut s = b.to_vec();
    let n = b.len();
    let mut i = 0;
    let apagar = |s: &mut Vec<u8>, i: usize| {
        if s[i] != b'\n' {
            s[i] = b' ';
        }
    };
    while i < n {
        match b[i] {
            b'/' if i + 1 < n && b[i + 1] == b'/' => {
                while i < n && b[i] != b'\n' {
                    s[i] = b' ';
                    i += 1;
                }
            }
            b'/' if i + 1 < n && b[i + 1] == b'*' => {
                s[i] = b' ';
                s[i + 1] = b' ';
                i += 2;
                while i < n && !(b[i] == b'*' && i + 1 < n && b[i + 1] == b'/') {
                    apagar(&mut s, i);
                    i += 1;
                }
                if i + 1 < n {
                    s[i] = b' ';
                    s[i + 1] = b' ';
                }
                i += 2;
            }
            q @ (b'"' | b'\'' | b'`') => {
                i += 1;
                while i < n && b[i] != q {
                    if b[i] == b'\\' {
                        s[i] = b' ';
                        i += 1;
                        if i < n {
                            apagar(&mut s, i);
                        }
                        i += 1;
                        continue;
                    }
                    if q != b'`' && b[i] == b'\n' {
                        break;
                    }
                    apagar(&mut s, i);
                    i += 1;
                }
                i += 1;
            }
            _ => i += 1,
        }
    }
    String::from_utf8(s).unwrap_or_else(|_| texto.to_string())
}

/// Posição do fechamento de `m[abre]` (`{`, `(` ou `[`).
fn fechar(m: &[u8], abre: usize) -> usize {
    let (a, f) = match m[abre] {
        b'{' => (b'{', b'}'),
        b'(' => (b'(', b')'),
        _ => (b'[', b']'),
    };
    let mut d = 0i32;
    for (i, &c) in m.iter().enumerate().skip(abre) {
        if c == a {
            d += 1;
        } else if c == f {
            d -= 1;
            if d == 0 {
                return i;
            }
        }
    }
    m.len().saturating_sub(1)
}

fn re(cache: &'static OnceLock<Regex>, padrao: &str) -> &'static Regex {
    cache.get_or_init(|| Regex::new(padrao).expect("regex"))
}

fn eh_ident(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'$'
}

fn juntar_espacos(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn primeira_string(s: &str) -> Option<String> {
    static R: OnceLock<Regex> = OnceLock::new();
    let r = re(&R, r#""((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`([^`]*)`"#);
    r.captures(s).and_then(|c| c.get(1).or(c.get(2)).or(c.get(3))).map(|m| m.as_str().to_string())
}

fn argumento(args: &str, nome: &str) -> Option<String> {
    let r = Regex::new(&format!(r#"\b{nome}\s*[=:]\s*(?:\{{\s*)?["']([^"']*)["']"#)).ok()?;
    r.captures(args).map(|c| c[1].to_string())
}

/// Nome simples de um tipo: `List<Reserva>` → `List`, `br.x.Reserva` → `Reserva`, `Reserva[]` → `Reserva`.
fn tipo_simples(t: &str) -> String {
    let t = t.trim().trim_start_matches("final ").trim();
    let base = t.split('<').next().unwrap_or(t).trim_end_matches("[]").trim_end_matches("...").trim();
    base.rsplit('.').next().unwrap_or(base).trim().to_string()
}

/// Tipos dentro dos genéricos: `Optional<Reserva>` → `[Reserva]`.
fn tipos_genericos(t: &str) -> Vec<String> {
    match (t.find('<'), t.rfind('>')) {
        (Some(a), Some(f)) if f > a => t[a + 1..f].split(',').map(tipo_simples).filter(|s| !s.is_empty()).collect(),
        _ => vec![],
    }
}

#[derive(Clone)]
struct Anotacao {
    nome: String,
    args: String,
}

/// Anotações/decorators entre `de` e `ate`.
fn anotacoes(f: &Fonte, de: usize, ate: usize) -> Vec<Anotacao> {
    let m = f.m();
    let mut lista = Vec::new();
    let mut i = de;
    while i < ate.min(m.len()) {
        if m[i] == b'@' {
            let ini = i + 1;
            let mut j = ini;
            while j < ate && (eh_ident(m[j]) || m[j] == b'.') {
                j += 1;
            }
            let nome = f.orig(ini, j).rsplit('.').next().unwrap_or("").to_string();
            let mut k = j;
            while k < ate && m[k].is_ascii_whitespace() {
                k += 1;
            }
            let mut args = String::new();
            if k < ate && m[k] == b'(' {
                let fim = fechar(m, k);
                args = f.orig(k + 1, fim).to_string();
                j = fim + 1;
            }
            if !nome.is_empty() && nome != "interface" {
                lista.push(Anotacao { nome, args });
            }
            i = j;
        } else {
            i += 1;
        }
    }
    lista
}

/// Fim do bloco de anotações no início de `de..ate` (onde começa o resto da declaração).
fn depois_das_anotacoes(f: &Fonte, de: usize, ate: usize) -> usize {
    let m = f.m();
    let mut i = de;
    loop {
        while i < ate && m[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= ate || m[i] != b'@' {
            return i;
        }
        i += 1;
        while i < ate && (eh_ident(m[i]) || m[i] == b'.') {
            i += 1;
        }
        let mut k = i;
        while k < ate && m[k].is_ascii_whitespace() {
            k += 1;
        }
        if k < ate && m[k] == b'(' {
            i = fechar(m, k) + 1;
        }
    }
}

// ---------- classes e membros ----------

struct Classe {
    nome: String,
    tipo: String,
    inicio: usize,
    nome_fim: usize,
    abre: usize,
    fecha: usize,
    anotacoes: Vec<Anotacao>,
    cabecalho: String,
}

fn classes(f: &Fonte) -> Vec<Classe> {
    static R: OnceLock<Regex> = OnceLock::new();
    let r = re(&R, r"\b(class|interface|enum|record)\s+([A-Za-z_$][\w$]*)");
    let m = f.m();
    let mut lista = Vec::new();
    for c in r.captures_iter(&f.mascara) {
        let todo = c.get(0).unwrap();
        if todo.start() > 0 && m[todo.start() - 1] == b'.' {
            continue;
        }
        // Corpo: a primeira chave fora de parênteses depois do nome.
        let mut i = todo.end();
        let mut paren = 0i32;
        let mut abre = None;
        while i < m.len() {
            match m[i] {
                b'(' => paren += 1,
                b')' => paren -= 1,
                b'{' if paren == 0 => {
                    abre = Some(i);
                    break;
                }
                b';' if paren == 0 => break,
                _ => {}
            }
            i += 1;
        }
        let Some(abre) = abre else { continue };
        // Anotações: para trás até o fim da declaração anterior (fora de parênteses).
        let mut ini = todo.start();
        let mut paren = 0i32;
        while ini > 0 {
            let c = m[ini - 1];
            if c == b')' {
                paren += 1;
            } else if c == b'(' {
                paren -= 1;
            } else if paren == 0 && (c == b';' || c == b'{' || c == b'}') {
                break;
            }
            ini -= 1;
        }
        lista.push(Classe {
            nome: c[2].to_string(),
            tipo: c[1].to_string(),
            inicio: todo.start(),
            nome_fim: todo.end(),
            abre,
            fecha: fechar(m, abre),
            anotacoes: anotacoes(f, ini, todo.start()),
            cabecalho: juntar_espacos(f.orig(todo.end(), abre)),
        });
    }
    lista
}

struct Campo {
    nome: String,
    tipo: String,
    /// Valor do `= ...` (texto original).
    valor: String,
    anotacoes: Vec<Anotacao>,
    linha: u32,
}

struct MetodoBruto {
    nome: String,
    nome_pos: usize,
    anotacoes: Vec<Anotacao>,
    params: Vec<(String, String)>,
    corpo: Option<(usize, usize)>,
}

const PALAVRAS: &[&str] = &[
    "if", "for", "while", "switch", "catch", "synchronized", "return", "new", "throw", "else", "try", "do", "super",
    "this", "function", "typeof", "await", "case", "assert", "yield", "instanceof", "in", "of",
];

const MODIFICADORES: &[&str] = &[
    "private", "public", "protected", "static", "final", "transient", "volatile", "readonly", "abstract", "override",
    "declare", "default", "synchronized", "native", "async",
];

fn tirar_modificadores(s: &str) -> &str {
    let mut s = s.trim();
    loop {
        let antes = s;
        for m in MODIFICADORES {
            if let Some(resto) = s.strip_prefix(m) {
                if resto.starts_with(|c: char| c.is_whitespace()) {
                    s = resto.trim_start();
                }
            }
        }
        if s == antes {
            return s;
        }
    }
}

/// Divide por vírgulas fora de `<>`, `()`, `{}` e `[]`.
fn dividir(s: &str) -> Vec<String> {
    let mut partes = Vec::new();
    let mut d = 0i32;
    let mut atual = String::new();
    for c in s.chars() {
        match c {
            '<' | '(' | '{' | '[' => d += 1,
            '>' | ')' | '}' | ']' => d -= 1,
            ',' if d == 0 => {
                partes.push(std::mem::take(&mut atual));
                continue;
            }
            _ => {}
        }
        atual.push(c);
    }
    if !atual.trim().is_empty() {
        partes.push(atual);
    }
    partes
}

fn sem_anotacoes(s: &str) -> String {
    static R: OnceLock<Regex> = OnceLock::new();
    let r = re(&R, r"@[\w.]+(\s*\([^()]*(\([^()]*\)[^()]*)*\))?");
    r.replace_all(s, " ").to_string()
}

/// (nome, tipo) de cada parâmetro.
fn parametros(texto: &str, ts: bool) -> Vec<(String, String)> {
    dividir(texto)
        .into_iter()
        .filter_map(|p| {
            let p = sem_anotacoes(&p);
            let p = tirar_modificadores(&p);
            if ts {
                let (nome, resto) = p.split_once(':').unwrap_or((p, ""));
                let tipo = resto.split('=').next().unwrap_or("").trim();
                let nome = nome.trim().trim_end_matches('?').trim_start_matches("...").to_string();
                (!nome.is_empty()).then(|| (nome, tipo.to_string()))
            } else {
                let p = p.trim();
                let fim = p.len();
                let ini = p.rfind(|c: char| !(c.is_alphanumeric() || c == '_' || c == '$')).map(|i| i + 1).unwrap_or(0);
                let nome = p[ini..fim].to_string();
                let tipo = p[..ini].trim().to_string();
                (!nome.is_empty() && !tipo.is_empty()).then_some((nome, tipo))
            }
        })
        .collect()
}

fn membros(f: &Fonte, c: &Classe) -> (Vec<Campo>, Vec<MetodoBruto>) {
    let m = f.m();
    let mut campos = Vec::new();
    let mut metodos = Vec::new();
    if c.tipo == "enum" {
        return (campos, metodos);
    }
    if c.tipo == "record" {
        // Os componentes do record são os campos (com as anotações de validação).
        if let Some(a) = (c.nome_fim..c.abre).find(|&i| m[i] == b'(') {
            let fecha = fechar(m, a);
            let mut ini = a + 1;
            let mut d = 0i32;
            for i in a + 1..=fecha {
                match m[i] {
                    b'(' | b'<' => d += 1,
                    b')' | b'>' if i < fecha => d -= 1,
                    b',' if d == 0 => {}
                    _ if i == fecha => {}
                    _ => continue,
                }
                if (m[i] == b',' && d == 0) || i == fecha {
                    let p = depois_das_anotacoes(f, ini, i);
                    if let Some((nome, tipo)) = parametros(&f.mascara[p..i], false).into_iter().next() {
                        campos.push(Campo { nome, tipo, valor: String::new(), anotacoes: anotacoes(f, ini, p), linha: f.linha(p) });
                    }
                    ini = i + 1;
                }
            }
        }
    }
    let mut i = c.abre + 1;
    let mut ini = i;
    let mut paren = 0i32;
    while i < c.fecha {
        match m[i] {
            b'(' => paren += 1,
            b')' => paren -= 1,
            b'{' if paren == 0 => {
                let fim = fechar(m, i);
                membro(f, ini, i, Some((i, fim)), &mut campos, &mut metodos);
                i = fim;
                ini = fim + 1;
            }
            b';' if paren == 0 => {
                membro(f, ini, i, None, &mut campos, &mut metodos);
                ini = i + 1;
            }
            _ => {}
        }
        i += 1;
    }
    (campos, metodos)
}

fn membro(f: &Fonte, ini: usize, fim: usize, corpo: Option<(usize, usize)>, campos: &mut Vec<Campo>, metodos: &mut Vec<MetodoBruto>) {
    let m = f.m();
    let p = depois_das_anotacoes(f, ini, fim);
    if p >= fim {
        return;
    }
    let resto = &f.mascara[p..fim];
    let palavras: Vec<&str> = resto.split(|c: char| !(c.is_alphanumeric() || c == '_')).collect();
    if palavras.iter().any(|w| ["class", "interface", "enum", "record"].contains(w)) {
        return;
    }
    let anots = anotacoes(f, ini, p);
    let parentese = resto.find('(');
    let igual = resto.find('=');
    let seta = resto.contains("=>") || resto.contains("->");
    let eh_metodo = match (parentese, igual) {
        (Some(a), Some(b)) => a < b && !seta,
        (Some(_), None) => true,
        _ => false,
    };
    if eh_metodo {
        let a = p + parentese.unwrap();
        let antes = f.mascara[p..a].trim_end();
        let nome_ini = antes.rfind(|c: char| !(c.is_alphanumeric() || c == '_' || c == '$')).map(|i| i + 1).unwrap_or(0);
        let nome = &antes[nome_ini..];
        if nome.is_empty() || PALAVRAS.contains(&nome) || nome.chars().next().is_some_and(|c| c.is_ascii_digit()) {
            return;
        }
        let fecha = fechar(m, a);
        metodos.push(MetodoBruto {
            nome: nome.to_string(),
            nome_pos: p + nome_ini,
            anotacoes: anots,
            params: parametros(f.orig(a + 1, fecha), f.ts),
            corpo,
        });
        return;
    }
    // Campo. Um campo com objeto literal (`x = { ... };`) chega aqui duas vezes; a segunda vazia.
    let decl_fim = igual.map(|i| p + i).unwrap_or(fim);
    let decl = f.mascara[p..decl_fim].trim();
    let valor = igual.map(|i| f.orig(p + i + 1, corpo.map(|(_, b)| b + 1).unwrap_or(fim)).trim().to_string()).unwrap_or_default();
    let decl = tirar_modificadores(decl);
    let (nome, mut tipo) = if f.ts {
        let (n, t) = decl.split_once(':').unwrap_or((decl, ""));
        (n.trim().trim_end_matches(['?', '!']).to_string(), t.trim().to_string())
    } else {
        let ini = decl.rfind(|c: char| !(c.is_alphanumeric() || c == '_' || c == '$')).map(|i| i + 1).unwrap_or(0);
        (decl[ini..].to_string(), decl[..ini].trim().to_string())
    };
    if nome.is_empty() || !nome.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '$') {
        return;
    }
    if f.ts && tipo.is_empty() {
        static INJETAR: OnceLock<Regex> = OnceLock::new();
        if let Some(c) = re(&INJETAR, r"^inject\s*(?:<[^>]*>)?\s*\(\s*([\w$]+)").captures(&valor) {
            tipo = c[1].to_string();
        }
    }
    campos.push(Campo { nome, tipo, valor, anotacoes: anots, linha: f.linha(p) });
}

// ---------- corpo dos métodos ----------

struct ChamadaBruta {
    receptor: Option<String>,
    metodo: String,
    pos: usize,
}

fn chamadas_brutas(f: &Fonte, de: usize, ate: usize) -> Vec<ChamadaBruta> {
    static PONTO: OnceLock<Regex> = OnceLock::new();
    static SOLTA: OnceLock<Regex> = OnceLock::new();
    let ponto = re(&PONTO, r"(?:\bthis\s*\.\s*)?\b([A-Za-z_$][\w$]*)\s*\??\.\s*([A-Za-z_$][\w$]*)\s*(?:<[^<>()=;]*>\s*)?\(");
    let solta = re(&SOLTA, r"\b([a-z_$][\w$]*)\s*\(");
    let m = f.m();
    let trecho = &f.mascara[de..ate];
    let mut lista = Vec::new();
    for c in ponto.captures_iter(trecho) {
        let todo = c.get(0).unwrap();
        let ini = de + todo.start();
        if !todo.as_str().starts_with("this") && ini > 0 && m[ini - 1] == b'.' {
            continue;
        }
        let receptor = c[1].to_string();
        if receptor == "this" || receptor == "super" {
            lista.push(ChamadaBruta { receptor: None, metodo: c[2].to_string(), pos: ini });
        } else {
            lista.push(ChamadaBruta { receptor: Some(receptor), metodo: c[2].to_string(), pos: ini });
        }
    }
    for c in solta.captures_iter(trecho) {
        let g = c.get(1).unwrap();
        let ini = de + g.start();
        let mut k = ini;
        while k > 0 && m[k - 1].is_ascii_whitespace() {
            k -= 1;
        }
        if k > 0 && m[k - 1] == b'.' {
            continue;
        }
        // Palavra antes: `new X(`/`function x(` não são chamadas; `void x(` é declaração.
        let mut w = k;
        while w > 0 && eh_ident(m[w - 1]) {
            w -= 1;
        }
        let anterior = &f.mascara[w..k];
        if anterior == "new" || anterior == "function" || (!anterior.is_empty() && !PALAVRAS.contains(&anterior)) {
            continue;
        }
        let nome = g.as_str();
        if PALAVRAS.contains(&nome) {
            continue;
        }
        lista.push(ChamadaBruta { receptor: None, metodo: nome.to_string(), pos: ini });
    }
    lista.sort_by_key(|c| c.pos);
    lista
}

/// Variáveis locais `Tipo nome =` / `const nome: Tipo` dentro do corpo.
fn locais(f: &Fonte, de: usize, ate: usize) -> HashMap<String, String> {
    static JAVA: OnceLock<Regex> = OnceLock::new();
    static TS: OnceLock<Regex> = OnceLock::new();
    let trecho = &f.mascara[de..ate];
    let mut mapa = HashMap::new();
    if f.ts {
        for c in re(&TS, r"\b(?:const|let|var)\s+([\w$]+)\s*:\s*([\w$.<>\[\]]+)").captures_iter(trecho) {
            mapa.insert(c[1].to_string(), tipo_simples(&c[2]));
        }
    } else {
        for c in re(&JAVA, r"\b([A-Z][\w$]*(?:<[^;=(){}]*>)?)\s+([a-z_$][\w$]*)\s*[=:;]").captures_iter(trecho) {
            mapa.insert(c[2].to_string(), tipo_simples(&c[1]));
        }
    }
    mapa
}

/// Condição do `if` que controla a posição `pos` (o throw/return logo dentro dele).
fn condicao_de(f: &Fonte, de: usize, pos: usize) -> Option<(String, usize)> {
    static IF: OnceLock<Regex> = OnceLock::new();
    let r = re(&IF, r"\bif\s*\(");
    let m = f.m();
    let mut melhor = None;
    for c in r.find_iter(&f.mascara[de..pos]) {
        let abre = de + c.end() - 1;
        let fecha = fechar(m, abre);
        if fecha >= pos {
            continue;
        }
        let mut k = fecha + 1;
        while k < pos && m[k].is_ascii_whitespace() {
            k += 1;
        }
        let dentro = if m[k] == b'{' {
            fechar(m, k) > pos
        } else {
            // Sem chaves: a posição tem de ser o próprio comando do if.
            k == pos
        };
        if dentro {
            melhor = Some((juntar_espacos(f.orig(abre + 1, fecha)), de + c.start()));
        }
    }
    melhor
}

fn status_de(texto: &str) -> Option<u16> {
    static NOME: OnceLock<Regex> = OnceLock::new();
    static NUM: OnceLock<Regex> = OnceLock::new();
    if let Some(c) = re(&NOME, r"(?:HttpStatus|Status|HttpServletResponse)\s*\.\s*(?:SC_)?([A-Z_]+)").captures(texto) {
        let codigo = match &c[1] {
            "OK" => 200,
            "CREATED" => 201,
            "ACCEPTED" => 202,
            "NO_CONTENT" => 204,
            "BAD_REQUEST" => 400,
            "UNAUTHORIZED" => 401,
            "PAYMENT_REQUIRED" => 402,
            "FORBIDDEN" => 403,
            "NOT_FOUND" => 404,
            "METHOD_NOT_ALLOWED" => 405,
            "CONFLICT" => 409,
            "GONE" => 410,
            "PRECONDITION_FAILED" => 412,
            "UNPROCESSABLE_ENTITY" | "UNPROCESSABLE_CONTENT" => 422,
            "TOO_MANY_REQUESTS" => 429,
            "INTERNAL_SERVER_ERROR" => 500,
            "SERVICE_UNAVAILABLE" => 503,
            _ => 0,
        };
        if codigo > 0 {
            return Some(codigo);
        }
    }
    let curto = [
        ("badRequest", 400),
        ("notFound", 404),
        ("forbidden", 403),
        ("unprocessableEntity", 422),
        ("noContent", 204),
        ("created", 201),
    ];
    for (nome, codigo) in curto {
        if texto.contains(&format!(".{nome}(")) {
            return Some(codigo);
        }
    }
    re(&NUM, r"\b(?:status|valueOf|sendError|setStatus)\s*\(\s*([1-5]\d\d)\b").captures(texto).and_then(|c| c[1].parse().ok())
}

fn desvios(f: &Fonte, de: usize, ate: usize) -> Vec<Desvio> {
    static THROW: OnceLock<Regex> = OnceLock::new();
    static OU: OnceLock<Regex> = OnceLock::new();
    static RETURN: OnceLock<Regex> = OnceLock::new();
    let m = f.m();
    let mut lista = Vec::new();
    for c in re(&THROW, r"\bthrow\s+new\s+([A-Za-z_$][\w$.]*)\s*(?:<[^>]*>\s*)?\(").captures_iter(&f.mascara[de..ate]) {
        let pos = de + c.get(0).unwrap().start();
        let abre = de + c.get(0).unwrap().end() - 1;
        let args = f.orig(abre + 1, fechar(m, abre));
        let excecao = tipo_simples(&c[1]);
        let condicao = condicao_de(f, de, pos).map(|(c, _)| c);
        lista.push(Desvio {
            linha: f.linha(pos),
            condicao,
            acao: format!("lança {excecao}"),
            mensagem: primeira_string(args),
            status: status_de(args),
            excecao: Some(excecao),
        });
    }
    let ou = re(&OU, r"\.\s*orElseThrow\s*\(\s*(?:\(\s*\)\s*->\s*new\s+([\w$.]+)|([\w$.]+)\s*::\s*new|\))");
    for c in ou.captures_iter(&f.mascara[de..ate]) {
        let pos = de + c.get(0).unwrap().start();
        // Começo do comando: depois do último ; { } antes.
        let mut ini = pos;
        while ini > de && !matches!(m[ini - 1], b';' | b'{' | b'}') {
            ini -= 1;
        }
        let mut expr = juntar_espacos(f.orig(ini, pos));
        if let Some((_, depois)) = expr.split_once(" = ") {
            expr = depois.trim().to_string();
        }
        if let Some(r) = expr.strip_prefix("return ") {
            expr = r.to_string();
        }
        let excecao = c.get(1).or(c.get(2)).map(|g| tipo_simples(g.as_str())).unwrap_or_else(|| "NoSuchElementException".into());
        let fim = fechar(m, de + c.get(0).unwrap().start() + c.get(0).unwrap().as_str().find('(').unwrap());
        let args = f.orig(pos, fim);
        lista.push(Desvio {
            linha: f.linha(pos),
            condicao: Some(format!("{expr} vazio")),
            acao: format!("lança {excecao}"),
            mensagem: primeira_string(args),
            status: status_de(args),
            excecao: Some(excecao),
        });
    }
    // if (...) return <algo com status>: a resposta muda de rumo.
    for c in re(&RETURN, r"\breturn\b").find_iter(&f.mascara[de..ate]) {
        let pos = de + c.start();
        let mut fim = pos;
        while fim < ate && m[fim] != b';' {
            fim += 1;
        }
        let expr = juntar_espacos(f.orig(pos + 6, fim));
        let Some(status) = status_de(&expr) else { continue };
        if status < 300 {
            continue;
        }
        let Some((condicao, _)) = condicao_de(f, de, pos) else { continue };
        let curta: String = expr.chars().take(70).collect();
        lista.push(Desvio { linha: f.linha(pos), condicao: Some(condicao), acao: format!("return {curta}"), excecao: None, mensagem: primeira_string(&expr), status: Some(status) });
    }
    lista.sort_by_key(|d| d.linha);
    lista
}

/// Chamadas do HttpClient no corpo: (verbo, expressão da URL, posição).
fn http_do_front(f: &Fonte, de: usize, ate: usize) -> Vec<(String, String, usize)> {
    static R: OnceLock<Regex> = OnceLock::new();
    let r = re(&R, r"(?:\bthis\s*\.\s*)?\b[\w$]*[hH]ttp[\w$]*\s*\.\s*(get|post|put|delete|patch|head|request)\s*(?:<[^()]*?>)?\s*\(");
    let m = f.m();
    r.captures_iter(&f.mascara[de..ate])
        .map(|c| {
            let abre = de + c.get(0).unwrap().end() - 1;
            let fecha = fechar(m, abre);
            let args = dividir(f.orig(abre + 1, fecha));
            let mut verbo = c[1].to_uppercase();
            let mut url = args.first().cloned().unwrap_or_default();
            if verbo == "REQUEST" {
                verbo = primeira_string(&url).unwrap_or_default().to_uppercase();
                url = args.get(1).cloned().unwrap_or_default();
            }
            (verbo, url.trim().to_string(), de + c.get(0).unwrap().start())
        })
        .collect()
}

/// Monta a URL do front trocando os campos de texto da classe pelo valor e o resto por `{}`.
fn montar_url(expr: &str, campos: &HashMap<String, String>, fundo: u8) -> String {
    let expr = expr.trim();
    let valor_de = |nome: &str| -> String {
        let nome = nome.trim().trim_start_matches("this.").trim();
        match campos.get(nome) {
            Some(v) if fundo < 3 => montar_url(v, campos, fundo + 1),
            _ => "{}".into(),
        }
    };
    dividir_soma(expr)
        .into_iter()
        .map(|parte| {
            let p = parte.trim();
            if (p.starts_with('\'') && p.ends_with('\'')) || (p.starts_with('"') && p.ends_with('"')) {
                p[1..p.len() - 1].to_string()
            } else if p.starts_with('`') && p.ends_with('`') && p.len() >= 2 {
                let miolo = &p[1..p.len() - 1];
                let mut saida = String::new();
                let mut resto = miolo;
                while let Some(i) = resto.find("${") {
                    saida.push_str(&resto[..i]);
                    let fim = resto[i..].find('}').map(|j| i + j).unwrap_or(resto.len() - 1);
                    saida.push_str(&valor_de(&resto[i + 2..fim]));
                    resto = &resto[(fim + 1).min(resto.len())..];
                }
                saida.push_str(resto);
                saida
            } else {
                valor_de(p)
            }
        })
        .collect()
}

fn dividir_soma(s: &str) -> Vec<String> {
    let mut partes = Vec::new();
    let mut atual = String::new();
    let mut d = 0i32;
    let mut aspas: Option<char> = None;
    for c in s.chars() {
        if let Some(q) = aspas {
            atual.push(c);
            if c == q {
                aspas = None;
            }
            continue;
        }
        match c {
            '\'' | '"' | '`' => aspas = Some(c),
            '(' | '[' | '{' => d += 1,
            ')' | ']' | '}' => d -= 1,
            '+' if d == 0 => {
                partes.push(std::mem::take(&mut atual));
                continue;
            }
            _ => {}
        }
        atual.push(c);
    }
    partes.push(atual);
    partes
}

/// Trechos de uma rota: `/reservas/{id}` → `[reservas, *]`. URL absoluta de fora: None no host.
fn trechos(rota: &str) -> (Option<String>, Vec<String>) {
    let mut r = rota.trim();
    let mut host = None;
    if let Some(i) = r.find("://") {
        let depois = &r[i + 3..];
        let fim = depois.find('/').unwrap_or(depois.len());
        let h = &depois[..fim];
        if !h.starts_with("localhost") && !h.starts_with("127.0.0.1") && !h.contains("{}") {
            host = Some(h.to_string());
        }
        r = &depois[fim..];
    }
    let r = r.split(['?', '#']).next().unwrap_or("");
    let lista = r
        .split('/')
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(|t| if t.contains('{') || t.starts_with(':') || t == "*" { "*".to_string() } else { t.to_lowercase() })
        .collect::<Vec<_>>();
    // O `{}` do começo é a base da API (environment.api): fica de fora.
    let lista = lista.into_iter().skip_while(|t| t == "*").collect();
    (host, lista)
}

fn juntar_rota(base: &str, rota: &str) -> String {
    let b = base.trim().trim_end_matches('/');
    let r = rota.trim().trim_start_matches('/');
    let mut s = if r.is_empty() { b.to_string() } else { format!("{b}/{r}") };
    if !s.starts_with('/') {
        s.insert(0, '/');
    }
    s
}

/// Quanto as rotas casam pelo fim (com `*` casando com qualquer trecho). 0 = não casam.
fn casamento(front: &[String], back: &[String]) -> usize {
    let n = front.len().min(back.len());
    if n == 0 {
        return 0;
    }
    let iguais = front.iter().rev().zip(back.iter().rev()).all(|(a, b)| a == b || a == "*" || b == "*");
    let fixo = front.iter().rev().zip(back.iter().rev()).any(|(a, b)| a == b && a != "*");
    if !iguais || !fixo {
        return 0;
    }
    // Preferir o de mesmo tamanho (sem trechos de sobra).
    n * 10 + 9usize.saturating_sub(front.len().abs_diff(back.len()))
}

// ---------- montagem ----------

struct Bruto {
    comp: Componente,
    fonte: usize,
    classe_abre: usize,
    classe_fecha: usize,
    campos: Vec<Campo>,
    metodos: Vec<MetodoBruto>,
    anots: Vec<Anotacao>,
    cabecalho: String,
}

const CLIENTES_HTTP: &[&str] = &["RestTemplate", "WebClient", "RestClient", "HttpClient", "OkHttpClient", "Client"];

fn papel(c: &Classe, f: &Fonte, anots: &HashSet<&str>, metodos: &[MetodoBruto]) -> &'static str {
    let nome = c.nome.as_str();
    if f.teste {
        return "teste";
    }
    if f.ts {
        if anots.contains("Component") {
            return "tela";
        }
        if anots.contains("Injectable") || nome.ends_with("Service") || nome.ends_with("Api") {
            return "front";
        }
        return "outro";
    }
    let tem = |a: &str| anots.contains(a);
    let cab = c.cabecalho.as_str();
    if tem("ControllerAdvice") || tem("RestControllerAdvice") || cab.contains("ExceptionMapper") || tem("Provider") && cab.contains("Mapper") {
        return "tratador";
    }
    if tem("RestController") || tem("Controller") || tem("WebServlet") || cab.contains("HttpServlet") || (tem("Path") && !tem("ApplicationPath")) {
        return "entrada";
    }
    if tem("Entity") || tem("Embeddable") || tem("Document") || tem("Table") {
        return "entidade";
    }
    if tem("Repository") || tem("FeignClient") || nome.ends_with("Repository") || nome.ends_with("Dao") || nome.ends_with("DAO") || cab.contains("Repository<") {
        return "repositorio";
    }
    if nome.ends_with("Exception") || cab.contains("Exception") && cab.contains("extends") {
        return "excecao";
    }
    let agenda = metodos.iter().any(|m| m.anotacoes.iter().any(|a| matches!(a.nome.as_str(), "Scheduled" | "Schedule" | "KafkaListener" | "JmsListener" | "RabbitListener" | "EventListener")));
    if tem("MessageDriven") || (agenda && !tem("Service") && !tem("Stateless") && !tem("Stateful")) || nome.ends_with("Job") || nome.ends_with("Listener") || nome.ends_with("Consumer") {
        return "job";
    }
    if tem("Configuration") || tem("SpringBootApplication") || tem("ApplicationPath") || nome.ends_with("Config") || nome.ends_with("Configuration") {
        return "outro";
    }
    if tem("Service") || tem("Stateless") || tem("Stateful") || tem("Singleton") || tem("ApplicationScoped") || tem("RequestScoped") || tem("Component") || tem("Named")
        || ["Service", "ServiceImpl", "UseCase", "Facade", "Manager", "Bean", "Client", "Gateway"].iter().any(|s| nome.ends_with(s))
    {
        return if nome.ends_with("Client") || nome.ends_with("Gateway") { "repositorio" } else { "servico" };
    }
    "outro"
}

/// Palavras de camada que não dizem o domínio (pacotes e pastas).
const PALAVRAS_DE_CAMADA: &[&str] = &[
    "controller", "controllers", "controle", "service", "services", "servico", "servicos", "repository", "repositories",
    "repositorio", "repositorios", "dao", "daos", "model", "models", "modelo", "modelos", "domain", "dominio", "entity",
    "entities", "entidade", "entidades", "dto", "dtos", "web", "rest", "api", "apis", "resource", "resources", "impl",
    "config", "configuration", "application", "app", "infra", "infrastructure", "adapter", "adapters", "core", "job",
    "jobs", "scheduler", "schedulers", "exception", "exceptions", "excecao", "excecoes", "handler", "handlers",
    "persistence", "persistencia", "mapper", "mappers", "jpa", "ejb", "bean", "beans", "servlet", "servlets",
    "endpoint", "endpoints", "negocio", "util", "utils", "common", "shared", "pages", "paginas", "components",
    "componentes", "features", "modules", "telas", "views", "client", "clients", "integration", "integracao",
    "security", "seguranca", "src", "main", "java", "ts", "environments", "http", "usecase", "usecases", "facade",
    "gateway", "gateways", "listener", "listeners", "data", "store", "state", "interceptors", "guards", "pipes",
];

const SUFIXOS: &[&str] = &[
    "ServiceImpl", "Controller", "Resource", "Service", "Repository", "Component", "Endpoint", "Servlet", "Exception",
    "Handler", "Webhook", "UseCase", "Facade", "Client", "Gateway", "Listener", "Consumer", "Mapper", "Api", "Dao",
    "DAO", "Job", "Impl", "Request", "Response", "Dto", "DTO", "Form", "Page", "Entity",
];

fn primeira_palavra(nome: &str) -> String {
    let mut base = nome;
    for s in SUFIXOS {
        if let Some(b) = base.strip_suffix(s) {
            if !b.is_empty() {
                base = b;
                break;
            }
        }
    }
    let mut palavra = String::new();
    for (i, c) in base.char_indices() {
        if i > 0 && (c.is_uppercase() || c == '-' || c == '_') {
            break;
        }
        palavra.push(c);
    }
    palavra.to_lowercase()
}

fn dominio_do_pacote(pacote: &str, comum: usize) -> Option<String> {
    pacote
        .split('.')
        .skip(comum)
        .find(|t| !PALAVRAS_DE_CAMADA.contains(&t.to_lowercase().as_str()))
        .map(|t| t.to_lowercase())
}

fn dominio_da_pasta(relativo: &str) -> Option<String> {
    let depois = relativo.split_once("/app/").map(|(_, d)| d).or_else(|| relativo.split_once("src/").map(|(_, d)| d))?;
    let pastas: Vec<&str> = depois.split('/').collect();
    pastas[..pastas.len().saturating_sub(1)]
        .iter()
        .find(|t| !PALAVRAS_DE_CAMADA.contains(&t.to_lowercase().as_str()))
        .map(|t| primeira_palavra(t))
}

fn tecnologias(fontes: &[(String, String)]) -> Vec<String> {
    static BOOT: OnceLock<Regex> = OnceLock::new();
    static GRADLE: OnceLock<Regex> = OnceLock::new();
    static JAKARTA: OnceLock<Regex> = OnceLock::new();
    static NG: OnceLock<Regex> = OnceLock::new();
    let mut lista = Vec::new();
    let mut ja = |s: String| {
        if !lista.contains(&s) {
            lista.push(s);
        }
    };
    for (rel, texto) in fontes {
        let nome = rel.rsplit('/').next().unwrap_or("");
        if nome == "pom.xml" || nome.starts_with("build.gradle") {
            let boot = re(&BOOT, r"spring-boot-starter-parent</artifactId>\s*<version>(\d+(?:\.\d+)?)")
                .captures(texto)
                .or_else(|| re(&GRADLE, r#"org\.springframework\.boot['"]?\)?\s*version\s*['"](\d+(?:\.\d+)?)"#).captures(texto));
            if let Some(c) = boot {
                ja(format!("Spring Boot {}", &c[1]));
            } else if texto.contains("spring-boot") || texto.contains("org.springframework.boot") {
                ja("Spring Boot".into());
            }
            if let Some(c) = re(&JAKARTA, r"(jakarta\.jakartaee[\w-]*-api|javaee[\w-]*-api)</artifactId>\s*<version>(\d+)").captures(texto) {
                ja(format!("{} {}", if c[1].starts_with("jakarta") { "Jakarta EE" } else { "Java EE" }, &c[2]));
            } else if texto.contains("jakartaee") {
                ja("Jakarta EE".into());
            } else if texto.contains("javaee-api") || texto.contains("javaee-web-api") {
                ja("Java EE".into());
            }
        } else if nome == "package.json" {
            if let Some(c) = re(&NG, r#""@angular/core"\s*:\s*"[\^~>=\s]*(\d+)"#).captures(texto) {
                ja(format!("Angular {}", &c[1]));
            }
        }
    }
    lista
}

fn fnv(s: &str) -> String {
    let mut h: u32 = 0x811c9dc5;
    for b in s.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(0x01000193);
    }
    format!("{h:08x}")
}

fn analisar(raiz: &Path) -> Analise {
    let mut fontes: Vec<Fonte> = Vec::new();
    let mut extras: Vec<(String, String)> = Vec::new();
    let mut htmls: HashMap<String, (String, String)> = HashMap::new();
    for entrada in percorrer(raiz, None) {
        if fontes.len() >= LIMITE_ARQUIVOS {
            break;
        }
        let caminho = entrada.path();
        let rel = relativo(raiz, caminho);
        if rel.contains(".angular/") || rel.contains("/generated") {
            continue;
        }
        let nome = rel.rsplit('/').next().unwrap_or("").to_string();
        let ext = caminho.extension().and_then(|e| e.to_str()).unwrap_or("");
        let interessa = matches!(ext, "java" | "ts" | "html") || nome == "pom.xml" || nome.starts_with("build.gradle") || nome == "package.json";
        if !interessa || nome.ends_with(".d.ts") || entrada.metadata().map(|m| m.len() > TAMANHO_MAXIMO).unwrap_or(true) {
            continue;
        }
        let Ok(texto) = fs::read_to_string(caminho) else { continue };
        let absoluto = caminho.to_string_lossy().into_owned();
        match ext {
            "java" | "ts" => fontes.push(Fonte::nova(absoluto, rel, texto)),
            "html" => {
                htmls.insert(rel.clone(), (absoluto, texto));
            }
            _ => extras.push((rel, texto)),
        }
    }
    let mut analise = montar(fontes, &htmls);
    analise.tecnologias = tecnologias(&extras);
    analise
}

fn montar(fontes: Vec<Fonte>, htmls: &HashMap<String, (String, String)>) -> Analise {
    static PACOTE: OnceLock<Regex> = OnceLock::new();
    let mut brutos: Vec<Bruto> = Vec::new();
    for (fi, f) in fontes.iter().enumerate() {
        let pacote = if f.ts {
            f.relativo.rsplit_once('/').map(|(p, _)| p.to_string()).unwrap_or_default()
        } else {
            re(&PACOTE, r"(?m)^\s*package\s+([\w.]+)\s*;").captures(&f.mascara).map(|c| c[1].to_string()).unwrap_or_default()
        };
        for c in classes(f) {
            let (campos, metodos) = membros(f, &c);
            let nomes: HashSet<&str> = c.anotacoes.iter().map(|a| a.nome.as_str()).collect();
            let p = papel(&c, f, &nomes, &metodos);
            let estende = {
                static EXT: OnceLock<Regex> = OnceLock::new();
                re(&EXT, r"\bextends\s+([\w$.]+(?:<[^{]*?>)?)").captures(&c.cabecalho).map(|x| x[1].to_string())
            };
            let implementa: Vec<String> = c
                .cabecalho
                .split_once("implements")
                .map(|(_, r)| dividir(r).iter().map(|t| tipo_simples(t)).filter(|t| !t.is_empty()).collect())
                .unwrap_or_default();
            let mut comp = Componente {
                id: c.nome.clone(),
                nome: c.nome.clone(),
                caminho: f.caminho.clone(),
                relativo: f.relativo.clone(),
                linha: f.linha(c.inicio),
                pacote: pacote.clone(),
                linguagem: if f.ts { "ts" } else { "java" },
                papel: p,
                anotacoes: c.anotacoes.iter().map(|a| a.nome.clone()).collect(),
                implementa,
                ..Default::default()
            };
            // Interfaces como `ReservaRepository extends JpaRepository<Reserva, Long>`.
            if let Some(e) = &estende {
                comp.estende = Some(tipo_simples(e));
                if p == "repositorio" {
                    comp.entidade = tipos_genericos(e).into_iter().next();
                }
            }
            if p == "repositorio" && comp.entidade.is_none() {
                for t in c.cabecalho.split("implements").nth(1).map(dividir).unwrap_or_default() {
                    if t.contains("Repository<") {
                        comp.entidade = tipos_genericos(&t).into_iter().next();
                    }
                }
            }
            for a in &c.anotacoes {
                match a.nome.as_str() {
                    "RequestMapping" | "Path" => comp.rota = argumento(&a.args, "value").or_else(|| argumento(&a.args, "path")).or_else(|| primeira_string(&a.args)),
                    "WebServlet" => comp.rota = argumento(&a.args, "urlPatterns").or_else(|| argumento(&a.args, "value")).or_else(|| primeira_string(&a.args)),
                    "Table" => comp.tabela = argumento(&a.args, "name").or_else(|| primeira_string(&a.args)),
                    "Entity" if comp.tabela.is_none() => comp.tabela = argumento(&a.args, "name"),
                    "FeignClient" => comp.externo = argumento(&a.args, "name").or_else(|| argumento(&a.args, "value")).or_else(|| primeira_string(&a.args)),
                    "Component" if f.ts => {
                        comp.seletor = argumento(&a.args, "selector");
                        comp.template = argumento(&a.args, "templateUrl");
                    }
                    _ => {}
                }
            }
            if p == "entidade" && comp.tabela.is_none() {
                comp.tabela = Some(snake(&c.nome));
            }
            brutos.push(Bruto { comp, fonte: fi, classe_abre: c.abre, classe_fecha: c.fecha, campos, metodos, anots: c.anotacoes, cabecalho: c.cabecalho });
        }
    }

    // Ids únicos: o nome simples, ou o pacote/pasta quando dois têm o mesmo nome.
    let mut contagem: HashMap<String, usize> = HashMap::new();
    for b in &brutos {
        *contagem.entry(b.comp.nome.clone()).or_default() += 1;
    }
    for b in &mut brutos {
        if contagem[&b.comp.nome] > 1 {
            b.comp.id = format!("{}#{}", b.comp.relativo, b.comp.nome);
        }
    }
    let mut por_nome: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, b) in brutos.iter().enumerate() {
        por_nome.entry(b.comp.nome.clone()).or_default().push(i);
    }
    // Interface → implementação (ReservaService → ReservaServiceImpl).
    let mut impl_de: HashMap<String, usize> = HashMap::new();
    for (i, b) in brutos.iter().enumerate() {
        if b.comp.papel != "teste" {
            for t in &b.comp.implementa {
                impl_de.entry(t.clone()).or_insert(i);
            }
        }
    }
    let resolver = |tipo: &str, ts: bool| -> Option<usize> {
        let nome = tipo_simples(tipo);
        let lista = por_nome.get(&nome)?;
        let escolhido = lista
            .iter()
            .copied()
            .find(|&i| (brutos[i].comp.linguagem == "ts") == ts && brutos[i].comp.papel != "teste")
            .or_else(|| lista.first().copied())?;
        Some(escolhido)
    };
    let alvo_de = |tipo: &str, ts: bool| -> Option<usize> {
        let i = resolver(tipo, ts)?;
        // Uma interface de serviço: quem atende é a implementação.
        if brutos[i].metodos.iter().all(|m| m.corpo.is_none()) && brutos[i].comp.papel != "repositorio" {
            if let Some(&j) = impl_de.get(&brutos[i].comp.nome) {
                return Some(j);
            }
        }
        Some(i)
    };

    // Exceção → status HTTP (anotação na exceção, @ExceptionHandler, ExceptionMapper).
    let mut status_excecao: HashMap<String, (u16, Lugar)> = HashMap::new();
    for b in &brutos {
        let f = &fontes[b.fonte];
        for a in &b.anots {
            if a.nome == "ResponseStatus" {
                if let Some(s) = status_de(&a.args) {
                    status_excecao.insert(b.comp.nome.clone(), (s, lugar(f, b.comp.linha, &format!("@ResponseStatus → {s}"))));
                }
            }
        }
        if b.comp.papel != "tratador" {
            continue;
        }
        for m in &b.metodos {
            let Some((abre, fecha)) = m.corpo else { continue };
            let corpo = f.orig(abre, fecha);
            let mut excecoes: Vec<String> = vec![];
            for a in &m.anotacoes {
                if a.nome == "ExceptionHandler" {
                    static CL: OnceLock<Regex> = OnceLock::new();
                    excecoes.extend(re(&CL, r"([\w$]+)\s*\.\s*class").captures_iter(&a.args).map(|c| c[1].to_string()));
                }
            }
            if excecoes.is_empty() && (m.anotacoes.iter().any(|a| a.nome == "ExceptionHandler") || m.nome == "toResponse") {
                excecoes.extend(m.params.iter().map(|(_, t)| tipo_simples(t)).filter(|t| t.ends_with("Exception")));
            }
            if m.nome == "toResponse" {
                static MAPPER: OnceLock<Regex> = OnceLock::new();
                if let Some(c) = re(&MAPPER, r"ExceptionMapper\s*<\s*([\w$.]+)").captures(&b.cabecalho) {
                    excecoes.push(tipo_simples(&c[1]));
                }
            }
            let status = m.anotacoes.iter().find(|a| a.nome == "ResponseStatus").and_then(|a| status_de(&a.args)).or_else(|| status_de(corpo));
            if let Some(s) = status {
                for e in excecoes {
                    status_excecao.insert(e, (s, lugar(f, f.linha(m.nome_pos), &format!("{}.{} → {s}", b.comp.nome, m.nome))));
                }
            }
        }
    }
    let estende_de: HashMap<String, String> = brutos.iter().filter_map(|b| b.comp.estende.clone().map(|e| (b.comp.nome.clone(), e))).collect();
    let status_da = |excecao: &str| -> Option<(u16, Lugar)> {
        let mut atual = excecao.to_string();
        for _ in 0..6 {
            if let Some(s) = status_excecao.get(&atual) {
                return Some(s.clone());
            }
            atual = estende_de.get(&atual)?.clone();
        }
        None
    };

    // Endpoints do back: (componente, método, verbo, trechos da rota).
    let mut endpoints: Vec<(usize, String, String, Vec<String>)> = Vec::new();
    let mut detalhes: Vec<Vec<Metodo>> = Vec::new();
    for (bi, b) in brutos.iter().enumerate() {
        let f = &fontes[b.fonte];
        let base = b.comp.rota.clone().unwrap_or_default();
        let mut lista = Vec::new();
        for m in &b.metodos {
            let mut met = Metodo {
                nome: m.nome.clone(),
                linha: f.linha(m.nome_pos),
                linha_fim: m.corpo.map(|(_, fim)| f.linha(fim)).unwrap_or(f.linha(m.nome_pos)),
                params: m.params.iter().map(|(n, _)| n.clone()).collect(),
                anotacoes: m.anotacoes.iter().map(|a| a.nome.clone()).collect(),
                ..Default::default()
            };
            let mut verbo = None;
            let mut rota = None;
            for a in &m.anotacoes {
                let v = match a.nome.as_str() {
                    "GetMapping" | "GET" => Some("GET"),
                    "PostMapping" | "POST" => Some("POST"),
                    "PutMapping" | "PUT" => Some("PUT"),
                    "DeleteMapping" | "DELETE" => Some("DELETE"),
                    "PatchMapping" | "PATCH" => Some("PATCH"),
                    "RequestMapping" => Some(if a.args.contains("POST") { "POST" } else if a.args.contains("PUT") { "PUT" } else if a.args.contains("DELETE") { "DELETE" } else { "GET" }),
                    _ => None,
                };
                if let Some(v) = v {
                    verbo = Some(v);
                    if a.nome.ends_with("Mapping") {
                        rota = argumento(&a.args, "value").or_else(|| argumento(&a.args, "path")).or_else(|| primeira_string(&a.args)).or(rota);
                    }
                }
                if a.nome == "Path" {
                    rota = primeira_string(&a.args);
                }
                if matches!(a.nome.as_str(), "Scheduled" | "Schedule") {
                    met.agendado = Some(juntar_espacos(&a.args));
                }
            }
            if b.comp.papel == "entrada" && verbo.is_none() && b.comp.anotacoes.iter().any(|a| a == "WebServlet") || b.comp.estende.as_deref() == Some("HttpServlet") {
                verbo = match m.nome.as_str() {
                    "doGet" => Some("GET"),
                    "doPost" => Some("POST"),
                    "doPut" => Some("PUT"),
                    "doDelete" => Some("DELETE"),
                    _ => verbo,
                };
            }
            if let (Some(v), "entrada") = (verbo, b.comp.papel) {
                let completa = juntar_rota(&base, rota.as_deref().unwrap_or(""));
                endpoints.push((bi, m.nome.clone(), v.to_string(), trechos(&completa).1));
                met.http = Some(Endpoint { verbo: v.into(), rota: completa });
            }
            lista.push(met);
        }
        detalhes.push(lista);
    }

    // Corpo dos métodos: chamadas resolvidas, desvios, HTTP do front.
    let mut resultados: Vec<(Vec<String>, Option<String>, Vec<Metodo>)> = Vec::new();
    for bi in 0..brutos.len() {
        let b = &brutos[bi];
        let f = &fontes[b.fonte];
        let ts = f.ts;
        let campos_tipo: HashMap<String, String> = b.campos.iter().map(|c| (c.nome.clone(), c.tipo.clone())).collect();
        let campos_texto: HashMap<String, String> = b.campos.iter().filter(|c| !c.valor.is_empty()).map(|c| (c.nome.clone(), c.valor.clone())).collect();
        let tem_cliente_http = b.campos.iter().any(|c| CLIENTES_HTTP.contains(&tipo_simples(&c.tipo).as_str()));
        // Construtor: os parâmetros também são dependências (injeção pelo construtor).
        let mut usa: Vec<usize> = Vec::new();
        let mut tipos_ctor: HashMap<String, String> = HashMap::new();
        for m in &b.metodos {
            if m.nome == b.comp.nome || m.nome == "constructor" {
                for (n, t) in &m.params {
                    tipos_ctor.insert(n.clone(), t.clone());
                }
            }
        }
        for t in campos_tipo.values().chain(tipos_ctor.values()) {
            for nome in std::iter::once(tipo_simples(t)).chain(tipos_genericos(t)) {
                if let Some(j) = alvo_de(&nome, ts) {
                    if j != bi && !usa.contains(&j) && brutos[j].comp.papel != "teste" {
                        usa.push(j);
                    }
                }
            }
        }
        let mut externo = brutos[bi].comp.externo.clone();
        if externo.is_none() && tem_cliente_http && !ts {
            externo = Some(nome_externo(f, b));
        }
        let mut metodos_finais = std::mem::take(&mut detalhes[bi]);
        for (mi, m) in b.metodos.iter().enumerate() {
            let Some((abre, fecha)) = m.corpo else { continue };
            let escopo_locais = locais(f, abre, fecha);
            let tipo_de = |receptor: &str| -> Option<String> {
                escopo_locais
                    .get(receptor)
                    .cloned()
                    .or_else(|| m.params.iter().find(|(n, _)| n == receptor).map(|(_, t)| t.clone()))
                    .or_else(|| campos_tipo.get(receptor).cloned())
                    .or_else(|| tipos_ctor.get(receptor).cloned())
                    .or_else(|| receptor.chars().next().filter(|c| c.is_uppercase()).map(|_| receptor.to_string()))
            };
            let mut chamadas = Vec::new();
            let mut vistos = HashSet::new();
            for c in chamadas_brutas(f, abre, fecha) {
                let alvo = match &c.receptor {
                    None => b.metodos.iter().any(|x| x.nome == c.metodo && x.nome != m.nome).then_some(bi),
                    Some(r) => tipo_de(r).and_then(|t| alvo_de(&t, ts)),
                };
                let Some(j) = alvo else { continue };
                let papel_alvo = brutos[j].comp.papel;
                if papel_alvo == "teste" || (j != bi && papel_alvo == "excecao") {
                    continue;
                }
                // Getters/setters de entidade e DTO só fazem barulho no caminho.
                let acessor = ["get", "set", "is"].iter().any(|p| c.metodo.strip_prefix(p).is_some_and(|r| r.starts_with(|x: char| x.is_uppercase())));
                if (matches!(papel_alvo, "entidade" | "outro") && acessor) || ["equals", "hashCode", "toString"].contains(&c.metodo.as_str()) {
                    continue;
                }
                // DTO/record: só o que tem corpo de verdade (os acessores do record não contam).
                if papel_alvo == "outro" && !brutos[j].metodos.iter().any(|x| x.nome == c.metodo && x.corpo.is_some()) {
                    continue;
                }
                if vistos.insert((j, c.metodo.clone())) {
                    chamadas.push(Chamada { alvo: brutos[j].comp.id.clone(), metodo: c.metodo, linha: f.linha(c.pos) });
                }
                if j != bi && !usa.contains(&j) {
                    usa.push(j);
                }
            }
            let met = &mut metodos_finais[mi];
            met.chamadas = chamadas;
            met.desvios = desvios(f, abre, fecha);
            for d in &mut met.desvios {
                if d.status.is_none() {
                    d.status = d.excecao.as_deref().and_then(|e| status_da(e)).map(|(s, _)| s);
                }
            }
            met.usa_externo = !ts && tem_cliente_http && {
                let corpo = f.orig(abre, fecha);
                b.campos.iter().any(|c| CLIENTES_HTTP.contains(&tipo_simples(&c.tipo).as_str()) && corpo.contains(&c.nome))
            };
            if ts {
                for (verbo, expr, pos) in http_do_front(f, abre, fecha) {
                    let url = montar_url(&expr, &campos_texto, 0);
                    let (host, partes) = trechos(&url);
                    let alvo = if host.is_some() {
                        None
                    } else {
                        endpoints
                            .iter()
                            .filter(|(_, _, v, _)| verbo.is_empty() || *v == verbo)
                            .map(|e| (casamento(&partes, &e.3), e))
                            .filter(|(n, _)| *n > 0)
                            .max_by_key(|(n, _)| *n)
                            .map(|(_, (j, metodo, _, _))| Chamada { alvo: brutos[*j].comp.id.clone(), metodo: metodo.clone(), linha: 0 })
                    };
                    met.http_saida.push(HttpSaida { verbo, url, linha: f.linha(pos), alvo });
                }
            }
        }
        // Template do componente Angular: quem dispara cada método.
        if b.comp.papel == "tela" {
            let (caminho_html, texto_html, inicio) = template_de(f, b, htmls);
            if let Some(texto) = texto_html {
                for (metodo, linha, evento, rotulo) in gatilhos(&texto) {
                    if let Some(met) = metodos_finais.iter_mut().find(|x| x.nome == metodo) {
                        met.gatilhos.push(Gatilho { caminho: caminho_html.clone(), linha: linha + inicio, evento, texto: rotulo });
                    }
                }
            }
        }
        resultados.push((usa.iter().map(|&j| brutos[j].comp.id.clone()).collect(), externo, metodos_finais));
    }
    for (b, (usa, externo, metodos)) in brutos.iter_mut().zip(resultados) {
        b.comp.usa = usa;
        b.comp.externo = externo;
        b.comp.metodos = metodos;
    }

    // Repositório → tabela da entidade.
    let tabelas: HashMap<String, (String, String)> = brutos.iter().filter(|b| b.comp.papel == "entidade").map(|b| (b.comp.nome.clone(), (b.comp.id.clone(), b.comp.tabela.clone().unwrap_or_default()))).collect();
    for b in &mut brutos {
        if b.comp.papel != "repositorio" {
            continue;
        }
        if b.comp.entidade.is_none() {
            // DAO com EntityManager: a primeira entidade citada como `X.class`.
            let f = &fontes[b.fonte];
            static CL: OnceLock<Regex> = OnceLock::new();
            let corpo = f.orig(b.classe_abre, b.classe_fecha);
            b.comp.entidade = re(&CL, r"\b([A-Z][\w$]*)\s*\.\s*class\b").captures_iter(corpo).map(|c| c[1].to_string()).find(|n| tabelas.contains_key(n));
            if b.comp.entidade.is_none() {
                let palavra = primeira_palavra(&b.comp.nome);
                b.comp.entidade = tabelas.keys().find(|n| n.to_lowercase() == palavra).cloned();
            }
        }
        if let Some((id, tabela)) = b.comp.entidade.as_ref().and_then(|e| tabelas.get(e)) {
            b.comp.entidade = Some(id.clone());
            b.comp.tabela = Some(tabela.clone());
        }
    }

    definir_dominios(&mut brutos);
    let regras = regras(&fontes, &brutos, &status_da);
    Analise { tecnologias: vec![], componentes: brutos.into_iter().map(|b| b.comp).collect(), regras, arquivos: fontes.len() }
}

fn nome_externo(f: &Fonte, b: &Bruto) -> String {
    static URL: OnceLock<Regex> = OnceLock::new();
    static VALOR: OnceLock<Regex> = OnceLock::new();
    let corpo = f.orig(b.classe_abre, b.classe_fecha);
    if let Some(c) = re(&URL, r#"https?://([\w.-]+)"#).captures(corpo) {
        return c[1].to_string();
    }
    if let Some(c) = re(&VALOR, r#"@Value\s*\(\s*"\$\{([\w.-]+)"#).captures(&f.texto) {
        return c[1].split('.').next().unwrap_or(&c[1]).to_string();
    }
    let p = primeira_palavra(&b.comp.nome);
    let mut s = p.clone();
    if let Some(c) = s.get_mut(0..1) {
        c.make_ascii_uppercase();
    }
    format!("API {s}")
}

fn snake(nome: &str) -> String {
    let mut s = String::new();
    for (i, c) in nome.chars().enumerate() {
        if c.is_uppercase() && i > 0 {
            s.push('_');
        }
        s.extend(c.to_lowercase());
    }
    s
}

fn lugar(f: &Fonte, linha: u32, detalhe: &str) -> Lugar {
    Lugar { caminho: f.caminho.clone(), relativo: f.relativo.clone(), linha, detalhe: detalhe.to_string() }
}

/// Texto do template (do templateUrl ou inline) e a linha onde ele começa no arquivo.
fn template_de(f: &Fonte, b: &Bruto, htmls: &HashMap<String, (String, String)>) -> (String, Option<String>, u32) {
    if let Some(url) = &b.comp.template {
        let pasta = f.relativo.rsplit_once('/').map(|(p, _)| p).unwrap_or("");
        let mut partes: Vec<&str> = pasta.split('/').filter(|s| !s.is_empty()).collect();
        for t in url.split('/') {
            match t {
                "." | "" => {}
                ".." => {
                    partes.pop();
                }
                t => partes.push(t),
            }
        }
        let rel = partes.join("/");
        if let Some((abs, texto)) = htmls.get(&rel) {
            return (abs.clone(), Some(texto.clone()), 0);
        }
        return (String::new(), None, 0);
    }
    for a in &b.anots {
        if a.nome == "Component" {
            if let Some(i) = a.args.find("template") {
                if let Some(ini) = a.args[i..].find('`') {
                    let resto = &a.args[i + ini + 1..];
                    let fim = resto.find('`').unwrap_or(resto.len());
                    let pos = f.texto.find(&resto[..fim.min(40)]).unwrap_or(0);
                    return (f.caminho.clone(), Some(resto[..fim].to_string()), f.linha(pos) - 1);
                }
            }
        }
    }
    (String::new(), None, 0)
}

/// (método, linha, evento, texto do elemento) de cada `(click)="metodo()"` do template.
fn gatilhos(html: &str) -> Vec<(String, u32, String, String)> {
    static EV: OnceLock<Regex> = OnceLock::new();
    static CHAMA: OnceLock<Regex> = OnceLock::new();
    static TAG: OnceLock<Regex> = OnceLock::new();
    let ev = re(&EV, r#"\(\s*(click|submit|ngSubmit|change|keyup\.enter|keydown\.enter|blur|input|dblclick)\s*\)\s*=\s*"([^"]*)""#);
    let chama = re(&CHAMA, r"\b([A-Za-z_$][\w$]*)\s*\(");
    let tag = re(&TAG, r"<[^<>]*$");
    let mut lista = Vec::new();
    for c in ev.captures_iter(html) {
        let pos = c.get(0).unwrap().start();
        let linha = html[..pos].matches('\n').count() as u32 + 1;
        // Texto: o conteúdo do elemento depois do `>` da própria tag.
        let depois = &html[c.get(0).unwrap().end()..];
        let texto = depois
            .find('>')
            .map(|i| &depois[i + 1..])
            .map(|r| {
                let r = r.split('<').next().unwrap_or("");
                juntar_espacos(r)
            })
            .filter(|t| !t.is_empty() && !t.starts_with("{{"))
            .or_else(|| {
                let inicio = tag.find(&html[..pos]).map(|m| m.as_str()).unwrap_or("");
                if inicio.starts_with("<form") {
                    Some("formulário".into())
                } else {
                    None
                }
            })
            .unwrap_or_default();
        for m in chama.captures_iter(&c[2]) {
            let nome = m[1].to_string();
            if !["$event", "set", "update"].contains(&nome.as_str()) {
                lista.push((nome, linha, c[1].to_string(), texto.clone()));
            }
        }
    }
    lista
}

fn definir_dominios(brutos: &mut [Bruto]) {
    // Prefixo comum dos pacotes do back (br.com.feira): fica de fora do domínio.
    let pacotes: Vec<Vec<&str>> = brutos.iter().filter(|b| b.comp.linguagem == "java" && b.comp.papel != "teste" && !b.comp.pacote.is_empty()).map(|b| b.comp.pacote.split('.').collect()).collect();
    let mut comum = 0;
    if let Some(primeiro) = pacotes.first() {
        'fora: for i in 0..primeiro.len() {
            for p in &pacotes {
                if p.get(i) != primeiro.get(i) {
                    break 'fora;
                }
            }
            comum = i + 1;
        }
        // Todos no mesmo pacote: o último trecho é o domínio (ou camada), não o prefixo.
        if pacotes.iter().all(|p| p.len() == comum) {
            comum = comum.saturating_sub(1);
        }
    }
    for b in brutos.iter_mut() {
        let d = if b.comp.linguagem == "java" {
            dominio_do_pacote(&b.comp.pacote, comum)
        } else {
            dominio_da_pasta(&b.comp.relativo)
        };
        b.comp.dominio = d.filter(|d| !d.is_empty()).unwrap_or_else(|| primeira_palavra(&b.comp.nome));
    }
    // Plural e singular juntos (reservas → reserva).
    let todos: HashSet<String> = brutos.iter().map(|b| b.comp.dominio.clone()).collect();
    for b in brutos.iter_mut() {
        if let Some(s) = b.comp.dominio.strip_suffix('s') {
            if todos.contains(s) {
                b.comp.dominio = s.to_string();
            }
        }
    }
    // A entidade fica na linha do repositório dela.
    let do_repo: HashMap<String, String> = brutos.iter().filter(|b| b.comp.papel == "repositorio").filter_map(|b| b.comp.entidade.clone().map(|e| (e, b.comp.dominio.clone()))).collect();
    for b in brutos.iter_mut() {
        if b.comp.papel == "entidade" {
            if let Some(d) = do_repo.get(&b.comp.id) {
                b.comp.dominio = d.clone();
            }
        }
    }
}

const EXCECOES_TECNICAS: &[&str] = &[
    "UnsupportedOperationException", "NullPointerException", "IOException", "UncheckedIOException", "InterruptedException",
    "CloneNotSupportedException", "AssertionError", "Error", "IllegalAccessException", "ClassCastException",
];

const VALIDACOES: &[&str] = &[
    "NotNull", "NotBlank", "NotEmpty", "Size", "Min", "Max", "Positive", "PositiveOrZero", "Negative", "Email",
    "Pattern", "Past", "Future", "PastOrPresent", "FutureOrPresent", "DecimalMin", "DecimalMax", "Digits", "AssertTrue",
    "AssertFalse", "Length", "CPF", "CNPJ",
];

fn regras(fontes: &[Fonte], brutos: &[Bruto], status_da: &dyn Fn(&str) -> Option<(u16, Lugar)>) -> Vec<Regra> {
    let mut lista: Vec<Regra> = Vec::new();
    for b in brutos {
        if matches!(b.comp.papel, "teste" | "tratador" | "excecao") {
            continue;
        }
        let f = &fontes[b.fonte];
        let base = |tipo: &'static str, metodo: Option<&str>, linha: u32, linha_fim: u32| Regra {
            chave: String::new(),
            tipo,
            componente: b.comp.id.clone(),
            metodo: metodo.map(str::to_string),
            dominio: b.comp.dominio.clone(),
            caminho: f.caminho.clone(),
            linha,
            linha_fim,
            condicao: None,
            mensagem: None,
            excecao: None,
            status: None,
            detalhe: String::new(),
            aparece_em: vec![],
            teste: None,
        };
        for m in &b.comp.metodos {
            for d in &m.desvios {
                if d.excecao.as_deref().is_some_and(|e| EXCECOES_TECNICAS.contains(&e)) {
                    continue;
                }
                // Não achou no banco sem mensagem: é técnico, não regra.
                if d.condicao.as_deref().is_some_and(|c| c.ends_with(" vazio")) && d.mensagem.is_none() && d.excecao.as_deref() == Some("NoSuchElementException") {
                    continue;
                }
                let mut r = base(if d.excecao.is_some() { "excecao" } else { "desvio" }, Some(&m.nome), d.linha, d.linha);
                if let Some(c) = &d.condicao {
                    // O if pode começar umas linhas antes do throw.
                    let linhas = f.texto.lines().enumerate().skip(m.linha as usize - 1).take((d.linha.saturating_sub(m.linha) + 1) as usize);
                    let primeiro = c.split_whitespace().next().unwrap_or("");
                    if let Some((i, _)) = linhas.filter(|(_, l)| l.contains("if") && l.contains(primeiro)).last() {
                        r.linha = i as u32 + 1;
                    }
                }
                r.condicao = d.condicao.clone();
                r.mensagem = d.mensagem.clone();
                r.excecao = d.excecao.clone();
                r.status = d.status;
                r.detalhe = d.acao.clone();
                if let Some((_, l)) = d.excecao.as_deref().and_then(status_da) {
                    r.aparece_em.push(l);
                }
                lista.push(r);
            }
            if let Some(a) = &m.agendado {
                let mut r = base("agendada", Some(&m.nome), m.linha, m.linha_fim);
                r.detalhe = a.clone();
                lista.push(r);
            }
            for a in m.anotacoes.iter() {
                if matches!(a.as_str(), "PreAuthorize" | "Secured" | "RolesAllowed") {
                    let bruto = b.metodos.iter().find(|x| x.nome == m.nome).and_then(|x| x.anotacoes.iter().find(|y| &y.nome == a)).map(|y| y.args.clone()).unwrap_or_default();
                    let mut r = base("permissao", Some(&m.nome), m.linha, m.linha);
                    r.detalhe = format!("@{a}({})", juntar_espacos(&bruto));
                    lista.push(r);
                }
            }
        }
        // Validação nos campos (DTOs e entidades) — uma regra por campo.
        if !f.ts {
            for c in &b.campos {
                let vs: Vec<String> = c
                    .anotacoes
                    .iter()
                    .filter(|a| VALIDACOES.contains(&a.nome.as_str()) || (a.nome == "Column" && (a.args.contains("unique") || a.args.contains("nullable = false") || a.args.contains("nullable=false"))))
                    .map(|a| if a.args.trim().is_empty() { format!("@{}", a.nome) } else { format!("@{}({})", a.nome, juntar_espacos(&a.args)) })
                    .collect();
                if vs.is_empty() {
                    continue;
                }
                let mut r = base("validacao", None, c.linha, c.linha);
                r.condicao = Some(c.nome.clone());
                r.detalhe = vs.join(" ");
                r.mensagem = c.anotacoes.iter().find_map(|a| argumento(&a.args, "message"));
                lista.push(r);
            }
        } else {
            // Angular: `numero: ['', [Validators.required, Validators.maxLength(5)]]`.
            static FORM: OnceLock<Regex> = OnceLock::new();
            static VAL: OnceLock<Regex> = OnceLock::new();
            let corpo = f.orig(b.classe_abre, b.classe_fecha);
            for c in re(&FORM, r"([\w$]+)\s*:\s*\[[^\[\]]*?(\[[^\]]*\]|Validators[^\]]*)\]").captures_iter(corpo) {
                let vs: Vec<String> = re(&VAL, r"Validators\.(\w+(?:\([^)]*\))?)").captures_iter(&c[0]).map(|v| v[1].to_string()).collect();
                if vs.is_empty() {
                    continue;
                }
                let pos = b.classe_abre + c.get(0).unwrap().start();
                let mut r = base("validacao", None, f.linha(pos), f.linha(pos));
                r.condicao = Some(c[1].to_string());
                r.detalhe = vs.join(", ");
                lista.push(r);
            }
        }
    }
    // Onde mais a mensagem aparece (a tela que mostra o erro) e qual teste cobre.
    let testes: Vec<(&Bruto, &MetodoBruto)> = brutos.iter().filter(|b| b.comp.papel == "teste").flat_map(|b| b.metodos.iter().map(move |m| (b, m))).collect();
    for r in &mut lista {
        if let Some(msg) = r.mensagem.clone().filter(|m| m.chars().count() >= 4) {
            for f in fontes.iter().filter(|f| !f.teste) {
                for (i, linha) in f.texto.lines().enumerate() {
                    if linha.contains(&msg) && !(f.caminho == r.caminho && (i as u32 + 1).abs_diff(r.linha) <= 3) && r.aparece_em.len() < 5 {
                        r.aparece_em.push(lugar(f, i as u32 + 1, "mensagem"));
                    }
                }
            }
        }
        let texto = format!("{}|{}|{}", r.condicao.as_deref().unwrap_or(""), r.mensagem.as_deref().unwrap_or(""), r.detalhe);
        r.chave = format!("{}:{}.{}:{}", r.tipo, r.componente, r.metodo.as_deref().unwrap_or("-"), fnv(&juntar_espacos(&texto)));
    }
    // Teste que cobre: primeiro pela mensagem (o mais certo); depois pela exceção + método,
    // sem repetir um teste que já ficou com outra regra pela mensagem.
    let corpo_de = |b: &Bruto, m: &MetodoBruto| m.corpo.map(|(a, f)| fontes[b.fonte].orig(a, f).to_string()).unwrap_or_default();
    let mut usados: HashSet<(usize, usize)> = HashSet::new();
    for r in &mut lista {
        let Some(msg) = r.mensagem.clone().filter(|m| m.chars().count() >= 4) else { continue };
        if let Some((i, (b, m))) = testes.iter().enumerate().find(|(_, (b, m))| corpo_de(b, m).contains(&msg)) {
            let f = &fontes[b.fonte];
            r.teste = Some(lugar(f, f.linha(m.nome_pos), &format!("{}.{}", b.comp.nome, m.nome)));
            usados.insert((i, 0));
        }
    }
    for r in &mut lista {
        if r.teste.is_some() {
            continue;
        }
        let achado = testes.iter().enumerate().find(|(i, (b, m))| {
            let corpo = corpo_de(b, m);
            let pela_excecao = r.excecao.as_deref().is_some_and(|e| corpo.contains(e)) && r.metodo.as_deref().is_some_and(|mm| corpo.contains(&format!(".{mm}(")));
            let pela_condicao = r.tipo == "validacao" && r.condicao.as_deref().is_some_and(|c| corpo.contains(c) && (corpo.contains("iolation") || corpo.contains("400")));
            !usados.contains(&(*i, 0)) && (pela_excecao || pela_condicao)
        });
        if let Some((i, (b, m))) = achado {
            let f = &fontes[b.fonte];
            r.teste = Some(lugar(f, f.linha(m.nome_pos), &format!("{}.{}", b.comp.nome, m.nome)));
            usados.insert((i, 0));
        }
    }
    lista
}

#[cfg(test)]
mod testes {
    use super::*;

    fn fonte(rel: &str, texto: &str) -> Fonte {
        Fonte::nova(format!("/p/{rel}"), rel.to_string(), texto.to_string())
    }

    const SERVICO: &str = r#"package br.com.feira.reserva;

import org.springframework.stereotype.Service;

/** Reservas de banca. { não conta } */
@Service
public class ReservaService {
    private static final int LIMITE_BANCAS = 120;
    private final ReservaRepository reservas;
    private final FeiraRepository feiraRepository;

    public ReservaService(ReservaRepository reservas, FeiraRepository feiraRepository) {
        this.reservas = reservas;
        this.feiraRepository = feiraRepository;
    }

    public Reserva reservar(Long feiraId, String numero) {
        Feira feira = feiraRepository.findById(feiraId)
            .orElseThrow(() -> new NaoEncontrada("feira"));
        if (feira.getBancas().size() >= LIMITE_BANCAS) {
            throw new RegraNegocioException("Feira lotada");
        }
        validar(numero);
        return reservas.save(new Reserva(feira, numero));
    }

    private void validar(String n) {
        if (n.isBlank()) throw new RegraNegocioException("Número obrigatório");
    }

    @Scheduled(fixedRate = 300000)
    public void expirarPendentes() { reservas.expirar(); }
}
"#;

    const REPO: &str = r#"package br.com.feira.reserva;
public interface ReservaRepository extends JpaRepository<Reserva, Long> {
    List<Reserva> findByFeira(Feira f);
    void expirar();
}
"#;

    const ENTIDADE: &str = r#"package br.com.feira.reserva;
@Entity
@Table(name = "reserva")
public class Reserva {
    @Id Long id;
    @NotBlank(message = "informe o número")
    @Size(max = 5)
    private String numero;
}
"#;

    const CONTROLLER: &str = r#"package br.com.feira.reserva;
@RestController
@RequestMapping("/api/reservas")
public class ReservaController {
    private final ReservaService service;
    ReservaController(ReservaService service) { this.service = service; }

    @PostMapping
    public ResponseEntity<Reserva> criar(@Valid @RequestBody ReservaRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.reservar(req.feiraId(), req.numero()));
    }

    @GetMapping("/{id}")
    public ResponseEntity<Reserva> ver(@PathVariable Long id) {
        if (id < 0) return ResponseEntity.status(HttpStatus.BAD_REQUEST).build();
        return ResponseEntity.ok(null);
    }
}
"#;

    const HANDLER: &str = r#"package br.com.feira.comum;
@RestControllerAdvice
public class RegraNegocioHandler {
    @ExceptionHandler(RegraNegocioException.class)
    @ResponseStatus(HttpStatus.CONFLICT)
    public Erro tratar(RegraNegocioException e) { return new Erro(e.getMessage()); }
}
"#;

    const TESTE: &str = r#"package br.com.feira.reserva;
class ReservaServiceTest {
    @Test
    void naoReservaEmFeiraLotada() {
        assertThrows(RegraNegocioException.class, () -> service.reservar(1L, "A1"));
    }
}
"#;

    const API_TS: &str = r#"import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ReservaApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.api}/reservas`;

  criar(feiraId: number, numero: string) {
    return this.http.post<Reserva>(this.base, { feiraId, numero });
  }

  ver(id: number) {
    return this.http.get<Reserva>(`${this.base}/${id}`);
  }
}
"#;

    const FORM_TS: &str = r#"import { Component } from '@angular/core';
@Component({
  selector: 'app-reserva-form',
  templateUrl: './reserva-form.component.html',
})
export class ReservaFormComponent {
  constructor(private readonly api: ReservaApi, private fb: FormBuilder) {}
  form = this.fb.group({ numero: ['', [Validators.required, Validators.maxLength(5)]] });
  erro = '';

  reservar(): void {
    this.api.criar(1, this.form.value.numero!).subscribe({
      error: (e) => (this.erro = e.status === 409 ? 'Feira lotada' : 'Falhou'),
    });
  }
}
"#;

    const FORM_HTML: &str = "<form [formGroup]=\"form\">\n  <input formControlName=\"numero\">\n  <button type=\"button\" (click)=\"reservar()\">Reservar</button>\n</form>\n";

    fn analise() -> Analise {
        let fontes = vec![
            fonte("back/src/main/java/br/com/feira/reserva/ReservaService.java", SERVICO),
            fonte("back/src/main/java/br/com/feira/reserva/ReservaRepository.java", REPO),
            fonte("back/src/main/java/br/com/feira/reserva/Reserva.java", ENTIDADE),
            fonte("back/src/main/java/br/com/feira/reserva/ReservaController.java", CONTROLLER),
            fonte("back/src/main/java/br/com/feira/comum/RegraNegocioHandler.java", HANDLER),
            fonte("back/src/test/java/br/com/feira/reserva/ReservaServiceTest.java", TESTE),
            fonte("front/src/app/reserva/reserva-api.service.ts", API_TS),
            fonte("front/src/app/reserva/reserva-form/reserva-form.component.ts", FORM_TS),
        ];
        let mut htmls = HashMap::new();
        htmls.insert("front/src/app/reserva/reserva-form/reserva-form.component.html".to_string(), ("/p/form.html".to_string(), FORM_HTML.to_string()));
        montar(fontes, &htmls)
    }

    fn comp<'a>(a: &'a Analise, nome: &str) -> &'a Componente {
        a.componentes.iter().find(|c| c.nome == nome).unwrap_or_else(|| panic!("sem {nome}"))
    }

    #[test]
    fn mascara_mantem_posicoes() {
        let t = "a = \"{ x }\"; // { b }\nc";
        let m = mascarar(t);
        assert_eq!(m.len(), t.len());
        assert!(!m.contains('{'));
        assert!(m.ends_with("\nc"));
    }

    #[test]
    fn papeis_e_dominios() {
        let a = analise();
        assert_eq!(comp(&a, "ReservaService").papel, "servico");
        assert_eq!(comp(&a, "ReservaController").papel, "entrada");
        assert_eq!(comp(&a, "ReservaRepository").papel, "repositorio");
        assert_eq!(comp(&a, "Reserva").papel, "entidade");
        assert_eq!(comp(&a, "RegraNegocioHandler").papel, "tratador");
        assert_eq!(comp(&a, "ReservaServiceTest").papel, "teste");
        assert_eq!(comp(&a, "ReservaApi").papel, "front");
        assert_eq!(comp(&a, "ReservaFormComponent").papel, "tela");
        for n in ["ReservaService", "ReservaController", "ReservaApi", "ReservaFormComponent", "Reserva"] {
            assert_eq!(comp(&a, n).dominio, "reserva", "{n}");
        }
        assert_eq!(comp(&a, "ReservaRepository").tabela.as_deref(), Some("reserva"));
    }

    #[test]
    fn injecao_e_chamadas() {
        let a = analise();
        let s = comp(&a, "ReservaService");
        assert!(s.usa.contains(&"ReservaRepository".to_string()));
        let reservar = s.metodos.iter().find(|m| m.nome == "reservar").unwrap();
        let alvos: Vec<String> = reservar.chamadas.iter().map(|c| format!("{}.{}", c.alvo, c.metodo)).collect();
        assert!(alvos.contains(&"FeiraRepository.findById".to_string()) || !a.componentes.iter().any(|c| c.nome == "FeiraRepository"));
        assert!(alvos.contains(&"ReservaRepository.save".to_string()), "{alvos:?}");
        assert!(alvos.contains(&"ReservaService.validar".to_string()), "{alvos:?}");
        let c = comp(&a, "ReservaController");
        let criar = c.metodos.iter().find(|m| m.nome == "criar").unwrap();
        assert_eq!(criar.http.as_ref().unwrap().rota, "/api/reservas");
        assert!(criar.chamadas.iter().any(|x| x.alvo == "ReservaService" && x.metodo == "reservar"));
    }

    #[test]
    fn desvios_com_status() {
        let a = analise();
        let s = comp(&a, "ReservaService");
        let reservar = s.metodos.iter().find(|m| m.nome == "reservar").unwrap();
        let lotada = reservar.desvios.iter().find(|d| d.mensagem.as_deref() == Some("Feira lotada")).unwrap();
        assert_eq!(lotada.condicao.as_deref(), Some("feira.getBancas().size() >= LIMITE_BANCAS"));
        assert_eq!(lotada.status, Some(409));
        let vazio = reservar.desvios.iter().find(|d| d.excecao.as_deref() == Some("NaoEncontrada")).unwrap();
        assert_eq!(vazio.condicao.as_deref(), Some("feiraRepository.findById(feiraId) vazio"));
        let ver = comp(&a, "ReservaController").metodos.iter().find(|m| m.nome == "ver").unwrap();
        assert_eq!(ver.desvios[0].status, Some(400));
        assert_eq!(ver.desvios[0].condicao.as_deref(), Some("id < 0"));
    }

    #[test]
    fn front_chega_no_endpoint() {
        let a = analise();
        let api = comp(&a, "ReservaApi");
        let criar = api.metodos.iter().find(|m| m.nome == "criar").unwrap();
        let saida = &criar.http_saida[0];
        assert_eq!(saida.verbo, "POST");
        let alvo = saida.alvo.as_ref().expect("casou com o endpoint");
        assert_eq!((alvo.alvo.as_str(), alvo.metodo.as_str()), ("ReservaController", "criar"));
        let ver = api.metodos.iter().find(|m| m.nome == "ver").unwrap();
        assert_eq!(ver.http_saida[0].alvo.as_ref().unwrap().metodo, "ver");

        let form = comp(&a, "ReservaFormComponent");
        assert!(form.usa.contains(&"ReservaApi".to_string()));
        let reservar = form.metodos.iter().find(|m| m.nome == "reservar").unwrap();
        assert_eq!(reservar.gatilhos[0].texto, "Reservar");
        assert_eq!(reservar.gatilhos[0].linha, 3);
        assert!(reservar.chamadas.iter().any(|c| c.alvo == "ReservaApi" && c.metodo == "criar"));
    }

    #[test]
    fn regras_candidatas() {
        let a = analise();
        let lotada = a.regras.iter().find(|r| r.mensagem.as_deref() == Some("Feira lotada") && r.tipo == "excecao").unwrap();
        assert_eq!(lotada.status, Some(409));
        assert_eq!(lotada.teste.as_ref().map(|t| t.detalhe.as_str()), Some("ReservaServiceTest.naoReservaEmFeiraLotada"));
        assert!(lotada.aparece_em.iter().any(|l| l.relativo.ends_with("reserva-form.component.ts")));
        assert!(lotada.aparece_em.iter().any(|l| l.detalhe.contains("→ 409")));
        assert!(a.regras.iter().any(|r| r.tipo == "agendada" && r.metodo.as_deref() == Some("expirarPendentes")));
        let campo = a.regras.iter().find(|r| r.tipo == "validacao" && r.componente == "Reserva").unwrap();
        assert_eq!(campo.condicao.as_deref(), Some("numero"));
        assert!(campo.detalhe.contains("@NotBlank"));
        assert!(a.regras.iter().any(|r| r.tipo == "validacao" && r.componente == "ReservaFormComponent" && r.detalhe.contains("required")));
        // A chave não muda entre análises.
        assert_eq!(analise().regras[0].chave, a.regras[0].chave);
    }

    #[test]
    fn jakarta_ee() {
        let recurso = r#"package br.gov.app.pedido;
@Path("/pedidos")
@Produces(MediaType.APPLICATION_JSON)
public class PedidoResource {
    @Inject PedidoBean bean;

    @POST
    @Path("/{id}/aprovar")
    public Response aprovar(@PathParam("id") Long id) {
        if (id == null) return Response.status(Response.Status.BAD_REQUEST).build();
        bean.aprovar(id);
        return Response.ok().build();
    }
}
"#;
        let ejb = r#"package br.gov.app.pedido;
@Stateless
public class PedidoBean {
    @EJB private PedidoDao dao;

    @RolesAllowed("GERENTE")
    public void aprovar(Long id) {
        Pedido p = dao.buscar(id);
        if (p.getValor().compareTo(LIMITE) > 0) {
            throw new PedidoException("Valor acima do limite");
        }
        dao.salvar(p);
    }

    @Schedule(hour = "3", persistent = false)
    public void limpar() { dao.limpar(); }
}
"#;
        let dao = r#"package br.gov.app.pedido;
@Stateless
public class PedidoDao {
    @PersistenceContext EntityManager em;
    public Pedido buscar(Long id) { return em.find(Pedido.class, id); }
    public void salvar(Pedido p) { em.merge(p); }
    public void limpar() { em.createQuery("delete from Pedido").executeUpdate(); }
}
"#;
        let entidade = "package br.gov.app.pedido;\n@Entity\npublic class Pedido { @Id Long id; @NotNull @DecimalMin(\"0.01\") BigDecimal valor; }\n";
        let mapper = r#"package br.gov.app.comum;
@Provider
public class PedidoExceptionMapper implements ExceptionMapper<PedidoException> {
    public Response toResponse(PedidoException e) { return Response.status(Response.Status.CONFLICT).entity(e.getMessage()).build(); }
}
"#;
        let servlet = "package br.gov.app.relatorio;\n@WebServlet(\"/relatorio\")\npublic class RelatorioServlet extends HttpServlet {\n  protected void doGet(HttpServletRequest req, HttpServletResponse resp) { }\n}\n";
        let a = montar(
            vec![
                fonte("src/main/java/br/gov/app/pedido/PedidoResource.java", recurso),
                fonte("src/main/java/br/gov/app/pedido/PedidoBean.java", ejb),
                fonte("src/main/java/br/gov/app/pedido/PedidoDao.java", dao),
                fonte("src/main/java/br/gov/app/pedido/Pedido.java", entidade),
                fonte("src/main/java/br/gov/app/comum/PedidoExceptionMapper.java", mapper),
                fonte("src/main/java/br/gov/app/relatorio/RelatorioServlet.java", servlet),
            ],
            &HashMap::new(),
        );
        assert_eq!(comp(&a, "PedidoResource").papel, "entrada");
        assert_eq!(comp(&a, "PedidoBean").papel, "servico");
        assert_eq!(comp(&a, "PedidoDao").papel, "repositorio");
        assert_eq!(comp(&a, "PedidoDao").tabela.as_deref(), Some("pedido"));
        assert_eq!(comp(&a, "PedidoExceptionMapper").papel, "tratador");
        let aprovar = comp(&a, "PedidoResource").metodos.iter().find(|m| m.nome == "aprovar").unwrap();
        let http = aprovar.http.as_ref().unwrap();
        assert_eq!((http.verbo.as_str(), http.rota.as_str()), ("POST", "/pedidos/{id}/aprovar"));
        assert!(aprovar.chamadas.iter().any(|c| c.alvo == "PedidoBean" && c.metodo == "aprovar"));
        assert_eq!(aprovar.desvios[0].status, Some(400));
        let bean = comp(&a, "PedidoBean").metodos.iter().find(|m| m.nome == "aprovar").unwrap();
        assert_eq!(bean.desvios[0].status, Some(409), "status pelo ExceptionMapper");
        assert!(bean.chamadas.iter().any(|c| c.alvo == "PedidoDao" && c.metodo == "salvar"));
        let doget = comp(&a, "RelatorioServlet").metodos.iter().find(|m| m.nome == "doGet").unwrap();
        assert_eq!(doget.http.as_ref().map(|h| h.rota.as_str()), Some("/relatorio"));
        assert!(a.regras.iter().any(|r| r.tipo == "permissao" && r.detalhe.contains("GERENTE")));
        assert!(a.regras.iter().any(|r| r.tipo == "agendada" && r.metodo.as_deref() == Some("limpar")));
        assert!(a.regras.iter().any(|r| r.tipo == "validacao" && r.componente == "Pedido" && r.detalhe.contains("DecimalMin")));
        for n in ["PedidoResource", "PedidoBean", "PedidoDao", "Pedido"] {
            assert_eq!(comp(&a, n).dominio, "pedido", "{n}");
        }
    }

    /// `SEEDY_ANALISAR=<pasta> cargo test --lib analisar_pasta -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn analisar_pasta() {
        let pasta = std::env::var("SEEDY_ANALISAR").expect("SEEDY_ANALISAR");
        let saida = std::env::var("SEEDY_SAIDA").expect("SEEDY_SAIDA");
        std::fs::write(saida, serde_json::to_string_pretty(&analisar(Path::new(&pasta))).unwrap()).unwrap();
    }

    #[test]
    fn rotas_casam_pelo_fim() {
        let (_, f) = trechos("{}/reservas/{}");
        let (_, b) = trechos("/api/reservas/{id}");
        assert!(casamento(&f, &b) > 0);
        let (_, outra) = trechos("/api/feiras/{id}");
        assert_eq!(casamento(&f, &outra), 0);
        let (host, _) = trechos("https://api.pix.com/cobranca");
        assert_eq!(host.as_deref(), Some("api.pix.com"));
    }
}
