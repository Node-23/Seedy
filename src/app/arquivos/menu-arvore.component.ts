import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { nomeBase } from '../nucleo/ponte';
import { ArquivosService } from './arquivos.service';
import { ItemNovo, nomeDaClasse } from './modelos';

/**
 * Menu do botão direito na árvore (mockup 40): Novo ▸, copiar, colar, renomear,
 * apagar e abrir no explorador.
 * Teclado: ↑↓ andam, ⏎/→ escolhem, ← volta, letras direto, esc fecha.
 */
@Component({
  selector: 'sd-menu-arvore',
  template: `
    @if (a.menu(); as m) {
      <div class="menu-arvore-fundo" (mousedown)="a.fechar()" (contextmenu)="$event.preventDefault(); a.fechar()"></div>
      <div #caixa class="menu-arvore" tabindex="-1" (keydown)="teclar($event)" [style.left.px]="posicao().x" [style.top.px]="posicao().y">
        @if (!m.novo || !soTipos()) {
          <div class="menu-gutter menu-arvore-caixa" role="menu">
            <div class="menu-gutter-titulo suave">{{ nome() }}</div>
            @for (i of principais(); track i.id; let n = $index) {
              @if (i.separar) { <div class="menu-regra-separador"></div> }
              <button class="menu-gutter-item" role="menuitem" [class.sel]="!nosTipos() && n === indice()" [disabled]="desligado(i.id)"
                      (mousemove)="passar(n)" (click)="escolher(i.id)">
                <span class="menu-arvore-marca suave">{{ i.marca }}</span><span>{{ i.rotulo }}</span><span class="espaco"></span>
                @if (i.id === 'novo') { <span>▸</span> } @else { <kbd>{{ i.atalho }}</kbd> }
              </button>
            }
          </div>
        }
        @if (nosTipos() || (!soTipos() && indice() === 0)) {
          <div class="menu-gutter menu-arvore-caixa menu-arvore-tipos" role="menu">
            <div class="menu-gutter-titulo suave">NOVO EM {{ ultimo(pasta()) }}/</div>
            @for (i of itens(); track i.tipo; let n = $index) {
              @if (n > 0 && itens()[n - 1].grupo !== i.grupo) { <div class="menu-regra-separador"></div> }
              <button class="menu-gutter-item" role="menuitem" [class.sel]="nosTipos() && n === tipo()" (mousemove)="nosTipos.set(true); tipo.set(n)" (click)="novo(i)">
                <span class="menu-arvore-marca suave">{{ i.marca }}</span><span>{{ i.rotulo }}</span><span class="espaco"></span><kbd>{{ i.tecla }}</kbd>
              </button>
            }
          </div>
        }
      </div>
    }
  `,
})
export class MenuArvoreComponent {
  protected readonly a = inject(ArquivosService);
  private readonly caixa = viewChild<ElementRef<HTMLElement>>('caixa');

  private readonly todos = [
    { id: 'novo', marca: '＋', rotulo: 'Novo', atalho: 'n', separar: false },
    { id: 'copiar', marca: '⧉', rotulo: 'Copiar', atalho: 'c', separar: true },
    { id: 'colar', marca: '▣', rotulo: 'Colar', atalho: 'v', separar: false },
    { id: 'caminho', marca: '⌘', rotulo: 'Copiar caminho', atalho: 'p', separar: false },
    { id: 'classe', marca: 'C', rotulo: 'Copiar nome completo da classe', atalho: 'q', separar: false },
    { id: 'renomear', marca: '✎', rotulo: 'Renomear', atalho: 'r', separar: true },
    { id: 'apagar', marca: '✕', rotulo: 'Apagar', atalho: 'd', separar: false },
    { id: 'explorador', marca: '↗', rotulo: 'Abrir no explorador de arquivos', atalho: 'e', separar: true },
  ];

  /** O nome da classe só aparece para um .java numa pasta de fontes. */
  protected readonly principais = computed(() => {
    const alvo = this.a.menu()?.alvo;
    return this.todos.filter((i) => i.id !== 'classe' || (!!alvo && !alvo.pasta && !!nomeDaClasse(alvo.caminho)));
  });

  protected readonly indice = signal(0);
  protected readonly nosTipos = signal(false);
  protected readonly tipo = signal(0);
  /** Aberto pelo teclado direto nos tipos: a primeira caixa nem aparece. */
  protected readonly soTipos = signal(false);

  protected readonly pasta = computed(() => {
    const m = this.a.menu();
    return m ? this.a.pastaDe(m.alvo) : '';
  });
  protected readonly nome = computed(() => {
    const alvo = this.a.menu()?.alvo;
    return alvo ? `${this.ultimo(alvo.caminho)}${alvo.pasta ? '/' : ''}` : '';
  });

  /** Só o nome: o caminho inteiro não cabe num menu. */
  protected ultimo(caminho: string): string {
    return nomeBase(caminho);
  }
  protected readonly itens = computed(() => this.a.itensNovos(this.pasta()));
  protected readonly posicao = signal({ x: 0, y: 0 });

  constructor() {
    effect(() => {
      const m = this.a.menu();
      const caixa = this.caixa();
      untracked(() => {
        if (!m) return;
        this.indice.set(0);
        this.tipo.set(0);
        this.nosTipos.set(m.novo);
        this.soTipos.set(m.novo);
        this.posicao.set({ x: m.x, y: m.y });
        if (!caixa) return;
        // Depois de desenhado: puxa para dentro da janela.
        setTimeout(() => {
          const r = caixa.nativeElement.getBoundingClientRect();
          this.posicao.set({
            x: Math.max(8, Math.min(m.x, window.innerWidth - r.width - 8)),
            y: Math.max(8, Math.min(m.y, window.innerHeight - r.height - 8)),
          });
          caixa.nativeElement.focus();
        });
      });
    });
  }

  protected desligado(id: string): boolean {
    const alvo = this.a.menu()?.alvo;
    if (id === 'colar') return !this.a.copiado();
    return (id === 'renomear' || id === 'apagar') && !!alvo && !this.a.podeMudar(alvo);
  }

  protected passar(n: number): void {
    this.nosTipos.set(false);
    this.indice.set(n);
  }

  protected escolher(id: string): void {
    const alvo = this.a.menu()?.alvo;
    if (!alvo) return;
    if (id === 'novo') this.nosTipos.set(true);
    else if (id === 'copiar') this.a.copiar(alvo);
    else if (id === 'colar') void this.a.colar(alvo);
    else if (id === 'caminho') void this.a.copiarCaminho(alvo);
    else if (id === 'classe') void this.a.copiarNomeDaClasse(alvo);
    else if (id === 'renomear') this.a.pedirRenomear(alvo);
    else if (id === 'apagar') this.a.pedirApagar(alvo);
    else void this.a.explorador(alvo);
  }

  protected novo(i: ItemNovo): void {
    this.a.pedirNovo(i.tipo, this.pasta());
  }

  protected teclar(e: KeyboardEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const andar = (total: number, atual: number, d: number) => (atual + d + total) % total;
    if (e.key === 'Escape') return this.a.fechar();
    if (this.nosTipos()) {
      const itens = this.itens();
      const direto = itens.find((i) => i.tecla === e.key);
      if (direto) this.novo(direto);
      else if (e.key === 'ArrowDown') this.tipo.set(andar(itens.length, this.tipo(), 1));
      else if (e.key === 'ArrowUp') this.tipo.set(andar(itens.length, this.tipo(), -1));
      else if (e.key === 'Enter') this.novo(itens[this.tipo()]);
      else if (e.key === 'ArrowLeft' && !this.soTipos()) this.nosTipos.set(false);
      return;
    }
    const principais = this.principais();
    const direto = principais.find((i) => i.atalho === e.key);
    // Com os tipos à vista (em "Novo"), a letra do tipo também vale; as do menu ganham.
    const tipo = this.indice() === 0 ? this.itens().find((i) => i.tecla === e.key) : undefined;
    if (direto) this.escolher(direto.id);
    else if (tipo) this.novo(tipo);
    else if (e.key === 'ArrowDown') this.indice.set(andar(principais.length, this.indice(), 1));
    else if (e.key === 'ArrowUp') this.indice.set(andar(principais.length, this.indice(), -1));
    else if (e.key === 'Enter' || (e.key === 'ArrowRight' && this.indice() === 0)) this.escolher(principais[this.indice()].id);
  }
}
