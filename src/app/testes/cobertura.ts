import type { AnaliseArquitetura, ComponenteAnalise, RegraAnalise, ResultadoTeste, TesteInfo } from '../nucleo/ponte';

/**
 * O que os testes cobrem das regras de negócio, lido do código: quais testes chegam até o método
 * da regra (direto ou por até 3 chamadas) e, entre eles, quais conferem um erro. O passou/falhou
 * vem da última execução. Não é cobertura de linhas: é "algum teste passa por aqui".
 */

export type EstadoDeTeste = 'ok' | 'falhou' | 'ignorado' | 'desconhecido';
export type EstadoDeCenario = 'sem' | 'coberto' | 'falhou';

export interface Cenario {
  id: string;
  rotulo: string;
  /** feliz = o caminho sem erro; erro = um desvio que a regra barra. */
  tipo: 'feliz' | 'erro';
  estado: EstadoDeCenario;
  testes: TesteInfo[];
}

export interface CoberturaDaRegra {
  chave: string;
  cenarios: Cenario[];
  /** Todos os testes que chegam no método da regra (feliz ou erro). */
  testes: TesteInfo[];
  estado: 'sem' | 'completa' | 'so-feliz' | 'so-erro' | 'falhando';
}

export const chaveDoResultado = (classe: string, metodo: string): string => `${classe}.${metodo}`;

export function estadoDoTeste(t: TesteInfo, resultados: ReadonlyMap<string, ResultadoTeste>): EstadoDeTeste {
  if (t.linguagem !== 'java') return resultados.get(t.id)?.estado ?? 'desconhecido';
  return resultados.get(chaveDoResultado(t.classe, t.metodo))?.estado ?? 'desconhecido';
}

const cache = new WeakMap<AnaliseArquitetura, Map<string, Set<string>>>();

/** Para cada teste: os `componente.método` que ele alcança (o que cita + o que esses chamam, até 3 saltos). */
function alcance(a: AnaliseArquitetura): Map<string, Set<string>> {
  const pronto = cache.get(a);
  if (pronto) return pronto;
  const comps = new Map(a.componentes.map((c) => [c.id, c]));
  const saida = new Map<string, Set<string>>();
  for (const t of a.testes ?? []) {
    const chamadas = new Set(t.chamadas);
    const alvo = new Set<string>();
    let fronteira: string[] = [];
    for (const id of t.componentes) {
      const c = comps.get(id);
      for (const m of c?.metodos ?? []) {
        if (chamadas.has(m.nome)) {
          const k = `${id}.${m.nome}`;
          if (!alvo.has(k)) {
            alvo.add(k);
            fronteira.push(k);
          }
        }
      }
    }
    for (let salto = 0; salto < 3 && fronteira.length; salto++) {
      const proximos: string[] = [];
      for (const k of fronteira) {
        const i = k.lastIndexOf('.');
        const c: ComponenteAnalise | undefined = comps.get(k.slice(0, i));
        const m = c?.metodos.find((x) => x.nome === k.slice(i + 1));
        for (const ch of m?.chamadas ?? []) {
          const n = `${ch.alvo}.${ch.metodo}`;
          if (!alvo.has(n)) {
            alvo.add(n);
            proximos.push(n);
          }
        }
      }
      fronteira = proximos;
    }
    saida.set(t.id, alvo);
  }
  cache.set(a, saida);
  return saida;
}

export function testesQueChegam(a: AnaliseArquitetura, comp: string, metodo: string | null): TesteInfo[] {
  if (!metodo) return [];
  const al = alcance(a);
  return (a.testes ?? []).filter((t) => al.get(t.id)?.has(`${comp}.${metodo}`));
}

const rotuloDoErro = (r: RegraAnalise): string => {
  const quando = r.mensagem ? `“${r.mensagem}”` : r.excecao ?? r.condicao ?? r.tipo;
  return r.status ? `${quando} → ${r.status}` : quando;
};

function estadoDoGrupo(ts: TesteInfo[], resultados: ReadonlyMap<string, ResultadoTeste>): EstadoDeCenario {
  if (!ts.length) return 'sem';
  return ts.some((t) => estadoDoTeste(t, resultados) === 'falhou') ? 'falhou' : 'coberto';
}

export function coberturaDaRegra(a: AnaliseArquitetura, r: RegraAnalise, resultados: ReadonlyMap<string, ResultadoTeste>): CoberturaDaRegra {
  const porId = new Map((a.testes ?? []).map((t) => [t.id, t]));
  const doMetodo = testesQueChegam(a, r.componente, r.metodo);
  const cenarios: Cenario[] = [];
  const feliz = doMetodo.filter((t) => !t.esperaErro);
  if (r.metodo) cenarios.push({ id: 'feliz', rotulo: 'caminho feliz', tipo: 'feliz', estado: estadoDoGrupo(feliz, resultados), testes: feliz });
  // Os desvios do mesmo método (inclusive o desta regra): cada um é um cenário que dá errado.
  const irmaos = a.regras.filter((x) => x.componente === r.componente && x.metodo === r.metodo && ['excecao', 'desvio', 'permissao', 'validacao'].includes(x.tipo));
  const desvios = irmaos.some((x) => x.chave === r.chave) ? irmaos : [r, ...irmaos];
  const agendada = r.tipo === 'agendada';
  if (!agendada) {
    for (const d of r.metodo ? desvios : [r]) {
      const testes = (d.testes ?? []).map((id) => porId.get(id)).filter((t): t is TesteInfo => !!t);
      cenarios.push({ id: d.chave, rotulo: rotuloDoErro(d), tipo: 'erro', estado: estadoDoGrupo(testes, resultados), testes });
    }
  }
  const todos = [...new Map([...doMetodo, ...cenarios.flatMap((c) => c.testes)].map((t) => [t.id, t])).values()];
  // O estado da regra é o do cenário dela (o desvio que ela descreve); os outros desvios do método só aparecem na lista.
  const dela = agendada ? cenarios.find((c) => c.tipo === 'feliz') : cenarios.find((c) => c.id === r.chave);
  let estado: CoberturaDaRegra['estado'];
  if (dela?.estado === 'falhou') estado = 'falhando';
  else if (dela?.estado === 'coberto') estado = 'completa';
  else estado = todos.length ? 'so-feliz' : 'sem';
  return { chave: r.chave, cenarios, testes: todos, estado };
}

export interface ResumoDeCobertura {
  regras: number;
  comTeste: number;
  passando: number;
  falhando: number;
  semTeste: number;
  errosTotal: number;
  errosCobertos: number;
}

export function resumirCobertura(mapa: ReadonlyMap<string, CoberturaDaRegra>): ResumoDeCobertura {
  const r: ResumoDeCobertura = { regras: mapa.size, comTeste: 0, passando: 0, falhando: 0, semTeste: 0, errosTotal: 0, errosCobertos: 0 };
  for (const c of mapa.values()) {
    if (c.estado === 'sem') r.semTeste++;
    else {
      r.comTeste++;
      if (c.estado === 'falhando') r.falhando++;
      else r.passando++;
    }
    for (const e of c.cenarios) {
      if (e.tipo !== 'erro') continue;
      r.errosTotal++;
      if (e.estado !== 'sem') r.errosCobertos++;
    }
  }
  return r;
}
