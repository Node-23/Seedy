//! Envio de um relatório de falha do Seedy ao Sentry, só quando o desenvolvedor aperta o botão.
//! É um POST no formato "envelope" do Sentry, sem o SDK deles: nada é coletado sozinho.

use std::time::Duration;

use serde_json::{json, Value};

/// DSN do projeto no Sentry (`https://CHAVE@HOST/PROJETO`). É um endereço público, feito para ir
/// dentro do app: só permite mandar eventos, não ler. Vazio = envio não configurado.
const DSN: &str = "https://a62fd703849c79f795be3a7def1fa564@o4512503754457088.ingest.us.sentry.io/4512503771103232";

/// Do DSN saem o endereço de envio e a chave pública.
fn destino(dsn: &str) -> Option<(String, String)> {
    let (esquema, resto) = dsn.trim().split_once("://")?;
    let (chave, resto) = resto.split_once('@')?;
    let (host, projeto) = resto.trim_end_matches('/').rsplit_once('/')?;
    if !matches!(esquema, "http" | "https") || chave.is_empty() || host.is_empty() || projeto.is_empty() {
        return None;
    }
    // DSN antigo traz a chave secreta junto (`publica:secreta`); só a pública é usada.
    let chave = chave.split(':').next()?;
    Some((format!("{esquema}://{host}/api/{projeto}/envelope/"), chave.to_string()))
}

/// Cabeçalho, cabeçalho do item e o evento, um por linha.
fn envelope(evento: &Value) -> String {
    format!("{}\n{}\n{evento}\n", json!({ "event_id": evento["event_id"] }), json!({ "type": "event" }))
}

fn enviar(dsn: &str, evento: &Value) -> Result<(), String> {
    let (url, chave) = destino(dsn).ok_or("o envio de relatórios ainda não está configurado")?;
    let resposta = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(20))
        .redirects(0)
        .build()
        .post(&url)
        .set("Content-Type", "application/x-sentry-envelope")
        .set("X-Sentry-Auth", &format!("Sentry sentry_version=7, sentry_client=seedy/{}, sentry_key={chave}", env!("CARGO_PKG_VERSION")))
        .send_string(&envelope(evento));
    match resposta {
        Ok(r) if r.status() < 300 => Ok(()),
        Err(ureq::Error::Status(429, _)) => Err("o limite de relatórios foi atingido; tente mais tarde".into()),
        Ok(r) => Err(format!("o servidor de relatórios respondeu {}", r.status())),
        Err(ureq::Error::Status(c, _)) => Err(format!("o servidor de relatórios respondeu {c}")),
        Err(e) => Err(format!("sem conexão com o servidor de relatórios ({e})")),
    }
}

#[tauri::command]
pub async fn relatorio_enviar(evento: Value) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || enviar(DSN, &evento)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod testes {
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;

    use super::*;

    #[test]
    fn le_o_dsn() {
        assert_eq!(
            destino("https://abc@o1.ingest.us.sentry.io/42"),
            Some(("https://o1.ingest.us.sentry.io/api/42/envelope/".into(), "abc".into()))
        );
        assert_eq!(destino("https://abc:segredo@sentry.exemplo.com/7").unwrap().1, "abc");
        for ruim in ["", "https://sentry.io/42", "ftp://abc@sentry.io/42", "https://abc@sentry.io"] {
            assert_eq!(destino(ruim), None, "{ruim}");
        }
    }

    /// Um servidor local no lugar do Sentry: confere o que sai pela rede.
    fn receber(status: &'static str) -> (Result<(), String>, String) {
        let ouvinte = TcpListener::bind("127.0.0.1:0").unwrap();
        let porta = ouvinte.local_addr().unwrap().port();
        let servidor = std::thread::spawn(move || {
            let (mut conexao, _) = ouvinte.accept().unwrap();
            let mut leitor = BufReader::new(conexao.try_clone().unwrap());
            let (mut pedido, mut tamanho) = (String::new(), 0);
            loop {
                let mut linha = String::new();
                leitor.read_line(&mut linha).unwrap();
                if let Some(v) = linha.to_lowercase().strip_prefix("content-length:") {
                    tamanho = v.trim().parse().unwrap();
                }
                pedido.push_str(&linha);
                if linha == "\r\n" {
                    break;
                }
            }
            let mut corpo = vec![0; tamanho];
            leitor.read_exact(&mut corpo).unwrap();
            write!(conexao, "HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
            pedido + &String::from_utf8(corpo).unwrap()
        });
        let evento = json!({ "event_id": "0123456789abcdef0123456789abcdef", "message": { "formatted": "não deu" } });
        let resultado = enviar(&format!("http://chave@127.0.0.1:{porta}/42"), &evento);
        (resultado, servidor.join().unwrap())
    }

    #[test]
    fn manda_o_envelope() {
        let (resultado, pedido) = receber("200 OK");
        assert_eq!(resultado, Ok(()));
        assert!(pedido.starts_with("POST /api/42/envelope/ HTTP/1.1"), "{pedido}");
        assert!(pedido.contains("sentry_key=chave"));
        let linhas: Vec<Value> = pedido.split("\r\n\r\n").nth(1).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(linhas[0]["event_id"], "0123456789abcdef0123456789abcdef");
        assert_eq!(linhas[1]["type"], "event");
        assert_eq!(linhas[2]["message"]["formatted"], "não deu");
    }

    #[test]
    fn recusa_vira_erro() {
        assert!(receber("429 Too Many Requests").0.unwrap_err().contains("limite"));
        assert!(receber("403 Forbidden").0.unwrap_err().contains("403"));
        assert!(enviar("", &json!({})).unwrap_err().contains("não está configurado"));
    }
}
