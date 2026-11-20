//! Busca no projeto: índice de arquivos e símbolos Java, e busca de texto.
//!
//! O ranqueamento (fuzzy) fica na interface; aqui só se percorre o disco.
//! Os símbolos saem de uma leitura simples das declarações Java, linha a linha —
//! quando o jdtls chegar (fase 1), ele passa a ser a fonte dos símbolos.

use ignore::overrides::{Override, OverrideBuilder};
use ignore::{DirEntry, WalkBuilder};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::OnceLock;

/// Pastas de saída e de dependências, que nunca entram na busca.
const PASTAS_IGNORADAS: &[&str] = &[".git", "target", "build", "out", "node_modules", "dist", ".idea", ".gradle"];
/// Arquivos maiores que isso não são lidos (provavelmente gerados ou binários).
const TAMANHO_MAXIMO: u64 = 2 * 1024 * 1024;
/// Linhas de resultado de texto são cortadas neste tamanho.
const LARGURA_LINHA: usize = 240;

#[derive(Serialize)]
pub struct ArquivoIndice {
    pub caminho: String,
    pub relativo: String,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Simbolo {
    pub nome: String,
    /// "classe" (class/interface/enum/record) ou "metodo".
    pub tipo: &'static str,
    /// Parâmetros do método, ex.: "Long, Long". Vazio para classes.
    pub detalhe: String,
    /// Classe onde o método está, ou o pacote/pasta da classe.
    pub conteiner: String,
    pub caminho: String,
    pub linha: usize,
}

#[derive(Serialize)]
pub struct Indice {
    pub arquivos: Vec<ArquivoIndice>,
    pub simbolos: Vec<Simbolo>,
}

#[derive(Serialize)]
pub struct Ocorrencia {
    pub caminho: String,
    pub relativo: String,
    pub linha: usize,
    pub texto: String,
}

/// Opções da busca de texto (as de "Buscar no projeto", Ctrl+Shift+F).
#[derive(Deserialize, Default, Debug, Clone)]
#[serde(default)]
pub struct OpcoesTexto {
    /// Diferenciar maiúsculas. Sem valor = só se a consulta tiver maiúscula (smart case).
    pub diferenciar: Option<bool>,
    /// Só palavra inteira.
    pub palavra: bool,
    /// A consulta é uma expressão regular.
    pub regex: bool,
    /// Máscara de arquivos separada por vírgula, ex.: `*.java, *.xml, !*Test.java`.
    pub mascara: String,
}

#[tauri::command]
pub async fn busca_indexar(raiz: String) -> Result<Indice, String> {
    tauri::async_runtime::spawn_blocking(move || indexar(Path::new(&raiz)))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn busca_texto(
    raiz: String,
    consulta: String,
    limite: usize,
    opcoes: Option<OpcoesTexto>,
) -> Result<Vec<Ocorrencia>, String> {
    let opcoes = opcoes.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || buscar_texto(Path::new(&raiz), &consulta, limite, &opcoes))
        .await
        .map_err(|e| e.to_string())?
}

fn percorrer(raiz: &Path, mascara: Option<Override>) -> impl Iterator<Item = DirEntry> {
    let mut construtor = WalkBuilder::new(raiz);
    if let Some(m) = mascara {
        construtor.overrides(m);
    }
    construtor
        .hidden(true)
        .require_git(false)
        .filter_entry(|e| {
            let nome = e.file_name().to_string_lossy();
            !(e.file_type().is_some_and(|t| t.is_dir()) && PASTAS_IGNORADAS.contains(&&*nome))
        })
        .build()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_some_and(|t| t.is_file()))
}

fn relativo(raiz: &Path, caminho: &Path) -> String {
    let rel = caminho.strip_prefix(raiz).unwrap_or(caminho);
    // Sempre com "/" na interface, em qualquer sistema.
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

fn indexar(raiz: &Path) -> Indice {
    let mut arquivos = Vec::new();
    let mut simbolos = Vec::new();
    for entrada in percorrer(raiz, None) {
        let caminho = entrada.path();
        let rel = relativo(raiz, caminho);
        let texto_caminho = caminho.to_string_lossy().into_owned();
        if caminho.extension().is_some_and(|e| e == "java") && !grande_demais(&entrada) {
            if let Ok(conteudo) = fs::read_to_string(caminho) {
                let pasta = rel.rsplit_once('/').map(|(p, _)| p).unwrap_or("");
                simbolos.extend(simbolos_java(&conteudo, &texto_caminho, &pacote_ou_pasta(&conteudo, pasta)));
            }
        }
        arquivos.push(ArquivoIndice { caminho: texto_caminho, relativo: rel });
    }
    arquivos.sort_by(|a, b| a.relativo.cmp(&b.relativo));
    Indice { arquivos, simbolos }
}

fn grande_demais(entrada: &DirEntry) -> bool {
    entrada.metadata().map(|m| m.len() > TAMANHO_MAXIMO).unwrap_or(true)
}

/// Último trecho do pacote (`br.com.x.feira` → `feira`), ou a pasta se não houver `package`.
fn pacote_ou_pasta(conteudo: &str, pasta: &str) -> String {
    static PACOTE: OnceLock<Regex> = OnceLock::new();
    let re = PACOTE.get_or_init(|| Regex::new(r"(?m)^\s*package\s+([\w.]+)\s*;").unwrap());
    match re.captures(conteudo) {
        Some(c) => c[1].rsplit('.').next().unwrap_or(&c[1]).to_string(),
        None => pasta.to_string(),
    }
}

/// Lê as declarações de tipos e métodos de um arquivo Java, uma por linha.
fn simbolos_java(conteudo: &str, caminho: &str, pacote: &str) -> Vec<Simbolo> {
    static TIPO: OnceLock<Regex> = OnceLock::new();
    static METODO: OnceLock<Regex> = OnceLock::new();
    let tipo = TIPO.get_or_init(|| {
        Regex::new(
            r"^\s*(?:(?:public|protected|private|abstract|final|static|sealed|non-sealed|strictfp)\s+)*(?:class|interface|enum|record|@interface)\s+([A-Za-z_$][\w$]*)",
        )
        .unwrap()
    });
    let metodo = METODO.get_or_init(|| {
        Regex::new(
            r"^\s*(?:(?:public|protected|private|abstract|final|static|synchronized|native|default|strictfp)\s+)*(?:<[^>]*>\s+)?([\w$][\w$<>\[\],.?\s]*?)\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)",
        )
        .unwrap()
    });
    const NAO_SAO_TIPOS: &[&str] = &[
        "return", "throw", "new", "else", "if", "for", "while", "switch", "case", "do", "try", "catch", "assert",
        "yield", "super", "this", "import", "package",
    ];

    let mut saida = Vec::new();
    let mut classe_atual = String::new();
    for (i, linha) in conteudo.lines().enumerate() {
        if let Some(c) = tipo.captures(linha) {
            classe_atual = c[1].to_string();
            saida.push(Simbolo {
                nome: c[1].to_string(),
                tipo: "classe",
                detalhe: String::new(),
                conteiner: pacote.to_string(),
                caminho: caminho.to_string(),
                linha: i + 1,
            });
        } else if let Some(c) = metodo.captures(linha) {
            let primeira = c[1].split_whitespace().next().unwrap_or("");
            if NAO_SAO_TIPOS.contains(&primeira) || NAO_SAO_TIPOS.contains(&&c[2]) {
                continue;
            }
            saida.push(Simbolo {
                nome: c[2].to_string(),
                tipo: "metodo",
                detalhe: tipos_dos_parametros(&c[3]),
                conteiner: classe_atual.clone(),
                caminho: caminho.to_string(),
                linha: i + 1,
            });
        }
    }
    saida
}

/// `Long feiraId, final Long feiranteId` → `Long, Long`.
fn tipos_dos_parametros(params: &str) -> String {
    params
        .split(',')
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(|p| {
            let palavras: Vec<&str> = p.split_whitespace().filter(|w| *w != "final" && !w.starts_with('@')).collect();
            match palavras.len() {
                0 => String::new(),
                1 => palavras[0].to_string(),
                n => palavras[..n - 1].join(" "),
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// Monta a expressão da busca a partir da consulta e das opções.
fn expressao(consulta: &str, opcoes: &OpcoesTexto) -> Result<Regex, String> {
    let base = if opcoes.regex { consulta.to_string() } else { regex::escape(consulta) };
    let padrao = if opcoes.palavra { format!(r"\b(?:{base})\b") } else { base };
    let diferencia = opcoes.diferenciar.unwrap_or_else(|| consulta.chars().any(char::is_uppercase));
    RegexBuilder::new(&padrao)
        .case_insensitive(!diferencia)
        .build()
        .map_err(|e| format!("expressão inválida: {e}"))
}

/// `*.java, *.xml, !*Test.java` → filtro de arquivos (o `!` exclui).
fn mascara(raiz: &Path, texto: &str) -> Result<Option<Override>, String> {
    let globs: Vec<&str> = texto.split(',').map(str::trim).filter(|g| !g.is_empty()).collect();
    if globs.is_empty() {
        return Ok(None);
    }
    let mut construtor = OverrideBuilder::new(raiz);
    for g in &globs {
        construtor.add(g).map_err(|e| format!("máscara inválida ({g}): {e}"))?;
    }
    construtor.build().map(Some).map_err(|e| format!("máscara inválida: {e}"))
}

fn buscar_texto(raiz: &Path, consulta: &str, limite: usize, opcoes: &OpcoesTexto) -> Result<Vec<Ocorrencia>, String> {
    if consulta.is_empty() {
        return Ok(Vec::new());
    }
    let re = expressao(consulta, opcoes)?;
    let filtro = mascara(raiz, &opcoes.mascara)?;

    let mut saida = Vec::new();
    for entrada in percorrer(raiz, filtro) {
        if grande_demais(&entrada) {
            continue;
        }
        let Ok(bytes) = fs::read(entrada.path()) else { continue };
        if bytes.iter().take(8000).any(|b| *b == 0) {
            continue; // binário
        }
        let conteudo = String::from_utf8_lossy(&bytes);
        let rel = relativo(raiz, entrada.path());
        for (i, linha) in conteudo.lines().enumerate() {
            if re.is_match(linha) {
                saida.push(Ocorrencia {
                    caminho: entrada.path().to_string_lossy().into_owned(),
                    relativo: rel.clone(),
                    linha: i + 1,
                    texto: linha.trim().chars().take(LARGURA_LINHA).collect(),
                });
                if saida.len() >= limite {
                    return Ok(saida);
                }
            }
        }
    }
    Ok(saida)
}

#[cfg(test)]
mod testes {
    use super::*;

    const EXEMPLO: &str = r#"package br.com.feirinhaverde.feira;

import java.util.List;

@Service
public class FeiraService {
    private static final int LIMITE = 120;

    public FeiraService(FeiraRepository repo) {
        this.repo = repo;
    }

    @Transactional
    public Banca reservarBanca(Long feiraId, final Long feiranteId) {
        Feira feira = repo.findById(feiraId)
            .orElseThrow(() -> new RegraNegocioException("x"));
        if (feira.cheia()) {
            throw new RegraNegocioException("Feira lotada");
        }
        return bancaRepository.save(new Banca(feira, feiranteId));
    }

    private <T> List<T> listar(Map<String, T> mapa) { return null; }
}

interface Pagavel {}
"#;

    #[test]
    fn le_classes_e_metodos() {
        let s = simbolos_java(EXEMPLO, "F.java", "feira");
        let nomes: Vec<(&str, &str, &str)> = s.iter().map(|x| (x.tipo, x.nome.as_str(), x.detalhe.as_str())).collect();
        assert_eq!(
            nomes,
            vec![
                ("classe", "FeiraService", ""),
                ("metodo", "FeiraService", "FeiraRepository"),
                ("metodo", "reservarBanca", "Long, Long"),
                ("metodo", "listar", "Map<String, T>"),
                ("classe", "Pagavel", ""),
            ]
        );
        assert_eq!(s[2].linha, 14);
        assert_eq!(s[2].conteiner, "FeiraService");
        assert_eq!(s[0].conteiner, "feira");
    }

    /// Pasta temporária com alguns arquivos, apagada no fim do teste.
    struct PastaTeste(std::path::PathBuf);
    impl PastaTeste {
        fn nova(nome: &str, arquivos: &[(&str, &str)]) -> Self {
            let p = std::env::temp_dir().join(format!("seedy-teste-{nome}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&p);
            for (rel, conteudo) in arquivos {
                let caminho = p.join(rel);
                fs::create_dir_all(caminho.parent().unwrap()).unwrap();
                fs::write(caminho, conteudo).unwrap();
            }
            PastaTeste(p)
        }
    }
    impl Drop for PastaTeste {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn busca_texto_com_opcoes() {
        let pasta = PastaTeste::nova(
            "texto",
            &[
                ("src/Feira.java", "class Feira {\n  int feiraId;\n  Feira feira;\n}\n"),
                ("src/FeiraTest.java", "class FeiraTest { Feira f; }\n"),
                ("config/app.xml", "<feira id=\"1\"/>\n"),
                ("target/Gerado.java", "Feira gerada\n"),
            ],
        );
        let raiz = pasta.0.as_path();
        let achar = |q: &str, o: OpcoesTexto| -> Vec<String> {
            let mut v: Vec<String> = buscar_texto(raiz, q, 100, &o)
                .unwrap()
                .into_iter()
                .map(|x| format!("{}:{}", x.relativo, x.linha))
                .collect();
            v.sort();
            v
        };

        // smart case: minúscula acha tudo; target/ é ignorada
        assert_eq!(achar("feira", OpcoesTexto::default()).len(), 5);
        // diferenciar maiúsculas
        let so_maiuscula = OpcoesTexto { diferenciar: Some(true), ..Default::default() };
        assert_eq!(achar("feira", so_maiuscula), vec!["config/app.xml:1", "src/Feira.java:2", "src/Feira.java:3"]);
        // palavra inteira: "feiraId" não conta
        let palavra = OpcoesTexto { palavra: true, ..Default::default() };
        assert_eq!(achar("feira", palavra).len(), 4);
        // máscara com exclusão
        let mascara = OpcoesTexto { mascara: "*.java, !*Test.java".into(), ..Default::default() };
        assert_eq!(achar("feira", mascara), vec!["src/Feira.java:1", "src/Feira.java:2", "src/Feira.java:3"]);
        // regex
        let regex = OpcoesTexto { regex: true, ..Default::default() };
        assert_eq!(achar(r"int \w+Id", regex), vec!["src/Feira.java:2"]);
        // regex inválida vira erro, não pânico
        let ruim = OpcoesTexto { regex: true, ..Default::default() };
        assert!(buscar_texto(raiz, "(", 10, &ruim).is_err());
    }

    #[test]
    fn pacote_cai_para_a_pasta() {
        assert_eq!(pacote_ou_pasta("class A {}", "src/test"), "src/test");
        assert_eq!(pacote_ou_pasta("package a.b.c;\n", "x"), "c");
    }
}
