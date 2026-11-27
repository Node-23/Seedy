import { afterNextRender, Component, computed, DestroyRef, effect, ElementRef, inject, isDevMode, signal, untracked, viewChild } from '@angular/core';
import { monaco } from '../editor/monaco';
import { initVimMode } from '../../vendor/monaco-vim';
import { EditorService } from '../editor/editor.service';
import { TemaService } from '../tema/tema';
import { LayoutService } from '../layout/layout.service';
import { EscolhaService } from '../escolha/escolha.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { ponte } from '../nucleo/ponte';
import { Bloco, diff3, resolverSimples } from './diff';
import { GitService } from './git.service';
import { ContextoDoMerge, MergeService } from './merge.service';
import { IaMergeService } from '../ia/ia-merge.service';
import { MergeIaComponent } from '../ia/merge-ia.component';

interface Conflito {
  bloco: Bloco;
  /** Decoração (vazia) no resultado que marca onde a resolução entra. */
  ancora: string;
  zona: string | null;
  resolvido: string | null;
  /** Linhas (1..n) do bloco nas colunas da esquerda e da direita. */
  seu: [number, number];
  deles: [number, number];
}

const ROTULO: Record<string, string> = { seu: '« seu', deles: 'deles »', ambos: 'ambos' };

/**
 * Merge de conflitos em três colunas (mockup 05): a sua versão, o resultado
 * (editável, é o que será gravado) e a deles. O que só um lado mudou já entra
 * sozinho; os conflitos viram caixas no resultado, resolvidas pelos botões,
 * por » / « nas colunas, ou por dp / do (vim). :w grava e vai para o próximo arquivo.
 */
@Component({
  selector: 'sd-merge',
  imports: [MergeIaComponent],
  template: `
    <div class="merge-tela">
      <div class="merge-barra">
        <span class="forte">{{ nomeDoArquivo() }}</span>
        <span class="suave">{{ mudancas() }} {{ mudancas() === 1 ? 'mudança' : 'mudanças' }} ·</span>
        <span class="git-mais">{{ automaticas() }} {{ automaticas() === 1 ? 'resolvida' : 'resolvidas' }} automaticamente</span>
        <span class="suave">·</span>
        <span [class.git-menos]="servico.restantes() > 0" [class.git-mais]="servico.restantes() === 0">
          {{ servico.restantes() }} {{ servico.restantes() === 1 ? 'conflito' : 'conflitos' }}
        </span>
        <span class="espaco"></span>
        <button class="botao" (click)="aceitarTudo('seu')">aceitar tudo seu</button>
        <button class="botao" (click)="aceitarTudo('deles')">aceitar tudo deles</button>
        <button class="botao destaque-texto merge-botao-ia" [class.ligado]="ia.aberto()" title="Conversar com a IA sobre os conflitos" (click)="ia.alternar()">
          ✦ IA <kbd>Alt+A</kbd>
        </button>
        <button class="botao destaque" (click)="resolverTudoSimples()">✦ resolver simples</button>
      </div>
      <div class="merge-colunas">
        <section class="painel merge-coluna">
          <div class="painel-faixa"><span class="rotulo">SUA VERSÃO</span><span class="destaque-texto">{{ nomeSeu() }}</span></div>
          <div #hostSeu class="merge-monaco"></div>
        </section>
        <section class="painel merge-coluna merge-resultado">
          <div class="painel-faixa"><span class="rotulo">RESULTADO</span><span>será gravado</span></div>
          <div #linhaVim class="vim-linha"></div>
          <div #hostResultado class="merge-monaco"></div>
        </section>
        <section class="painel merge-coluna">
          <div class="painel-faixa"><span class="rotulo">DELES</span><span class="rosa-texto">{{ nomeDeles() }}</span></div>
          <div #hostDeles class="merge-monaco"></div>
        </section>
        @if (ia.aberto()) { <sd-merge-ia /> }
      </div>
    </div>
  `,
})
export class MergeComponent {
  protected readonly servico = inject(MergeService);
  protected readonly ia = inject(IaMergeService);
  private readonly git = inject(GitService);
  private readonly editor = inject(EditorService);
  private readonly tema = inject(TemaService);
  private readonly layout = inject(LayoutService);
  private readonly escolha = inject(EscolhaService);
  private readonly mensagens = inject(MensagensService);
  private readonly hostSeu = viewChild.required<ElementRef<HTMLDivElement>>('hostSeu');
  private readonly linhaVim = viewChild.required<ElementRef<HTMLDivElement>>('linhaVim');
  private readonly hostResultado = viewChild.required<ElementRef<HTMLDivElement>>('hostResultado');
  private readonly hostDeles = viewChild.required<ElementRef<HTMLDivElement>>('hostDeles');

  protected readonly nomeSeu = signal('');
  protected readonly nomeDeles = signal('');
  private readonly relativo = signal<string | null>(null);
  protected readonly nomeDoArquivo = computed(() => this.relativo()?.split('/').pop() ?? '');
  protected readonly mudancas = signal(0);
  protected readonly automaticas = signal(0);

  private eSeu: monaco.editor.IStandaloneCodeEditor | null = null;
  private eResultado: monaco.editor.IStandaloneCodeEditor | null = null;
  private eDeles: monaco.editor.IStandaloneCodeEditor | null = null;
  private modelos: monaco.editor.ITextModel[] = [];
  private conflitos: Conflito[] = [];
  private fimDeLinha = '\n';
  /** Arquivos em conflito quando o merge abriu (a ordem não muda enquanto resolve). */
  private fila: string[] = [];

  constructor() {
    const destruir = inject(DestroyRef);
    afterNextRender(() => {
      const opcoes = (somenteLeitura: boolean): monaco.editor.IStandaloneEditorConstructionOptions => {
        const f = this.tema.tema().fontes.codigo;
        return {
          model: null,
          theme: 'seedy',
          readOnly: somenteLeitura,
          automaticLayout: true,
          minimap: { enabled: false },
          glyphMargin: somenteLeitura,
          lineNumbersMinChars: 3,
          scrollBeyondLastLine: false,
          renderLineHighlight: somenteLeitura ? 'none' : 'line',
          overviewRulerLanes: 0,
          stickyScroll: { enabled: false },
          'semanticHighlighting.enabled': false,
          scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
          fontFamily: `"${f.familia}", ${this.tema.tema().fontes.reserva}`,
          fontSize: f.tamanho,
          lineHeight: f.alturaLinha,
        };
      };
      this.eSeu = monaco.editor.create(this.hostSeu().nativeElement, opcoes(true));
      this.eResultado = monaco.editor.create(this.hostResultado().nativeElement, opcoes(false));
      this.eDeles = monaco.editor.create(this.hostDeles().nativeElement, opcoes(true));

      // Vim no resultado, com a linha de comando no canto de cima da coluna.
      const barra = document.createElement('span');
      barra.className = 'vim-painel';
      this.linhaVim().nativeElement.appendChild(barra);
      const vim = initVimMode(this.eResultado, barra);
      vim.on('vim-mode-change', (e: { mode: 'normal' | 'insert' | 'visual' | 'replace' }) => this.editor.modo.set(e.mode));
      // dp / do: o "d" do vim é operador e engole o mapeamento; então, com "d" pendente,
      // o "p"/"o" seguinte é tratado aqui antes do vim (fase de captura).
      this.hostResultado().nativeElement.addEventListener(
        'keydown',
        (ev) => {
          const estado = (vim as unknown as { state: { vim?: { insertMode: boolean; visualMode: boolean; inputState: { operator: string | null; motion: string | null } } } }).state.vim;
          if (!estado || estado.insertMode || estado.visualMode) return;
          if (ev.ctrlKey || ev.altKey || ev.metaKey || (ev.key !== 'p' && ev.key !== 'o')) return;
          if (estado.inputState.operator !== 'delete' || estado.inputState.motion) return;
          ev.preventDefault();
          ev.stopImmediatePropagation();
          (vim as unknown as { state: { vim: { inputState: unknown } } }).state.vim.inputState = new (estado.inputState.constructor as new () => unknown)();
          // Só o que estava pendente (o último elemento); o resto da linha o vim continua usando.
          if (barra.lastElementChild) barra.lastElementChild.textContent = '';
          this.servico.acoes?.pegar(ev.key === 'p' ? 'seu' : 'deles');
        },
        true,
      );

      // » / « nas colunas: pega aquele lado para o conflito daquela linha.
      for (const [ed, lado] of [[this.eSeu, 'seu'], [this.eDeles, 'deles']] as const) {
        ed.onMouseDown((e) => {
          if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
          const linha = e.target.position?.lineNumber ?? 0;
          const c = this.conflitos.find((k) => !k.resolvido && k[lado][0] === linha);
          if (c) this.resolver(c, lado);
        });
      }
      // Botões das caixas de conflito no resultado.
      this.eResultado.onMouseDown((e) => {
        if (e.target.type !== monaco.editor.MouseTargetType.CONTENT_VIEW_ZONE) return;
        const botao = (e.target.element as HTMLElement | null)?.closest('button');
        const c = this.conflitos.find((k) => k.zona === (e.target as { detail?: { viewZoneId?: string } }).detail?.viewZoneId);
        if (botao && c) this.resolver(c, botao.dataset['acao'] as 'seu' | 'deles' | 'ambos');
      });
      // As três colunas rolam juntas.
      this.eResultado.onDidScrollChange((e) => {
        if (!e.scrollTopChanged) return;
        this.eSeu?.setScrollTop(e.scrollTop);
        this.eDeles?.setScrollTop(e.scrollTop);
      });

      this.servico.acoes = {
        proximo: (p) => this.proximo(p),
        pegar: (lado) => {
          const c = this.conflitoPerto();
          if (c) this.resolver(c, lado);
        },
        gravar: () => this.gravar(),
        contexto: () => this.contextoParaIA(),
        aplicarIA: (n, linhas) => {
          const c = this.conflitos[n - 1];
          if (!c || c.resolvido) return false;
          this.resolver(c, { linhas, tag: '✦ IA' });
          return true;
        },
        focarResultado: () => this.eResultado?.focus(),
      };

      destruir.onDestroy(() => {
        this.servico.acoes = null;
        this.servico.arquivo.set(null);
        this.servico.previa.set(null);
        vim.dispose?.();
        barra.remove();
        this.limpar();
        for (const e of [this.eSeu, this.eResultado, this.eDeles]) e?.dispose();
      });

      // Só em desenvolvimento: inspecionar pelo DevTools.
      if (isDevMode()) Object.assign(window, { seedyMerge: this, seedyMergeVim: vim });
      void this.iniciar();
    });

    // Proposta da IA: a caixa do conflito vira a prévia (e volta quando sai).
    effect(() => {
      this.servico.previa();
      untracked(() => this.desenharZonas());
    });

    // Se outro programa resolver tudo, o merge fecha sozinho.
    effect(() => {
      const n = this.git.conflitos().length;
      untracked(() => this.servico.totalDeArquivos.set(Math.max(this.fila.length, n)));
    });
  }

  private async iniciar(): Promise<void> {
    this.fila = this.git.conflitos().map((c) => c.relativo);
    this.servico.totalDeArquivos.set(this.fila.length);
    const e = this.git.estado();
    this.nomeSeu.set(e?.branch ?? 'HEAD');
    const outro = e?.operacao === 'cherry-pick' ? 'CHERRY_PICK_HEAD' : e?.operacao === 'revert' ? 'REVERT_HEAD' : 'MERGE_HEAD';
    const nome = e?.operacao
      ? await this.git.rodar(['name-rev', '--name-only', '--refs=refs/heads/*', '--refs=refs/remotes/*', outro]).catch(() => '')
      : '';
    // Sem merge/cherry-pick em andamento, o conflito veio de outro lugar (a prateleira).
    this.nomeDeles.set(nome.trim().replace(/~\d+$/, '') || (e?.operacao ? outro.toLowerCase() : (this.servico.origemDeles() ?? 'deles')));
    this.servico.deles.set(this.nomeDeles());
    if (!this.fila.length) {
      this.mensagens.alerta('não há arquivos em conflito');
      this.layout.tela.set('git');
      return;
    }
    await this.abrirArquivo(0);
  }

  private async abrirArquivo(i: number): Promise<void> {
    const rel = this.fila[i];
    this.servico.arquivoAtual.set(i);
    this.relativo.set(rel);
    this.servico.arquivo.set(rel);
    const [base, seu, deles] = await Promise.all([':1', ':2', ':3'].map((rev) => this.git.conteudo(rev, rel)));
    if (!seu || !deles) {
      // Um lado apagou o arquivo: não há o que juntar linha a linha.
      await this.conflitoDeArquivoApagado(rel, !seu ? 'seu' : 'deles');
      return;
    }
    this.fimDeLinha = seu.includes('\r\n') ? '\r\n' : '\n';
    const linhas = (t: string) => t.split(/\r?\n/);
    this.montar(diff3(linhas(base), linhas(seu), linhas(deles)), linhas(seu), linhas(deles), rel);
  }

  private montar(blocos: Bloco[], seu: string[], deles: string[], rel: string): void {
    this.limpar();
    const linguagem = this.editor.linguagemDe(rel);
    const resultado: string[] = [];
    const marcasResultado: { ini: number; fim: number; tag: string }[] = [];
    const ancoras: number[] = [];
    const marcasSeu: monaco.editor.IModelDeltaDecoration[] = [];
    const marcasDeles: monaco.editor.IModelDeltaDecoration[] = [];
    const pendentes: Omit<Conflito, 'ancora' | 'zona'>[] = [];
    let ls = 1;
    let ld = 1;
    let mudancas = 0;
    let automaticas = 0;
    const faixa = (ini: number, n: number, classe: string, glifo?: string): monaco.editor.IModelDeltaDecoration[] =>
      n <= 0
        ? []
        : [
            { range: new monaco.Range(ini, 1, ini + n - 1, 1), options: { isWholeLine: true, className: classe } },
            ...(glifo ? [{ range: new monaco.Range(ini, 1, ini, 1), options: { glyphMarginClassName: glifo } }] : []),
          ];

    for (const b of blocos) {
      if (b.tipo !== 'igual') mudancas++;
      if (b.tipo === 'igual') {
        resultado.push(...b.base);
      } else if (b.tipo === 'conflito') {
        ancoras.push(resultado.length);
        pendentes.push({ bloco: b, resolvido: null, seu: [ls, ls + b.seu.length - 1], deles: [ld, ld + b.deles.length - 1] });
        marcasSeu.push(...faixa(ls, Math.max(1, b.seu.length), 'merge-linha-conflito', 'merge-pegar-seu'));
        marcasDeles.push(...faixa(ld, Math.max(1, b.deles.length), 'merge-linha-conflito', 'merge-pegar-deles'));
      } else {
        automaticas++;
        const linhas = b.tipo === 'deles' ? b.deles : b.seu;
        const tag = b.tipo === 'seu' ? '✦ só seu' : b.tipo === 'deles' ? '✦ só deles' : 'os dois lados';
        marcasResultado.push({ ini: resultado.length + 1, fim: resultado.length + linhas.length, tag });
        resultado.push(...linhas);
        if (b.tipo !== 'deles') marcasSeu.push(...faixa(ls, b.seu.length, 'merge-linha-mudou'));
        if (b.tipo !== 'seu') marcasDeles.push(...faixa(ld, b.deles.length, 'merge-linha-mudou'));
      }
      ls += b.seu.length;
      ld += b.deles.length;
    }
    // Conflito no fim do arquivo precisa de uma linha onde ancorar.
    if (ancoras.some((a) => a >= resultado.length)) resultado.push('');

    const [mSeu, mResultado, mDeles] = [seu.join('\n'), resultado.join('\n'), deles.join('\n')].map((t) =>
      monaco.editor.createModel(t, linguagem),
    );
    this.modelos = [mSeu, mResultado, mDeles];
    this.eSeu!.setModel(mSeu);
    this.eResultado!.setModel(mResultado);
    this.eDeles!.setModel(mDeles);
    mSeu.deltaDecorations([], marcasSeu);
    mDeles.deltaDecorations([], marcasDeles);
    mResultado.deltaDecorations([], marcasResultado.flatMap((x) => this.marcaDoResultado(mResultado, x.ini, x.fim, x.tag)));

    const ids = mResultado.deltaDecorations(
      [],
      ancoras.map((a) => ({
        range: new monaco.Range(a + 1, 1, a + 1, 1),
        options: { stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges },
      })),
    );
    this.conflitos = pendentes.map((p, i) => ({ ...p, ancora: ids[i], zona: null }));
    this.mudancas.set(mudancas);
    this.automaticas.set(automaticas);
    this.desenharZonas();
    this.atualizarRestantes();
    queueMicrotask(() => {
      this.eResultado?.focus();
      this.proximo(1);
    });
  }

  /** Fundo verde e etiqueta ("✦ só deles", "« seu"...) nas linhas que entraram no resultado. */
  private marcaDoResultado(m: monaco.editor.ITextModel, ini: number, fim: number, tag: string): monaco.editor.IModelDeltaDecoration[] {
    if (fim < ini) return [];
    // A etiqueta vai no fim da primeira linha do trecho.
    const col = m.getLineMaxColumn(ini);
    return [
      { range: new monaco.Range(ini, 1, fim, 1), options: { isWholeLine: true, className: 'merge-linha-mudou' } },
      { range: new monaco.Range(ini, col, ini, col), options: { after: { content: `   ${tag}`, inlineClassName: 'merge-etiqueta' }, showIfCollapsed: true } },
    ];
  }

  /** Caixas tracejadas dos conflitos sem resolução, com os botões. */
  private desenharZonas(): void {
    const ed = this.eResultado;
    const m = ed?.getModel();
    if (!ed || !m) return;
    const total = this.conflitos.length;
    ed.changeViewZones((acc) => {
      this.conflitos.forEach((c, i) => {
        if (c.zona) acc.removeZone(c.zona);
        c.zona = null;
        if (c.resolvido) return;
        const linha = m.getDecorationRange(c.ancora)?.startLineNumber ?? 1;
        const previa = this.servico.previa();
        if (previa?.conflito === i + 1) {
          c.zona = acc.addZone({ afterLineNumber: linha - 1, heightInPx: this.alturaDaPrevia(previa.linhas.length), domNode: this.caixaDaPrevia(i + 1, previa.linhas) });
          return;
        }
        const caixa = document.createElement('div');
        caixa.className = 'merge-conflito';
        const titulo = document.createElement('div');
        titulo.textContent = `conflito ${i + 1} de ${total} — os dois lados mudaram`;
        const botoes = document.createElement('div');
        botoes.className = 'merge-botoes';
        for (const acao of ['seu', 'deles', 'ambos'] as const) {
          const b = document.createElement('button');
          b.className = 'botao';
          b.dataset['acao'] = acao;
          b.textContent = acao === 'seu' ? '« seu  dp' : acao === 'deles' ? 'deles »  do' : 'ambos';
          botoes.appendChild(b);
        }
        caixa.append(titulo, botoes);
        c.zona = acc.addZone({ afterLineNumber: linha - 1, heightInPx: 86, domNode: caixa });
      });
    });
  }

  private resolver(c: Conflito, como: 'seu' | 'deles' | 'ambos' | 'simples' | { linhas: string[]; tag: string }): void {
    const m = this.eResultado?.getModel();
    if (!m || c.resolvido) return;
    let linhas: string[];
    let tag: string;
    const numero = this.conflitos.indexOf(c) + 1;
    if (this.servico.previa()?.conflito === numero) this.servico.previa.set(null);
    if (typeof como === 'object') {
      linhas = como.linhas;
      tag = como.tag;
    } else if (como === 'simples') {
      const r = resolverSimples(c.bloco);
      if (!r) return;
      linhas = r.linhas;
      tag = `✦ ${r.motivo}`;
    } else {
      linhas = como === 'seu' ? c.bloco.seu : como === 'deles' ? c.bloco.deles : [...c.bloco.seu, ...c.bloco.deles];
      tag = ROTULO[como];
    }
    const pos = m.getDecorationRange(c.ancora);
    const linha = pos?.startLineNumber ?? 1;
    if (linhas.length) m.pushEditOperations([], [{ range: new monaco.Range(linha, 1, linha, 1), text: linhas.join('\n') + '\n' }], () => null);
    c.resolvido = typeof como === 'object' ? 'ia' : como;
    m.deltaDecorations([], this.marcaDoResultado(m, linha, linha + linhas.length - 1, tag));
    this.desenharZonas();
    this.atualizarRestantes();
  }

  /** Altura da caixa da prévia: título + linhas de código (na altura de linha do editor). */
  private alturaDaPrevia(n: number): number {
    const linha = this.eResultado?.getOption(monaco.editor.EditorOption.lineHeight) ?? 20;
    return 8 + 26 + n * linha + 10;
  }

  /** Caixa tracejada (lavanda) com o código que a IA propôs, antes de aplicar. */
  private caixaDaPrevia(numero: number, linhas: string[]): HTMLElement {
    const caixa = document.createElement('div');
    caixa.className = 'merge-previa-ia';
    const titulo = document.createElement('div');
    titulo.className = 'merge-previa-titulo';
    titulo.textContent = `✦ prévia da IA · conflito ${numero}`;
    const dica = document.createElement('span');
    dica.className = 'suave';
    dica.textContent = '⏎ aplica no chat';
    titulo.appendChild(dica);
    const codigo = document.createElement('div');
    codigo.className = 'merge-previa-codigo';
    const f = this.tema.tema().fontes.codigo;
    codigo.style.fontFamily = `"${f.familia}", ${this.tema.tema().fontes.reserva}`;
    codigo.style.fontSize = `${f.tamanho}px`;
    codigo.style.lineHeight = `${this.eResultado?.getOption(monaco.editor.EditorOption.lineHeight) ?? 20}px`;
    codigo.textContent = linhas.join('\n');
    caixa.append(titulo, codigo);
    return caixa;
  }

  /** O arquivo e os conflitos, para a IA (o chat monta a conversa com isto). */
  private contextoParaIA(): ContextoDoMerge | null {
    const m = this.eResultado?.getModel();
    const rel = this.relativo();
    if (!m || !rel) return null;
    const perto = this.conflitoPerto();
    return {
      arquivo: rel,
      linguagem: this.editor.linguagemDe(rel),
      nomeSeu: this.nomeSeu(),
      nomeDeles: this.nomeDeles(),
      resultado: m.getLinesContent(),
      conflitos: this.conflitos.map((c, i) => ({
        numero: i + 1,
        resolvido: !!c.resolvido,
        linha: m.getDecorationRange(c.ancora)?.startLineNumber ?? 1,
        base: c.bloco.base,
        seu: c.bloco.seu,
        deles: c.bloco.deles,
      })),
      atual: perto ? this.conflitos.indexOf(perto) + 1 : null,
    };
  }

  protected aceitarTudo(lado: 'seu' | 'deles'): void {
    for (const c of this.conflitos) if (!c.resolvido) this.resolver(c, lado);
  }

  protected resolverTudoSimples(): void {
    let n = 0;
    for (const c of this.conflitos) {
      if (c.resolvido || !resolverSimples(c.bloco)) continue;
      this.resolver(c, 'simples');
      n++;
    }
    const sobram = this.conflitos.filter((c) => !c.resolvido).length;
    this.mensagens.mostrar(
      n ? `${n} ${n === 1 ? 'conflito resolvido' : 'conflitos resolvidos'}${sobram ? `; ${sobram} precisa(m) de você` : ''}` : 'nenhum conflito simples: escolha o lado em cada um',
    );
  }

  private proximo(passo: 1 | -1): void {
    const ed = this.eResultado;
    const m = ed?.getModel();
    if (!ed || !m) return;
    const linhas = this.conflitos
      .filter((c) => !c.resolvido)
      .map((c) => m.getDecorationRange(c.ancora)?.startLineNumber ?? 1)
      .sort((a, b) => a - b);
    if (!linhas.length) {
      this.mensagens.alerta('sem conflitos: :w grava');
      return;
    }
    const atual = ed.getPosition()?.lineNumber ?? 1;
    const alvo = passo > 0 ? (linhas.find((l) => l > atual) ?? linhas[0]) : ([...linhas].reverse().find((l) => l < atual) ?? linhas[linhas.length - 1]);
    ed.setPosition({ lineNumber: alvo, column: 1 });
    ed.revealLineInCenter(alvo);
  }

  /** Conflito sem resolução mais perto do cursor (para dp / do). */
  private conflitoPerto(): Conflito | undefined {
    const m = this.eResultado?.getModel();
    const atual = this.eResultado?.getPosition()?.lineNumber ?? 1;
    if (!m) return undefined;
    return this.conflitos
      .filter((c) => !c.resolvido)
      .sort((a, b) => Math.abs((m.getDecorationRange(a.ancora)?.startLineNumber ?? 1) - atual) - Math.abs((m.getDecorationRange(b.ancora)?.startLineNumber ?? 1) - atual))[0];
  }

  private atualizarRestantes(): void {
    this.servico.restantes.set(this.conflitos.filter((c) => !c.resolvido).length);
  }

  /** :w — grava o resultado, marca como resolvido (git add) e vai para o próximo arquivo. */
  private async gravar(): Promise<void> {
    const m = this.eResultado?.getModel();
    const rel = this.relativo();
    if (!m || !rel) return;
    const sobram = this.servico.restantes();
    if (sobram) {
      const ok = await this.escolha.escolherUm(`AINDA HÁ ${sobram} ${sobram === 1 ? 'CONFLITO' : 'CONFLITOS'}`, [
        { rotulo: 'Voltar e resolver', valor: false },
        { rotulo: 'Gravar mesmo assim', detalhe: 'os trechos em conflito ficam de fora', valor: true },
      ]);
      if (!ok) return;
    }
    const texto = m.getLinesContent().join(this.fimDeLinha);
    await ponte.gravarArquivo(this.git.absoluto(rel), texto);
    if (!(await this.git.operar(`resolvendo ${rel}`, ['add', '--', rel], `${rel.split('/').pop()} resolvido`))) return;
    // Conflito da prateleira: resolvido, o arquivo volta a ser só uma mudança (fora do índice).
    if (!this.git.estado()?.operacao) await this.git.operar(`resolvendo ${rel}`, ['reset', '-q', '--', rel]);
    await this.seguir();
  }

  private async seguir(): Promise<void> {
    const proximo = this.servico.arquivoAtual() + 1;
    if (proximo < this.fila.length) {
      await this.abrirArquivo(proximo);
      return;
    }
    if (!this.git.estado()?.operacao) {
      this.servico.origemDeles.set(null);
      this.mensagens.mostrar('conflitos resolvidos');
      this.layout.tela.set('editor');
      return;
    }
    const op = this.git.estado()?.operacao ?? 'merge';
    const concluir = await this.escolha.escolherUm('TODOS OS CONFLITOS RESOLVIDOS', [
      { rotulo: `Concluir o ${op}`, detalhe: op === 'merge' ? 'faz o commit do merge' : `${op} --continue`, valor: true },
      { rotulo: 'Depois', detalhe: 'volta para a tela do Git', valor: false },
    ]);
    if (concluir) await this.git.concluirOperacao();
    this.layout.tela.set('git');
  }

  private async conflitoDeArquivoApagado(rel: string, apagouQuem: 'seu' | 'deles'): Promise<void> {
    const r = await this.escolha.escolherUm(`${rel.split('/').pop()?.toUpperCase()}: ${apagouQuem === 'seu' ? 'VOCÊ APAGOU' : 'ELES APAGARAM'}, O OUTRO LADO MUDOU`, [
      { rotulo: 'Manter o arquivo (com a mudança)', valor: 'manter' as const },
      { rotulo: 'Apagar o arquivo', valor: 'apagar' as const },
    ]);
    if (!r) {
      this.layout.tela.set('git');
      return;
    }
    const lado = apagouQuem === 'seu' ? '--theirs' : '--ours';
    const ok =
      r === 'apagar'
        ? await this.git.operar(`apagando ${rel}`, ['rm', '--', rel])
        : (await this.git.operar(`mantendo ${rel}`, ['checkout', lado, '--', rel])) && (await this.git.operar(`resolvendo ${rel}`, ['add', '--', rel]));
    if (ok) await this.seguir();
  }

  private limpar(): void {
    this.conflitos = [];
    for (const m of this.modelos) m.dispose();
    this.modelos = [];
  }
}
