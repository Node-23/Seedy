/**
 * Usos de classes e métodos Java fora do Java: XML (Struts, Tiles, Spring),
 * JSP (EL `${obj.prop}`, `jsp:useBean`), .properties, YAML...
 * O jdtls só enxerga código Java; esta busca textual completa os usos dele
 * (a "busca híbrida" do ROADMAP).
 */
import { Ocorrencia, ponte } from '../nucleo/ponte';

/** Arquivos de configuração e de visão onde classes/métodos aparecem por nome. */
const CONFIGURACAO = '*.xml, *.jsp, *.jspf, *.jspx, *.tag, *.tagx, *.tld, *.xhtml, *.html, *.ftl, *.vm, *.properties, *.yml, *.yaml';
/** Onde aparece Expression Language (`${feira.nome}`). */
const VISOES = '*.jsp, *.jspf, *.jspx, *.tag, *.tagx, *.xhtml';

const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `package br.com.x;` + `Feira` → `br.com.x.Feira` (null se o arquivo não declara pacote). */
export function nomeCompleto(conteudo: string, classe: string): string | null {
  const pacote = /^\s*package\s+([\w.]+)\s*;/m.exec(conteudo)?.[1];
  return pacote ? `${pacote}.${classe}` : null;
}

/** `getNome` / `isAtivo` / `setNome` → `nome` / `ativo` (propriedade de JavaBean, usada na EL). */
export function propriedadeDe(metodo: string): string | null {
  const m = /^(?:get|is|set)([A-Z]\w*)$/.exec(metodo);
  return m ? m[1][0].toLowerCase() + m[1].slice(1) : null;
}

/**
 * Ocorrências fora do Java. Para classe, passe o nome completo (é assim que XML
 * e JSP se referem a ela); para método, o nome (e a propriedade, se for getter/setter).
 */
export async function usosEmConfiguracao(raiz: string, alvo: { classe?: string | null; metodo?: string | null }): Promise<Ocorrencia[]> {
  const buscas: Promise<Ocorrencia[]>[] = [];
  const buscar = (consulta: string, opcoes: Parameters<typeof ponte.buscarTexto>[3]) =>
    ponte.buscarTexto(raiz, consulta, 200, opcoes).catch(() => [] as Ocorrencia[]);

  if (alvo.classe) buscas.push(buscar(alvo.classe, { diferenciar: true, mascara: CONFIGURACAO }));
  if (alvo.metodo) {
    buscas.push(buscar(alvo.metodo, { diferenciar: true, palavra: true, mascara: CONFIGURACAO }));
    const prop = propriedadeDe(alvo.metodo);
    if (prop) buscas.push(buscar(`\\.${escapar(prop)}\\b`, { diferenciar: true, regex: true, mascara: VISOES }));
  }
  const vistos = new Set<string>();
  return (await Promise.all(buscas)).flat().filter((o) => {
    const chave = `${o.caminho}:${o.linha}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

/** Onde, na linha, está o termo procurado (para o Monaco destacar). */
export function colunaDoUso(linha: string, alvo: { classe?: string | null; metodo?: string | null }): { inicio: number; fim: number } | null {
  const termos = [alvo.classe, alvo.metodo, alvo.metodo ? propriedadeDe(alvo.metodo) : null].filter((t): t is string => !!t);
  for (const t of termos) {
    const i = linha.search(new RegExp(`\\b${escapar(t)}\\b`));
    if (i >= 0) return { inicio: i, fim: i + t.length };
  }
  return null;
}
