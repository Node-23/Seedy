import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { monaco } from './monaco';
import { initVimMode, VimMode } from '../../vendor/monaco-vim';
import { EditorService, ModoVim } from './editor.service';
import { TemaService } from '../tema/tema';
import { ProjetoService } from '../nucleo/projeto.service';
import { AtalhosService } from '../teclado/atalhos.service';
import { LayoutService } from '../layout/layout.service';

/** API interna do vim (do CodeMirror), que o monaco-vim expõe sem tipos. */
interface ApiVim {
  defineEx(nome: string, prefixo: string, fn: (cm: unknown, params: { argString?: string; bang?: boolean }) => void): void;
  map(lhs: string, rhs: string, contexto?: string): void;
}

/** O controlador da caixa de busca do Monaco (Ctrl+F), que a API pública não tipa. */
interface ControladorDeBusca {
  getState(): {
    isRevealed: boolean;
    onFindReplaceStateChange(fn: (e: { isRevealed: boolean }) => void): unknown;
  };
}

let exDefinidos = false;

@Component({
  selector: 'sd-editor',
  template: `
    <section class="painel editor" aria-label="Editor">
      <div class="entalhe">
        <button class="botao-quadrado destaque" aria-label="Modo foco" title="Modo foco" (click)="alternarFoco()">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"></path></svg>
        </button>
      </div>
      <div class="painel-faixa migalhas">
        @for (parte of migalhas(); track $index; let ultimo = $last) {
          <span [class.atual]="ultimo">{{ parte }}</span>
          @if (!ultimo) { <span>›</span> }
        }
      </div>
      <div class="editor-corpo">
        <div #hospedeiro class="editor-monaco" [class.oculto]="!editor.bufferAtivo()"></div>
        @if (!editor.bufferAtivo()) {
          <div class="editor-vazio">
            <div class="logo">seedy</div>
            @if (projeto.raiz()) {
              <p>Nenhum arquivo aberto.</p>
              <p class="suave"><kbd>␣</kbd> menu de atalhos · <kbd>␣ e</kbd> arquivos · <kbd>alt f12</kbd> terminal</p>
            } @else {
              <p>Nenhum projeto aberto.</p>
              <button class="botao destaque" (click)="projeto.escolher()">abrir pasta <kbd>␣ o</kbd></button>
            }
          </div>
        }
      </div>
    </section>
  `,
})
export class EditorComponent {
  protected readonly editor = inject(EditorService);
  protected readonly projeto = inject(ProjetoService);
  private readonly tema = inject(TemaService);
  private readonly atalhos = inject(AtalhosService);
  private readonly layout = inject(LayoutService);
  private readonly hospedeiro = viewChild.required<ElementRef<HTMLDivElement>>('hospedeiro');

  protected readonly migalhas = computed(() => {
    const b = this.editor.bufferAtivo();
    if (!b) return [this.projeto.nome() ?? 'seedy'];
    if (b.somenteLeitura) return [...(b.descricao ?? b.nome).split('.'), 'somente leitura'];
    const raiz = this.projeto.raiz();
    const relativo = raiz && b.caminho.startsWith(raiz) ? b.caminho.slice(raiz.length) : b.caminho;
    return relativo.split(/[\\/]/).filter(Boolean);
  });

  constructor() {
    const destruir = inject(DestroyRef);

    afterNextRender(() => {
      const t = this.tema.tema();
      const instancia = monaco.editor.create(this.hospedeiro().nativeElement, {
        model: null,
        theme: 'seedy',
        automaticLayout: true,
        minimap: { enabled: false },
        lineNumbers: 'relative',
        renderLineHighlight: 'line',
        scrollBeyondLastLine: false,
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        guides: { indentation: false },
        padding: { top: 10, bottom: 10 },
        stickyScroll: { enabled: false },
        // Alabaster: pouca cor. Parênteses coloridos brigam com essa ideia.
        bracketPairColorization: { enabled: false },
        matchBrackets: 'near',
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        // Definições de verdade vêm do jdtls (tokens semânticos).
        'semanticHighlighting.enabled': true,
        lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.OnCode },
        fixedOverflowWidgets: true,
        ...this.opcoesDeFonte(t),
      });
      this.editor.instancia = instancia;
      instancia.setModel(this.editor.bufferAtivo()?.modelo ?? null);

      const barraVim = document.getElementById('vim-linha-de-comando');
      const vim = initVimMode(instancia, barraVim);
      vim.on('vim-mode-change', (e: { mode: ModoVim }) => this.editor.modo.set(e.mode));
      this.definirComandosEx();

      // Ao fechar a busca do arquivo (Ctrl+F), o cursor fica no trecho encontrado, sem
      // seleção — senão o vim entende a seleção como modo VISUAL.
      const buscaNoArquivo = instancia.getContribution<monaco.editor.IEditorContribution & ControladorDeBusca>(
        'editor.contrib.findController',
      );
      buscaNoArquivo?.getState().onFindReplaceStateChange((e) => {
        if (!e.isRevealed || buscaNoArquivo.getState().isRevealed) return;
        const selecao = instancia.getSelection();
        if (selecao && !selecao.isEmpty()) instancia.setPosition(selecao.getStartPosition());
      });

      // Na caixa de busca: ↓/↑ vão para o próximo/anterior, como no IntelliJ
      // (⏎ / shift+⏎ e F3 / shift+F3 o Monaco já trata).
      const naCaixaDeBusca = 'findWidgetVisible && findInputFocussed';
      instancia.addCommand(
        monaco.KeyCode.DownArrow,
        () => void instancia.getAction('editor.action.nextMatchFindAction')?.run(),
        naCaixaDeBusca,
      );
      instancia.addCommand(
        monaco.KeyCode.UpArrow,
        () => void instancia.getAction('editor.action.previousMatchFindAction')?.run(),
        naCaixaDeBusca,
      );

      this.atalhosDeCodigo(instancia);

      instancia.onDidChangeCursorPosition((e) =>
        this.editor.cursor.set({ linha: e.position.lineNumber, coluna: e.position.column }),
      );

      destruir.onDestroy(() => {
        vim.dispose?.();
        instancia.dispose();
      });
    });

    // Troca o modelo quando o buffer ativo muda.
    effect(() => {
      const b = this.editor.bufferAtivo();
      const instancia = this.editor.instancia;
      if (!instancia) return;
      instancia.updateOptions({ readOnly: !!b?.somenteLeitura });
      if (instancia.getModel() !== (b?.modelo ?? null)) {
        instancia.setModel(b?.modelo ?? null);
        if (b) queueMicrotask(() => instancia.focus());
      }
    });

    // Fonte do código vem do tema.
    effect(() => {
      const t = this.tema.tema();
      this.editor.instancia?.updateOptions(this.opcoesDeFonte(t));
      monaco.editor.remeasureFonts();
    });
  }

  protected alternarFoco(): void {
    const algumAberto = this.layout.visivel('arquivos') || this.layout.visivel('terminal');
    if (algumAberto) {
      if (this.layout.visivel('arquivos')) this.layout.alternar('arquivos');
      if (this.layout.visivel('terminal')) this.layout.alternar('terminal');
    } else {
      this.layout.alternar('arquivos');
    }
    this.editor.focar();
  }

  private opcoesDeFonte(t: ReturnType<TemaService['tema']>): monaco.editor.IEditorOptions {
    const f = t.fontes.codigo;
    return {
      fontFamily: `"${f.familia}", ${t.fontes.reserva}`,
      fontSize: f.tamanho,
      lineHeight: f.alturaLinha,
      fontLigatures: f.ligaduras,
    };
  }

  /** Comandos do vim (:w, :q, :e...) ligados ao Seedy. */
  private definirComandosEx(): void {
    if (exDefinidos) return;
    exDefinidos = true;
    const Vim = (VimMode as unknown as { Vim: ApiVim }).Vim;
    Vim.defineEx('write', 'w', () => void this.editor.salvar());
    Vim.defineEx('quit', 'q', (_cm, p) => this.editor.fechar(undefined, !!p.bang));
    Vim.defineEx('wq', 'wq', async () => {
      await this.editor.salvar();
      this.editor.fechar();
    });
    Vim.defineEx('xit', 'x', async () => {
      await this.editor.salvar();
      this.editor.fechar();
    });
    Vim.defineEx('bnext', 'bn', () => this.editor.proximo(1));
    Vim.defineEx('bprevious', 'bp', () => this.editor.proximo(-1));
    Vim.defineEx('terminal', 'term', () => this.layout.mostrar('terminal'));
    Vim.defineEx('wall', 'wa', () => void this.editor.salvarTodos());
    // Espaço no modo normal abre o menu do líder.
    Vim.defineEx('seedylider', 'seedylider', () => this.atalhos.abrirLider());
    Vim.map('<Space>', ':seedylider<CR>', 'normal');

    // Navegação de código no jeito do vim (gd, gr, gi, K), via jdtls.
    // Roda depois que o foco volta da linha de comando do vim ao editor:
    // senão o hover abre e fecha na mesma hora.
    const acao = (id: string) => () =>
      setTimeout(() => {
        this.editor.instancia?.focus();
        this.editor.instancia?.trigger('vim', id, null);
      });
    const mapear = (tecla: string, nome: string, id: string) => {
      Vim.defineEx(nome, nome, acao(id));
      Vim.map(tecla, `:${nome}<CR>`, 'normal');
    };
    mapear('gd', 'seedydefinicao', 'editor.action.revealDefinition');
    mapear('gr', 'seedyusos', 'editor.action.referenceSearch.trigger');
    mapear('gi', 'seedyimplementacao', 'editor.action.goToImplementation');
    mapear('K', 'seedyhover', 'editor.action.showHover');
  }

  /**
   * Atalhos de código no padrão do IntelliJ (os do Monaco continuam valendo:
   * F12 definição, shift+F12 usos, F2 renomear, ctrl+. ação rápida).
   */
  private atalhosDeCodigo(instancia: monaco.editor.IStandaloneCodeEditor): void {
    const { KeyMod: M, KeyCode: K } = monaco;
    const ligar = (tecla: number, id: string) => instancia.addCommand(tecla, () => instancia.trigger('teclado', id, null));
    ligar(M.CtrlCmd | K.KeyB, 'editor.action.revealDefinition');
    ligar(M.CtrlCmd | M.Alt | K.KeyB, 'editor.action.goToImplementation');
    ligar(M.Alt | K.F7, 'editor.action.referenceSearch.trigger');
    ligar(M.Shift | K.F12, 'editor.action.referenceSearch.trigger');
    ligar(M.Shift | K.F6, 'editor.action.rename');
    ligar(M.Alt | K.Enter, 'editor.action.quickFix');
    ligar(M.CtrlCmd | M.Alt | K.KeyL, 'editor.action.formatDocument');
    ligar(M.CtrlCmd | M.Alt | K.KeyO, 'editor.action.organizeImports');
    ligar(M.CtrlCmd | K.F12, 'editor.action.quickOutline');
  }
}
