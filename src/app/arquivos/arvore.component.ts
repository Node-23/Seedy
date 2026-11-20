import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { Entrada, ponte } from '../nucleo/ponte';
import { ProjetoService } from '../nucleo/projeto.service';
import { EditorService } from '../editor/editor.service';
import { LayoutService } from '../layout/layout.service';
import { MensagensService } from '../nucleo/mensagens.service';

interface No {
  entrada: Entrada;
  nivel: number;
  aberto: boolean;
  filhos: No[] | null;
}

/**
 * Árvore de arquivos do projeto.
 * Teclado: j/k ou ↑/↓ navegam, l/→/Enter abrem, h/← fecham a pasta.
 */
@Component({
  selector: 'sd-arvore',
  template: `
    <section class="painel arvore" aria-label="Arquivos">
      <div class="painel-faixa">
        <span class="rotulo">ARQUIVOS</span>
        <span class="faixa-acoes">
          <button class="botao-icone" aria-label="Recarregar" title="Recarregar" (click)="projeto.recarregar()">↻</button>
          <kbd>␣ e</kbd>
        </span>
      </div>
      <div
        #lista
        class="arvore-lista"
        role="tree"
        tabindex="0"
        [attr.aria-activedescendant]="selecionado() ? 'no-' + selecionado() : null"
        (keydown)="teclar($event)"
      >
        @if (!projeto.raiz()) {
          <p class="suave arvore-vazia">Nenhum projeto aberto.<br />
            <button class="botao" (click)="projeto.escolher()">abrir pasta</button></p>
        }
        @for (no of visiveis(); track no.entrada.caminho; let i = $index) {
          <div
            class="arvore-item"
            role="treeitem"
            [id]="'no-' + i"
            [attr.aria-expanded]="no.entrada.pasta ? no.aberto : null"
            [class.selecionado]="i === selecionado()"
            [class.ativo]="no.entrada.caminho === editor.ativo()"
            [style.padding-left.px]="12 + no.nivel * 14"
            (click)="selecionado.set(i); ativar(no)"
          >
            @if (no.entrada.pasta) {
              <span class="seta">{{ no.aberto ? '▾' : '▸' }}</span>
            }
            <span class="nome">{{ no.entrada.nome }}</span>
            @if (sujo(no.entrada.caminho)) { <span class="marca-sujo">M</span> }
          </div>
        }
      </div>
    </section>
  `,
})
export class ArvoreComponent {
  protected readonly projeto = inject(ProjetoService);
  protected readonly editor = inject(EditorService);
  private readonly layout = inject(LayoutService);
  private readonly mensagens = inject(MensagensService);
  private readonly lista = viewChild.required<ElementRef<HTMLDivElement>>('lista');

  private readonly raizes = signal<No[]>([]);
  /** Força o recálculo depois de abrir/fechar pastas (os nós são mutáveis). */
  private readonly mudancas = signal(0);
  protected readonly selecionado = signal(0);

  protected readonly visiveis = computed(() => {
    this.mudancas();
    const saida: No[] = [];
    const visitar = (nos: No[]) => {
      for (const no of nos) {
        saida.push(no);
        if (no.aberto && no.filhos) visitar(no.filhos);
      }
    };
    visitar(this.raizes());
    return saida;
  });

  constructor() {
    effect(() => {
      this.projeto.versao();
      const raiz = this.projeto.raiz();
      // untracked: o carregamento lê outros sinais que não devem disparar este efeito.
      untracked(() => (raiz ? void this.carregarRaiz(raiz) : this.raizes.set([])));
    });
    effect(() => {
      const pedido = this.layout.pedidoDeFoco();
      if (pedido?.id === 'arquivos') queueMicrotask(() => this.lista().nativeElement.focus());
    });
  }

  protected sujo(caminho: string): boolean {
    const b = this.editor.buffers().find((x) => x.caminho === caminho);
    return !!b && this.editor.sujo(b);
  }

  protected async ativar(no: No): Promise<void> {
    if (no.entrada.pasta) await this.alternar(no);
    else await this.editor.abrir(no.entrada.caminho);
  }

  protected teclar(e: KeyboardEvent): void {
    const nos = this.visiveis();
    const atual = nos[this.selecionado()];
    const mover = (d: number) => {
      this.selecionado.set(Math.max(0, Math.min(nos.length - 1, this.selecionado() + d)));
      this.lista().nativeElement.querySelector(`#no-${this.selecionado()}`)?.scrollIntoView({ block: 'nearest' });
    };
    switch (e.key) {
      case 'j':
      case 'ArrowDown':
        mover(1);
        break;
      case 'k':
      case 'ArrowUp':
        mover(-1);
        break;
      case 'l':
      case 'ArrowRight':
      case 'Enter':
        if (atual) void this.ativar(atual);
        break;
      case 'h':
      case 'ArrowLeft':
        if (atual?.entrada.pasta && atual.aberto) void this.alternar(atual);
        break;
      case 'Escape':
        this.editor.focar();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  private async alternar(no: No): Promise<void> {
    if (!no.aberto && no.filhos === null) {
      no.filhos = await this.carregar(no.entrada.caminho, no.nivel + 1);
    }
    no.aberto = !no.aberto;
    this.mudancas.update((n) => n + 1);
  }

  private async carregarRaiz(raiz: string): Promise<void> {
    // Recarregar mantém abertas as pastas que já estavam.
    const abertas = new Set(this.visiveis().filter((n) => n.aberto).map((n) => n.entrada.caminho));
    const reabrir = async (nos: No[]): Promise<void> => {
      for (const no of nos) {
        if (no.entrada.pasta && abertas.has(no.entrada.caminho)) {
          no.filhos = await this.carregar(no.entrada.caminho, no.nivel + 1);
          no.aberto = true;
          await reabrir(no.filhos);
        }
      }
    };
    const nos = await this.carregar(raiz, 0);
    await reabrir(nos);
    this.raizes.set(nos);
    this.selecionado.set(Math.min(this.selecionado(), Math.max(0, this.visiveis().length - 1)));
  }

  private async carregar(caminho: string, nivel: number): Promise<No[]> {
    try {
      const entradas = await ponte.lerPasta(caminho);
      return entradas.map((entrada) => ({ entrada, nivel, aberto: false, filhos: null }));
    } catch (e) {
      this.mensagens.erro(String(e));
      return [];
    }
  }
}
