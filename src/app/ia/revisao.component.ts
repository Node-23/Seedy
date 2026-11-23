import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { Alteracao, RevisaoService } from './revisao.service';
import { trechos } from './trechos';
import { nomeBase } from '../nucleo/ponte';
import { haQuanto } from '../git/tempo';
import { ProjetoService } from '../nucleo/projeto.service';

const ROTULO_DO_ESTADO: Record<Alteracao['estado'], string> = {
  pendente: 'proposta',
  aplicada: 'já no disco',
  aceita: 'aceita',
  recusada: 'recusada',
  desfeita: 'desfeita',
};

/**
 * Revisão das alterações da IA (Alt+Y): à esquerda a lista, à direita o diff. ⏎ aceita (ou
 * mantém, se já estava no disco), d recusa (ou desfaz), D abre o diff completo.
 */
@Component({
  selector: 'sd-revisao',
  template: `
    @if (r.aberta()) {
      <div class="busca revisao-janela" role="dialog" aria-label="Revisão das alterações da IA" (keydown)="teclar($event)">
        <div class="painel-faixa">
          <span class="rotulo">REVISÃO · ALTERAÇÕES DA IA</span>
          <span class="suave contagem">{{ r.pendentes() }} {{ r.pendentes() === 1 ? 'esperando você' : 'esperando você' }}</span>
        </div>
        <div class="commit-corpo">
          <ul #caixa class="busca-resultados revisao-lista" tabindex="0" role="listbox" aria-label="Alterações">
            @for (a of lista(); track a.id; let i = $index) {
              <li class="busca-item" role="option" [class.selecionado]="i === sel()" [attr.aria-selected]="i === sel()" (click)="sel.set(i)">
                <span class="revisao-estado" [attr.data-estado]="a.estado">{{ rotulo(a.estado) }}</span>
                <span class="busca-rotulo">{{ nome(a.caminho) }}</span>
                <span class="espaco"></span>
                <span class="suave busca-detalhe">{{ a.origem === 'ia' ? 'IA' : 'Claude Code' }} · {{ quando(a) }}</span>
              </li>
            } @empty {
              <li class="busca-vazio suave">nenhuma alteração da IA ainda</li>
            }
          </ul>
          <div class="commit-direita">
            @if (atual(); as a) {
              <div class="revisao-motivo"><span class="forte">{{ relativo(a.caminho) }}</span><br /><span class="suave">{{ a.motivo }}</span></div>
              <div class="git-diff commit-diff">
                @for (l of diffAtual().linhas; track $index) {
                  <div class="git-diff-linha" [attr.data-tipo]="l.tipo === 'corte' ? 'contexto' : l.tipo">
                    <span class="git-diff-sinal">{{ l.tipo === 'mais' ? '+' : l.tipo === 'menos' ? '−' : '' }}</span><span [class.suave]="l.tipo === 'corte'">{{ l.texto }}</span>
                  </div>
                }
              </div>
            }
          </div>
        </div>
        <div class="busca-dicas">
          <span><span class="tecla">j k</span> navegar</span>
          <span><span class="tecla">⏎</span> aceitar / manter</span>
          <span><span class="tecla">d</span> recusar / desfazer</span>
          <span><span class="tecla">D</span> diff completo</span>
          <span><span class="tecla">c</span> limpar resolvidas</span>
          <span><span class="tecla">esc</span> fechar</span>
        </div>
      </div>
    }
  `,
})
export class RevisaoComponent {
  protected readonly r = inject(RevisaoService);
  private readonly projeto = inject(ProjetoService);
  private readonly elLista = viewChild<ElementRef<HTMLElement>>('caixa');
  protected readonly sel = signal(0);
  private focoAnterior: HTMLElement | null = null;

  /** Primeiro o que espera decisão, depois o resto (mais recentes no topo). */
  protected readonly lista = computed(() =>
    [...this.r.alteracoes()].sort((a, b) => peso(a) - peso(b) || b.quando - a.quando),
  );
  protected readonly atual = computed(() => this.lista()[this.sel()] ?? null);
  protected readonly diffAtual = computed(() => {
    const a = this.atual();
    return a ? trechos(a.antes, a.depois, 3, 400) : { linhas: [], mais: 0, menos: 0 };
  });

  constructor() {
    effect(() => {
      if (!this.r.aberta()) return;
      untracked(() => {
        this.focoAnterior = document.activeElement as HTMLElement | null;
        this.sel.set(0);
        queueMicrotask(() => this.elLista()?.nativeElement.focus());
      });
    });
  }

  protected rotulo(e: Alteracao['estado']): string {
    return ROTULO_DO_ESTADO[e];
  }

  protected relativo(c: string): string {
    const raiz = (this.projeto.raiz() ?? '').replace(/\\/g, '/');
    return c.replace(/\\/g, '/').replace(raiz + '/', '');
  }

  protected nome(c: string): string {
    return nomeBase(c);
  }

  protected quando(a: Alteracao): string {
    return haQuanto(a.quando / 1000, Date.now() / 1000);
  }

  private fechar(): void {
    this.r.aberta.set(false);
    const f = this.focoAnterior;
    this.focoAnterior = null;
    if (f?.isConnected && f !== document.body) queueMicrotask(() => f.focus());
  }

  protected teclar(e: KeyboardEvent): void {
    const a = this.atual();
    const n = this.lista().length;
    switch (e.key) {
      case 'Escape':
        this.fechar();
        break;
      case 'j':
      case 'ArrowDown':
        this.sel.set(Math.min(n - 1, this.sel() + 1));
        break;
      case 'k':
      case 'ArrowUp':
        this.sel.set(Math.max(0, this.sel() - 1));
        break;
      case 'Enter':
        if (a) void this.r.aceitar(a.id);
        break;
      case 'd':
        if (a) void this.r.recusar(a.id);
        break;
      case 'D':
        if (a) this.r.verDiff(a.id);
        break;
      case 'c':
        this.r.limparResolvidas();
        this.sel.set(0);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }
}

function peso(a: Alteracao): number {
  return a.estado === 'pendente' ? 0 : a.estado === 'aplicada' ? 1 : 2;
}
