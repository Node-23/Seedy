//! Observa a pasta do projeto e avisa a interface quando arquivos mudam fora do
//! editor (git checkout, build, outro programa): a árvore se atualiza sozinha,
//! a busca reindexa, o jdtls fica sabendo e buffers não alterados recarregam.
//!
//! As mudanças chegam em lote: espera a rajada assentar (300 ms sem eventos).

use notify::event::ModifyKind;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

/// Pastas de saída e dependências: mudam o tempo todo e não interessam.
const IGNORADAS: &[&str] = &["target", "build", "out", "node_modules", "dist", ".idea", ".gradle"];
const ESPERA: Duration = Duration::from_millis(300);

#[derive(Default)]
pub struct Observador(Mutex<Option<RecommendedWatcher>>);

#[derive(Serialize, Default, Debug, PartialEq)]
pub struct Mudancas {
    pub criados: BTreeSet<String>,
    pub removidos: BTreeSet<String>,
    pub alterados: BTreeSet<String>,
    /// `.git/HEAD` mudou: trocou de branch.
    pub git: bool,
}

impl Mudancas {
    fn vazio(&self) -> bool {
        self.criados.is_empty() && self.removidos.is_empty() && self.alterados.is_empty() && !self.git
    }
}

/// Começa a observar `raiz` (e para de observar o projeto anterior).
#[tauri::command]
pub fn projeto_observar(app: AppHandle, estado: State<'_, Observador>, raiz: String) -> Result<(), String> {
    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    let mut observador = notify::recommended_watcher(tx).map_err(|e| format!("não consegui observar o projeto: {e}"))?;
    observador
        .watch(Path::new(&raiz), RecursiveMode::Recursive)
        .map_err(|e| format!("não consegui observar {raiz}: {e}"))?;
    // Trocar o observador derruba o anterior; o canal dele fecha e a thread dele acaba.
    *estado.0.lock().unwrap() = Some(observador);

    std::thread::spawn(move || {
        let raiz = PathBuf::from(raiz);
        while let Ok(primeiro) = rx.recv() {
            let mut lote = Mudancas::default();
            acumular(&mut lote, primeiro, &raiz);
            loop {
                match rx.recv_timeout(ESPERA) {
                    Ok(evento) => acumular(&mut lote, evento, &raiz),
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
            if !lote.vazio() {
                let _ = app.emit("arquivos-alterados", &lote);
            }
        }
    });
    Ok(())
}

fn acumular(lote: &mut Mudancas, evento: notify::Result<Event>, raiz: &Path) {
    let Ok(evento) = evento else { return };
    for caminho in &evento.paths {
        let Ok(relativo) = caminho.strip_prefix(raiz) else { continue };
        let partes: Vec<String> = relativo.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
        if partes.first().map(String::as_str) == Some(".git") {
            if partes.len() == 2 && partes[1] == "HEAD" {
                lote.git = true;
            }
            continue;
        }
        if partes.iter().any(|p| IGNORADAS.contains(&p.as_str())) {
            continue;
        }
        let texto = caminho.to_string_lossy().into_owned();
        match evento.kind {
            EventKind::Create(_) => {
                lote.removidos.remove(&texto);
                lote.criados.insert(texto);
            }
            EventKind::Remove(_) => {
                lote.criados.remove(&texto);
                lote.alterados.remove(&texto);
                lote.removidos.insert(texto);
            }
            // Renomear chega como dois eventos (origem e destino): decide pelo que existe agora.
            EventKind::Modify(ModifyKind::Name(_)) => {
                if caminho.exists() {
                    lote.criados.insert(texto);
                } else {
                    lote.removidos.insert(texto);
                }
            }
            EventKind::Modify(_) => {
                if !lote.criados.contains(&texto) {
                    lote.alterados.insert(texto);
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use notify::event::{CreateKind, DataChange, RemoveKind};

    fn evento(tipo: EventKind, caminho: &str) -> notify::Result<Event> {
        Ok(Event::new(tipo).add_path(PathBuf::from(caminho)))
    }

    #[test]
    fn agrupa_e_ignora_pastas_de_saida() {
        let raiz = PathBuf::from("/p");
        let mut lote = Mudancas::default();
        acumular(&mut lote, evento(EventKind::Create(CreateKind::File), "/p/src/A.java"), &raiz);
        acumular(&mut lote, evento(EventKind::Modify(ModifyKind::Data(DataChange::Content)), "/p/src/A.java"), &raiz);
        acumular(&mut lote, evento(EventKind::Modify(ModifyKind::Data(DataChange::Content)), "/p/pom.xml"), &raiz);
        acumular(&mut lote, evento(EventKind::Remove(RemoveKind::File), "/p/src/B.java"), &raiz);
        acumular(&mut lote, evento(EventKind::Create(CreateKind::File), "/p/target/classes/A.class"), &raiz);
        acumular(&mut lote, evento(EventKind::Modify(ModifyKind::Any), "/p/.git/index"), &raiz);
        acumular(&mut lote, evento(EventKind::Modify(ModifyKind::Any), "/p/.git/HEAD"), &raiz);

        let s = |p: &str| PathBuf::from(p).to_string_lossy().into_owned();
        assert_eq!(lote.criados, BTreeSet::from([s("/p/src/A.java")]));
        assert_eq!(lote.alterados, BTreeSet::from([s("/p/pom.xml")]));
        assert_eq!(lote.removidos, BTreeSet::from([s("/p/src/B.java")]));
        assert!(lote.git);
    }
}

/// Fechou o projeto: derruba o observador (a thread dele acaba junto).
#[tauri::command]
pub fn projeto_parar_de_observar(estado: State<'_, Observador>) {
    *estado.0.lock().unwrap() = None;
}
