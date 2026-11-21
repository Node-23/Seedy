import type { AnaliseArquitetura, ComponenteAnalise, DesvioAnalise, MetodoAnalise } from '../nucleo/ponte';
import { nomeDoStatus } from './regras';

/**
 * Posições dos diagramas da Fase 9: a grade da arquitetura (domínios × camadas, mockup 17)
 * e o caminho de um método (de onde vem → para onde vai, mockup 19). Só geometria: a tela
 * desenha os blocos em HTML e as setas num SVG por cima.
 */

export type TipoSeta = 'chama' | 'dominio' | 'http' | 'desvio';
export type CorTexto = 'suave' | 'rosa' | 'destaque' | 'aviso' | 'erro' | 'sucesso';

export interface Seta {
  d: string;
  tipo: TipoSeta;
  rotulo?: string;
  rx?: number;
  ry?: number;
  /** Alinhamento do rótulo (o das setas verticais fica ao lado da linha). */
  ancora?: 'start' | 'middle' | 'end';
  de: string;
  para: string;
}

export interface Bloco {
  id: string;
  titulo: string;
  tituloCor?: CorTexto;
  sub: string;
  subCor: CorTexto;
  x: number;
  y: number;
  largura: number;
  altura: number;
  /** db (fundo), ext/tracejado (externo), erro (desvio). */
  estilo?: 'db' | 'ext' | 'erro' | 'tela-erro';
  comp?: string;
  metodo?: string;
  caminho?: string;
  linha?: number;
  coluna: number;
}

const LARGURA = 150;
const ALTURA = 72;

function curva(x1: number, y1: number, x2: number, y2: number): string {
  const meio = Math.max(18, Math.abs(x2 - x1) / 2);
  return `M${x1} ${y1} C${x1 + meio} ${y1} ${x2 - meio} ${y2} ${x2} ${y2}`;
}

function ligar(a: Bloco, b: Bloco): { d: string; rx: number; ry: number; ancora: 'start' | 'middle' | 'end' } {
  const ay = a.y + a.altura / 2;
  const by = b.y + b.altura / 2;
  if (b.x >= a.x + a.largura - 4) {
    const x1 = a.x + a.largura;
    const x2 = b.x - 2;
    return { d: curva(x1, ay, x2, by), rx: (x1 + x2) / 2, ry: (ay + by) / 2 - 6, ancora: 'middle' };
  }
  if (b.x + b.largura <= a.x + 4) {
    const x1 = a.x;
    const x2 = b.x + b.largura + 2;
    const meio = Math.max(18, (x1 - x2) / 2);
    return { d: `M${x1} ${ay} C${x1 - meio} ${ay} ${x2 + meio} ${by} ${x2} ${by}`, rx: (x1 + x2) / 2, ry: (ay + by) / 2 - 6, ancora: 'middle' };
  }
  // Mesma coluna: por cima/baixo.
  const desce = b.y > a.y;
  const x = a.x + a.largura / 2 + (desce ? 14 : -14);
  const y1 = desce ? a.y + a.altura : a.y;
  const y2 = desce ? b.y - 2 : b.y + b.altura + 2;
  const bx = b.x + b.largura / 2 + (desce ? 14 : -14);
  const m = (y2 - y1) / 2;
  return { d: `M${x} ${y1} C${x} ${y1 + m} ${bx} ${y2 - m} ${bx} ${y2}`, rx: desce ? x + 8 : x - 8, ry: (y1 + y2) / 2, ancora: desce ? 'start' : 'end' };
}

/** ReservaFormComponent → reserva-form. */
export function nomeDeTela(nome: string): string {
  return nome
    .replace(/Component$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

export function nomeCurto(id: string): string {
  return id.split('#').pop() ?? id;
}

// ---------- arquitetura ----------

export interface Camada {
  chave: 'tela' | 'front' | 'entrada' | 'servico' | 'repositorio' | 'banco';
  rotulo: string;
  x: number;
}

export interface Dominio {
  nome: string;
  y: number;
  altura: number;
}

export interface DesenhoArquitetura {
  camadas: Camada[];
  dominios: Dominio[];
  blocos: Bloco[];
  setas: Seta[];
  /** Linhas tracejadas entre o front e o back: x e a legenda de cada lado. */
  divisas: { x: number; rotulo: string }[];
  largura: number;
  altura: number;
}

const CAMADAS: { chave: Camada['chave']; rotulo: string; papeis: string[] }[] = [
  { chave: 'tela', rotulo: 'TELAS · NG', papeis: ['tela'] },
  { chave: 'front', rotulo: 'SERVIÇOS DO FRONT', papeis: ['front'] },
  { chave: 'entrada', rotulo: 'CONTROLLERS', papeis: ['entrada', 'job'] },
  { chave: 'servico', rotulo: 'SERVIÇOS', papeis: ['servico'] },
  { chave: 'repositorio', rotulo: 'REPOSITÓRIOS', papeis: ['repositorio'] },
  { chave: 'banco', rotulo: 'BANCO · EXTERNO', papeis: ['entidade'] },
];

export const PAPEIS_NA_GRADE = new Set(CAMADAS.flatMap((c) => c.papeis));

function resumo(c: ComponenteAnalise, regras: number): { sub: string; cor: CorTexto } {
  const endpoints = c.metodos.filter((m) => m.http);
  switch (c.papel) {
    case 'tela': {
      const n = c.metodos.reduce((s, m) => s + m.gatilhos.length, 0);
      return { sub: n ? `${n} ${n === 1 ? 'ação' : 'ações'} na tela` : (c.seletor ?? 'tela'), cor: 'suave' };
    }
    case 'front': {
      const n = c.metodos.reduce((s, m) => s + m.httpSaida.length, 0);
      return { sub: `${n} ${n === 1 ? 'chamada' : 'chamadas'} HTTP`, cor: 'suave' };
    }
    case 'entrada':
      if (regras) return { sub: `⚑ ${regras} ${regras === 1 ? 'regra' : 'regras'}`, cor: 'aviso' };
      if (endpoints.length === 1) return { sub: `${endpoints[0].http!.verbo} ${endpoints[0].http!.rota}`, cor: 'rosa' };
      return { sub: `${endpoints.length} endpoints`, cor: 'suave' };
    case 'job': {
      const a = c.metodos.find((m) => m.agendado);
      return { sub: a ? '@Scheduled' : 'rotina', cor: 'suave' };
    }
    case 'servico': {
      if (regras) return { sub: `⚑ ${regras} ${regras === 1 ? 'regra' : 'regras'}`, cor: 'aviso' };
      const n = c.metodos.filter((m) => m.nome !== c.nome).length;
      return { sub: `${n} ${n === 1 ? 'método' : 'métodos'}`, cor: 'suave' };
    }
    case 'repositorio':
      if (c.externo) return { sub: 'cliente HTTP', cor: 'suave' };
      return { sub: /Repository|Jpa|Crud/.test(c.estende ?? '') ? 'JPA' : 'DAO', cor: 'suave' };
    case 'entidade':
      return { sub: 'tabela', cor: 'suave' };
    default:
      return { sub: c.papel, cor: 'suave' };
  }
}

export function desenharArquitetura(a: AnaliseArquitetura, regrasPorComp: Map<string, number>): DesenhoArquitetura {
  const visiveis = a.componentes.filter((c) => PAPEIS_NA_GRADE.has(c.papel));
  const camadaDe = (c: ComponenteAnalise) => CAMADAS.findIndex((x) => x.papeis.includes(c.papel));
  // Camadas sem nada somem (um projeto só de back não mostra as do Angular).
  const usadas = CAMADAS.filter((_, i) => visiveis.some((c) => camadaDe(c) === i) || (CAMADAS[i].chave === 'banco' && visiveis.some((c) => c.externo)));
  const PASSO = 172;
  const camadas: Camada[] = usadas.map((c, i) => ({ chave: c.chave, rotulo: c.rotulo, x: 44 + i * PASSO }));
  const xDa = (chave: Camada['chave']) => camadas.find((c) => c.chave === chave)?.x ?? 44;

  const porDominio = new Map<string, ComponenteAnalise[]>();
  for (const c of visiveis) porDominio.set(c.dominio, [...(porDominio.get(c.dominio) ?? []), c]);
  const ordem = [...porDominio.keys()].sort((x, y) => porDominio.get(y)!.length - porDominio.get(x)!.length || x.localeCompare(y));

  const blocos: Bloco[] = [];
  const dominios: Dominio[] = [];
  let y = 40;
  for (const nome of ordem) {
    const lista = porDominio.get(nome)!;
    const celulas = new Map<Camada["chave"], ComponenteAnalise[]>();
    for (const c of lista) {
      const k = CAMADAS[camadaDe(c)].chave;
      celulas.set(k, [...(celulas.get(k) ?? []), c]);
    }
    const externos = [...new Set(lista.filter((c) => c.externo).map((c) => c.externo!))];
    const banco = (celulas.get('banco')?.length ?? 0) + externos.length;
    const linhas = Math.max(1, banco, ...[...celulas.entries()].filter(([k]) => k !== 'banco').map(([, v]) => v.length));
    const altura = linhas * (ALTURA + 14) + 10;
    dominios.push({ nome, y, altura });
    for (const [k, comps] of celulas) {
      comps.sort((p, q) => p.nome.localeCompare(q.nome));
      comps.forEach((c, i) => {
        const r = resumo(c, regrasPorComp.get(c.id) ?? 0);
        blocos.push({
          id: c.id,
          titulo: c.papel === 'tela' ? nomeDeTela(c.nome) : c.papel === 'entidade' ? (c.tabela ?? c.nome) : c.nome,
          sub: r.sub,
          subCor: r.cor,
          x: xDa(k),
          y: y + 10 + i * (ALTURA + 14),
          largura: LARGURA,
          altura: ALTURA,
          estilo: c.papel === 'entidade' ? 'db' : undefined,
          comp: c.id,
          caminho: c.caminho,
          linha: c.linha,
          coluna: camadas.findIndex((x) => x.chave === k),
        });
      });
    }
    const usadosNoBanco = celulas.get('banco')?.length ?? 0;
    externos.forEach((e, i) => {
      blocos.push({
        id: `ext:${e}`,
        titulo: e,
        tituloCor: 'rosa',
        sub: 'HTTP externa',
        subCor: 'suave',
        x: xDa('banco'),
        y: y + 10 + (usadosNoBanco + i) * (ALTURA + 14),
        largura: LARGURA,
        altura: ALTURA,
        estilo: 'ext',
        coluna: camadas.findIndex((x) => x.chave === 'banco'),
      });
    });
    y += altura + 14;
  }

  // Setas: injeção/chamadas, HTTP do front para a API, repositório → tabela, cliente → externo.
  const porId = new Map(blocos.map((b) => [b.id, b]));
  const comp = new Map(a.componentes.map((c) => [c.id, c]));
  const setas: Seta[] = [];
  const vistas = new Set<string>();
  const ligarBlocos = (de: string, para: string, tipo: TipoSeta, rotulo?: string) => {
    const b1 = porId.get(de);
    const b2 = porId.get(para);
    const chave = `${de}>${para}`;
    if (!b1 || !b2 || de === para || vistas.has(chave)) return;
    vistas.add(chave);
    const l = ligar(b1, b2);
    setas.push({ ...l, tipo, rotulo, de, para });
  };
  for (const c of visiveis) {
    for (const m of c.metodos) {
      for (const h of m.httpSaida) if (h.alvo) ligarBlocos(c.id, h.alvo.alvo, 'http');
    }
    if (c.papel === 'repositorio' && c.entidade) ligarBlocos(c.id, c.entidade, 'chama');
    if (c.externo) ligarBlocos(c.id, `ext:${c.externo}`, 'http');
    for (const u of c.usa) {
      const alvo = comp.get(u);
      if (!alvo || alvo.papel === 'entidade' || !porId.has(u)) continue;
      const outro = alvo.dominio !== c.dominio;
      // O que é chamado de outro domínio vira o rótulo ("confirmar").
      const metodo = outro ? c.metodos.flatMap((m) => m.chamadas).find((x) => x.alvo === u)?.metodo : undefined;
      ligarBlocos(c.id, u, outro ? 'dominio' : 'chama', metodo);
    }
  }

  // Divisa entre o front e o back.
  const divisas: DesenhoArquitetura['divisas'] = [];
  const iFront = camadas.findIndex((c) => c.chave === 'front' || c.chave === 'tela');
  const iBack = camadas.findIndex((c) => !['tela', 'front'].includes(c.chave));
  if (iFront >= 0 && iBack > 0) {
    const ng = a.tecnologias.find((t) => t.startsWith('Angular')) ?? 'Angular';
    const back = a.tecnologias.find((t) => !t.startsWith('Angular')) ?? 'Java';
    divisas.push({ x: camadas[iBack].x - 11, rotulo: `API · ${back}` });
    if (camadas[0].chave === 'tela' && camadas[1]?.chave === 'front') divisas.unshift({ x: camadas[1].x - 11, rotulo: `front · ${ng}` });
  }

  const largura = (camadas.at(-1)?.x ?? 0) + LARGURA + 40;
  return { camadas, dominios, blocos, setas, divisas, largura, altura: y + 30 };
}

// ---------- caminho de um método ----------

export interface Passo {
  bloco: string;
  /** Partes do texto: negrito no nome, cores nos detalhes. */
  partes: { texto: string; cor?: CorTexto; forte?: boolean }[];
  desvios: { texto: string; regra?: string }[];
}

export interface DesenhoCaminho {
  blocos: Bloco[];
  setas: Seta[];
  colunas: { x: number; rotulo: string }[];
  passos: Passo[];
  outras: { bloco: string; texto: string; sub: string }[];
  entradas: number;
  condicoes: number;
  largura: number;
  altura: number;
  foco: string;
}

interface Ponta {
  comp: ComponenteAnalise;
  metodo: string;
}

const chaveDe = (comp: string, metodo: string) => `${comp}.${metodo}`;

function operacao(metodo: string): string {
  if (/^(find|get|read|query|search|exists|count|list|load|stream)/.test(metodo)) return 'SELECT';
  if (/^(delete|remove)/.test(metodo)) return 'DELETE';
  if (/^(persist|insert|create)/.test(metodo)) return 'INSERT';
  if (/^(save|merge|update)/.test(metodo)) return 'INSERT/UPDATE';
  return 'SQL';
}

function rotaCurta(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, '').replace(/^\{\}/, '') || '/';
}

export function desenharCaminho(
  a: AnaliseArquitetura,
  foco: { comp: string; metodo: string },
  niveis: number,
  regrasDe: (comp: string, metodo: string, d?: DesvioAnalise) => string[],
): DesenhoCaminho | null {
  const comps = new Map(a.componentes.map((c) => [c.id, c]));
  const focal = comps.get(foco.comp);
  if (!focal) return null;
  const metodoDe = (c: ComponenteAnalise, nome: string): MetodoAnalise | undefined => c.metodos.find((m) => m.nome === nome);

  // Quem chama quem (de trás para frente), inclusive o HTTP do front para o endpoint.
  const quemChama = new Map<string, { de: Ponta; http?: string }[]>();
  for (const c of a.componentes) {
    if (c.papel === 'teste') continue;
    for (const m of c.metodos) {
      for (const ch of m.chamadas) {
        if (ch.alvo === c.id && ch.metodo === m.nome) continue;
        const k = chaveDe(ch.alvo, ch.metodo);
        quemChama.set(k, [...(quemChama.get(k) ?? []), { de: { comp: c, metodo: m.nome } }]);
      }
      for (const h of m.httpSaida) {
        if (!h.alvo) continue;
        const k = chaveDe(h.alvo.alvo, h.alvo.metodo);
        quemChama.set(k, [...(quemChama.get(k) ?? []), { de: { comp: c, metodo: m.nome }, http: `${h.verbo} ${rotaCurta(h.url)}` }]);
      }
    }
  }

  interface No {
    chave: string;
    coluna: number;
    bloco: Omit<Bloco, 'x' | 'y' | 'largura' | 'altura' | 'coluna'>;
    /** Para quem este aponta (o próximo no caminho). */
    filhoDe?: string;
    ordem: number;
  }
  const nos = new Map<string, No>();
  const ligacoes: { de: string; para: string; tipo: TipoSeta; rotulo?: string }[] = [];
  let ordem = 0;

  const blocoDoMetodo = (c: ComponenteAnalise, nome: string, chave: string): No['bloco'] => {
    const m = metodoDe(c, nome);
    const http = m?.http ? `${m.http.verbo} ${m.http.rota}` : null;
    const titulo = c.papel === 'tela' ? nomeDeTela(c.nome) : c.nome;
    let sub = `.${nome}`;
    let subCor: CorTexto = 'suave';
    const g = c.papel === 'tela' ? m?.gatilhos[0] : undefined;
    // Método de tela chamado pelo template: o bloco é a própria entrada (o botão).
    if (g) return { id: chave, titulo, tituloCor: 'rosa', sub: rotuloDoGatilho(g), subCor: 'suave', comp: c.id, metodo: nome, caminho: g.caminho, linha: g.linha };
    if (m?.agendado) sub = `@Scheduled ${resumoAgenda(m.agendado)}`;
    else if (c.papel === 'front' && m?.httpSaida[0]) {
      sub = `${m.httpSaida[0].verbo} ${rotaCurta(m.httpSaida[0].url)}`;
      subCor = 'rosa';
    } else if (http) sub = `.${nome} · ${m!.http!.verbo}`;
    return { id: chave, titulo: c.papel === 'front' ? `${c.nome}.${nome}` : titulo, sub, subCor, comp: c.id, metodo: nome, caminho: c.caminho, linha: m?.linha ?? c.linha };
  };

  const chaveFoco = chaveDe(focal.id, foco.metodo);
  const mFoco = metodoDe(focal, foco.metodo);
  const regrasFoco = regrasDe(focal.id, foco.metodo);
  nos.set(chaveFoco, {
    chave: chaveFoco,
    coluna: 0,
    ordem: ordem++,
    bloco: { id: chaveFoco, titulo: focal.papel === 'tela' ? nomeDeTela(focal.nome) : focal.nome, sub: `.${foco.metodo}${regrasFoco.length ? `  ⚑ ${regrasFoco.join(' ')}` : ''}`, subCor: 'destaque', comp: focal.id, metodo: foco.metodo, caminho: focal.caminho, linha: mFoco?.linha ?? focal.linha },
  });

  // Telas: o template chama o método (o botão vira a entrada).
  const adicionarGatilhos = (c: ComponenteAnalise, nome: string, chave: string, coluna: number) => {
    const m = metodoDe(c, nome);
    for (const g of m?.gatilhos ?? []) {
      const k = `tela:${chave}:${g.linha}`;
      if (nos.has(k)) continue;
      nos.set(k, {
        chave: k,
        coluna: coluna - 1,
        ordem: ordem++,
        filhoDe: chave,
        bloco: { id: k, titulo: nomeDeTela(c.nome), tituloCor: 'rosa', sub: rotuloDoGatilho(g), subCor: 'suave', comp: c.id, metodo: nome, caminho: g.caminho, linha: g.linha },
      });
      ligacoes.push({ de: k, para: chave, tipo: 'chama' });
    }
  };

  // De onde vem: quem chama, nível por nível.
  let fronteira = [chaveFoco];
  adicionarGatilhos(focal, foco.metodo, chaveFoco, 0);
  for (let nivel = 1; nivel <= niveis && fronteira.length; nivel++) {
    const proxima: string[] = [];
    for (const k of fronteira) {
      for (const q of quemChama.get(k) ?? []) {
        const kq = chaveDe(q.de.comp.id, q.de.metodo);
        if (!nos.has(kq)) {
          nos.set(kq, { chave: kq, coluna: -nivel, ordem: ordem++, filhoDe: k, bloco: blocoDoMetodo(q.de.comp, q.de.metodo, kq) });
          proxima.push(kq);
        }
        if (!ligacoes.some((l) => l.de === kq && l.para === k)) ligacoes.push({ de: kq, para: k, tipo: q.http ? 'http' : 'chama', rotulo: q.http?.split(' ')[0] });
      }
    }
    fronteira = proxima;
  }

  // Para onde vai: as chamadas do método, na ordem do código; repositório → tabela.
  const descer = (c: ComponenteAnalise, nome: string, chave: string, nivel: number) => {
    if (nivel > niveis) return;
    const m = metodoDe(c, nome);
    if (!m) return;
    for (const ch of m.chamadas) {
      const alvo = comps.get(ch.alvo);
      if (!alvo) continue;
      const k = chaveDe(alvo.id, ch.metodo);
      if (k === chaveFoco) continue;
      const novo = !nos.has(k);
      if (novo) {
        const b = blocoDoMetodo(alvo, ch.metodo, k);
        nos.set(k, { chave: k, coluna: nivel, ordem: ordem++, bloco: { ...b, titulo: alvo.papel === 'tela' ? nomeDeTela(alvo.nome) : alvo.nome } });
      }
      if (!ligacoes.some((l) => l.de === chave && l.para === k)) ligacoes.push({ de: chave, para: k, tipo: 'chama' });
      if (!novo) continue;
      if (alvo.papel === 'repositorio' && alvo.tabela) {
        const kt = `tabela:${alvo.tabela}:${operacao(ch.metodo)}`;
        if (!nos.has(kt)) nos.set(kt, { chave: kt, coluna: nivel + 1, ordem: ordem++, bloco: { id: kt, titulo: alvo.tabela, sub: operacao(ch.metodo), subCor: 'suave', estilo: 'db', comp: alvo.entidade ?? undefined, caminho: comps.get(alvo.entidade ?? '')?.caminho, linha: comps.get(alvo.entidade ?? '')?.linha } });
        ligacoes.push({ de: k, para: kt, tipo: 'chama' });
      }
      if (alvo.externo) {
        const ke = `ext:${alvo.externo}`;
        if (!nos.has(ke)) nos.set(ke, { chave: ke, coluna: nivel + 1, ordem: ordem++, bloco: { id: ke, titulo: alvo.externo, tituloCor: 'rosa', sub: 'HTTP externa', subCor: 'suave', estilo: 'ext' } });
        ligacoes.push({ de: k, para: ke, tipo: 'http' });
      }
      descer(alvo, ch.metodo, k, nivel + 1);
    }
    // Do front para a API.
    for (const h of m.httpSaida) {
      const alvo = h.alvo ? comps.get(h.alvo.alvo) : null;
      if (!alvo || !h.alvo) continue;
      const k = chaveDe(alvo.id, h.alvo.metodo);
      if (k === chaveFoco) continue;
      if (!nos.has(k)) {
        nos.set(k, { chave: k, coluna: nivel, ordem: ordem++, bloco: blocoDoMetodo(alvo, h.alvo.metodo, k) });
        ligacoes.push({ de: chave, para: k, tipo: 'http', rotulo: h.verbo });
        descer(alvo, h.alvo.metodo, k, nivel + 1);
      }
    }
  };
  descer(focal, foco.metodo, chaveFoco, 1);

  // Posições: colunas por distância do método; cada coluna centrada na linha do método.
  const PASSO_X = 180;
  const PASSO_Y = 88;
  const colunasUsadas = [...new Set([...nos.values()].map((n) => n.coluna))].sort((x, y) => x - y);
  const minimo = colunasUsadas[0] ?? 0;
  const porColuna = new Map<number, No[]>();
  for (const n of [...nos.values()].sort((x, y) => x.ordem - y.ordem)) porColuna.set(n.coluna, [...(porColuna.get(n.coluna) ?? []), n]);
  const maior = Math.max(...[...porColuna.values()].map((v) => v.length));
  const yMeio = 46 + ((maior - 1) / 2) * PASSO_Y;
  const blocos: Bloco[] = [];
  for (const [coluna, lista] of porColuna) {
    lista.forEach((n, i) => {
      const largura = n.chave === chaveFoco ? 168 : n.bloco.estilo === 'db' ? 134 : 154;
      blocos.push({
        ...n.bloco,
        x: 20 + (coluna - minimo) * PASSO_X,
        y: Math.round(yMeio + (i - (lista.length - 1) / 2) * PASSO_Y),
        largura,
        altura: ALTURA,
        coluna: coluna - minimo,
      });
    });
  }
  const porId = new Map(blocos.map((b) => [b.id, b]));
  const setas: Seta[] = [];
  for (const l of ligacoes) {
    const b1 = porId.get(l.de);
    const b2 = porId.get(l.para);
    if (!b1 || !b2) continue;
    setas.push({ ...ligar(b1, b2), tipo: l.tipo, rotulo: l.rotulo, de: l.de, para: l.para });
  }

  // Desvios do método: blocos vermelhos numa linha embaixo, terminando sob o método (à
  // esquerda ficam as colunas de entrada, que são curtas), com a condição em cima de cada um.
  const desvios = mFoco?.desvios ?? [];
  const bFoco = porId.get(chaveFoco)!;
  const LARGURA_DESVIO = 168;
  const larguraDaFila = desvios.length * (LARGURA_DESVIO + 14) - 14;
  const inicioX = Math.max(20, Math.min(bFoco.x + bFoco.largura / 2 - larguraDaFila / 2, bFoco.x + bFoco.largura - larguraDaFila));
  const fimX = inicioX + larguraDaFila;
  const fundo = Math.max(bFoco.y + bFoco.altura, ...blocos.filter((b) => b.x < fimX && b.x + b.largura > inicioX).map((b) => b.y + b.altura)) + 70;
  const blocosDesvio: Bloco[] = desvios.map((d, i) => {
    const regras = regrasDe(focal.id, foco.metodo, d);
    return {
      id: `desvio:${i}`,
      titulo: d.status ? `${d.status} ${nomeDoStatus(d.status)}`.trim() : (d.excecao ?? 'desvio'),
      tituloCor: 'erro',
      sub: d.status && d.excecao ? `${d.excecao}${regras.length ? ` · ${regras.join(' ')}` : ''}` : d.acao,
      subCor: 'suave',
      x: Math.round(inicioX + i * (LARGURA_DESVIO + 14)),
      y: fundo,
      largura: LARGURA_DESVIO,
      altura: ALTURA,
      estilo: 'erro',
      comp: focal.id,
      metodo: foco.metodo,
      caminho: focal.caminho,
      linha: d.linha,
      coluna: bFoco.coluna,
    };
  });
  blocosDesvio.forEach((b, i) => {
    const x1 = bFoco.x + bFoco.largura / 2 + (i - (desvios.length - 1) / 2) * 16;
    const y1 = bFoco.y + bFoco.altura;
    const x2 = b.x + b.largura / 2;
    const y2 = b.y - 20;
    const cond = (desvios[i].condicao ?? 'sempre').replace(/ vazio$/, ' não acha');
    setas.push({ d: `M${x1} ${y1} C${x1} ${y1 + 30} ${x2} ${y2 - 30} ${x2} ${y2}`, tipo: 'desvio', rotulo: encurtar(cond, 23), rx: x2, ry: b.y - 6, ancora: 'middle', de: chaveFoco, para: b.id });
  });
  blocos.push(...blocosDesvio);

  // A tela recebe o erro de volta.
  const ehTela = (b: Bloco) => b.coluna < bFoco.coluna && !!b.comp && comps.get(b.comp)?.papel === 'tela';
  const tela = blocos.find(ehTela);
  const comStatus = blocosDesvio.filter((_, i) => desvios[i].status);
  if (tela && comStatus.length) {
    const volta: Bloco = { ...tela, id: 'tela:erro', sub: 'mostra o erro', subCor: 'suave', y: fundo, estilo: 'tela-erro' };
    if (volta.x + volta.largura > comStatus[0].x - 20) volta.y = fundo + ALTURA + 34;
    blocos.push(volta);
    const primeiro = comStatus[0];
    const sx = primeiro.x + primeiro.largura / 2;
    const sy = primeiro.y + primeiro.altura;
    const ex = volta.x + volta.largura + 2;
    const ey = volta.y + volta.altura / 2;
    const fundoVolta = Math.max(sy, ey) + 40;
    const codigos = [...new Set(comStatus.map((b) => desvios[blocosDesvio.indexOf(b)].status))].join(' · ');
    setas.push({ d: `M${sx} ${sy} C${sx} ${fundoVolta} ${ex + 60} ${ey} ${ex} ${ey}`, tipo: 'desvio', rotulo: `${codigos} · a tela mostra o erro`, rx: ex + 12, ry: ey + 22, ancora: 'start', de: primeiro.id, para: volta.id });
  }

  // Rótulos das colunas.
  const colunas = colunasUsadas.map((c) => {
    const lista = porColuna.get(c) ?? [];
    const papeis = lista.map((n) => (n.bloco.comp ? comps.get(n.bloco.comp)?.papel : null));
    let rotulo = 'PARA ONDE VAI';
    if (c === 0) rotulo = 'O MÉTODO';
    else if (c < 0 && papeis.every((p) => p === 'tela')) rotulo = 'ENTRADA · TELA';
    else if (lista.every((n) => n.bloco.estilo === 'db' || n.bloco.estilo === 'ext')) rotulo = lista.some((n) => n.bloco.estilo === 'ext') ? (lista.some((n) => n.bloco.estilo === 'db') ? 'BANCO · EXTERNO' : 'EXTERNO') : 'BANCO';
    else if (c < 0 && papeis.every((p) => p === 'front')) rotulo = 'FRONT';
    else if (c < 0 && papeis.every((p) => p === 'entrada' || p === 'job')) rotulo = 'API';
    else if (c < 0) rotulo = 'QUEM CHAMA';
    else if (papeis.every((p) => p === 'entrada')) rotulo = 'API';
    return { x: 26 + (c - minimo) * PASSO_X, rotulo };
  });

  // Passo a passo: a entrada principal (a tela, se houver) até o método, e depois o que ele chama.
  const passos: Passo[] = [];
  const outras: DesenhoCaminho['outras'] = [];
  const entradas = [...nos.values()].filter((n) => n.coluna < 0 && ![...nos.values()].some((x) => x.filhoDe === n.chave));
  const principal = entradas.find((n) => n.chave.startsWith('tela:') || (n.bloco.comp && comps.get(n.bloco.comp)?.papel === 'tela')) ?? [...entradas].sort((x, y) => x.coluna - y.coluna)[0];
  const cadeia: No[] = [];
  for (let n: No | undefined = principal; n && n.chave !== chaveFoco; n = n.filhoDe ? nos.get(n.filhoDe) : undefined) cadeia.push(n);
  for (const n of cadeia) passos.push(passo(n.bloco, comps, metodoDe));
  const pFoco = passo(nos.get(chaveFoco)!.bloco, comps, metodoDe);
  pFoco.desvios = desvios.map((d) => ({ texto: `${d.condicao ? encurtar(d.condicao.replace(/ vazio$/, ' não acha'), 30) : 'sempre'} → ${d.status ?? d.excecao ?? ''}`, regra: regrasDe(focal.id, foco.metodo, d)[0] }));
  passos.push(pFoco);
  for (const n of [...nos.values()].filter((x) => x.coluna > 0 && x.bloco.estilo !== 'db').sort((x, y) => x.ordem - y.ordem)) passos.push(passo(n.bloco, comps, metodoDe));
  for (const n of entradas) {
    if (n === principal || cadeia.includes(n)) continue;
    const c = n.bloco.comp ? comps.get(n.bloco.comp) : null;
    const m = c && n.bloco.metodo ? metodoDe(c, n.bloco.metodo) : undefined;
    outras.push({ bloco: n.chave, texto: c ? `${c.nome}.${n.bloco.metodo}` : n.bloco.titulo, sub: m?.agendado ? resumoAgenda(m.agendado) : m?.http ? `${m.http.verbo} ${m.http.rota}` : '' });
  }

  const largura = Math.max(...blocos.map((b) => b.x + b.largura)) + 40;
  const altura = Math.max(...blocos.map((b) => b.y + b.altura)) + 60;
  return { blocos, setas, colunas, passos, outras, entradas: Math.max(1, entradas.length), condicoes: desvios.length, largura, altura, foco: chaveFoco };
}

function rotuloDoGatilho(g: { evento: string; texto: string }): string {
  const evento = g.evento === 'click' ? 'botão' : g.evento === 'ngSubmit' || g.evento === 'submit' ? 'envio' : g.evento;
  return g.texto ? `${evento} "${g.texto}"` : evento;
}

function resumoAgenda(a: string): string {
  const cron = /cron\s*=\s*"0 (\d+) (\d+) \* \* \*"/.exec(a);
  if (cron) return `${cron[2].padStart(2, '0')}:${cron[1].padStart(2, '0')}`;
  const ms = /fixed(?:Rate|Delay)\s*=\s*(\d+)/.exec(a);
  if (ms) return `a cada ${Number(ms[1]) >= 60000 ? `${Number(ms[1]) / 60000} min` : `${Number(ms[1]) / 1000} s`}`;
  return '';
}

function encurtar(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function passo(b: Omit<Bloco, 'x' | 'y' | 'largura' | 'altura' | 'coluna'>, comps: Map<string, ComponenteAnalise>, metodoDe: (c: ComponenteAnalise, n: string) => MetodoAnalise | undefined): Passo {
  const c = b.comp ? comps.get(b.comp) : undefined;
  const m = c && b.metodo ? metodoDe(c, b.metodo) : undefined;
  const nome = c && b.metodo ? `${c.nome}.${b.metodo}` : b.titulo;
  if (b.id.startsWith('tela:') || (c?.papel === 'tela' && m?.gatilhos.length)) {
    const texto = b.sub.replace(/^botão /, '');
    return { bloco: b.id, partes: [{ texto: b.sub.startsWith('botão') ? 'Clique em ' : 'Na tela: ' }, { texto: texto.replace(/"/g, ''), forte: true }, { texto: `  ${b.titulo}.html:${b.linha}`, cor: 'suave' }], desvios: [] };
  }
  if (b.estilo === 'db') return { bloco: b.id, partes: [{ texto: b.sub === 'SELECT' ? 'lê ' : b.sub === 'DELETE' ? 'apaga em ' : 'grava em ' }, { texto: b.titulo, cor: 'destaque' }], desvios: [] };
  if (b.estilo === 'ext') return { bloco: b.id, partes: [{ texto: 'chama por HTTP ' }, { texto: b.titulo, cor: 'rosa' }], desvios: [] };
  if (c?.papel === 'front' && m?.httpSaida[0]) return { bloco: b.id, partes: [{ texto: nome, forte: true }, { texto: ' faz ' }, { texto: `${m.httpSaida[0].verbo} ${rotaCurta(m.httpSaida[0].url)}`, cor: 'rosa' }], desvios: [] };
  if (m?.http) return { bloco: b.id, partes: [{ texto: nome, forte: true }, { texto: ' recebe ' }, { texto: `${m.http.verbo} ${m.http.rota}`, cor: 'rosa' }], desvios: [] };
  if (m?.agendado) return { bloco: b.id, partes: [{ texto: nome, forte: true }, { texto: ` roda sozinho ${resumoAgenda(m.agendado)}`, cor: 'suave' }], desvios: [] };
  if (c?.papel === 'repositorio' && c.tabela) return { bloco: b.id, partes: [{ texto: nome, forte: true }, { texto: ` ${operacao(b.metodo ?? '') === 'SELECT' ? 'lê' : 'grava'} ` }, { texto: c.tabela, cor: 'destaque' }], desvios: [] };
  return { bloco: b.id, partes: [{ texto: nome, forte: true }], desvios: [] };
}
