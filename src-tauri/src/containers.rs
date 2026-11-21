//! Fase 8 — Containers (mockups 15 e 16). Tudo pelo CLI do Docker (o mesmo no Windows,
//! com o Docker Desktop, e no Linux): listar e inspecionar, ações, compose e o tráfego
//! entre os containers, lido de /proc/net/tcp de dentro de cada um. A interface monta o
//! mapa (redes, depends_on, configuração e portas) com o que vem daqui.

use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::process::{Command, Stdio};

fn docker(args: &[&str]) -> Result<String, String> {
    let mut c = Command::new("docker");
    c.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let saida = c.output().map_err(|e| format!("não consegui rodar o docker (está instalado?): {e}"))?;
    if saida.status.success() {
        Ok(String::from_utf8_lossy(&saida.stdout).into_owned())
    } else {
        let erro = String::from_utf8_lossy(&saida.stderr);
        Err(erro.lines().find(|l| !l.trim().is_empty()).unwrap_or("o docker falhou").trim().to_string())
    }
}

/// Versão do servidor do Docker (Err = não instalado ou parado).
#[tauri::command]
pub async fn docker_versao() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| docker(&["version", "--format", "{{.Server.Version}}"]).map(|v| v.trim().to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Porta {
    container: u16,
    host: Option<u16>,
    protocolo: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rede {
    nome: String,
    ip: String,
    /// Nomes pelos quais os outros containers acham este (serviço do compose, aliases).
    apelidos: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Container {
    id: String,
    nome: String,
    imagem: String,
    estado: String,
    status: String,
    criado: String,
    iniciado: String,
    portas: Vec<Porta>,
    redes: Vec<Rede>,
    /// Variáveis de ambiente (a interface mascara as que parecem senha).
    ambiente: Vec<String>,
    compose_projeto: Option<String>,
    compose_servico: Option<String>,
    compose_pasta: Option<String>,
    /// `depends_on` do compose (nomes de serviço).
    depende_de: Vec<String>,
}

/// Todos os containers (rodando e parados), já inspecionados.
#[tauri::command]
pub async fn docker_listar() -> Result<Vec<Container>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let ids: Vec<String> = docker(&["ps", "-a", "-q", "--no-trunc"])?.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect();
        if ids.is_empty() {
            return Ok(vec![]);
        }
        let mut args = vec!["inspect"];
        args.extend(ids.iter().map(String::as_str));
        let lista: Vec<Value> = serde_json::from_str(&docker(&args)?).map_err(|e| format!("inspect inválido: {e}"))?;
        Ok(lista.iter().map(ler_container).collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn texto(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_string()
}

fn ler_container(v: &Value) -> Container {
    let rotulos = &v["Config"]["Labels"];
    let rotulo = |k: &str| rotulos[k].as_str().filter(|s| !s.is_empty()).map(String::from);
    let mut portas = Vec::new();
    if let Some(mapa) = v["NetworkSettings"]["Ports"].as_object() {
        for (chave, ligacoes) in mapa {
            let (num, proto) = chave.split_once('/').unwrap_or((chave, "tcp"));
            let Ok(container) = num.parse::<u16>() else { continue };
            let host = ligacoes.as_array().and_then(|l| l.iter().find_map(|b| b["HostPort"].as_str()?.parse::<u16>().ok()));
            if !portas.iter().any(|p: &Porta| p.container == container && p.host == host) {
                portas.push(Porta { container, host, protocolo: proto.to_string() });
            }
        }
    }
    portas.sort_by_key(|p| (p.host.is_none(), p.container));
    let mut redes = Vec::new();
    if let Some(mapa) = v["NetworkSettings"]["Networks"].as_object() {
        for (nome, r) in mapa {
            let mut apelidos: Vec<String> = r["Aliases"].as_array().map(|l| l.iter().filter_map(|a| a.as_str().map(String::from)).collect()).unwrap_or_default();
            if let Some(d) = r["DNSNames"].as_array() {
                apelidos.extend(d.iter().filter_map(|a| a.as_str().map(String::from)));
            }
            apelidos.sort();
            apelidos.dedup();
            redes.push(Rede { nome: nome.clone(), ip: texto(&r["IPAddress"]), apelidos });
        }
    }
    let depende_de = rotulo("com.docker.compose.depends_on")
        .map(|d| d.split(',').filter_map(|x| x.split(':').next()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
        .unwrap_or_default();
    Container {
        id: texto(&v["Id"]).chars().take(12).collect(),
        nome: texto(&v["Name"]).trim_start_matches('/').to_string(),
        imagem: texto(&v["Config"]["Image"]),
        estado: texto(&v["State"]["Status"]),
        status: texto(&v["State"]["Status"]),
        criado: texto(&v["Created"]),
        iniciado: texto(&v["State"]["StartedAt"]),
        portas,
        redes,
        ambiente: v["Config"]["Env"].as_array().map(|l| l.iter().filter_map(|e| e.as_str().map(String::from)).collect()).unwrap_or_default(),
        compose_projeto: rotulo("com.docker.compose.project"),
        compose_servico: rotulo("com.docker.compose.service"),
        compose_pasta: rotulo("com.docker.compose.project.working_dir"),
        depende_de,
    }
}

// ---------- tráfego entre containers ----------

/// Conexão TCP estabelecida de um container para outro.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Trafego {
    de: String,
    para: String,
    porta: u16,
    conexoes: u32,
}

/// Endereço `0100007F:1F90` (little-endian, como no /proc/net/tcp) → ("127.0.0.1", 8080).
fn endereco_ipv4(hex: &str) -> Option<(String, u16)> {
    let (ip, porta) = hex.split_once(':')?;
    if ip.len() != 8 {
        return None;
    }
    let n = u32::from_str_radix(ip, 16).ok()?;
    let b = n.to_le_bytes();
    Some((format!("{}.{}.{}.{}", b[0], b[1], b[2], b[3]), u16::from_str_radix(porta, 16).ok()?))
}

/// IPv4 mapeado em IPv6 (`0000000000000000FFFF0000 0200A8C0`) do /proc/net/tcp6.
fn endereco_ipv6(hex: &str) -> Option<(String, u16)> {
    let (ip, porta) = hex.split_once(':')?;
    if ip.len() != 32 || !ip[..24].eq_ignore_ascii_case("0000000000000000FFFF0000") {
        return None;
    }
    endereco_ipv4(&format!("{}:{}", &ip[24..], porta))
}

/// Do conteúdo de /proc/net/tcp(6): (portas escutando, conexões estabelecidas local→remoto).
fn ler_tcp(conteudo: &str) -> (HashSet<u16>, Vec<((String, u16), (String, u16))>) {
    let mut escuta = HashSet::new();
    let mut conexoes = Vec::new();
    for linha in conteudo.lines() {
        let c: Vec<&str> = linha.split_whitespace().collect();
        if c.len() < 4 || c[0] == "sl" {
            continue;
        }
        let ler = |h: &str| endereco_ipv4(h).or_else(|| endereco_ipv6(h));
        match c[3] {
            "0A" => {
                if let Some(porta) = c[1].rsplit_once(':').and_then(|(_, p)| u16::from_str_radix(p, 16).ok()) {
                    escuta.insert(porta);
                }
            }
            "01" => {
                if let (Some(l), Some(r)) = (ler(c[1]), ler(c[2])) {
                    conexoes.push((l, r));
                }
            }
            _ => {}
        }
    }
    (escuta, conexoes)
}

/// Quem fala com quem agora: em cada container rodando, as conexões TCP estabelecidas
/// para o IP de outro container numa porta em que ele escuta.
#[tauri::command]
pub async fn docker_trafego() -> Result<Vec<Trafego>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let ids: Vec<String> = docker(&["ps", "-q"])?.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect();
        if ids.is_empty() {
            return Ok(vec![]);
        }
        let mut args = vec!["inspect", "--format", "{{.Name}}{{range .NetworkSettings.Networks}} {{.IPAddress}}{{end}}"];
        args.extend(ids.iter().map(String::as_str));
        let mut ips: HashMap<String, String> = HashMap::new(); // ip → nome
        let mut nomes = Vec::new();
        for linha in docker(&args)?.lines() {
            let mut partes = linha.split_whitespace();
            let Some(nome) = partes.next().map(|n| n.trim_start_matches('/').to_string()) else { continue };
            for ip in partes {
                ips.insert(ip.to_string(), nome.clone());
            }
            nomes.push(nome);
        }
        // Lê de todos em paralelo (imagens sem `cat` só ficam de fora).
        let leituras: Vec<(String, Option<String>)> = std::thread::scope(|s| {
            let tarefas: Vec<_> = nomes
                .iter()
                .map(|n| s.spawn(move || (n.clone(), docker(&["exec", n, "cat", "/proc/net/tcp", "/proc/net/tcp6"]).ok())))
                .collect();
            tarefas.into_iter().filter_map(|t| t.join().ok()).collect()
        });
        let tabelas: HashMap<String, (HashSet<u16>, Vec<((String, u16), (String, u16))>)> =
            leituras.into_iter().filter_map(|(n, t)| t.map(|t| (n, ler_tcp(&t)))).collect();
        let mut contagem: HashMap<(String, String, u16), u32> = HashMap::new();
        for (de, (_, conexoes)) in &tabelas {
            for (_, (ip, porta)) in conexoes {
                let Some(para) = ips.get(ip) else { continue };
                if para == de {
                    continue;
                }
                // Só vale se o outro lado escuta nessa porta (senão é a resposta, não o pedido).
                let escuta = tabelas.get(para).map(|(e, _)| e.contains(porta)).unwrap_or(true);
                if escuta {
                    *contagem.entry((de.clone(), para.clone(), *porta)).or_default() += 1;
                }
            }
        }
        let mut lista: Vec<Trafego> = contagem.into_iter().map(|((de, para, porta), conexoes)| Trafego { de, para, porta, conexoes }).collect();
        lista.sort_by(|a, b| (&a.de, &a.para).cmp(&(&b.de, &b.para)));
        Ok(lista)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------- uso e ações ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Uso {
    nome: String,
    cpu: String,
    memoria: String,
}

/// CPU e memória dos containers rodando (uma leitura; leva ~2 s).
#[tauri::command]
pub async fn docker_uso() -> Result<Vec<Uso>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let saida = docker(&["stats", "--no-stream", "--format", "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"])?;
        Ok(saida
            .lines()
            .filter_map(|l| {
                let mut c = l.split('\t');
                Some(Uso { nome: c.next()?.to_string(), cpu: c.next()?.to_string(), memoria: c.next()?.split('/').next()?.trim().to_string() })
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// start / stop / restart de um container.
#[tauri::command]
pub async fn docker_acao(nome: String, acao: String) -> Result<(), String> {
    if !["start", "stop", "restart"].contains(&acao.as_str()) {
        return Err(format!("ação desconhecida: {acao}"));
    }
    tauri::async_runtime::spawn_blocking(move || docker(&[&acao, &nome]).map(|_| ())).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn le_enderecos_do_proc() {
        assert_eq!(endereco_ipv4("0100007F:1F90"), Some(("127.0.0.1".into(), 8080)));
        assert_eq!(endereco_ipv4("0300A8C0:1538"), Some(("192.168.0.3".into(), 5432)));
        assert_eq!(endereco_ipv6("0000000000000000FFFF00000300A8C0:1538"), Some(("192.168.0.3".into(), 5432)));
        assert_eq!(endereco_ipv6("00000000000000000000000001000000:1538"), None);
    }

    #[test]
    fn separa_escuta_e_conexoes() {
        let tcp = "  sl  local_address rem_address   st tx_queue\n   0: 00000000:1538 00000000:0000 0A 00000000\n   1: 0200120A:C350 0300120A:1538 01 00000000\n   2: 0200120A:C351 0300120A:1538 06 00000000\n";
        let (escuta, conexoes) = ler_tcp(tcp);
        assert!(escuta.contains(&5432));
        assert_eq!(conexoes, vec![(("10.18.0.2".to_string(), 50000), ("10.18.0.3".to_string(), 5432))]);
    }
}
