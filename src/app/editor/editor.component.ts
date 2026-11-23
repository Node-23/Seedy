import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { monaco } from './monaco';
import { initVimMode, VimMode } from '../../vendor/monaco-vim';
import { EditorService, ModoVim } from './editor.service';
import { VimAjudaService } from '../vim/vim-ajuda.component';
import { BookmarksService } from './bookmarks.service';
import { MenuGutterService } from './menu-gutter.service';
import { TemaService } from '../tema/tema';
import { ProjetoService } from '../nucleo/projeto.service';
import { AtalhosService } from '../teclado/atalhos.service';
import { LayoutService } from '../layout/layout.service';
import { MergeService } from '../git/merge.service';
import { BancoService, NOME_DO_AMBIENTE } from '../banco/banco.service';
import { ConfigService } from '../config/config.service';
import { aceitaBreakpoint, DepuradorService } from '../servidor/depurador.service';

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
    <section class="painel editor" [class.desfocado]="desfocado()" [attr.aria-label]="dividido() ? 'Editor, painel ' + (painel() + 1) : 'Editor'">
      @if (sql(); as f) {
        <div class="painel-faixa faixa-sql" [attr.data-ambiente]="f.perfil?.ambiente ?? null">
          @if (f.perfil; as p) {
            <button class="faixa-sql-conexao" title="trocar a conexão deste arquivo" (click)="banco.escolherConexao()">
              <span class="bolinha-ambiente" [class.conectada]="f.conectado" aria-hidden="true">●</span>
              <span class="faixa-sql-ambiente">{{ nomeDoAmbiente(p.ambiente).toUpperCase() }}</span>
              <span>{{ p.banco || p.usuario }} · {{ banco.schemaPadrao(p) }}</span>
            </button>
            <span class="espaco"></span>
            @if (!f.conectado) { <button class="faixa-sql-acao" (click)="banco.conectar(p.id)">conectar</button> }
            @if (p.somenteLeitura) { <span class="faixa-sql-acao">🔒 somente leitura</span> }
            @if (p.ssh) { <span class="faixa-sql-acao">⇄ ssh {{ p.ssh }}</span> }
          } @else {
            <button class="faixa-sql-conexao" (click)="banco.escolherConexao()"><span class="suave">sem conexão —</span> escolher</button>
          }
        </div>
      } @else {
        <div class="painel-faixa migalhas">
          @for (parte of migalhas(); track $index; let ultimo = $last) {
            <span [class.atual]="ultimo">{{ parte }}</span>
            @if (!ultimo) { <span class="sep">›</span> }
          }
        </div>
      }
      <div class="editor-corpo">
        <div #hospedeiro class="editor-monaco" [class.oculto]="!buffer()"></div>
        @if (sql()) {
          <div class="acoes-sql">
            <button class="botao" title="plano de execução (ctrl+shift+⏎)" (click)="banco.executarNoCursor(true)">explain</button>
            <button class="botao destaque" [disabled]="banco.resultadoAtivo()?.executando" (click)="banco.executarNoCursor()">▶ executar <kbd>^⏎</kbd></button>
          </div>
        }
        @if (!buffer()) {
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
  private readonly config = inject(ConfigService);
  protected readonly editor = inject(EditorService);
  protected readonly projeto = inject(ProjetoService);
  private readonly tema = inject(TemaService);
  private readonly atalhos = inject(AtalhosService);
  private readonly vimAjuda = inject(VimAjudaService);
  private readonly bookmarks = inject(BookmarksService);
  private readonly menuGutter = inject(MenuGutterService);
  private readonly layout = inject(LayoutService);
  private readonly merge = inject(MergeService);
  private readonly hospedeiro = viewChild.required<ElementRef<HTMLDivElement>>('hospedeiro');

  /** Qual painel este é (0 = esquerda; 1 = direita, quando o editor está dividido). */
  readonly painel = input<0 | 1>(0);
  protected readonly buffer = computed(() => this.editor.bufferDoPainel(this.painel()));
  protected readonly banco = inject(BancoService);
  private readonly depurador = inject(DepuradorService);
  /** Arquivo .sql neste painel: a conexão dele (a faixa do topo mostra o ambiente). */
  protected readonly sql = computed(() => {
    const b = this.buffer();
    if (!b || b.somenteLeitura || !/\.sql$/i.test(b.caminho)) return null;
    const id = this.banco.associacoes().get(b.caminho);
    const perfil = this.banco.perfis().find((p) => p.id === id) ?? null;
    return { perfil, conectado: !!perfil && this.banco.sessoes().has(perfil.id) };
  });

  protected nomeDoAmbiente(a: string): string {
    return NOME_DO_AMBIENTE[a] ?? a;
  }
  protected readonly dividido = computed(() => !!this.editor.divisao());
  protected readonly desfocado = computed(() => this.dividido() && this.editor.painelFocado() !== this.painel());
  private readonly focado = computed(() => this.editor.painelFocado() === this.painel());

  /** Instância do Monaco deste painel (vira não-nula depois de criada). */
  private readonly instancia = signal<monaco.editor.IStandaloneCodeEditor | null>(null);
  private barraVim: HTMLElement | null = null;

  protected readonly migalhas = computed(() => {
    const b = this.buffer();
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
        // Fora do shadow DOM: o menu de contexto e os widgets pegam o CSS do tema (senão ficam transparentes).
        useShadowDOM: false,
        automaticLayout: true,
        minimap: { enabled: false },
        lineNumbers: 'relative',
        // Margem dos breakpoints (clique ou ctrl+F8).
        glyphMargin: true,
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
      const painel = this.painel();
      this.editor.registrarInstancia(painel, instancia);
      // Botão direito na margem (ao lado do número da linha): bookmark e breakpoint.
      this.hospedeiro().nativeElement.addEventListener(
        'contextmenu',
        (ev) => {
          if (!(ev.target as HTMLElement).closest('.margin')) return;
          const linha = instancia.getTargetAtClientPoint(ev.clientX, ev.clientY)?.position?.lineNumber;
          const b = this.buffer();
          ev.preventDefault();
          ev.stopPropagation(); // o menu do Monaco não abre por cima
          if (linha && b) this.menuGutter.abrir(ev.clientX, ev.clientY, linha, b.caminho);
        },
        true,
      );
      instancia.onMouseDown((ev) => {
        if (ev.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
        const b = this.buffer();
        const linha = ev.target.position?.lineNumber;
        if (b && linha && !b.somenteLeitura && aceitaBreakpoint(b.caminho)) this.depurador.alternar(b.caminho, linha);
      });
      this.instancia.set(instancia);
      instancia.setModel(this.buffer()?.modelo ?? null);

      // Cada painel tem o seu vim, com a sua linha de comando no rodapé
      // (só a do painel focado aparece).
      const barraVim = document.createElement('span');
      barraVim.className = 'vim-painel';
      document.getElementById('vim-linha-de-comando')?.appendChild(barraVim);
      this.barraVim = barraVim;
      const vim = initVimMode(instancia, barraVim);
      vim.on('vim-mode-change', (e: { mode: ModoVim }) => {
        if (this.focado()) this.editor.modo.set(e.mode);
      });
      this.definirComandosEx();

      // Clicar (ou focar) num painel faz dele o painel ativo.
      instancia.onDidFocusEditorText(() => this.editor.focarPainel(painel));

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

      instancia.onDidChangeCursorPosition((e) => {
        if (this.focado()) this.editor.cursor.set({ linha: e.position.lineNumber, coluna: e.position.column });
      });

      destruir.onDestroy(() => {
        this.editor.registrarInstancia(painel, null);
        vim.dispose?.();
        instancia.dispose();
        barraVim.remove();
      });
    });

    // Troca o modelo quando o buffer deste painel muda.
    effect(() => {
      const b = this.buffer();
      const instancia = this.instancia();
      if (!instancia) return;
      instancia.updateOptions({ readOnly: !!b?.somenteLeitura });
      if (instancia.getModel() !== (b?.modelo ?? null)) {
        this.editor.mostrarModelo(b?.modelo ?? null, true, instancia);
        if (b && this.focado()) queueMicrotask(() => instancia.focus());
      }
    });

    // Só a linha de comando do vim do painel focado aparece no rodapé.
    effect(() => {
      const focado = this.focado();
      if (this.instancia() && this.barraVim) this.barraVim.hidden = !focado;
    });

    // Opções do editor vêm do seedy.json (editor.*).
    effect(() => {
      const c = this.config.atual().editor;
      const instancia = this.instancia();
      if (!instancia) return;
      instancia.updateOptions({ wordWrap: c.quebraDeLinha ? 'on' : 'off', lineNumbers: c.numerosRelativos ? 'relative' : 'on', minimap: { enabled: c.minimapa } });
      const modelo = this.buffer()?.modelo;
      if (modelo && c.tabulacao) modelo.updateOptions({ tabSize: c.tabulacao, indentSize: c.tabulacao, insertSpaces: c.espacos });
    });

    // Fonte do código vem do tema.
    effect(() => {
      const t = this.tema.tema();
      this.instancia()?.updateOptions(this.opcoesDeFonte(t));
      monaco.editor.remeasureFonts();
    });
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
    // No merge, :w grava o resultado; no editor, o buffer.
    Vim.defineEx('write', 'w', () => (this.layout.tela() === 'merge' ? void this.merge.acoes?.gravar() : void this.editor.salvar()));
    // Merge em três colunas: ]c / [c entre conflitos, dp/do ficam no componente do merge.
    Vim.defineEx('seedymergeprox', 'seedymergeprox', () => this.merge.acoes?.proximo(1));
    Vim.defineEx('seedymergeant', 'seedymergeant', () => this.merge.acoes?.proximo(-1));
    Vim.defineEx('seedymergeseu', 'seedymergeseu', () => this.merge.acoes?.pegar('seu'));
    Vim.defineEx('seedymergedeles', 'seedymergedeles', () => this.merge.acoes?.pegar('deles'));
    Vim.map(']c', ':seedymergeprox<CR>', 'normal');
    Vim.map('[c', ':seedymergeant<CR>', 'normal');
    // Como no vim: com o editor dividido, :q fecha o painel; senão, o buffer.
    Vim.defineEx('quit', 'q', (_cm, p) => (this.editor.divisao() ? this.editor.fecharPainel() : this.editor.fechar(undefined, !!p.bang)));
    Vim.defineEx('vsplit', 'vs', (_cm, p) => void this.editor.dividir(p.argString?.trim() || undefined));
    Vim.defineEx('only', 'on', () => this.editor.fecharPainel(this.editor.painelFocado() === 0 ? 1 : 0));
    Vim.defineEx('close', 'clo', () => this.editor.fecharPainel());
    Vim.defineEx('seedypainelesq', 'seedypainelesq', () => this.editor.focarPainel(0));
    Vim.defineEx('seedypaineldir', 'seedypaineldir', () => this.editor.focarPainel(1));
    Vim.defineEx('seedypaineloutro', 'seedypaineloutro', () => this.editor.focarPainel(this.editor.painelFocado() === 0 ? 1 : 0));
    // Ctrl+W h/l/w/v/q/o fica no AtalhosService (o monaco-vim não mapeia acordes com Ctrl).
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
    Vim.defineEx('help', 'h', () => this.vimAjuda.alternar());
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
    // Bookmark na linha do cursor (␣ M); ␣ B lista as marcas.
    instancia.addCommand(M.CtrlCmd | K.F2, () => void this.bookmarks.alternar());
    // Gerar... (getters/setters, construtor, toString, equals/hashCode, sobrescrever).
    ligar(M.Alt | K.Insert, 'editor.action.sourceAction');
  }
}
