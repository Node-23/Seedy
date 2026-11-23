import { Component, computed, effect, ElementRef, inject, Injectable, signal, untracked, viewChild } from '@angular/core';
import { ConfigService } from '../config/config.service';
import { EditorService } from '../editor/editor.service';
import { GRUPOS_DE_VIM } from './vim-ajuda';

/** A janela do Vim (Alt+Shift+V, `:h` ou o clique no modo da barra de status): configuração e atalhos. */
@Injectable({ providedIn: 'root' })
export class VimAjudaService {
  readonly aberta = signal(false);
  private focoAnterior: HTMLElement | null = null;

  alternar(): void {
    if (this.aberta()) return this.fechar();
    this.focoAnterior = document.activeElement as HTMLElement | null;
    this.aberta.set(true);
  }

  fechar(): void {
    this.aberta.set(false);
    const anterior = this.focoAnterior;
    this.focoAnterior = null;
    if (anterior?.isConnected && anterior !== document.body) queueMicrotask(() => anterior.focus());
  }
}

@Component({
  selector: 'sd-vim-ajuda',
  template: `
    @if (v.aberta()) {
      <div #quadro class="menu-vim" role="dialog" aria-label="Vim: configuração e atalhos" tabindex="-1" (keydown)="teclar($event)">
        <div class="menu-lider-topo">
          <span class="rotulo destaque">VIM · modo {{ modo() }}</span>
          <span class="suave">esc, q ou Alt+Shift+V fecha</span>
        </div>
        <div class="menu-vim-config">
          <span class="rotulo">CONFIGURAÇÃO</span>
          <div class="menu-vim-linhas">
            @for (c of configuracao(); track c[0]) { <span class="suave">{{ c[0] }}</span><span>{{ c[1] }}</span> }
          </div>
          <div class="suave menu-vim-nota">O Vim do Seedy é o monaco-vim: ainda não lê um .vimrc. O que o Seedy liga está nas listas coloridas; as opções do editor ficam no <span class="destaque-texto">seedy.json</span> (Ctrl+,).</div>
        </div>
        <div class="menu-vim-grade">
          @for (g of grupos; track g.titulo) {
            <section class="menu-vim-grupo" [class.seedy]="g.seedy">
              <div class="rotulo menu-vim-titulo">{{ g.titulo }}</div>
              @for (i of g.itens; track i[0]) {
                <div class="menu-vim-item"><kbd>{{ i[0] }}</kbd><span>{{ i[1] }}</span></div>
              }
            </section>
          }
        </div>
      </div>
    }
  `,
})
export class VimAjudaComponent {
  protected readonly v = inject(VimAjudaService);
  private readonly editor = inject(EditorService);
  private readonly config = inject(ConfigService);
  private readonly quadro = viewChild<ElementRef<HTMLElement>>('quadro');
  protected readonly grupos = GRUPOS_DE_VIM;

  protected readonly modo = computed(() => ({ normal: 'NORMAL', insert: 'INSERIR', visual: 'VISUAL', replace: 'SUBSTITUIR' })[this.editor.modo()]);

  /** As opções do editor que valem hoje (do seedy.json, global e do projeto). */
  protected readonly configuracao = computed<[string, string][]>(() => {
    const e = this.config.atual().editor;
    return [
      ['números de linha', e.numerosRelativos ? 'relativos (como set relativenumber)' : 'absolutos'],
      ['tabulação', `${e.espacos ? 'espaços' : 'tab'}${e.tabulacao ? `, ${e.tabulacao}` : ', detectada pelo arquivo'}`],
      ['quebra de linha', e.quebraDeLinha ? 'ligada' : 'desligada'],
      ['minimapa', e.minimapa ? 'ligado' : 'desligado'],
      ['formatar ao salvar', e.formatarAoSalvar ? 'sim (Prettier, nos projetos que usam)' : 'não'],
      ['menu de atalhos', 'Ctrl+Shift+Espaço (o Espaço só com atalhos.espacoAbreMenu)'],
    ];
  });

  constructor() {
    effect(() => {
      if (!this.v.aberta()) return;
      untracked(() => setTimeout(() => this.quadro()?.nativeElement.focus()));
    });
  }

  protected teclar(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'q' || (e.key === 'V' && !e.ctrlKey) || e.key === '?') {
      this.v.fechar();
      e.preventDefault();
      e.stopPropagation();
    }
  }
}
