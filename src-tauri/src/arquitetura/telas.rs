//! Telas e rotas que não estão no código Java/TS em si: os mapeamentos do Struts (1 e 2,
//! no struts-config.xml / struts.xml), os formulários e links das JSPs, as rotas do Angular
//! (`Routes`) e para onde cada tela navega (`router.navigate`, `routerLink`).

use regex::Regex;
use std::sync::OnceLock;

fn re(cache: &'static OnceLock<Regex>, padrao: &str) -> &'static Regex {
    cache.get_or_init(|| Regex::new(padrao).expect("regex"))
}

fn linha_de(texto: &str, pos: usize) -> u32 {
    texto[..pos.min(texto.len())].matches('\n').count() as u32 + 1
}

fn atributo(attrs: &str, nome: &str) -> Option<String> {
    let r = Regex::new(&format!(r#"(?i)(?:^|\s){nome}\s*=\s*(?:"([^"]*)"|'([^']*)')"#)).ok()?;
    r.captures(attrs).and_then(|c| c.get(1).or(c.get(2))).map(|m| m.as_str().trim().to_string())
}

fn sem_tags(s: &str) -> String {
    static TAG: OnceLock<Regex> = OnceLock::new();
    re(&TAG, r"<[^>]*>").replace_all(s, " ").split_whitespace().collect::<Vec<_>>().join(" ")
}

// ---------- Struts ----------

#[derive(Debug, Clone)]
pub struct MapeamentoStruts {
    /// "/reserva.do" (Struts 1) ou "/loja/reservar.action" (Struts 2).
    pub rota: String,
    pub classe: String,
    /// Método do Struts 2 (`method="salvar"`); sem ele, `execute`.
    pub metodo: Option<String>,
    /// Para onde a ação encaminha (forwards / results): caminhos das JSPs.
    pub resultados: Vec<String>,
    pub linha: u32,
}

pub fn struts(texto: &str) -> Vec<MapeamentoStruts> {
    static ACAO: OnceLock<Regex> = OnceLock::new();
    static PACOTE: OnceLock<Regex> = OnceLock::new();
    static FORWARD: OnceLock<Regex> = OnceLock::new();
    static RESULT: OnceLock<Regex> = OnceLock::new();
    let acao = re(&ACAO, r#"(?s)<action\s([^>]*?)(?:/>|>(.*?)</action>)"#);
    let struts1 = texto.contains("<action-mappings") || texto.contains("struts-config");
    // Struts 2: o namespace vem do <package> em volta.
    let pacotes: Vec<(usize, String)> = re(&PACOTE, r#"<package\b([^>]*)>"#)
        .captures_iter(texto)
        .map(|c| (c.get(0).unwrap().start(), atributo(&c[1], "namespace").unwrap_or_default()))
        .collect();
    let mut lista = Vec::new();
    for c in acao.captures_iter(texto) {
        let pos = c.get(0).unwrap().start();
        let attrs = &c[1];
        let corpo = c.get(2).map(|m| m.as_str()).unwrap_or("");
        let mut resultados: Vec<String> = Vec::new();
        if struts1 {
            let Some(caminho) = atributo(attrs, "path") else { continue };
            let Some(tipo) = atributo(attrs, "type") else { continue };
            for f in re(&FORWARD, r#"<forward\b([^>]*)/?>"#).captures_iter(corpo) {
                if let Some(p) = atributo(&f[1], "path") {
                    resultados.push(p);
                }
            }
            if let Some(input) = atributo(attrs, "input") {
                resultados.push(input);
            }
            let rota = format!("/{}.do", caminho.trim_start_matches('/'));
            lista.push(MapeamentoStruts { rota, classe: tipo.rsplit('.').next().unwrap_or(&tipo).to_string(), metodo: None, resultados, linha: linha_de(texto, pos) });
        } else {
            let Some(nome) = atributo(attrs, "name") else { continue };
            let Some(classe) = atributo(attrs, "class") else { continue };
            for r in re(&RESULT, r#"(?s)<result\b[^>]*>(.*?)</result>"#).captures_iter(corpo) {
                let v = r[1].trim();
                if v.ends_with(".jsp") {
                    resultados.push(v.to_string());
                }
            }
            let ns = pacotes.iter().filter(|(p, _)| *p < pos).last().map(|(_, n)| n.clone()).unwrap_or_default();
            let rota = format!("{}/{}.action", ns.trim_end_matches('/'), nome.trim_start_matches('/'));
            let rota = if rota.starts_with('/') { rota } else { format!("/{rota}") };
            lista.push(MapeamentoStruts { rota, classe: classe.rsplit('.').next().unwrap_or(&classe).to_string(), metodo: atributo(attrs, "method"), resultados, linha: linha_de(texto, pos) });
        }
    }
    lista
}

/// Regras do validation.xml do Struts (commons-validator): (formulário, campo, regras, linha).
pub fn validacoes_xml(texto: &str) -> Vec<(String, String, String, u32)> {
    static FORM: OnceLock<Regex> = OnceLock::new();
    static CAMPO: OnceLock<Regex> = OnceLock::new();
    let mut lista = Vec::new();
    for f in re(&FORM, r#"(?s)<form\s+name\s*=\s*"([^"]+)"[^>]*>(.*?)</form>"#).captures_iter(texto) {
        let base = f.get(2).unwrap().start();
        for c in re(&CAMPO, r#"<field\b([^>]*)>"#).captures_iter(&f[2]) {
            let (Some(campo), Some(regras)) = (atributo(&c[1], "property"), atributo(&c[1], "depends")) else { continue };
            lista.push((f[1].to_string(), campo, regras, linha_de(texto, base + c.get(0).unwrap().start())));
        }
    }
    lista
}

// ---------- JSP ----------

#[derive(Debug, Clone)]
pub struct AlvoJsp {
    pub url: String,
    pub verbo: &'static str,
    pub linha: u32,
    /// Texto do botão de envio ou do link.
    pub texto: String,
    /// "submit" (formulário) ou "click" (link).
    pub evento: &'static str,
}

/// Formulários e links de uma JSP que vão para uma ação (Struts, servlet, controller) ou
/// para outra JSP.
pub fn alvos_jsp(texto: &str) -> Vec<AlvoJsp> {
    static FORM: OnceLock<Regex> = OnceLock::new();
    static ENVIO: OnceLock<Regex> = OnceLock::new();
    static LINK: OnceLock<Regex> = OnceLock::new();
    let mut lista = Vec::new();
    for c in re(&FORM, r#"(?is)<(html:form|s:form|form:form|form)\b([^>]*)>"#).captures_iter(texto) {
        let tag = c[1].to_lowercase();
        let attrs = &c[2];
        let Some(mut url) = atributo(attrs, "action") else { continue };
        if tag == "s:form" {
            if let Some(ns) = atributo(attrs, "namespace") {
                url = format!("{}/{}", ns.trim_end_matches('/'), url.trim_start_matches('/'));
            }
            if !url.contains('.') {
                url.push_str(".action");
            }
        }
        if tag == "html:form" && !url.contains(".do") {
            url = format!("{}.do", url.trim_end_matches('/'));
        }
        let fim = c.get(0).unwrap().end();
        let fecha = texto[fim..].to_lowercase().find(&format!("</{tag}")).map(|i| fim + i).unwrap_or(texto.len());
        let dentro = &texto[fim..fecha];
        let botao = re(&ENVIO, r#"(?is)<(?:input|html:submit|s:submit)\b[^>]*?\bvalue\s*=\s*"([^"]*)"|<(?:button|html:submit)\b[^>]*>(.*?)</(?:button|html:submit)>"#)
            .captures(dentro)
            .and_then(|b| b.get(1).or(b.get(2)))
            .map(|m| sem_tags(m.as_str()))
            .unwrap_or_default();
        let metodo = atributo(attrs, "method").map(|m| m.to_uppercase());
        let verbo = match metodo.as_deref() {
            Some("GET") => "GET",
            Some(_) => "POST",
            None if tag == "form" => "GET",
            None => "POST",
        };
        lista.push(AlvoJsp { url, verbo, linha: linha_de(texto, c.get(0).unwrap().start()), texto: botao, evento: "submit" });
    }
    for c in re(&LINK, r#"(?is)<(a|html:link|s:a)\b([^>]*)>(.*?)</(?:a|html:link|s:a)>"#).captures_iter(texto) {
        let attrs = &c[2];
        let url = match c[1].to_lowercase().as_str() {
            "html:link" => atributo(attrs, "action").map(|a| format!("{}.do", a.trim_end_matches(".do"))).or_else(|| atributo(attrs, "page")).or_else(|| atributo(attrs, "href")),
            "s:a" => atributo(attrs, "action").map(|a| format!("{a}.action")).or_else(|| atributo(attrs, "href")),
            _ => atributo(attrs, "href"),
        };
        let Some(url) = url else { continue };
        let limpa = url.split(['?', '#']).next().unwrap_or("");
        if !(limpa.ends_with(".do") || limpa.ends_with(".action") || limpa.ends_with(".jsp")) {
            continue;
        }
        lista.push(AlvoJsp { url, verbo: "GET", linha: linha_de(texto, c.get(0).unwrap().start()), texto: sem_tags(&c[3]), evento: "click" });
    }
    lista.sort_by_key(|a| a.linha);
    lista
}

// ---------- Angular: rotas e navegação ----------

#[derive(Debug, Clone, PartialEq)]
pub struct RotaNg {
    /// "/reservas/:id".
    pub caminho: String,
    pub componente: String,
    pub linha: u32,
}

/// Fecho do `[`/`{` em `m[abre]` (texto já mascarado).
fn fechar(m: &[u8], abre: usize) -> usize {
    let (a, f) = if m[abre] == b'[' { (b'[', b']') } else { (b'{', b'}') };
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

/// As rotas de um arquivo TS (`Routes = [...]`, `forRoot([...])`, `provideRouter([...])`),
/// com os `children` juntando o caminho do pai.
pub fn rotas_angular(texto: &str, mascara: &str) -> Vec<RotaNg> {
    static INICIO: OnceLock<Regex> = OnceLock::new();
    let r = re(&INICIO, r"(?:\bRoutes\s*=|\bforRoot\s*\(|\bforChild\s*\(|\bprovideRouter\s*\()\s*\[");
    let mut lista = Vec::new();
    for c in r.find_iter(mascara) {
        let abre = c.end() - 1;
        lista_de_rotas(texto, mascara, abre, "", &mut lista);
    }
    lista
}

fn lista_de_rotas(texto: &str, mascara: &str, abre: usize, prefixo: &str, saida: &mut Vec<RotaNg>) {
    static PATH: OnceLock<Regex> = OnceLock::new();
    static COMP: OnceLock<Regex> = OnceLock::new();
    static LAZY: OnceLock<Regex> = OnceLock::new();
    static FILHOS: OnceLock<Regex> = OnceLock::new();
    let m = mascara.as_bytes();
    let fecha = fechar(m, abre);
    let mut i = abre + 1;
    while i < fecha {
        if m[i] != b'{' {
            i += 1;
            continue;
        }
        let fim = fechar(m, i);
        // Só as chaves do próprio objeto: o que está em {} e [] aninhados vira espaço.
        let mut proprio = texto.as_bytes()[i + 1..fim].to_vec();
        let mut d = 0i32;
        for (k, &c) in m[i + 1..fim].iter().enumerate() {
            match c {
                b'{' | b'[' => d += 1,
                b'}' | b']' => d -= 1,
                _ => {}
            }
            if d > 0 {
                proprio[k] = b' ';
            }
        }
        let proprio = String::from_utf8_lossy(&proprio).into_owned();
        let caminho = re(&PATH, r#"\bpath\s*:\s*['"`]([^'"`]*)['"`]"#).captures(&proprio).map(|c| c[1].to_string());
        let completo = format!("{}/{}", prefixo.trim_end_matches('/'), caminho.clone().unwrap_or_default().trim_start_matches('/'));
        let completo = if completo.len() > 1 { completo.trim_end_matches('/').to_string() } else { "/".to_string() };
        let comp = re(&COMP, r"\bcomponent\s*:\s*([A-Za-z_$][\w$]*)").captures(&proprio).map(|c| c[1].to_string()).or_else(|| {
            re(&LAZY, r"\bloadComponent\s*:[\s\S]*?\.then\s*\(\s*\(?\s*([\w$]+)\s*\)?\s*=>\s*[\w$]+\s*\.\s*([\w$]+)").captures(&proprio).map(|c| c[2].to_string())
        });
        if let (Some(_), Some(componente)) = (&caminho, comp) {
            saida.push(RotaNg { caminho: completo.clone(), componente, linha: linha_de(texto, i) });
        }
        if let Some(f) = re(&FILHOS, r"\bchildren\s*:\s*\[").find(&mascara[i..fim]) {
            lista_de_rotas(texto, mascara, i + f.end() - 1, &completo, saida);
        }
        i = fim + 1;
    }
}

/// `['/reservas', r.id]` → "/reservas/*".
fn rota_de_partes(partes: &str) -> String {
    let mut segs: Vec<String> = Vec::new();
    for p in partes.split(',') {
        let p = p.trim();
        if p.is_empty() {
            continue;
        }
        let literal = (p.starts_with('\'') && p.ends_with('\'')) || (p.starts_with('"') && p.ends_with('"'));
        if literal && p.len() >= 2 {
            segs.extend(p[1..p.len() - 1].split('/').filter(|s| !s.is_empty()).map(str::to_string));
        } else {
            segs.push("*".into());
        }
    }
    format!("/{}", segs.join("/"))
}

/// `this.router.navigate([...])` / `navigateByUrl('...')` num trecho de código: (rota, posição).
pub fn navegacoes_ts(codigo: &str) -> Vec<(String, usize)> {
    static NAV: OnceLock<Regex> = OnceLock::new();
    static URL: OnceLock<Regex> = OnceLock::new();
    let mut lista: Vec<(String, usize)> = re(&NAV, r"\.navigate\s*\(\s*\[([^\]]*)\]").captures_iter(codigo).map(|c| (rota_de_partes(&c[1]), c.get(0).unwrap().start())).collect();
    for c in re(&URL, r#"\.navigateByUrl\s*\(\s*['"`]([^'"`]+)['"`]"#).captures_iter(codigo) {
        let rota = c[1].split('/').filter(|s| !s.is_empty()).map(|s| if s.contains("${") { "*" } else { s }).collect::<Vec<_>>().join("/");
        lista.push((format!("/{rota}"), c.get(0).unwrap().start()));
    }
    lista.sort_by_key(|(_, p)| *p);
    lista
}

/// `routerLink="/feiras"` e `[routerLink]="['/feiras', f.id]"` no template: (rota, linha, texto do link).
pub fn links_template(html: &str) -> Vec<(String, u32, String)> {
    static FIXO: OnceLock<Regex> = OnceLock::new();
    static LIGADO: OnceLock<Regex> = OnceLock::new();
    let texto_do = |fim: usize| -> String {
        let depois = &html[fim..];
        depois.find('>').map(|i| sem_tags(depois[i + 1..].split("</").next().unwrap_or(""))).unwrap_or_default()
    };
    let mut lista = Vec::new();
    for c in re(&FIXO, r#"(?:^|[\s<])routerLink\s*=\s*"([^"]+)""#).captures_iter(html) {
        let rota = format!("/{}", c[1].trim().trim_start_matches('/'));
        lista.push((rota, linha_de(html, c.get(0).unwrap().start()), texto_do(c.get(0).unwrap().end())));
    }
    for c in re(&LIGADO, r#"\[routerLink\]\s*=\s*"\s*\[([^\]]*)\]\s*""#).captures_iter(html) {
        lista.push((rota_de_partes(&c[1]), linha_de(html, c.get(0).unwrap().start()), texto_do(c.get(0).unwrap().end())));
    }
    lista.sort_by_key(|(_, l, _)| *l);
    lista
}

/// A rota do Angular (`reservas/:id`) atende a navegação (`/reservas/*`)?
#[cfg(test)]
pub fn casa_rota(padrao: &str, url: &str) -> bool {
    pontos_da_rota(padrao, url).is_some()
}

/// Quanto a rota combina com a navegação: trecho igual vale mais que parâmetro (`:id`), que
/// vale mais que um trecho fixo casando com um valor variável (`nova` × `r.id`).
pub fn pontos_da_rota(padrao: &str, url: &str) -> Option<usize> {
    let p: Vec<&str> = padrao.split('/').filter(|s| !s.is_empty()).collect();
    let u: Vec<&str> = url.split(['?', '#']).next().unwrap_or("").split('/').filter(|s| !s.is_empty()).collect();
    if p.iter().any(|s| *s == "**") || p.len() != u.len() {
        return None;
    }
    let mut pontos = 1;
    for (a, b) in p.iter().zip(&u) {
        pontos += if a == b {
            3
        } else if a.starts_with(':') {
            2
        } else if *b == "*" {
            1
        } else {
            return None;
        };
    }
    Some(pontos)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn struts1_e_struts2() {
        let s1 = r#"<struts-config><action-mappings>
  <action path="/reserva" type="br.gov.app.reserva.ReservaAction" name="reservaForm" input="/WEB-INF/jsp/reserva/form.jsp">
    <forward name="sucesso" path="/WEB-INF/jsp/reserva/ok.jsp"/>
  </action>
</action-mappings></struts-config>"#;
        let m = struts(s1);
        assert_eq!(m[0].rota, "/reserva.do");
        assert_eq!(m[0].classe, "ReservaAction");
        assert!(m[0].resultados.contains(&"/WEB-INF/jsp/reserva/ok.jsp".to_string()));
        let s2 = r#"<struts><package name="loja" namespace="/loja" extends="struts-default">
  <action name="reservar" class="br.app.ReservaAction" method="salvar"><result name="success">/reserva/ok.jsp</result></action>
</package></struts>"#;
        let m = struts(s2);
        assert_eq!((m[0].rota.as_str(), m[0].metodo.as_deref()), ("/loja/reservar.action", Some("salvar")));
        assert_eq!(m[0].resultados, vec!["/reserva/ok.jsp".to_string()]);
    }

    #[test]
    fn jsp_formularios_e_links() {
        let jsp = r#"<%@ taglib prefix="html" uri="http://struts.apache.org/tags-html" %>
<html:form action="/reserva">
  <html:text property="numero"/>
  <html:submit>Reservar</html:submit>
</html:form>
<a href="feiras.do?acao=listar">Ver feiras</a>
<a href="ajuda.html">Ajuda</a>"#;
        let a = alvos_jsp(jsp);
        assert_eq!(a.len(), 2);
        assert_eq!((a[0].url.as_str(), a[0].verbo, a[0].texto.as_str(), a[0].linha), ("/reserva.do", "POST", "Reservar", 2));
        assert_eq!((a[1].url.as_str(), a[1].texto.as_str()), ("feiras.do?acao=listar", "Ver feiras"));
    }

    #[test]
    fn rotas_do_angular() {
        let ts = r#"export const routes: Routes = [
  { path: '', component: FeiraListaComponent },
  { path: 'reservas', children: [
      { path: 'nova', component: ReservaFormComponent },
      { path: ':id', loadComponent: () => import('./reserva/detalhe.component').then((m) => m.ReservaDetalheComponent) },
  ] },
  { path: '**', redirectTo: '' },
];"#;
        let mascara = crate::arquitetura::mascarar(ts);
        let r = rotas_angular(ts, &mascara);
        let pares: Vec<(String, String)> = r.iter().map(|x| (x.caminho.clone(), x.componente.clone())).collect();
        assert!(pares.contains(&("/".into(), "FeiraListaComponent".into())), "{pares:?}");
        assert!(pares.contains(&("/reservas/nova".into(), "ReservaFormComponent".into())), "{pares:?}");
        assert!(pares.contains(&("/reservas/:id".into(), "ReservaDetalheComponent".into())), "{pares:?}");
        assert_eq!(pares.len(), 3, "o pai (só children) não é rota de tela: {pares:?}");
        assert!(casa_rota("/reservas/:id", "/reservas/*"));
        assert!(!casa_rota("/reservas/nova", "/reservas/*/editar"));
        assert_eq!(navegacoes_ts("this.router.navigate(['/reservas', r.id]);")[0].0, "/reservas/*");
        let links = links_template(r#"<a routerLink="/reservas/nova">Nova reserva</a> <a [routerLink]="['/reservas', r.id]">ver</a>"#);
        assert_eq!(links[0], ("/reservas/nova".to_string(), 1, "Nova reserva".to_string()));
        assert_eq!(links[1].0, "/reservas/*");
    }
}
