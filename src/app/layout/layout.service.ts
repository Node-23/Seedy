import { Injectable, signal } from '@angular/core';

/**
 * Painéis do Seedy e onde cada um fica.
 *
 * Hoje a disposição é fixa (arquivos à esquerda, terminal embaixo), mas tudo
 * passa por aqui: quando o layout for editável, basta mudar este registro e
 * salvar/carregar a disposição de um arquivo (ver ROADMAP.md).
 */
export type IdPainel = 'arquivos' | 'terminal';
/** Tela que ocupa a área principal: o editor (com árvore e terminal), o Git ou o merge. */
export type Tela = 'editor' | 'git' | 'merge';
export type Regiao = 'esquerda' | 'inferior';

export interface Painel {
  id: IdPainel;
  titulo: string;
  regiao: Regiao;
  atalho: string;
}

export const PAINEIS: Painel[] = [
  { id: 'arquivos', titulo: 'Arquivos', regiao: 'esquerda', atalho: '␣ e' },
  { id: 'terminal', titulo: 'Terminal', regiao: 'inferior', atalho: 'alt f12' },
];

interface Disposicao {
  visiveis: Record<IdPainel, boolean>;
  larguraEsquerda: number;
  alturaInferior: number;
}

const CHAVE = 'seedy.layout';
const PADRAO: Disposicao = {
  visiveis: { arquivos: true, terminal: false },
  larguraEsquerda: 280,
  alturaInferior: 280,
};

@Injectable({ providedIn: 'root' })
export class LayoutService {
  readonly disposicao = signal<Disposicao>(this.carregar());
  /** Tela na área principal. O editor continua vivo (só escondido) nas outras. */
  readonly tela = signal<Tela>('editor');

  /** Painel que deve receber o foco (o componente observa e se foca). */
  readonly pedidoDeFoco = signal<{ id: IdPainel; n: number } | null>(null);

  visivel(id: IdPainel): boolean {
    return this.disposicao().visiveis[id];
  }

  alternar(id: IdPainel): void {
    const abrir = !this.visivel(id);
    this.atualizar((d) => ({ ...d, visiveis: { ...d.visiveis, [id]: abrir } }));
    if (abrir) this.focar(id);
  }

  mostrar(id: IdPainel): void {
    if (!this.visivel(id)) this.atualizar((d) => ({ ...d, visiveis: { ...d.visiveis, [id]: true } }));
    this.focar(id);
  }

  focar(id: IdPainel): void {
    this.pedidoDeFoco.set({ id, n: (this.pedidoDeFoco()?.n ?? 0) + 1 });
  }

  redimensionar(regiao: Regiao, tamanho: number): void {
    this.atualizar((d) =>
      regiao === 'esquerda'
        ? { ...d, larguraEsquerda: Math.max(180, Math.min(560, tamanho)) }
        : { ...d, alturaInferior: Math.max(120, Math.min(720, tamanho)) },
    );
  }

  private atualizar(fn: (d: Disposicao) => Disposicao): void {
    this.disposicao.update(fn);
    localStorage.setItem(CHAVE, JSON.stringify(this.disposicao()));
  }

  private carregar(): Disposicao {
    try {
      const salvo = JSON.parse(localStorage.getItem(CHAVE) ?? 'null');
      return salvo ? { ...PADRAO, ...salvo, visiveis: { ...PADRAO.visiveis, ...salvo.visiveis } } : PADRAO;
    } catch {
      return PADRAO;
    }
  }
}
