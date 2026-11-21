import { computed, effect, inject, Injectable, isDevMode, signal, untracked } from '@angular/core';
import { ponte } from '../nucleo/ponte';
import { monaco } from '../editor/monaco';
import { EditorService } from '../editor/editor.service';
import { JdtlsService } from '../java/jdtls.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { ServidorService } from './servidor.service';
import { LayoutService } from '../layout/layout.service';
import { ProjetoService } from '../nucleo/projeto.service';

export interface FrameDap {
  id: number;
  name: string;
  line: number;
  source?: { path?: string; name?: string };
}

export interface VariavelDap {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
}

export interface ThreadDap {
  id: number;
  name: string;
}

/** Um nó da árvore de variáveis (os filhos carregam ao abrir). */
export interface NoDeVariavel {
  chave: string;
  nivel: number;
  v: VariavelDap;
  aberto: boolean;
}

/** Sessão de debug: anexada a um servidor (JDWP) ou um processo `main` lançado pelo java-debug. */
export interface SessaoDebug {
  tipo: 'servidor' | 'main' | 'navegador';
  nome: string;
  perfilId: string | null;
  porta: number | null;
  /** RUN sem debug: o java-debug só roda o processo (sem breakpoints). */
  semDebug: boolean;
}

/** O que o RUN/DEBUG de uma classe `main` precisa. */
export interface AlvoMain {
  nome: string;
  mainClass: string;
  projectName: string;
}

export type ParadaEmExcecoes = 'nenhuma' | 'naoTratadas' | 'todas';

/** O que o debug no navegador precisa (mockup 14). */
export interface AlvoNavegador {
  nome: string;
  url: string;
  webRoot: string;
  navegador: 'edge' | 'chrome';
}

/** Arquivos em que dá para pôr breakpoint: Java e JS/TS (debug no navegador). */
export function aceitaBreakpoint(caminho: string): boolean {
  return /\.(java|[cm]?[jt]sx?)$/i.test(caminho);
}

interface Mensagem {
  type: 'request' | 'response' | 'event';
  seq: number;
  command?: string;
  event?: string;
  request_seq?: number;
  success?: boolean;
  message?: string;
  body?: any;
}

const CHAVE_DOS_BREAKPOINTS = 'seedy.breakpoints';
const CHAVE_DAS_CONDICOES = 'seedy.breakpoints.condicoes';
const CHAVE_DAS_VIGIAS = 'seedy.vigias';
const CHAVE_DAS_EXCECOES = 'seedy.breakpoints.excecoes';

/**
 * Debug de Java pelo java-debug (DAP): anexado ao servidor (JDWP) ou lançando a classe
 * `main` (o java-debug sobe a JVM; com RUN, sem debug). Breakpoints na margem (ctrl+F8),
 * com condição; F8 passa, F7 entra, shift+F8 sai, F9 continua, alt+F9 roda até o cursor,
 * alt+F8 avalia. Classes alteradas entram no processo sozinhas (hot code replace).
 */
@Injectable({ providedIn: 'root' })
export class DepuradorService {
  private readonly editor = inject(EditorService);
  private readonly jdtls = inject(JdtlsService);
  private readonly mensagens = inject(MensagensService);
  private readonly servidor = inject(ServidorService);
  private readonly layout = inject(LayoutService);
  private readonly projeto = inject(ProjetoService);

  /** Arquivo → linhas com breakpoint. */
  readonly breakpoints = signal(new Map<string, number[]>(ler<[string, number[]][]>(CHAVE_DOS_BREAKPOINTS, [])));
  /** `arquivo#linha` → condição do breakpoint. */
  readonly condicoes = signal(new Map<string, string>(ler<[string, string][]>(CHAVE_DAS_CONDICOES, [])));
  readonly silenciado = signal(false);
  readonly paradaEmExcecoes = signal<ParadaEmExcecoes>(ler<ParadaEmExcecoes>(CHAVE_DAS_EXCECOES, 'nenhuma'));
  readonly sessao = signal<SessaoDebug | null>(null);
  readonly pausado = signal<{ threadId: number; motivo: string; texto: string | null } | null>(null);
  readonly threads = signal<ThreadDap[]>([]);
  readonly frames = signal<FrameDap[]>([]);
  readonly frameAtual = signal<number | null>(null);
  readonly variaveis = signal<NoDeVariavel[]>([]);
  readonly avaliacoes = signal<{ expressao: string; resultado: string; erro: boolean }[]>([]);
  /** Expressões vigiadas: reavaliadas a cada parada. */
  readonly vigias = signal<string[]>(ler<string[]>(CHAVE_DAS_VIGIAS, []));
  readonly valoresDasVigias = signal(new Map<string, { valor: string; erro: boolean }>());

  readonly ativo = computed(() => !!this.sessao());
  /** Sessão em que dá para depurar (não é um RUN sem debug). */
  readonly depurando = computed(() => !!this.sessao() && !this.sessao()!.semDebug);
  readonly localAtual = computed(() => {
    const f = this.frames().find((x) => x.id === this.frameAtual());
    return f?.source?.path ? { caminho: f.source.path, linha: f.line, nome: f.name } : null;
  });
  readonly totalDeBreakpoints = computed(() => [...this.breakpoints().values()].reduce((n, l) => n + l.length, 0));

  /** A saída do processo `main` (stdout/stderr) e o fim dele vão para quem roda (ExecucaoService). */
  aoSaida: ((texto: string, categoria: string) => void) | null = null;
  aoTerminar: ((codigo: number | null) => void) | null = null;
  /** A tela de debug (quando aberta) diz onde está o cursor dela e foca o campo de avaliar. */
  telaDebug: { cursor(): { caminho: string; linha: number } | null; focarAvaliar(): void } | null = null;

  private conexao: number | null = null;
  /** No debug do navegador, a sessão "pai" do js-debug (a que lançou o navegador). */
  private conexaoPai: number | null = null;
  private portaJsDebug: number | null = null;
  /** Conexões que já receberam os breakpoints (o js-debug manda "initialized" de novo e um reenvio os apagaria). */
  private readonly configuradas = new Set<number>();
  private seq = 0;
  private codigoDeSaida: number | null = null;
  private ateOCursor: { caminho: string; linha: number } | null = null;
  private readonly pendentes = new Map<number, { ok: (b: any) => void; erro: (e: Error) => void }>();
  private readonly filhos = new Map<string, VariavelDap[]>();
  private readonly decoracoes = new Map<monaco.editor.ITextModel, string[]>();
  private decoracaoAtual: monaco.editor.IEditorDecorationsCollection | null = null;

  constructor() {
    this.servidor.aoSubir = (perfilId, porta) => void this.anexar(perfilId, porta);
    this.servidor.aoParar = (perfilId) => {
      if (this.sessao()?.perfilId === perfilId) void this.desanexar();
    };
    // Breakpoints e a linha atual acompanham o arquivo mostrado.
    effect(() => {
      this.editor.ativo();
      this.breakpoints();
      this.localAtual();
      untracked(() => queueMicrotask(() => this.desenhar()));
    });
    if (isDevMode()) Object.assign(window, { seedyDepurador: this });
  }

  // ---------- breakpoints ----------

  /** ctrl+F8 / clique na margem: liga ou desliga o breakpoint da linha. */
  alternar(caminho: string, linha: number): void {
    const atual = new Set(this.breakpoints().get(caminho) ?? []);
    if (atual.has(linha)) {
      atual.delete(linha);
      this.mudarCondicao(caminho, linha, '');
    } else atual.add(linha);
    this.mudarLinhas(caminho, [...atual]);
  }

  alternarNoCursor(): void {
    const b = this.editor.bufferAtivo();
    const pos = this.editor.instancia?.getPosition();
    if (!b || b.somenteLeitura || !pos) return;
    if (!aceitaBreakpoint(b.caminho)) {
      this.mensagens.mostrar('breakpoints só em arquivos .java, .ts e .js');
      return;
    }
    this.alternar(b.caminho, pos.lineNumber);
  }

  remover(caminho: string, linha: number): void {
    this.mudarLinhas(caminho, (this.breakpoints().get(caminho) ?? []).filter((l) => l !== linha));
    this.mudarCondicao(caminho, linha, '');
  }

  condicao(caminho: string, linha: number): string {
    return this.condicoes().get(`${caminho}#${linha}`) ?? '';
  }

  /** Breakpoint condicional: só para quando a expressão Java dá true (vazio = sempre). */
  definirCondicao(caminho: string, linha: number, expressao: string): void {
    this.mudarCondicao(caminho, linha, expressao.trim());
    if (this.conexao !== null) void this.enviarBreakpoints(caminho);
    this.breakpoints.update((m) => new Map(m)); // redesenha (o ícone muda)
  }

  /** Deixa os breakpoints guardados mas não para neles. */
  alternarSilencio(): void {
    this.silenciado.update((s) => !s);
    this.mensagens.mostrar(this.silenciado() ? 'breakpoints silenciados' : 'breakpoints de volta');
    if (this.conexao !== null) void this.enviarTodos();
  }

  /** Nenhuma → só as não tratadas → todas as exceções. */
  alternarExcecoes(): void {
    const proxima: Record<ParadaEmExcecoes, ParadaEmExcecoes> = { nenhuma: 'naoTratadas', naoTratadas: 'todas', todas: 'nenhuma' };
    this.paradaEmExcecoes.set(proxima[this.paradaEmExcecoes()]);
    gravar(CHAVE_DAS_EXCECOES, this.paradaEmExcecoes());
    if (this.conexao !== null) void this.enviarExcecoes();
  }

  private mudarLinhas(caminho: string, linhas: number[]): void {
    this.breakpoints.update((m) => {
      const n = new Map(m);
      if (linhas.length) n.set(caminho, [...new Set(linhas)].sort((a, b) => a - b));
      else n.delete(caminho);
      return n;
    });
    gravar(CHAVE_DOS_BREAKPOINTS, [...this.breakpoints()]);
    if (this.conexao !== null) void this.enviarBreakpoints(caminho);
  }

  private mudarCondicao(caminho: string, linha: number, expressao: string): void {
    const chave = `${caminho}#${linha}`;
    if ((this.condicoes().get(chave) ?? '') === expressao) return;
    this.condicoes.update((m) => {
      const n = new Map(m);
      if (expressao) n.set(chave, expressao);
      else n.delete(chave);
      return n;
    });
    gravar(CHAVE_DAS_CONDICOES, [...this.condicoes()]);
  }

  /** Bolinhas na margem e a linha onde a execução parou (no editor principal). */
  private desenhar(): void {
    const ed = this.editor.instancia;
    const m = ed?.getModel();
    if (!ed || !m) return;
    const caminho = this.editor.bufferAtivo()?.caminho;
    const antigas = this.decoracoes.get(m) ?? [];
    this.decoracoes.set(m, m.deltaDecorations(antigas, caminho ? this.decoracoesDeBreakpoint(caminho, m) : []));
    this.decoracaoAtual?.clear();
    const aqui = this.localAtual();
    if (aqui && caminho && mesmo(aqui.caminho, caminho) && aqui.linha <= m.getLineCount()) {
      this.decoracaoAtual = ed.createDecorationsCollection([
        { range: new monaco.Range(aqui.linha, 1, aqui.linha, 1), options: { isWholeLine: true, className: 'linha-depurada', glyphMarginClassName: 'seta-depurada' } },
      ]);
    }
  }

  /** As bolinhas de um arquivo (a tela de debug usa as mesmas no editor dela). */
  decoracoesDeBreakpoint(caminho: string, m: monaco.editor.ITextModel): monaco.editor.IModelDeltaDecoration[] {
    const linhas = this.breakpoints().get(caminho) ?? [];
    return linhas
      .filter((l) => l <= m.getLineCount())
      .map((l) => {
        const cond = this.condicao(caminho, l);
        return {
          range: new monaco.Range(l, 1, l, 1),
          options: {
            glyphMarginClassName: `breakpoint${cond ? ' condicional' : ''}${this.silenciado() ? ' silenciado' : ''}`,
            glyphMarginHoverMessage: { value: cond ? `breakpoint se \`${cond}\`` : 'breakpoint (ctrl+F8)' },
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        };
      });
  }

  // ---------- sessão ----------

  /** Anexa o depurador ao servidor (JDWP em `porta`), pelo java-debug do jdtls. */
  async anexar(perfilId: string, porta: number): Promise<void> {
    const nome = this.servidor.perfil(perfilId)?.nome ?? 'servidor';
    await this.abrirSessao({ tipo: 'servidor', nome, perfilId, porta, semDebug: false }, () =>
      this.pedir('attach', { type: 'java', name: 'Seedy', request: 'attach', hostName: 'localhost', port: porta, timeout: 30000 }),
    );
  }

  /** RUN/DEBUG de uma classe `main`: o java-debug monta o classpath e sobe a JVM. */
  async lancar(alvo: AlvoMain, debug: boolean): Promise<boolean> {
    let caminhos: [string[], string[]];
    let java: string | undefined;
    try {
      // Compila antes (incremental), como o VS Code: sem isso a classe pode ainda não estar no disco.
      const build = await this.jdtls.executar<number>('java.workspace.compile', false).catch(() => null);
      if (build === 1) {
        this.mensagens.erro(`${alvo.nome}: o projeto tem erros de compilação`);
        return false;
      }
      caminhos = await this.jdtls.executar<[string[], string[]]>('vscode.java.resolveClasspath', alvo.mainClass, alvo.projectName);
      java = await this.jdtls.executar<string>('vscode.java.resolveJavaExecutable', alvo.mainClass, alvo.projectName).catch(() => undefined);
    } catch (e) {
      this.mensagens.erro(`não consegui montar o classpath de ${alvo.nome}: ${(e as Error).message}`);
      return false;
    }
    this.codigoDeSaida = null;
    return this.abrirSessao({ tipo: 'main', nome: alvo.nome, perfilId: null, porta: null, semDebug: !debug }, () =>
      this.pedir('launch', {
        type: 'java',
        name: alvo.nome,
        request: 'launch',
        mainClass: alvo.mainClass,
        projectName: alvo.projectName,
        cwd: this.projeto.raiz() ?? undefined,
        modulePaths: caminhos?.[0] ?? [],
        classPaths: caminhos?.[1] ?? [],
        javaExec: java,
        args: '',
        // A saída chega em UTF-8 (sem isso, acentos quebram no console do Windows).
        vmArgs: '-Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8 -Dfile.encoding=UTF-8',
        encoding: 'UTF-8',
        console: 'internalConsole',
        noDebug: !debug,
        stopOnEntry: false,
      }),
    );
  }

  /**
   * Debug no navegador (mockup 14): o js-debug abre o Edge/Chrome no endereço e pede uma
   * sessão filha (startDebugging) para a aba — é nela que ficam breakpoints e pausas.
   */
  async lancarNavegador(alvo: AlvoNavegador): Promise<boolean> {
    if (this.sessao()) await this.desanexar(this.sessao()!.tipo !== 'servidor');
    try {
      const porta = await ponte.web.jsdebug(true);
      this.portaJsDebug = porta;
      let id = -1;
      id = await ponte.dap.conectar(
        porta,
        (m) => this.receber(m, id),
        () => this.aoFecharConexao(id),
      );
      this.conexao = id;
      this.conexaoPai = id;
      this.sessao.set({ tipo: 'navegador', nome: alvo.nome, perfilId: null, porta: null, semDebug: false });
      await this.pedir('initialize', { ...INICIALIZAR, adapterID: 'pwa-chrome', supportsStartDebuggingRequest: true });
      void this.pedirEm(id, 'launch', {
        type: alvo.navegador === 'edge' ? 'pwa-msedge' : 'pwa-chrome',
        request: 'launch',
        name: alvo.nome,
        url: alvo.url,
        webRoot: alvo.webRoot,
        sourceMaps: true,
        smartStep: true,
        pauseForSourceMap: true,
        skipFiles: ['<node_internals>/**', '**/node_modules/**'],
        userDataDir: true,
        cleanUp: 'wholeBrowser',
      }).catch((e) => {
        this.mensagens.erro(`debug no navegador: ${e.message}`);
        void this.desanexar(true);
      });
      return true;
    } catch (e) {
      this.mensagens.erro(`debug no navegador: ${(e as Error).message ?? e}`);
      await this.desanexar();
      return false;
    }
  }

  /** O js-debug pediu uma sessão filha (a aba do navegador): conecta e a assume. */
  private async abrirFilha(args: { request: string; configuration: unknown }): Promise<void> {
    if (this.portaJsDebug === null) return;
    let id = -1;
    id = await ponte.dap.conectar(
      this.portaJsDebug,
      (m) => this.receber(m, id),
      () => this.aoFecharConexao(id),
    );
    this.conexao = id;
    await this.pedir('initialize', { ...INICIALIZAR, adapterID: 'pwa-chrome', supportsStartDebuggingRequest: true });
    void this.pedir(args.request === 'attach' ? 'attach' : 'launch', args.configuration).catch((e) => this.mensagens.erro(`debug no navegador: ${e.message}`));
  }

  /** Uma conexão caiu: no navegador, fechar a aba (filha) ou o js-debug (pai) encerra tudo. */
  private aoFecharConexao(id: number): void {
    if (this.sessao()?.tipo === 'navegador' && (id === this.conexao || id === this.conexaoPai)) void this.desanexar(true);
    else if (id === this.conexao) this.aoFechar();
  }

  private async abrirSessao(s: SessaoDebug, iniciar: () => Promise<unknown>): Promise<boolean> {
    if (this.sessao()) await this.desanexar(this.sessao()!.tipo === 'main');
    try {
      const portaDap = await this.jdtls.executar<number>('vscode.java.startDebugSession');
      await this.jdtls
        .executar('vscode.java.updateDebugSettings', JSON.stringify({ hotCodeReplace: 'auto', showStaticVariables: false, showQualifiedNames: false, showHex: false, showToString: true, maxStringLength: 0 }))
        .catch(() => undefined);
      let id = -1;
      id = await ponte.dap.conectar(
        portaDap,
        (m) => this.receber(m, id),
        () => this.aoFecharConexao(id),
      );
      this.conexao = id;
      this.sessao.set(s);
      await this.pedir('initialize', { ...INICIALIZAR, adapterID: 'java' });
      // A resposta do attach/launch só chega depois do configurationDone (feito no evento "initialized").
      void iniciar().catch((e) => {
        this.mensagens.erro(`${s.semDebug ? 'rodar' : 'debug'}: ${e.message}`);
        if (s.tipo === 'main') void this.desanexar(true);
      });
      return true;
    } catch (e) {
      this.mensagens.erro(`debug: ${(e as Error).message ?? e}`);
      await this.desanexar();
      return false;
    }
  }

  /** Solta o depurador; com `encerrar`, mata o processo depurado (o `main`). */
  async desanexar(encerrar = false): Promise<void> {
    const conexoes = [...new Set([this.conexao, this.conexaoPai].filter((c): c is number => c !== null))];
    this.conexao = null;
    this.conexaoPai = null;
    for (const c of conexoes) {
      await this.pedirEm(c, 'disconnect', { restart: false, terminateDebuggee: encerrar }).catch(() => undefined);
      await ponte.dap.fechar(c).catch(() => undefined);
    }
    this.aoFechar();
  }

  private aoFechar(): void {
    const s = this.sessao();
    this.conexao = null;
    this.conexaoPai = null;
    this.portaJsDebug = null;
    this.configuradas.clear();
    for (const p of this.pendentes.values()) p.erro(new Error('sessão de debug encerrada'));
    this.pendentes.clear();
    this.sessao.set(null);
    this.threads.set([]);
    this.limparPausa();
    if (s?.tipo === 'main') this.aoTerminar?.(this.codigoDeSaida);
  }

  // ---------- controle ----------

  continuar(): void {
    const p = this.pausado();
    if (p) void this.pedir('continue', { threadId: p.threadId }).then(() => this.limparPausa());
  }

  passar(): void {
    this.passo('next');
  }

  entrar(): void {
    this.passo('stepIn');
  }

  sair(): void {
    this.passo('stepOut');
  }

  /** alt+F9: segue até a linha (um breakpoint temporário que some na próxima parada). */
  async ateALinha(caminho: string, linha: number): Promise<void> {
    const p = this.pausado();
    if (!p) return void this.mensagens.mostrar('a execução não está pausada');
    this.ateOCursor = { caminho, linha };
    await this.enviarBreakpoints(caminho);
    this.continuar();
  }

  private passo(comando: 'next' | 'stepIn' | 'stepOut'): void {
    const p = this.pausado();
    if (!p) return void this.mensagens.mostrar('a execução não está pausada');
    void this.pedir(comando, { threadId: p.threadId }).catch((e) => this.mensagens.erro(`debug: ${e.message}`));
  }

  /** Avalia uma expressão no frame selecionado (alt+F8). */
  async avaliar(expressao: string): Promise<void> {
    const texto = expressao.trim();
    if (!texto) return;
    try {
      const r = await this.pedir('evaluate', { expression: texto, frameId: this.frameAtual() ?? undefined, context: 'repl' });
      this.avaliacoes.update((l) => [...l.slice(-30), { expressao: texto, resultado: `${r?.result ?? ''}${r?.type ? `  (${r.type})` : ''}`, erro: false }]);
    } catch (e) {
      this.avaliacoes.update((l) => [...l.slice(-30), { expressao: texto, resultado: (e as Error).message, erro: true }]);
    }
  }

  vigiar(expressao: string): void {
    const texto = expressao.trim();
    if (!texto || this.vigias().includes(texto)) return;
    this.vigias.update((l) => [...l, texto]);
    gravar(CHAVE_DAS_VIGIAS, this.vigias());
    void this.atualizarVigias();
  }

  deixarDeVigiar(expressao: string): void {
    this.vigias.update((l) => l.filter((v) => v !== expressao));
    gravar(CHAVE_DAS_VIGIAS, this.vigias());
  }

  private async atualizarVigias(): Promise<void> {
    const frameId = this.frameAtual();
    const valores = new Map<string, { valor: string; erro: boolean }>();
    for (const v of this.vigias()) {
      if (frameId === null) continue;
      try {
        const r = await this.pedir('evaluate', { expression: v, frameId, context: 'watch' });
        valores.set(v, { valor: r?.result ?? '', erro: false });
      } catch (e) {
        valores.set(v, { valor: (e as Error).message, erro: true });
      }
    }
    this.valoresDasVigias.set(valores);
  }

  async escolherFrame(id: number, abrirNoEditor = this.layout.tela() !== 'debug'): Promise<void> {
    this.frameAtual.set(id);
    const f = this.frames().find((x) => x.id === id);
    if (f?.source?.path && abrirNoEditor) await this.editor.abrir(f.source.path, f.line);
    await this.carregarVariaveis(id);
    await this.atualizarVigias();
  }

  /** Abre/fecha um nó da árvore de variáveis (carrega os filhos na primeira vez). */
  async alternarVariavel(chave: string): Promise<void> {
    const lista = this.variaveis();
    const i = lista.findIndex((n) => n.chave === chave);
    const no = lista[i];
    if (!no || !no.v.variablesReference) return;
    if (no.aberto) {
      const fim = lista.findIndex((n, j) => j > i && n.nivel <= no.nivel);
      this.variaveis.set([...lista.slice(0, i), { ...no, aberto: false }, ...(fim < 0 ? [] : lista.slice(fim))]);
      return;
    }
    let filhos = this.filhos.get(chave);
    if (!filhos) {
      filhos = ((await this.pedir('variables', { variablesReference: no.v.variablesReference }).catch(() => null))?.variables ?? []) as VariavelDap[];
      this.filhos.set(chave, filhos);
    }
    const novos = filhos.map((v) => ({ chave: `${chave}/${v.name}`, nivel: no.nivel + 1, v, aberto: false }));
    this.variaveis.set([...lista.slice(0, i), { ...no, aberto: true }, ...novos, ...lista.slice(i + 1)]);
  }

  // ---------- protocolo ----------

  private pedir(command: string, args: unknown): Promise<any> {
    if (this.conexao === null) return Promise.reject(new Error('sem sessão de debug'));
    return this.pedirEm(this.conexao, command, args);
  }

  private pedirEm(conexao: number, command: string, args: unknown): Promise<any> {
    const seq = ++this.seq;
    const msg = JSON.stringify({ type: 'request', seq, command, arguments: args });
    return new Promise((ok, erro) => {
      this.pendentes.set(seq, { ok, erro });
      ponte.dap.enviar(conexao, msg).catch((e) => {
        this.pendentes.delete(seq);
        erro(new Error(String(e)));
      });
    });
  }

  private receber(texto: string, origem: number): void {
    let m: Mensagem & { arguments?: any };
    try {
      m = JSON.parse(texto);
    } catch {
      return;
    }
    if (m.type === 'response' && m.request_seq !== undefined) {
      const p = this.pendentes.get(m.request_seq);
      this.pendentes.delete(m.request_seq);
      if (m.success) p?.ok(m.body);
      else p?.erro(new Error(m.message ?? 'falhou'));
    } else if (m.type === 'request') {
      // Pedidos do adaptador para o cliente (o js-debug pede as sessões filhas assim).
      const sucesso = m.command === 'startDebugging';
      void ponte.dap
        .enviar(origem, JSON.stringify({ type: 'response', seq: ++this.seq, request_seq: m.seq, command: m.command, success: sucesso, message: sucesso ? undefined : 'não suportado' }))
        .catch(() => undefined);
      if (sucesso) void this.abrirFilha(m.arguments ?? {});
    } else if (m.type === 'event') {
      // A sessão pai do navegador só precisa do configurationDone; o resto é da filha.
      if (this.sessao()?.tipo === 'navegador' && origem === this.conexaoPai && origem !== this.conexao) {
        if (m.event === 'initialized') void this.pedirEm(origem, 'configurationDone', {}).catch(() => undefined);
        else if (m.event === 'terminated') void this.desanexar(true);
        else if (m.event === 'output') void this.aoEvento('output', m.body ?? {});
        return;
      }
      void this.aoEvento(m.event ?? '', m.body ?? {});
    }
  }

  private async aoEvento(evento: string, corpo: any): Promise<void> {
    switch (evento) {
      case 'initialized': {
        const conexao = this.conexao;
        const primeira = conexao !== null && !this.configuradas.has(conexao);
        if (conexao !== null) this.configuradas.add(conexao);
        if (primeira && !this.sessao()?.semDebug) {
          await this.enviarTodos();
          await this.enviarExcecoes();
        }
        await this.pedir('configurationDone', {}).catch(() => undefined);
        const s = this.sessao();
        if (s?.tipo === 'servidor') this.mensagens.mostrar(`depurador anexado na porta ${s.porta}`);
        break;
      }
      case 'stopped':
        await this.aoParar(corpo.threadId, corpo.reason, corpo.text ?? corpo.description ?? null);
        break;
      case 'continued':
        this.limparPausa();
        break;
      case 'thread':
        void this.atualizarThreads();
        break;
      case 'exited':
        this.codigoDeSaida = typeof corpo.exitCode === 'number' ? corpo.exitCode : null;
        break;
      case 'terminated':
        // O "exited" (com o código de saída) às vezes chega logo depois.
        await new Promise((r) => setTimeout(r, 150));
        await this.desanexar();
        break;
      case 'hotcodereplace':
        // Build do jdtls terminou com classes alteradas: manda o processo trocá-las.
        if (corpo.changeType === 'BUILD_COMPLETE') {
          try {
            const r = await this.pedir('redefineClasses', {});
            const n = r?.changedClasses?.length ?? 0;
            if (n) this.mensagens.mostrar(`hot code replace: ${n} ${n === 1 ? 'classe trocada' : 'classes trocadas'}`);
          } catch (e) {
            this.mensagens.erro(`hot code replace: ${(e as Error).message}`);
          }
        } else if (corpo.changeType === 'ERROR' || corpo.changeType === 'WARNING') {
          this.mensagens.erro(`hot code replace não aplicou: ${corpo.message}`);
        }
        break;
      case 'output':
        if ((this.sessao()?.tipo === 'main' || this.sessao()?.tipo === 'navegador') && corpo.category !== 'telemetry') this.aoSaida?.(corpo.output ?? '', corpo.category ?? 'console');
        else if (corpo.category === 'stderr' && corpo.output?.trim()) this.mensagens.erro(`debug: ${corpo.output.trim()}`);
        break;
    }
  }

  private async aoParar(threadId: number, motivo: string, texto: string | null): Promise<void> {
    if (this.ateOCursor) {
      const { caminho } = this.ateOCursor;
      this.ateOCursor = null;
      void this.enviarBreakpoints(caminho);
    }
    this.pausado.set({ threadId, motivo, texto });
    void this.atualizarThreads();
    const r = await this.pedir('stackTrace', { threadId, startFrame: 0, levels: 80 }).catch(() => null);
    const frames = (r?.stackFrames ?? []) as FrameDap[];
    this.frames.set(frames);
    // Parou: a tela de debug aparece (como a janela de debug do IntelliJ).
    if (this.layout.tela() === 'editor') this.layout.tela.set('debug');
    const primeiro = frames.find((f) => f.source?.path) ?? frames[0];
    if (primeiro) await this.escolherFrame(primeiro.id);
  }

  private async atualizarThreads(): Promise<void> {
    const r = await this.pedir('threads', {}).catch(() => null);
    this.threads.set(((r?.threads ?? []) as ThreadDap[]).slice().sort((a, b) => a.name.localeCompare(b.name)));
  }

  private async carregarVariaveis(frameId: number): Promise<void> {
    this.filhos.clear();
    const todos = ((await this.pedir('scopes', { frameId }).catch(() => null))?.scopes ?? []) as { name: string; variablesReference: number; expensive?: boolean }[];
    // O escopo global do navegador (window inteira) fica de fora: é caro e enterra as locais.
    const escopos = todos.filter((e) => !e.expensive && !/^global$/i.test(e.name));
    const nos: NoDeVariavel[] = [];
    for (const e of escopos) {
      const vars = ((await this.pedir('variables', { variablesReference: e.variablesReference }).catch(() => null))?.variables ?? []) as VariavelDap[];
      for (const v of vars) nos.push({ chave: `${e.name}/${v.name}`, nivel: 0, v, aberto: false });
    }
    this.variaveis.set(nos);
  }

  private async enviarTodos(): Promise<void> {
    const arquivos = new Set(this.breakpoints().keys());
    if (this.ateOCursor) arquivos.add(this.ateOCursor.caminho);
    for (const caminho of arquivos) await this.enviarBreakpoints(caminho);
  }

  private async enviarExcecoes(): Promise<void> {
    const filtros = { nenhuma: [], naoTratadas: ['uncaught'], todas: ['caught', 'uncaught'] }[this.paradaEmExcecoes()];
    await this.pedir('setExceptionBreakpoints', { filters: filtros }).catch(() => undefined);
  }

  private async enviarBreakpoints(caminho: string): Promise<void> {
    if (this.sessao()?.semDebug) return;
    const linhas = this.silenciado() ? [] : [...(this.breakpoints().get(caminho) ?? [])];
    if (this.ateOCursor && mesmo(this.ateOCursor.caminho, caminho) && !linhas.includes(this.ateOCursor.linha)) linhas.push(this.ateOCursor.linha);
    const nome = caminho.split(/[\\/]/).pop();
    const r = await this.pedir('setBreakpoints', {
      source: { path: caminho, name: nome },
      breakpoints: linhas.map((line) => {
        const condition = this.condicao(caminho, line);
        return condition ? { line, condition } : { line };
      }),
      lines: linhas,
      sourceModified: false,
    }).catch((e) => {
      this.mensagens.erro(`breakpoint em ${nome}: ${e.message}`);
      return null;
    });
    const naoVerificados = ((r?.breakpoints ?? []) as { verified: boolean }[]).filter((b) => !b.verified).length;
    if (naoVerificados && this.sessao()?.tipo === 'servidor') this.mensagens.mostrar(`${naoVerificados} breakpoint(s) em ${nome} ainda não carregado(s) no servidor`);
  }

  private limparPausa(): void {
    this.pausado.set(null);
    this.frames.set([]);
    this.frameAtual.set(null);
    this.variaveis.set([]);
    this.valoresDasVigias.set(new Map());
  }
}

const INICIALIZAR = {
  clientID: 'seedy',
  clientName: 'Seedy',
  pathFormat: 'path',
  linesStartAt1: true,
  columnsStartAt1: true,
  supportsVariableType: true,
  supportsRunInTerminalRequest: false,
  locale: 'pt-BR',
};

export function motivoLegivel(m: string): string {
  return m === 'breakpoint' ? 'breakpoint' : m === 'step' ? 'passo' : m === 'exception' ? 'exceção' : m === 'pause' ? 'pausa' : m === 'entry' ? 'início' : m;
}

function mesmo(a: string, b: string): boolean {
  const n = (c: string) => c.replace(/\\/g, '/').toLowerCase();
  return n(a) === n(b);
}

function ler<T>(chave: string, padrao: T): T {
  try {
    const v = localStorage.getItem(chave);
    return v === null ? padrao : (JSON.parse(v) as T);
  } catch {
    return padrao;
  }
}

function gravar(chave: string, valor: unknown): void {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    /* sem armazenamento: vale nesta sessão */
  }
}
