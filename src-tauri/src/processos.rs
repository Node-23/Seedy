//! Os processos que o Seedy inicia (jdtls, a classe main do RUN/DEBUG, servidores, scripts, terminais,
//! Claude Code) não podem sobreviver a ele. No Windows o próprio Seedy entra num "job" que mata todos os
//! descendentes quando o processo termina (inclusive se ele cair); nos outros sistemas, ao sair ele
//! encerra a árvore de filhos. O que deve continuar vivo (navegador aberto por link, instalador da
//! atualização) usa `spawn_livre`, que sai do job.

use std::process::{Child, Command};

/// Windows: coloca o Seedy num job com `KILL_ON_JOB_CLOSE`. Os filhos herdam o job; quando o Seedy
/// morre, o sistema encerra todos. Chamado uma vez, no começo.
#[cfg(windows)]
pub fn prender_filhos() {
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_BREAKAWAY_OK, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::GetCurrentProcess;
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_BREAKAWAY_OK;
        let ok = SetInformationJobObject(job, JobObjectExtendedLimitInformation, &info as *const _ as *const _, std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32);
        // O handle fica aberto de propósito: o job fecha (e mata os filhos) quando o Seedy termina.
        if ok != 0 {
            AssignProcessToJobObject(job, GetCurrentProcess());
        }
    }
}

#[cfg(not(windows))]
pub fn prender_filhos() {}

/// Linux e macOS: ao sair, encerra todos os descendentes (filhos, netos...). No Windows o job já faz isso.
#[cfg(not(windows))]
pub fn encerrar_descendentes() {
    fn filhos_de(pid: u32) -> Vec<u32> {
        let Ok(saida) = Command::new("pgrep").args(["-P", &pid.to_string()]).output() else { return vec![] };
        String::from_utf8_lossy(&saida.stdout).lines().filter_map(|l| l.trim().parse().ok()).collect()
    }
    let mut todos = Vec::new();
    let mut fila = vec![std::process::id()];
    while let Some(p) = fila.pop() {
        for f in filhos_de(p) {
            todos.push(f);
            fila.push(f);
        }
    }
    // Do mais fundo para o mais raso, com TERM; o que insistir leva KILL.
    for p in todos.iter().rev() {
        let _ = Command::new("kill").args(["-TERM", &p.to_string()]).output();
    }
    std::thread::sleep(std::time::Duration::from_millis(400));
    for p in todos.iter().rev() {
        let _ = Command::new("kill").args(["-KILL", &p.to_string()]).output();
    }
}

#[cfg(windows)]
pub fn encerrar_descendentes() {}

/// Inicia um processo que deve continuar depois que o Seedy fechar (o navegador de um link, o instalador).
/// No Windows sai do job dos filhos (se o job não permitir, roda do jeito normal).
pub fn spawn_livre(c: &mut Command, flags_base: u32) -> std::io::Result<Child> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
        c.creation_flags(flags_base | CREATE_BREAKAWAY_FROM_JOB);
        match c.spawn() {
            Ok(f) => return Ok(f),
            Err(_) => {
                c.creation_flags(flags_base);
            }
        }
    }
    #[cfg(not(windows))]
    let _ = flags_base;
    c.spawn()
}
