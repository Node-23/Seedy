import { afterNextRender, Component, computed, DestroyRef, effect, ElementRef, inject, signal, untracked, viewChild, WritableSignal } from '@angular/core';
import { monaco } from '../editor/monaco';
import { EditorService } from '../editor/editor.service';
import { TemaService } from '../tema/tema';
import { LayoutService } from '../layout/layout.service';
import { ProjetoService } from '../nucleo/projeto.service';
import { aceitaBreakpoint, DepuradorService, FrameDap, motivoLegivel } from '../servidor/depurador.service';
import { ServidorService } from '../servidor/servidor.service';
import { ExecucaoService } from '../execucao/execucao.service';
import { deFramework } from '../servidor/log';

type Foco = 'pilha' | 'breakpoints' | 'variaveis' | 'console';
type ItemDaPilha = { tipo: 'thread'; id: number; nome: string; pausada: boolean } | { tipo: 'frame'; f: FrameDap } | { tipo: 'oculto'; total: number };
type ItemDeBreakpoint = { tipo: 'linha'; caminho: string; linha: number; condicao: string } | { tipo: 'excecoes' };

const NOME_DO_NIVEL = { erro: 'ERROR', aviso: 'WARN ', info: 'INFO ', debug: 'DEBUG' } as const;
const ROTULO_DAS_EXCECOES = { nenhuma: 'não para em exceções', naoTratadas: 'para nas não tratadas', todas: 'para em todas' } as const;

/**
 * Depurador em tela cheia (mockup 11, Alt+5): pilha e breakpoints à esquerda, o código na
 * linha pausada (com os valores ao lado), variáveis e expressões vigiadas à direita e o
 * console do processo embaixo. p / b / v / c focam cada parte; esc volta ao editor.
 */
@Component({
  selector: 'sd-tela-debug',
  template: `
    <div class="debug-tela" (keydown)="teclar($event)">
      <div class="debug-faixa">
        @if (dep.pausado(); as p) {
          <span class="aviso-texto forte">● pausado</span>
          @if (dep.localAtual(); as l) { <span>{{ arquivo(l.caminho) }}<span class="suave">:{{ l.linha }}</span></span> }
          <span class="suave debug-onde">· {{ motivo(p.motivo) }}@if (nomeDaThread(p.threadId); as t) { · thread {{ t }}}</span>
        } @else if (dep.depurando()) {
          <span class="git-mais forte">● rodando</span>
          <span class="suave debug-onde">{{ dep.sessao()!.nome }} · para no próximo breakpoint</span>
        } @else {
          <span class="suave forte">○ sem sessão de debug</span>
          <span class="suave debug-onde">shift+F9 depura {{ exec.atual()?.nome ?? 'o projeto' }}</span>
        }
        <span class="espaco"></span>
        <button class="botao" [disabled]="!dep.pausado()" (click)="dep.continuar()">▶ continuar <kbd>F9</kbd></button>
        <button class="botao" [disabled]="!dep.pausado()" (click)="dep.passar()">⤼ passar <kbd>F8</kbd></button>
        <button class="botao" [disabled]="!dep.pausado()" (click)="dep.entrar()">↓ entrar <kbd>F7</kbd></button>
        <button class="botao" [disabled]="!dep.pausado()" (click)="dep.sair()">↑ sair <kbd>⇧F8</kbd></button>
        <button class="botao" [disabled]="!dep.pausado()" (click)="ateOCursor()">⇥ até o cursor <kbd>alt F9</kbd></button>
        <button class="botao-quadrado" [class.ligado]="dep.silenciado()" [title]="dep.silenciado() ? 'breakpoints silenciados (clique para voltar)' : 'silenciar breakpoints'" (click)="dep.alternarSilencio()">⊘</button>
      </div>

      <div class="debug-grade">
        <div class="debug-esquerda">
          <section class="painel debug-pilha" aria-label="Pilha">
            <div class="painel-faixa"><span class="rotulo">PILHA</span><span class="espaco"></span><kbd>p</kbd></div>
            <div #pilha class="debug-lista" tabindex="0" role="listbox" aria-label="Threads e frames" (keydown)="teclarLista($event, 'pilha')" (focus)="foco.set('pilha')">
              @for (it of itensDaPilha(); track $index; let i = $index) {
                @switch (it.tipo) {
                  @case ('thread') {
                    <div class="debug-item" [class.selecionado]="foco() === 'pilha' && selPilha() === i" (click)="selPilha.set(i)">
                      <span [class.aviso-texto]="it.pausada" [class.suave]="!it.pausada">{{ it.pausada ? '▾ ●' : '▸ ○' }}</span>
                      <span>{{ it.nome }}</span><span class="espaco"></span><span class="suave">{{ it.pausada ? 'pausada' : 'rodando' }}</span>
                    </div>
                  }
                  @case ('frame') {
                    <div class="debug-item frame" [class.atual]="it.f.id === dep.frameAtual()" [class.selecionado]="foco() === 'pilha' && selPilha() === i"
                         [class.suave]="!it.f.source?.path" (click)="selPilha.set(i); escolherFrame(it.f)">
                      <span [class.destaque-texto]="!!it.f.source?.path">{{ metodo(it.f) }}</span>
                      <span class="suave">{{ classe(it.f) }}{{ it.f.line ? ':' + it.f.line : '' }}</span>
                    </div>
                  }
                  @case ('oculto') { <div class="debug-item frame suave">… {{ it.total }} frames sem código no projeto</div> }
                }
              } @empty {
                <div class="debug-vazio suave">{{ dep.depurando() ? 'a pilha aparece quando a execução para' : 'nenhuma sessão de debug' }}</div>
              }
            </div>
          </section>

          <section class="painel debug-breakpoints" aria-label="Breakpoints">
            <div class="painel-faixa"><span class="rotulo">BREAKPOINTS</span><span class="suave">{{ dep.totalDeBreakpoints() }}</span><span class="espaco"></span><kbd>b</kbd></div>
            <div #breakpoints class="debug-lista" tabindex="0" role="listbox" aria-label="Breakpoints" (keydown)="teclarLista($event, 'breakpoints')" (focus)="foco.set('breakpoints')">
              @for (it of itensDeBreakpoint(); track $index; let i = $index) {
                @if (it.tipo === 'linha') {
                  <div class="debug-item bp" [class.selecionado]="foco() === 'breakpoints' && selBp() === i" (click)="selBp.set(i)" (dblclick)="irAoBreakpoint(it.caminho, it.linha)">
                    <span class="erro-texto">{{ it.condicao ? '◆' : '●' }}</span>
                    <span [class.suave]="dep.silenciado()">{{ arquivo(it.caminho) }}</span><span class="suave">:{{ it.linha }}</span>
                    <span class="espaco"></span>
                    <button class="debug-x suave" title="apagar (d)" (click)="dep.remover(it.caminho, it.linha); $event.stopPropagation()">×</button>
                  </div>
                  @if (editandoCondicao() === i) {
                    <input #campoCondicao class="debug-condicao" type="text" spellcheck="false" placeholder="condição Java (⏎ grava, vazio = sempre)"
                           [value]="it.condicao" (keydown)="teclarCondicao($event, it.caminho, it.linha)" />
                  } @else if (it.condicao) {
                    <div class="debug-item-detalhe suave">se {{ it.condicao }}</div>
                  }
                } @else {
                  <div class="debug-item bp" [class.selecionado]="foco() === 'breakpoints' && selBp() === i" (click)="selBp.set(i); dep.alternarExcecoes()">
                    <span [class.erro-texto]="dep.paradaEmExcecoes() !== 'nenhuma'" [class.suave]="dep.paradaEmExcecoes() === 'nenhuma'">⚡</span>
                    <span>exceções</span><span class="suave">{{ rotuloExcecoes() }}</span>
                  </div>
                }
              }
              <div class="debug-dica suave">ctrl+F8 marca · ⏎ vai · d apaga · e condição · ⏎ em ⚡ troca</div>
            </div>
          </section>
        </div>

        <section class="painel debug-codigo" aria-label="Código">
          <div class="painel-faixa">
            @if (caminhoMostrado(); as c) {
              <span>{{ arquivo(c) }}</span><span class="suave debug-pacote">{{ pasta(c) }}</span>
            } @else {
              <span class="suave">nenhum arquivo</span>
            }
            <span class="espaco"></span>
            @if (dep.localAtual(); as l) { <span class="aviso-texto">● linha {{ l.linha }}</span> }
          </div>
          <div #codigo class="debug-monaco"></div>
        </section>

        <section class="painel debug-variaveis" aria-label="Variáveis">
          <div class="painel-faixa">
            <span class="rotulo">VARIÁVEIS</span>
            @if (frameSelecionado(); as f) { <span class="suave">{{ metodo(f) }}()</span> }
            <span class="espaco"></span><kbd>v</kbd>
          </div>
          <div #variaveis class="debug-lista debug-arvore" tabindex="0" role="tree" aria-label="Variáveis" (keydown)="teclarLista($event, 'variaveis')" (focus)="foco.set('variaveis')">
            @for (n of dep.variaveis(); track n.chave; let i = $index) {
              <div class="debug-var" [style.padding-left.px]="12 + n.nivel * 16" [class.selecionado]="foco() === 'variaveis' && selVar() === i" (click)="selVar.set(i); dep.alternarVariavel(n.chave)">
                <span class="seta suave">{{ n.v.variablesReference ? (n.aberto ? '▾' : '▸') : '' }}</span>
                <span class="destaque-texto">{{ n.v.name }}</span> = <span [class]="classeDoValor(n.v.value)">{{ n.v.value }}</span>
              </div>
            } @empty {
              <div class="debug-vazio suave">as variáveis aparecem quando a execução para</div>
            }
          </div>
          <div class="debug-secao"><span>VIGIAR</span><span class="espaco"></span><kbd>alt F8</kbd></div>
          <div class="debug-vigias">
            @for (v of dep.vigias(); track v) {
              <div class="debug-var">
                <span class="destaque-texto">{{ v }}</span> =
                @if (dep.valoresDasVigias().get(v); as r) {
                  <span [class]="r.erro ? 'erro-texto' : classeDoValor(r.valor)">{{ r.valor }}</span>
                } @else { <span class="suave">—</span> }
                <span class="espaco"></span>
                <button class="debug-x suave" title="deixar de vigiar" (click)="dep.deixarDeVigiar(v)">×</button>
              </div>
            }
            @for (a of avaliacoesRecentes(); track $index) {
              <div class="debug-var"><span class="suave">› {{ a.expressao }}</span> = <span [class.erro-texto]="a.erro">{{ a.resultado }}</span></div>
            }
          </div>
          <label class="debug-avaliar">
            <span class="destaque-texto">›</span>
            <input #avaliar type="text" spellcheck="false" placeholder="expressão (⏎ avalia · ctrl ⏎ vigia)" aria-label="Expressão para avaliar ou vigiar"
                   (keydown)="teclarAvaliar($event)" />
          </label>
        </section>

        <section class="painel debug-console" aria-label="Console">
          <div class="painel-faixa">
            <span class="rotulo">CONSOLE</span>
            <span class="suave">{{ descricaoDoConsole() }}</span>
            <span class="espaco"></span>
            @if (console(); as c) {
              <span class="chip-log erro">ERROR {{ c.erros }}</span>
              <span class="chip-log">WARN {{ c.avisos }}</span>
            }
            <kbd>c</kbd>
          </div>
          <div #saidaConsole class="debug-log" tabindex="0" role="log" aria-label="Saída do processo" (keydown)="teclarLista($event, 'console')" (focus)="foco.set('console')">
            @for (l of linhasDoConsole(); track l.n) {
              <div class="log-linha" [attr.data-nivel]="l.nivel" [class.seedy]="l.seedy" [class.pilha]="l.pilha" [class.framework]="!!l.frame && deFramework(l.frame.classe)">
                @if (l.frame; as f) {
                  <span class="log-recuo">    at </span>
                  @if (!deFramework(f.classe)) {
                    <a class="log-frame" (click)="servidor.abrirFrame(f)">{{ f.classe }}.{{ f.metodo }}({{ f.arquivo }}{{ f.linha ? ':' + f.linha : '' }})</a>
                  } @else { <span>{{ f.classe }}.{{ f.metodo }}({{ f.arquivo }}{{ f.linha ? ':' + f.linha : '' }})</span> }
                } @else if (l.pilha || !l.nivel) {
                  <span>{{ l.texto }}</span>
                } @else {
                  <span class="log-hora">{{ l.hora ?? '' }}</span><span class="log-nivel">{{ l.seedy ? 'seedy' : nomeDoNivel(l.nivel) }}</span><span>{{ l.mensagem }}</span>
                }
              </div>
            } @empty {
              <div class="debug-vazio suave">a saída do processo aparece aqui</div>
            }
          </div>
        </section>
      </div>
    </div>
  `,
})
export class TelaDebugComponent {
  protected readonly dep = inject(DepuradorService);
  protected readonly exec = inject(ExecucaoService);
  protected readonly servidor = inject(ServidorService);
  private readonly editor = inject(EditorService);
  private readonly tema = inject(TemaService);
  private readonly layout = inject(LayoutService);
  private readonly projeto = inject(ProjetoService);

  private readonly hospedeiro = viewChild.required<ElementRef<HTMLElement>>('codigo');
  private readonly elPilha = viewChild.required<ElementRef<HTMLElement>>('pilha');
  private readonly elBreakpoints = viewChild.required<ElementRef<HTMLElement>>('breakpoints');
  private readonly elVariaveis = viewChild.required<ElementRef<HTMLElement>>('variaveis');
  private readonly elConsole = viewChild.required<ElementRef<HTMLElement>>('saidaConsole');
  private readonly elAvaliar = viewChild.required<ElementRef<HTMLInputElement>>('avaliar');
  private readonly elCondicao = viewChild<ElementRef<HTMLInputElement>>('campoCondicao');

  protected readonly deFramework = deFramework;
  protected readonly foco = signal<Foco>('pilha');
  protected readonly selPilha = signal(0);
  protected readonly selBp = signal(0);
  protected readonly selVar = signal(0);
  protected readonly editandoCondicao = signal<number | null>(null);
  private readonly instancia = signal<monaco.editor.IStandaloneCodeEditor | null>(null);
  private decoracoes: monaco.editor.IEditorDecorationsCollection | null = null;

  /** O arquivo do frame selecionado; sem pausa, o do editor (para marcar breakpoints). */
  protected readonly caminhoMostrado = computed(() => this.dep.localAtual()?.caminho ?? this.editor.bufferAtivo()?.caminho ?? null);
  protected readonly frameSelecionado = computed(() => this.dep.frames().find((f) => f.id === this.dep.frameAtual()) ?? null);
  protected readonly avaliacoesRecentes = computed(() => this.dep.avaliacoes().slice(-4));

  protected readonly itensDaPilha = computed<ItemDaPilha[]>(() => {
    const p = this.dep.pausado();
    const threads = this.dep.threads();
    const lista: ItemDaPilha[] = [];
    const base = p && !threads.some((t) => t.id === p.threadId) ? [{ id: p.threadId, name: `thread ${p.threadId}` }, ...threads] : threads;
    // A thread pausada vem primeiro.
    const comPausada = [...base].sort((a, b) => Number(b.id === p?.threadId) - Number(a.id === p?.threadId));
    for (const t of comPausada) {
      const pausada = p?.threadId === t.id;
      lista.push({ tipo: 'thread', id: t.id, nome: nomeDeThread(t.name), pausada });
      if (!pausada) continue;
      // Frames sem código no projeto (servidor, bibliotecas): 2 aparecem, o resto recolhe.
      const frames = this.dep.frames();
      let i = 0;
      while (i < frames.length) {
        if (doProjeto(frames[i])) {
          lista.push({ tipo: 'frame', f: frames[i++] });
          continue;
        }
        let j = i;
        while (j < frames.length && !doProjeto(frames[j])) j++;
        const corrida = frames.slice(i, j);
        corrida.slice(0, 2).forEach((f) => lista.push({ tipo: 'frame', f }));
        if (corrida.length > 2) lista.push({ tipo: 'oculto', total: corrida.length - 2 });
        i = j;
      }
    }
    return lista;
  });

  protected readonly itensDeBreakpoint = computed<ItemDeBreakpoint[]>(() => {
    const itens: ItemDeBreakpoint[] = [];
    for (const [caminho, linhas] of this.dep.breakpoints()) {
      for (const linha of linhas) itens.push({ tipo: 'linha', caminho, linha, condicao: this.dep.condicao(caminho, linha) });
    }
    this.dep.condicoes();
    itens.push({ tipo: 'excecoes' });
    return itens;
  });

  /** Saída do processo depurado: o servidor da sessão, ou o main. */
  protected readonly console = computed(() => {
    const s = this.dep.sessao();
    if (s?.tipo === 'navegador' || (!s && this.exec.atual()?.tipo === 'script')) return this.exec.navegador();
    if (s?.tipo === 'servidor' && s.perfilId) return this.servidor.execucoes().get(s.perfilId) ?? null;
    const c = this.exec.atual();
    if (c?.tipo === 'servidor') return this.servidor.execucoes().get(c.perfilId) ?? null;
    return this.exec.main();
  });
  protected readonly linhasDoConsole = computed(() => (this.console()?.linhas ?? []).slice(-400));
  protected readonly descricaoDoConsole = computed(() => {
    const s = this.dep.sessao();
    if (s) return `${s.nome}${s.porta ? ` · debug :${s.porta}` : ''}`;
    return this.exec.atual()?.nome ?? '';
  });

  constructor() {
    const destruir = inject(DestroyRef);
    this.dep.telaDebug = {
      cursor: () => {
        const c = this.caminhoMostrado();
        const pos = this.instancia()?.getPosition();
        return c && pos ? { caminho: c, linha: pos.lineNumber } : null;
      },
      focarAvaliar: () => this.elAvaliar().nativeElement.focus(),
    };
    destruir.onDestroy(() => {
      this.dep.telaDebug = null;
      this.instancia()?.dispose();
    });

    afterNextRender(() => {
      const f = this.tema.tema().fontes.codigo;
      const ed = monaco.editor.create(this.hospedeiro().nativeElement, {
        model: null,
        theme: 'seedy',
        readOnly: true,
        domReadOnly: false,
        automaticLayout: true,
        minimap: { enabled: false },
        glyphMargin: true,
        lineNumbers: 'on',
        renderLineHighlight: 'none',
        scrollBeyondLastLine: false,
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        guides: { indentation: false },
        padding: { top: 8, bottom: 8 },
        stickyScroll: { enabled: false },
        bracketPairColorization: { enabled: false },
        'semanticHighlighting.enabled': true,
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        fixedOverflowWidgets: true,
        fontFamily: `"${f.familia}", ${this.tema.tema().fontes.reserva}`,
        fontSize: f.tamanho,
        lineHeight: f.alturaLinha,
      });
      ed.onMouseDown((ev) => {
        if (ev.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
        const c = this.caminhoMostrado();
        const linha = ev.target.position?.lineNumber;
        if (c && linha && aceitaBreakpoint(c)) this.dep.alternar(c, linha);
      });
      this.instancia.set(ed);
      queueMicrotask(() => this.elPilha().nativeElement.focus());
    });

    // O arquivo mostrado acompanha o frame (e vai até a linha dele).
    effect(() => {
      const ed = this.instancia();
      const caminho = this.caminhoMostrado();
      const linha = this.dep.localAtual()?.linha;
      if (!ed) return;
      untracked(async () => {
        const modelo = caminho ? await this.editor.garantirModelo(caminho) : null;
        if (ed.getModel() !== modelo) ed.setModel(modelo);
        if (modelo && linha) {
          ed.revealLineInCenterIfOutsideViewport(linha);
          ed.setPosition({ lineNumber: linha, column: 1 });
        }
        this.desenhar();
      });
    });
    // Breakpoints, linha atual e valores ao lado das linhas.
    effect(() => {
      this.instancia();
      this.dep.breakpoints();
      this.dep.condicoes();
      this.dep.silenciado();
      this.dep.localAtual();
      this.dep.variaveis();
      untracked(() => queueMicrotask(() => this.desenhar()));
    });
    // Console acompanha o fim.
    effect(() => {
      this.linhasDoConsole();
      untracked(() =>
        queueMicrotask(() => {
          const el = this.elConsole()?.nativeElement;
          if (el) el.scrollTop = el.scrollHeight;
        }),
      );
    });
    effect(() => {
      if (this.editandoCondicao() !== null) untracked(() => queueMicrotask(() => this.elCondicao()?.nativeElement.focus()));
    });
  }

  private desenhar(): void {
    const ed = this.instancia();
    const m = ed?.getModel();
    const caminho = this.caminhoMostrado();
    if (!ed) return;
    this.decoracoes?.clear();
    if (!m || !caminho) return;
    const decs = this.dep.decoracoesDeBreakpoint(caminho, m);
    const aqui = this.dep.localAtual();
    if (aqui && mesmo(aqui.caminho, caminho) && aqui.linha <= m.getLineCount()) {
      decs.push({ range: new monaco.Range(aqui.linha, 1, aqui.linha, 1), options: { isWholeLine: true, className: 'linha-pausada', glyphMarginClassName: 'seta-pausada' } });
      for (const [linha, texto] of valoresNasLinhas(m, aqui.linha, this.dep.variaveis().filter((n) => n.nivel === 0).map((n) => n.v))) {
        const col = m.getLineMaxColumn(linha);
        decs.push({ range: new monaco.Range(linha, col, linha, col), options: { after: { content: `   ${texto}`, inlineClassName: 'valor-inline' }, showIfCollapsed: true } });
      }
    }
    this.decoracoes = ed.createDecorationsCollection(decs);
  }

  // ---------- ações ----------

  protected ateOCursor(): void {
    const c = this.dep.telaDebug?.cursor();
    if (c) void this.dep.ateALinha(c.caminho, c.linha);
  }

  protected escolherFrame(f: FrameDap): void {
    void this.dep.escolherFrame(f.id, false);
  }

  protected irAoBreakpoint(caminho: string, linha: number): void {
    this.layout.tela.set('editor');
    void this.editor.abrir(caminho, linha).then(() => this.editor.focar());
  }

  protected rotuloExcecoes(): string {
    return ROTULO_DAS_EXCECOES[this.dep.paradaEmExcecoes()];
  }

  // ---------- teclado ----------

  protected teclar(e: KeyboardEvent): void {
    const alvo = e.target as HTMLElement;
    if (alvo.closest('input, .monaco-editor') || e.ctrlKey || e.altKey || e.metaKey) {
      if (e.key === 'Escape' && alvo.closest('.monaco-editor')) {
        this.elPilha().nativeElement.focus();
        e.preventDefault();
      }
      return;
    }
    const focar: Record<string, Foco> = { p: 'pilha', b: 'breakpoints', v: 'variaveis', c: 'console' };
    if (focar[e.key]) {
      this.focarParte(focar[e.key]);
    } else if (e.key === 'Escape') {
      this.layout.tela.set('editor');
      this.editor.focar();
    } else if (e.key === 'Tab') {
      // tab entra no código (para mover o cursor e usar alt+F9 / ctrl+F8).
      this.instancia()?.focus();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }

  private focarParte(f: Foco): void {
    this.foco.set(f);
    const el = { pilha: this.elPilha, breakpoints: this.elBreakpoints, variaveis: this.elVariaveis, console: this.elConsole }[f]();
    el.nativeElement.focus();
  }

  protected teclarLista(e: KeyboardEvent, parte: Foco): void {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const mover = (sel: WritableSignal<number>, total: number, d: number) => sel.set(Math.max(0, Math.min(total - 1, sel() + d)));
    const desce = e.key === 'j' || e.key === 'ArrowDown';
    const sobe = e.key === 'k' || e.key === 'ArrowUp';
    if (parte === 'pilha') {
      const itens = this.itensDaPilha();
      if (desce || sobe) mover(this.selPilha, itens.length, desce ? 1 : -1);
      else if (e.key === 'Enter') {
        const it = itens[this.selPilha()];
        if (it?.tipo === 'frame') this.escolherFrame(it.f);
      } else return;
    } else if (parte === 'breakpoints') {
      const itens = this.itensDeBreakpoint();
      const it = itens[this.selBp()];
      if (desce || sobe) mover(this.selBp, itens.length, desce ? 1 : -1);
      else if (e.key === 'Enter') {
        if (it?.tipo === 'linha') this.irAoBreakpoint(it.caminho, it.linha);
        else if (it) this.dep.alternarExcecoes();
      } else if (e.key === 'd' && it?.tipo === 'linha') {
        this.dep.remover(it.caminho, it.linha);
        this.selBp.set(Math.max(0, this.selBp() - 1));
      } else if (e.key === 'e' && it?.tipo === 'linha') this.editandoCondicao.set(this.selBp());
      else return;
    } else if (parte === 'variaveis') {
      const nos = this.dep.variaveis();
      const no = nos[this.selVar()];
      if (desce || sobe) mover(this.selVar, nos.length, desce ? 1 : -1);
      else if ((e.key === 'Enter' || e.key === 'l' || e.key === 'ArrowRight') && no && !no.aberto) void this.dep.alternarVariavel(no.chave);
      else if ((e.key === 'Enter' || e.key === 'h' || e.key === 'ArrowLeft') && no?.aberto) void this.dep.alternarVariavel(no.chave);
      else if (e.key === 'w' && no) this.dep.vigiar(no.v.name);
      else return;
    } else {
      const el = this.elConsole().nativeElement;
      if (desce || sobe) el.scrollTop += desce ? 40 : -40;
      else if (e.key === 'G') el.scrollTop = el.scrollHeight;
      else if (e.key === 'g') el.scrollTop = 0;
      else return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  protected teclarCondicao(e: KeyboardEvent, caminho: string, linha: number): void {
    if (e.key === 'Enter') {
      this.dep.definirCondicao(caminho, linha, (e.target as HTMLInputElement).value);
      this.editandoCondicao.set(null);
      this.focarParte('breakpoints');
    } else if (e.key === 'Escape') {
      this.editandoCondicao.set(null);
      this.focarParte('breakpoints');
    } else {
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  protected teclarAvaliar(e: KeyboardEvent): void {
    const campo = e.target as HTMLInputElement;
    if (e.key === 'Enter') {
      if (e.ctrlKey || e.metaKey) this.dep.vigiar(campo.value);
      else void this.dep.avaliar(campo.value);
      campo.value = '';
    } else if (e.key === 'Escape') {
      this.focarParte('variaveis');
    } else {
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  // ---------- textos ----------

  protected arquivo(c: string): string {
    return c.split(/[\\/]/).pop() ?? c;
  }

  /** Pasta do arquivo relativa ao projeto, em notação de pacote quando é código Java. */
  protected pasta(c: string): string {
    const raiz = (this.projeto.raiz() ?? '').replace(/\\/g, '/');
    let rel = c.replace(/\\/g, '/');
    // Windows: o js-debug manda "c:\..." e a raiz é "C:\..." — compara sem caixa.
    if (raiz && rel.toLowerCase().startsWith(raiz.toLowerCase() + '/')) rel = rel.slice(raiz.length + 1);
    rel = rel.split('/').slice(0, -1).join('/');
    const java = /(?:^|\/)src\/(?:main|test)\/java\/(.+)$/.exec(rel);
    if (java) return java[1].replace(/\//g, '.');
    // Fora do Java (TS/JS), a pasta como está: src/app/bancas.
    return /\.java$/i.test(c) ? (/(?:^|\/)src\/(.+)$/.exec(rel)?.[1].replace(/\//g, '.') ?? rel) : rel;
  }

  protected motivo(m: string): string {
    return motivoLegivel(m);
  }

  protected nomeDaThread(id: number): string | null {
    const t = this.dep.threads().find((x) => x.id === id);
    return t ? nomeDeThread(t.name) : null;
  }

  /** "ReservaServlet.reservar(HttpServletRequest, ...)" → "reservar". */
  protected metodo(f: FrameDap): string {
    const semArgs = f.name.replace(/\(.*$/, '');
    return semArgs.split('.').pop() ?? semArgs;
  }

  protected classe(f: FrameDap): string {
    const semArgs = f.name.replace(/\(.*$/, '');
    const partes = semArgs.split('.');
    return partes.length > 1 ? partes[partes.length - 2] : (f.source?.name ?? '').replace(/\.java$/, '');
  }

  protected classeDoValor(v: string): string {
    if (/^".*"$/.test(v)) return 'git-mais';
    if (/^-?\d+(\.\d+)?[LFDlfd]?$/.test(v) || v === 'true' || v === 'false' || v === 'null') return 'rosa-texto';
    return 'suave';
  }

  protected nomeDoNivel(n: keyof typeof NOME_DO_NIVEL): string {
    return NOME_DO_NIVEL[n];
  }
}

/**
 * Valores ao lado das linhas (como no IntelliJ): cada variável aparece na linha onde
 * recebe valor (ou aparece pela primeira vez), entre o começo do método e a linha pausada.
 */
export function valoresNasLinhas(m: monaco.editor.ITextModel, linhaAtual: number, vars: { name: string; value: string }[]): Map<number, string> {
  const inicio = inicioDoMetodo(m, linhaAtual);
  const porLinha = new Map<number, string[]>();
  for (const v of vars) {
    if (v.name === 'this' || !/^[\w$]+$/.test(v.name)) continue;
    const nome = v.name.replace(/\$/g, '\\$');
    const atribui = new RegExp(`\\b${nome}\\s*=[^=]`);
    const usa = new RegExp(`\\b${nome}\\b`);
    let alvo: number | null = null;
    let primeira: number | null = null;
    for (let l = inicio; l <= linhaAtual; l++) {
      const t = m.getLineContent(l).replace(/\/\/.*$/, '');
      if (atribui.test(t)) alvo = l;
      else if (primeira === null && usa.test(t)) primeira = l;
    }
    const linha = alvo ?? primeira;
    if (linha === null) continue;
    const valor = v.value.length > 60 ? `${v.value.slice(0, 57)}…` : v.value;
    porLinha.set(linha, [...(porLinha.get(linha) ?? []), `${v.name}: ${valor}`]);
  }
  return new Map([...porLinha].map(([l, t]) => [l, t.join('  ')]));
}

/** Linha da assinatura do método que contém `linha` (procura para cima). */
function inicioDoMetodo(m: monaco.editor.ITextModel, linha: number): number {
  const assinatura = /^\s*(?:(?:public|protected|private|static|final|synchronized|abstract|default)\s+)*(?:<[^>]+>\s+)?[\w$<>[\],.? ]+\s+[\w$]+\s*\([^;]*$/;
  for (let l = linha; l >= Math.max(1, linha - 200); l--) {
    const t = m.getLineContent(l);
    if (assinatura.test(t) && !/^\s*(?:return|new|else|if|for|while|switch|catch)\b/.test(t)) return l;
  }
  return Math.max(1, linha - 60);
}

/** Frame com código do projeto (não de biblioteca, do servidor ou do framework). */
function doProjeto(f: FrameDap & { presentationHint?: string }): boolean {
  return !!f.source?.path && !/[\\/]node_modules[\\/]/.test(f.source.path) && f.presentationHint !== 'subtle' && f.presentationHint !== 'deemphasize';
}

/** "Thread [http-nio-8080-exec-3]" → "http-nio-8080-exec-3". */
function nomeDeThread(nome: string): string {
  return /^Thread \[(.*)\]$/.exec(nome)?.[1] ?? nome;
}

function mesmo(a: string, b: string): boolean {
  const n = (c: string) => c.replace(/\\/g, '/').toLowerCase();
  return n(a) === n(b);
}

