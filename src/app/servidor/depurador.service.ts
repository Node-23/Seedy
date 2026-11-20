import { computed, effect, inject, Injectable, isDevMode, signal, untracked } from '@angular/core';
import { ponte } from '../nucleo/ponte';
import { monaco } from '../editor/monaco';
import { EditorService } from '../editor/editor.service';
import { JdtlsService } from '../java/jdtls.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { ServidorService } from './servidor.service';

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

/** Um nó da árvore de variáveis (os filhos carregam ao abrir). */
export interface NoDeVariavel {
  chave: string;
  nivel: number;
  v: VariavelDap;
  aberto: boolean;
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

/**
 * Debug de Java pelo java-debug (DAP) anexado ao servidor (JDWP). Breakpoints na
 * margem do editor (ctrl+F8), F8 passa, F7 entra, shift+F8 sai, F9 continua,
 * alt+F8 avalia. Classes alteradas entram no servidor sozinhas (hot code replace).
 */
@Injectable({ providedIn: 'root' })
export class DepuradorService {
  private readonly editor = inject(EditorService);
  private readonly jdtls = inject(JdtlsService);
  private readonly mensagens = inject(MensagensService);
  private readonly servidor = inject(ServidorService);

  /** Arquivo → linhas com breakpoint. */
  readonly breakpoints = signal(new Map<string, number[]>(this.lerBreakpoints()));
  readonly sessao = signal<{ perfilId: string; porta: number } | null>(null);
  readonly pausado = signal<{ threadId: number; motivo: string } | null>(null);
  readonly frames = signal<FrameDap[]>([]);
  readonly frameAtual = signal<number | null>(null);
  readonly variaveis = signal<NoDeVariavel[]>([]);
  readonly avaliacoes = signal<{ expressao: string; resultado: string; erro: boolean }[]>([]);

  readonly ativo = computed(() => !!this.sessao());
  readonly localAtual = computed(() => {
    const f = this.frames().find((x) => x.id === this.frameAtual());
    return f?.source?.path ? { caminho: f.source.path, linha: f.line, nome: f.name } : null;
  });

  private conexao: number | null = null;
  private seq = 0;
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
    if (atual.has(linha)) atual.delete(linha);
    else atual.add(linha);
    this.breakpoints.update((m) => {
      const n = new Map(m);
      if (atual.size) n.set(caminho, [...atual].sort((a, b) => a - b));
      else n.delete(caminho);
      return n;
    });
    try {
      localStorage.setItem(CHAVE_DOS_BREAKPOINTS, JSON.stringify([...this.breakpoints()]));
    } catch {
      /* sem armazenamento: vale nesta sessão */
    }
    if (this.conexao !== null) void this.enviarBreakpoints(caminho);
  }

  alternarNoCursor(): void {
    const b = this.editor.bufferAtivo();
    const pos = this.editor.instancia?.getPosition();
    if (!b || b.somenteLeitura || !pos) return;
    if (!/\.java$/i.test(b.caminho)) {
      this.mensagens.mostrar('breakpoints só em arquivos .java');
      return;
    }
    this.alternar(b.caminho, pos.lineNumber);
  }

  private lerBreakpoints(): [string, number[]][] {
    try {
      return JSON.parse(localStorage.getItem(CHAVE_DOS_BREAKPOINTS) ?? '[]');
    } catch {
      return [];
    }
  }

  /** Bolinhas na margem e a linha onde a execução parou. */
  private desenhar(): void {
    const ed = this.editor.instancia;
    const m = ed?.getModel();
    if (!ed || !m) return;
    const caminho = this.editor.bufferAtivo()?.caminho;
    const linhas = (caminho && this.breakpoints().get(caminho)) || [];
    const antigas = this.decoracoes.get(m) ?? [];
    this.decoracoes.set(
      m,
      m.deltaDecorations(
        antigas,
        linhas.filter((l) => l <= m.getLineCount()).map((l) => ({
          range: new monaco.Range(l, 1, l, 1),
          options: { glyphMarginClassName: 'breakpoint', glyphMarginHoverMessage: { value: 'breakpoint (ctrl+F8)' }, stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges },
        })),
      ),
    );
    this.decoracaoAtual?.clear();
    const aqui = this.localAtual();
    if (aqui && caminho && mesmo(aqui.caminho, caminho) && aqui.linha <= m.getLineCount()) {
      this.decoracaoAtual = ed.createDecorationsCollection([
        { range: new monaco.Range(aqui.linha, 1, aqui.linha, 1), options: { isWholeLine: true, className: 'linha-depurada', glyphMarginClassName: 'seta-depurada' } },
      ]);
    }
  }

  // ---------- sessão ----------

  /** Anexa o depurador ao servidor (JDWP em `porta`), pelo java-debug do jdtls. */
  async anexar(perfilId: string, porta: number): Promise<void> {
    if (this.sessao()) await this.desanexar();
    try {
      const portaDap = await this.jdtls.executar<number>('vscode.java.startDebugSession');
      await this.jdtls
        .executar('vscode.java.updateDebugSettings', JSON.stringify({ hotCodeReplace: 'auto', showStaticVariables: false, showQualifiedNames: false, showHex: false, showToString: true, maxStringLength: 0 }))
        .catch(() => undefined);
      this.conexao = await ponte.dap.conectar(
        portaDap,
        (m) => this.receber(m),
        () => this.aoFechar(),
      );
      this.sessao.set({ perfilId, porta });
      await this.pedir('initialize', {
        clientID: 'seedy',
        clientName: 'Seedy',
        adapterID: 'java',
        pathFormat: 'path',
        linesStartAt1: true,
        columnsStartAt1: true,
        supportsVariableType: true,
        locale: 'pt-BR',
      });
      // A resposta do attach só chega depois do configurationDone (feito no evento "initialized").
      void this.pedir('attach', { type: 'java', name: 'Seedy', request: 'attach', hostName: 'localhost', port: porta, timeout: 30000 }).catch((e) =>
        this.mensagens.erro(`debug: ${e.message}`),
      );
    } catch (e) {
      this.mensagens.erro(`debug: ${(e as Error).message ?? e}`);
      await this.desanexar();
    }
  }

  async desanexar(): Promise<void> {
    if (this.conexao !== null) {
      await this.pedir('disconnect', { restart: false, terminateDebuggee: false }).catch(() => undefined);
      await ponte.dap.fechar(this.conexao).catch(() => undefined);
    }
    this.aoFechar();
  }

  private aoFechar(): void {
    this.conexao = null;
    for (const p of this.pendentes.values()) p.erro(new Error('sessão de debug encerrada'));
    this.pendentes.clear();
    this.sessao.set(null);
    this.limparPausa();
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

  async escolherFrame(id: number): Promise<void> {
    this.frameAtual.set(id);
    const f = this.frames().find((x) => x.id === id);
    if (f?.source?.path) {
      await this.editor.abrir(f.source.path, f.line);
    }
    await this.carregarVariaveis(id);
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
    const seq = ++this.seq;
    const msg = JSON.stringify({ type: 'request', seq, command, arguments: args });
    return new Promise((ok, erro) => {
      this.pendentes.set(seq, { ok, erro });
      ponte.dap.enviar(this.conexao!, msg).catch((e) => {
        this.pendentes.delete(seq);
        erro(new Error(String(e)));
      });
    });
  }

  private receber(texto: string): void {
    let m: Mensagem;
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
    } else if (m.type === 'event') {
      void this.aoEvento(m.event ?? '', m.body ?? {});
    }
  }

  private async aoEvento(evento: string, corpo: any): Promise<void> {
    switch (evento) {
      case 'initialized':
        for (const caminho of this.breakpoints().keys()) await this.enviarBreakpoints(caminho);
        await this.pedir('setExceptionBreakpoints', { filters: [] }).catch(() => undefined);
        await this.pedir('configurationDone', {}).catch(() => undefined);
        this.mensagens.mostrar(`depurador anexado na porta ${this.sessao()?.porta}`);
        break;
      case 'stopped':
        await this.aoParar(corpo.threadId, corpo.reason);
        break;
      case 'continued':
        this.limparPausa();
        break;
      case 'terminated':
      case 'exited':
        this.aoFechar();
        break;
      case 'hotcodereplace':
        // Build do jdtls terminou com classes alteradas: manda o servidor trocá-las.
        if (corpo.changeType === 'BUILD_COMPLETE') {
          try {
            const r = await this.pedir('redefineClasses', {});
            const n = r?.changedClasses?.length ?? 0;
            if (n) this.mensagens.mostrar(`hot code replace: ${n} ${n === 1 ? 'classe trocada' : 'classes trocadas'} no servidor`);
          } catch (e) {
            this.mensagens.erro(`hot code replace: ${(e as Error).message}`);
          }
        } else if (corpo.changeType === 'ERROR' || corpo.changeType === 'WARNING') {
          this.mensagens.erro(`hot code replace não aplicou: ${corpo.message} (ctrl+F10 faz redeploy)`);
        }
        break;
      case 'output':
        if (corpo.category === 'stderr' && corpo.output?.trim()) this.mensagens.erro(`debug: ${corpo.output.trim()}`);
        break;
    }
  }

  private async aoParar(threadId: number, motivo: string): Promise<void> {
    this.pausado.set({ threadId, motivo });
    const r = await this.pedir('stackTrace', { threadId, startFrame: 0, levels: 60 }).catch(() => null);
    const frames = (r?.stackFrames ?? []) as FrameDap[];
    this.frames.set(frames);
    const primeiro = frames.find((f) => f.source?.path) ?? frames[0];
    if (primeiro) await this.escolherFrame(primeiro.id);
    const onde = primeiro?.source?.name ? `${primeiro.source.name}:${primeiro.line}` : '';
    this.mensagens.mostrar(`pausado${onde ? ` em ${onde}` : ''} (${motivoLegivel(motivo)}) · F8 passa · F7 entra · F9 continua`);
  }

  private async carregarVariaveis(frameId: number): Promise<void> {
    this.filhos.clear();
    const escopos = ((await this.pedir('scopes', { frameId }).catch(() => null))?.scopes ?? []) as { name: string; variablesReference: number }[];
    const nos: NoDeVariavel[] = [];
    for (const e of escopos) {
      const vars = ((await this.pedir('variables', { variablesReference: e.variablesReference }).catch(() => null))?.variables ?? []) as VariavelDap[];
      for (const v of vars) nos.push({ chave: `${e.name}/${v.name}`, nivel: 0, v, aberto: false });
    }
    this.variaveis.set(nos);
  }

  private async enviarBreakpoints(caminho: string): Promise<void> {
    const linhas = this.breakpoints().get(caminho) ?? [];
    const nome = caminho.split(/[\\/]/).pop();
    const r = await this.pedir('setBreakpoints', {
      source: { path: caminho, name: nome },
      breakpoints: linhas.map((line) => ({ line })),
      lines: linhas,
      sourceModified: false,
    }).catch((e) => {
      this.mensagens.erro(`breakpoint em ${nome}: ${e.message}`);
      return null;
    });
    const naoVerificados = ((r?.breakpoints ?? []) as { verified: boolean }[]).filter((b) => !b.verified).length;
    if (naoVerificados && this.sessao()) this.mensagens.mostrar(`${naoVerificados} breakpoint(s) em ${nome} ainda não carregado(s) no servidor`);
  }

  private limparPausa(): void {
    this.pausado.set(null);
    this.frames.set([]);
    this.frameAtual.set(null);
    this.variaveis.set([]);
  }
}

function motivoLegivel(m: string): string {
  return m === 'breakpoint' ? 'breakpoint' : m === 'step' ? 'passo' : m === 'exception' ? 'exceção' : m === 'pause' ? 'pausa' : m;
}

function mesmo(a: string, b: string): boolean {
  const n = (c: string) => c.replace(/\\/g, '/').toLowerCase();
  return n(a) === n(b);
}
