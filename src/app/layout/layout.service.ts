import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { ConfigService } from '../config/config.service';

/**
 * Painéis do Seedy e onde cada um fica: a base do layout editável.
 *
 * Cada painel mora numa região (esquerda, embaixo ou direita) e cada região mostra um painel
 * por vez. Arrastar a faixa de título de um painel (ou ␣ L → mover) troca a região; arrastar
 * o divisor muda o tamanho. A disposição atual e as salvas com nome ficam no seedy.json
 * (`layout`), então valem em qualquer projeto e dá para editar à mão.
 */
export type IdPainel = 'arquivos' | 'conexoes' | 'terminal' | 'servidor' | 'scripts' | 'containers' | 'ia';
/** Tela que ocupa a área principal: o editor (com os painéis) ou uma tela cheia. */
export type Tela = 'editor' | 'git' | 'merge' | 'debug' | 'containers' | 'entender' | 'config' | 'testes' | 'endpoints';
export type Regiao = 'esquerda' | 'inferior' | 'direita';

export interface Painel {
  id: IdPainel;
  titulo: string;
  regiao: Regiao;
  atalho: string;
}

export const PAINEIS: Painel[] = [
  { id: 'arquivos', titulo: 'Arquivos', regiao: 'esquerda', atalho: '␣ e' },
  { id: 'conexoes', titulo: 'Conexões (banco)', regiao: 'direita', atalho: '␣ d' },
  { id: 'terminal', titulo: 'Terminal', regiao: 'inferior', atalho: 'alt f12' },
  { id: 'servidor', titulo: 'Servidor', regiao: 'inferior', atalho: '␣ j' },
  { id: 'scripts', titulo: 'Scripts', regiao: 'inferior', atalho: '␣ p' },
  { id: 'containers', titulo: 'Containers', regiao: 'inferior', atalho: '␣ h' },
  { id: 'ia', titulo: 'IA', regiao: 'direita', atalho: '␣ a' },
];

export const NOME_DA_REGIAO: Record<Regiao, string> = { esquerda: 'à esquerda', inferior: 'embaixo', direita: 'à direita' };

export interface Disposicao {
  visiveis: Record<IdPainel, boolean>;
  regioes: Record<IdPainel, Regiao>;
  /** Largura (esquerda/direita) e altura (embaixo) de cada painel. */
  tamanhos: Partial<Record<IdPainel, { largura?: number; altura?: number }>>;
}

interface LayoutNoArquivo {
  atual?: string;
  agora?: Partial<Disposicao>;
  disposicoes?: Record<string, Partial<Disposicao>>;
}

const LARGURA_PADRAO: Partial<Record<IdPainel, number>> = { arquivos: 280, conexoes: 300, ia: 480 };
const ALTURA_PADRAO = 280;
const CHAVE = 'seedy.layout';
export const NOME_PADRAO = 'padrão';

export const PADRAO: Disposicao = {
  visiveis: { arquivos: true, conexoes: false, terminal: false, servidor: false, scripts: false, containers: false, ia: false },
  regioes: Object.fromEntries(PAINEIS.map((p) => [p.id, p.regiao])) as Record<IdPainel, Regiao>,
  tamanhos: {},
};

function completar(d: Partial<Disposicao> | null | undefined): Disposicao {
  const regioes = { ...PADRAO.regioes, ...(d?.regioes ?? {}) };
  for (const id of Object.keys(regioes) as IdPainel[]) if (!['esquerda', 'inferior', 'direita'].includes(regioes[id])) regioes[id] = PADRAO.regioes[id];
  const visiveis = { ...PADRAO.visiveis, ...(d?.visiveis ?? {}) };
  // Uma região mostra um painel por vez.
  const ocupadas = new Set<Regiao>();
  for (const p of PAINEIS) {
    if (!visiveis[p.id]) continue;
    if (ocupadas.has(regioes[p.id])) visiveis[p.id] = false;
    else ocupadas.add(regioes[p.id]);
  }
  return { visiveis, regioes, tamanhos: { ...(d?.tamanhos ?? {}) } };
}

@Injectable({ providedIn: 'root' })
export class LayoutService {
  private readonly config = inject(ConfigService);

  readonly disposicao = signal<Disposicao>(this.carregarLocal());
  /** Nome da disposição salva que está em uso (ou "padrão"). */
  readonly nomeAtual = signal<string>(NOME_PADRAO);
  readonly salvas = signal<Record<string, Disposicao>>({});
  /** Tela na área principal. O editor continua vivo (só escondido) nas outras. */
  readonly tela = signal<Tela>('editor');

  /** Painel que deve receber o foco (o componente observa e se foca). */
  readonly pedidoDeFoco = signal<{ id: IdPainel; n: number } | null>(null);

  /** Painel visível de cada região (ou null). */
  readonly ativos = computed(() => {
    const d = this.disposicao();
    const ativo = (r: Regiao) => PAINEIS.find((p) => d.regioes[p.id] === r && d.visiveis[p.id])?.id ?? null;
    return { esquerda: ativo('esquerda'), inferior: ativo('inferior'), direita: ativo('direita') } as Record<Regiao, IdPainel | null>;
  });

  private carregouDoArquivo = false;
  private gravacao: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // O seedy.json chegou (ou mudou à mão): aplica o layout de lá.
    effect(() => {
      const l = this.config.atual().layout as LayoutNoArquivo | undefined;
      untracked(() => this.receber(l));
    });
  }

  private receber(l: LayoutNoArquivo | undefined): void {
    if (!l) return;
    this.salvas.set(Object.fromEntries(Object.entries(l.disposicoes ?? {}).map(([n, d]) => [n, completar(d)])));
    if (l.atual) this.nomeAtual.set(l.atual);
    if (l.agora) {
      const nova = completar(l.agora);
      if (JSON.stringify(nova) !== JSON.stringify(this.disposicao())) this.disposicao.set(nova);
    }
    this.carregouDoArquivo = true;
  }

  // ---------- painéis ----------

  /** Para o template (o contexto do ng-template chega sem tipo). */
  ativoEm(regiao: unknown): IdPainel | null {
    return this.ativos()[regiao as Regiao] ?? null;
  }

  terminalEm(regiao: unknown): boolean {
    return this.disposicao().regioes.terminal === regiao;
  }

  visivel(id: IdPainel): boolean {
    return this.disposicao().visiveis[id];
  }

  regiaoDe(id: IdPainel): Regiao {
    return this.disposicao().regioes[id];
  }

  alternar(id: IdPainel): void {
    const abrir = !this.visivel(id);
    this.atualizar((d) => ({ ...d, visiveis: { ...d.visiveis, ...this.vizinhosFechados(d, id, abrir), [id]: abrir } }));
    if (abrir) this.focar(id);
  }

  mostrar(id: IdPainel): void {
    if (!this.visivel(id)) this.atualizar((d) => ({ ...d, visiveis: { ...d.visiveis, ...this.vizinhosFechados(d, id, true), [id]: true } }));
    this.focar(id);
  }

  /** Cada região mostra um painel por vez: abrir um fecha os outros dela. */
  private vizinhosFechados(d: Disposicao, id: IdPainel, abrindo: boolean): Partial<Record<IdPainel, boolean>> {
    if (!abrindo) return {};
    const regiao = d.regioes[id];
    return Object.fromEntries(PAINEIS.filter((p) => d.regioes[p.id] === regiao && p.id !== id).map((p) => [p.id, false]));
  }

  focar(id: IdPainel): void {
    this.pedidoDeFoco.set({ id, n: (this.pedidoDeFoco()?.n ?? 0) + 1 });
  }

  /** Muda o painel de região (e já o mostra lá). */
  mover(id: IdPainel, regiao: Regiao): void {
    this.atualizar((d) => {
      const novo = { ...d, regioes: { ...d.regioes, [id]: regiao } };
      return { ...novo, visiveis: { ...novo.visiveis, ...this.vizinhosFechados(novo, id, true), [id]: true } };
    });
    this.focar(id);
  }

  // ---------- tamanhos ----------

  tamanho(regiao: Regiao): number {
    const id = this.ativos()[regiao];
    const t = id ? this.disposicao().tamanhos[id] : undefined;
    if (regiao === 'inferior') return t?.altura ?? ALTURA_PADRAO;
    return t?.largura ?? (id ? (LARGURA_PADRAO[id] ?? 360) : 280);
  }

  redimensionar(regiao: Regiao, tamanho: number): void {
    const id = this.ativos()[regiao];
    if (!id) return;
    const valor = Math.round(regiao === 'inferior' ? Math.max(120, Math.min(720, tamanho)) : Math.max(180, Math.min(760, tamanho)));
    this.atualizar((d) => ({ ...d, tamanhos: { ...d.tamanhos, [id]: { ...d.tamanhos[id], [regiao === 'inferior' ? 'altura' : 'largura']: valor } } }));
  }

  // ---------- disposições salvas ----------

  salvarComo(nome: string): void {
    this.salvas.update((s) => ({ ...s, [nome]: this.disposicao() }));
    this.nomeAtual.set(nome);
    this.gravarNoArquivo(true);
  }

  usar(nome: string): void {
    const d = nome === NOME_PADRAO ? PADRAO : this.salvas()[nome];
    if (!d) return;
    this.nomeAtual.set(nome);
    this.atualizar(() => completar(d));
  }

  apagar(nome: string): void {
    this.salvas.update((s) => Object.fromEntries(Object.entries(s).filter(([n]) => n !== nome)));
    if (this.nomeAtual() === nome) this.nomeAtual.set(NOME_PADRAO);
    this.gravarNoArquivo(true);
  }

  // ---------- gravar ----------

  private atualizar(fn: (d: Disposicao) => Disposicao): void {
    this.disposicao.update(fn);
    try {
      localStorage.setItem(CHAVE, JSON.stringify(this.disposicao()));
    } catch {
      // sem localStorage: fica só no seedy.json
    }
    this.gravarNoArquivo(false);
  }

  /** Grava no seedy.json (o arrastar de divisor gera muitas mudanças: espera assentar). */
  private gravarNoArquivo(agora: boolean): void {
    if (this.gravacao) clearTimeout(this.gravacao);
    const gravar = () => {
      this.gravacao = null;
      const layout: LayoutNoArquivo = { atual: this.nomeAtual(), agora: this.disposicao(), disposicoes: this.salvas() };
      void this.config.gravar({ layout });
    };
    if (agora) gravar();
    else this.gravacao = setTimeout(gravar, this.carregouDoArquivo ? 700 : 2000);
  }

  private carregarLocal(): Disposicao {
    try {
      const salvo = JSON.parse(localStorage.getItem(CHAVE) ?? 'null');
      return completar(salvo ? { ...salvo, regioes: salvo.regioes, tamanhos: salvo.tamanhos ?? migrarTamanhos(salvo) } : null);
    } catch {
      return completar(null);
    }
  }
}

/** Layout antigo (larguraEsquerda/alturaInferior) → tamanhos por painel. */
function migrarTamanhos(antigo: { larguraEsquerda?: number; alturaInferior?: number }): Disposicao['tamanhos'] {
  const t: Disposicao['tamanhos'] = {};
  if (antigo.larguraEsquerda) t.arquivos = { largura: antigo.larguraEsquerda };
  if (antigo.alturaInferior) for (const id of ['terminal', 'servidor', 'scripts', 'containers'] as IdPainel[]) t[id] = { altura: antigo.alturaInferior };
  return t;
}
