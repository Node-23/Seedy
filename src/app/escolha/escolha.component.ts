import { Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { EscolhaService, OpcaoDeEscolha } from './escolha.service';
import { casar } from '../busca/fuzzy';
import { EditorService } from '../editor/editor.service';

/**
 * Janela de escolha (uma ou várias opções), no visual das buscas.
 * Teclado: digitar filtra, ↑↓ navegam, espaço marca (múltipla), ctrl+a marca/desmarca
 * todas, ⏎ confirma, esc cancela.
 */
@Component({
  selector: 'sd-escolha',
  template: `
    @if (servico.pedido(); as p) {
      <div class="busca escolha" role="dialog" [attr.aria-label]="p.titulo" (keydown)="teclar($event)">
        <div class="painel-faixa">
          <span class="rotulo">{{ p.titulo }}</span>
          @if (p.multipla) { <span class="suave contagem">{{ marcadas().size }} de {{ p.opcoes.length }}</span> }
        </div>
        <label class="busca-campo">
          <span class="busca-prompt" aria-hidden="true">›</span>
          <input
            #campo
            type="text"
            spellcheck="false"
            autocomplete="off"
            aria-label="Filtrar"
            aria-controls="escolha-opcoes"
            [attr.aria-activedescendant]="visiveis().length ? 'escolha-' + indice() : null"
            [value]="filtro()"
            (input)="filtrar($any($event.target).value)"
          />
        </label>
        <ul id="escolha-opcoes" class="busca-resultados escolha-opcoes" role="listbox" [attr.aria-multiselectable]="p.multipla">
          @for (o of visiveis(); track o.i; let n = $index) {
            <li class="busca-item" role="option" [id]="'escolha-' + n" [class.selecionado]="n === indice()"
                [attr.aria-selected]="p.multipla ? marcadas().has(o.i) : n === indice()"
                (mousedown)="$event.preventDefault()" (mousemove)="indice.set(n)" (click)="clicar(n)">
              @if (p.multipla) {
                <span class="marca-escolha" [class.marcada]="marcadas().has(o.i)" aria-hidden="true">{{ marcadas().has(o.i) ? '✓' : '' }}</span>
              }
              <span class="busca-rotulo">{{ o.opcao.rotulo }}</span>
              <span class="espaco"></span>
              @if (o.opcao.detalhe) { <span class="suave busca-detalhe">{{ o.opcao.detalhe }}</span> }
            </li>
          } @empty {
            <li class="busca-vazio suave">nada encontrado</li>
          }
        </ul>
        <div class="busca-dicas">
          <span><span class="tecla">↑↓</span> navegar</span>
          @if (p.multipla) {
            <span><span class="tecla">espaço</span> marcar</span>
            <span><span class="tecla">^a</span> todos</span>
          }
          <span><span class="tecla">⏎</span> {{ p.multipla ? 'confirmar' : 'escolher' }}</span>
          <span><span class="tecla">esc</span> cancelar</span>
          <span class="espaco"></span>
          @if (p.dica) { <span>{{ p.dica }}</span> }
        </div>
      </div>
    }
  `,
})
export class EscolhaComponent {
  protected readonly servico = inject(EscolhaService);
  private readonly editor = inject(EditorService);
  private readonly campo = viewChild<ElementRef<HTMLInputElement>>('campo');

  protected readonly filtro = signal('');
  protected readonly indice = signal(0);
  protected readonly marcadas = signal(new Set<number>());

  protected readonly visiveis = computed(() => {
    const p = this.servico.pedido();
    if (!p) return [];
    const q = this.filtro().trim();
    return p.opcoes
      .map((opcao, i) => ({ opcao, i, c: casar(q, opcao.rotulo + ' ' + (opcao.detalhe ?? '')) }))
      .filter((o) => o.c)
      .sort((a, b) => (q ? b.c!.pontos - a.c!.pontos : 0));
  });

  constructor() {
    // Novo pedido: limpa o filtro, marca o que veio marcado e foca o campo.
    effect(() => {
      const p = this.servico.pedido();
      if (!p) return;
      this.filtro.set('');
      this.indice.set(0);
      this.marcadas.set(new Set(p.opcoes.flatMap((o: OpcaoDeEscolha<unknown>, i) => (o.marcada ? [i] : []))));
      queueMicrotask(() => this.campo()?.nativeElement.focus());
    });
  }

  protected filtrar(texto: string): void {
    this.filtro.set(texto);
    this.indice.set(0);
  }

  protected clicar(n: number): void {
    this.indice.set(n);
    if (this.servico.pedido()?.multipla) this.alternar(n);
    else this.confirmar();
  }

  protected teclar(e: KeyboardEvent): void {
    const p = this.servico.pedido();
    if (!p) return;
    const total = this.visiveis().length;
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      this.fechar(null);
    } else if (e.key === 'ArrowDown' || (ctrl && e.key.toLowerCase() === 'n')) {
      if (total) this.indice.set((this.indice() + 1) % total);
    } else if (e.key === 'ArrowUp' || (ctrl && e.key.toLowerCase() === 'p')) {
      if (total) this.indice.set((this.indice() - 1 + total) % total);
    } else if (e.key === ' ' && p.multipla) {
      this.alternar(this.indice());
    } else if (ctrl && e.key.toLowerCase() === 'a' && p.multipla) {
      const todas = this.marcadas().size === p.opcoes.length;
      this.marcadas.set(new Set(todas ? [] : p.opcoes.map((_, i) => i)));
    } else if (e.key === 'Enter') {
      this.confirmar();
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    queueMicrotask(() => document.getElementById('escolha-' + this.indice())?.scrollIntoView({ block: 'nearest' }));
  }

  private alternar(n: number): void {
    const o = this.visiveis()[n];
    if (!o) return;
    const s = new Set(this.marcadas());
    if (s.has(o.i)) s.delete(o.i);
    else s.add(o.i);
    this.marcadas.set(s);
  }

  private confirmar(): void {
    const p = this.servico.pedido();
    if (!p) return;
    if (p.multipla) {
      this.fechar([...this.marcadas()].sort((a, b) => a - b).map((i) => p.opcoes[i].valor));
    } else {
      const o = this.visiveis()[this.indice()];
      if (o) this.fechar([o.opcao.valor]);
    }
  }

  private fechar(valores: unknown[] | null): void {
    this.servico.responder(valores);
    queueMicrotask(() => this.editor.focar());
  }
}
