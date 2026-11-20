//! Deploy explodido: a pasta da aplicação no servidor é um espelho das fontes do
//! projeto (a pasta web, as classes compiladas pelo jdtls e os jars), montado pelo
//! Seedy — sem precisar de Maven/Gradle. Enquanto o servidor roda, um observador
//! copia cada arquivo alterado (hot swap de JSP, estáticos e classes).

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, SystemTime};

/// Uma origem do deploy: uma pasta (copiada inteira para `destino`) ou um arquivo.
#[derive(Deserialize, Clone, Debug)]
pub struct Fonte {
    pub origem: String,
    /// Caminho relativo dentro da aplicação, com "/" ("" = raiz, "WEB-INF/classes").
    pub destino: String,
}

/// Arquivos esperados na aplicação → de onde vêm. Fontes posteriores ganham das anteriores.
pub fn mapa(fontes: &[Fonte]) -> HashMap<String, PathBuf> {
    let mut m = HashMap::new();
    for f in fontes {
        let origem = PathBuf::from(&f.origem);
        if origem.is_file() {
            m.insert(normalizar(&f.destino), origem);
        } else if origem.is_dir() {
            for entrada in walk(&origem) {
                if let Ok(rel) = entrada.strip_prefix(&origem) {
                    m.insert(juntar(&f.destino, rel), entrada);
                }
            }
        }
    }
    m
}

/// Espelha as fontes em `alvo`: copia o que falta ou mudou, apaga o que sobrou.
/// Devolve os caminhos relativos copiados.
pub fn espelhar(fontes: &[Fonte], alvo: &Path) -> Result<Vec<String>, String> {
    fs::create_dir_all(alvo).map_err(|e| format!("não consegui criar {}: {e}", alvo.display()))?;
    let esperado = mapa(fontes);
    let mut copiados = Vec::new();
    for (rel, origem) in &esperado {
        let destino = alvo.join(rel);
        if precisa_copiar(origem, &destino) {
            copiar(origem, &destino)?;
            copiados.push(rel.clone());
        }
    }
    // O que está na aplicação e não veio de nenhuma fonte sai (classe apagada, JSP renomeado).
    for existente in walk(alvo) {
        if let Ok(rel) = existente.strip_prefix(alvo) {
            let rel = normalizar(&rel.to_string_lossy());
            if !esperado.contains_key(&rel) {
                let _ = fs::remove_file(&existente);
            }
        }
    }
    apagar_pastas_vazias(alvo);
    copiados.sort();
    Ok(copiados)
}

fn precisa_copiar(origem: &Path, destino: &Path) -> bool {
    let (Ok(a), Ok(b)) = (fs::metadata(origem), fs::metadata(destino)) else { return true };
    a.len() != b.len() || a.modified().ok() > b.modified().ok()
}

fn copiar(origem: &Path, destino: &Path) -> Result<(), String> {
    if let Some(pai) = destino.parent() {
        fs::create_dir_all(pai).map_err(|e| e.to_string())?;
    }
    fs::copy(origem, destino).map_err(|e| format!("não consegui copiar {}: {e}", origem.display()))?;
    // A cópia fica com a data da origem: a próxima comparação não recopia à toa.
    if let Ok(quando) = fs::metadata(origem).and_then(|m| m.modified()) {
        let _ = fs::File::options().write(true).open(destino).and_then(|f| f.set_modified(quando));
    }
    Ok(())
}

fn walk(raiz: &Path) -> Vec<PathBuf> {
    let mut saida = Vec::new();
    let mut pilha = vec![raiz.to_path_buf()];
    while let Some(p) = pilha.pop() {
        let Ok(lista) = fs::read_dir(&p) else { continue };
        for e in lista.flatten() {
            let caminho = e.path();
            match e.file_type() {
                Ok(t) if t.is_dir() => pilha.push(caminho),
                Ok(t) if t.is_file() => saida.push(caminho),
                _ => {}
            }
        }
    }
    saida
}

fn apagar_pastas_vazias(raiz: &Path) {
    let Ok(lista) = fs::read_dir(raiz) else { return };
    for e in lista.flatten() {
        if e.file_type().is_ok_and(|t| t.is_dir()) {
            apagar_pastas_vazias(&e.path());
            let _ = fs::remove_dir(e.path()); // só some se estiver vazia
        }
    }
}

fn normalizar(rel: &str) -> String {
    rel.replace('\\', "/").trim_matches('/').to_string()
}

fn juntar(destino: &str, rel: &Path) -> String {
    let rel = normalizar(&rel.to_string_lossy());
    let destino = normalizar(destino);
    if destino.is_empty() {
        rel
    } else {
        format!("{destino}/{rel}")
    }
}

// ---------- observador (hot swap) ----------

/// Mantém a aplicação em dia com as fontes enquanto o servidor roda.
pub struct Sincronizador {
    _observador: RecommendedWatcher,
}

impl Sincronizador {
    /// `aviso` recebe os caminhos relativos copiados/apagados a cada lote de mudanças.
    pub fn iniciar(fontes: Vec<Fonte>, alvo: PathBuf, aviso: impl Fn(Vec<String>) + Send + 'static) -> Result<Self, String> {
        let (tx, rx) = mpsc::channel::<PathBuf>();
        let mut observador = notify::recommended_watcher(move |r: notify::Result<notify::Event>| {
            if let Ok(ev) = r {
                if matches!(ev.kind, EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)) {
                    for p in ev.paths {
                        let _ = tx.send(p);
                    }
                }
            }
        })
        .map_err(|e| e.to_string())?;
        for f in &fontes {
            let origem = Path::new(&f.origem);
            if origem.is_dir() {
                observador.watch(origem, RecursiveMode::Recursive).map_err(|e| format!("observar {}: {e}", f.origem))?;
            }
        }
        std::thread::spawn(move || {
            // Junta as mudanças que chegam juntas (o jdtls grava várias classes de uma vez).
            while let Ok(primeiro) = rx.recv() {
                let mut lote: HashSet<PathBuf> = HashSet::from([primeiro]);
                let limite = SystemTime::now() + Duration::from_millis(250);
                while let Ok(p) = rx.recv_timeout(Duration::from_millis(120)) {
                    lote.insert(p);
                    if SystemTime::now() > limite {
                        break;
                    }
                }
                let mudados = aplicar(&fontes, &alvo, lote);
                if !mudados.is_empty() {
                    aviso(mudados);
                }
            }
        });
        Ok(Self { _observador: observador })
    }
}

/// Copia (ou apaga) na aplicação cada arquivo alterado de uma fonte.
fn aplicar(fontes: &[Fonte], alvo: &Path, caminhos: HashSet<PathBuf>) -> Vec<String> {
    let mut mudados = Vec::new();
    for caminho in caminhos {
        let Some(rel) = destino_de(fontes, &caminho) else { continue };
        let destino = alvo.join(&rel);
        if caminho.is_file() {
            if precisa_copiar(&caminho, &destino) && copiar(&caminho, &destino).is_ok() {
                mudados.push(rel);
            }
        } else if !caminho.exists() && destino.is_file() && fs::remove_file(&destino).is_ok() {
            mudados.push(rel);
        }
    }
    mudados.sort();
    mudados
}

/// Onde um arquivo de uma fonte (pasta) fica dentro da aplicação.
fn destino_de(fontes: &[Fonte], caminho: &Path) -> Option<String> {
    // A última fonte que contém o arquivo é a que vale (como no espelho).
    fontes.iter().rev().find_map(|f| {
        let origem = Path::new(&f.origem);
        caminho.strip_prefix(origem).ok().filter(|r| !r.as_os_str().is_empty()).map(|rel| juntar(&f.destino, rel))
    })
}

#[cfg(test)]
mod testes {
    use super::*;

    fn pasta(nome: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("seedy-teste-{nome}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn escrever(p: &Path, texto: &str) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, texto).unwrap();
    }

    #[test]
    fn espelha_web_classes_e_jars_e_tira_o_que_sobrou() {
        let raiz = pasta("espelho");
        let web = raiz.join("webapp");
        let classes = raiz.join("classes");
        let jar = raiz.join("lib-1.0.jar");
        let alvo = raiz.join("app.war");
        escrever(&web.join("index.jsp"), "oi");
        escrever(&web.join("WEB-INF/web.xml"), "<web-app/>");
        escrever(&classes.join("br/App.class"), "cafe");
        escrever(&jar, "jar");
        escrever(&alvo.join("velho.jsp"), "sobrou");
        let fontes = vec![
            Fonte { origem: web.to_string_lossy().into(), destino: "".into() },
            Fonte { origem: classes.to_string_lossy().into(), destino: "WEB-INF/classes".into() },
            Fonte { origem: jar.to_string_lossy().into(), destino: "WEB-INF/lib/lib-1.0.jar".into() },
        ];
        let copiados = espelhar(&fontes, &alvo).unwrap();
        assert_eq!(copiados, ["WEB-INF/classes/br/App.class", "WEB-INF/lib/lib-1.0.jar", "WEB-INF/web.xml", "index.jsp"]);
        assert!(!alvo.join("velho.jsp").exists());
        // Sem mudança, nada é recopiado.
        assert!(espelhar(&fontes, &alvo).unwrap().is_empty());
        // Hot swap: um JSP alterado e uma classe apagada.
        escrever(&web.join("index.jsp"), "oi de novo");
        fs::remove_file(classes.join("br/App.class")).unwrap();
        let mudados = aplicar(&fontes, &alvo, HashSet::from([web.join("index.jsp"), classes.join("br/App.class")]));
        assert_eq!(mudados, ["WEB-INF/classes/br/App.class", "index.jsp"]);
        assert_eq!(fs::read_to_string(alvo.join("index.jsp")).unwrap(), "oi de novo");
        assert!(!alvo.join("WEB-INF/classes/br/App.class").exists());
        let _ = fs::remove_dir_all(&raiz);
    }

    #[test]
    fn destino_respeita_a_pasta_de_cada_fonte() {
        let fontes = vec![
            Fonte { origem: "/p/web".into(), destino: "".into() },
            Fonte { origem: "/p/target/classes".into(), destino: "WEB-INF/classes".into() },
        ];
        assert_eq!(destino_de(&fontes, Path::new("/p/web/css/a.css")).as_deref(), Some("css/a.css"));
        assert_eq!(destino_de(&fontes, Path::new("/p/target/classes/br/A.class")).as_deref(), Some("WEB-INF/classes/br/A.class"));
        assert_eq!(destino_de(&fontes, Path::new("/p/src/A.java")), None);
    }
}
