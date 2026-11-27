import { computed, effect, inject, Injectable, isDevMode, signal, untracked } from '@angular/core';
import { monaco } from '../editor/monaco';
import { Buffer, EditorService } from '../editor/editor.service';
import { BuscaService } from '../busca/busca.service';
import { ProjetoService } from '../nucleo/projeto.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { Jdk, Mudancas, noApp, ponte } from '../nucleo/ponte';
import { EscolhaService } from '../escolha/escolha.service';
import { ClienteLsp } from './lsp';
import { registrarProvedores } from './provedores';
import {
  caminhoDaUri,
  DiagnosticoLsp,
  EdicaoDeWorkspaceLsp,
  edicoesPorArquivo,
  paraEdicao,
  paraMarcador,
  uriMonaco,
} from './conversao';

export type FaseJdtls =
  | 'inativo' // projeto sem Java
  | 'navegador' // modo navegador: sem núcleo, sem jdtls
  | 'sem-java' // não achou JDK 21+
  | 'baixando'
  | 'iniciando'
  | 'importando'
  | 'pronto'
  | 'erro';

export interface EstadoJdtls {
  fase: FaseJdtls;
  /** Texto curto para a statusline (ex.: "importando 40%"). */
  detalhe?: string;
}

/** Arquivos que fazem um projeto ser "de Java". */
const MARCAS_DE_JAVA = /(^|\/)(pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?)$|\.java$/;
/** Arquivos de build: mudou, o jdtls reimporta o projeto. */
const ARQUIVOS_DE_BUILD = /(^|[\\/])(pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?)$/;

interface Aberto {
  modelo: monaco.editor.ITextModel;
  inscricao: monaco.IDisposable;
}

/**
 * O jdtls do projeto aberto: baixa na primeira vez, inicia, mantém os arquivos
 * Java abertos em sincronia (didOpen/didChange/didSave/didClose) e põe os
 * erros e avisos no editor. Os provedores do Monaco (completar, hover...)
 * ficam em `provedores.ts` e usam `cliente()` daqui.
 */
@Injectable({ providedIn: 'root' })
export class JdtlsService {
  private readonly editor = inject(EditorService);
  private readonly projeto = inject(ProjetoService);
  private readonly busca = inject(BuscaService);
  private readonly mensagens = inject(MensagensService);
  private readonly escolha = inject(EscolhaService);

  readonly estado = signal<EstadoJdtls>({ fase: 'inativo' });
  readonly pronto = computed(() => this.estado().fase === 'pronto' || this.estado().fase === 'importando');
  /** Legenda dos tokens semânticos que o servidor mandou no initialize. */
  legenda: { tokenTypes: string[]; tokenModifiers: string[] } | null = null;
  /** Caracteres que disparam o completar, vindos do servidor. */
  gatilhos: string[] = ['.', '@', '#', '*'];

  private servidor: { id: number; cliente: ClienteLsp; raiz: string } | null = null;
  private readonly abertos = new Map<string, Aberto>();
  private readonly diagnosticos = new Map<string, DiagnosticoLsp[]>();
  private readonly urisOriginais = new Map<string, string>();
  /** Decorações de dica (◆) por modelo. */
  private readonly dicas = new Map<string, string[]>();
  /** Arquivo .prefs do compilador (criado pelo núcleo na pasta de configuração). */
  private preferencias: string | null = null;
  /** JDKs instalados, um por versão, para os projetos compilarem contra a versão certa. */
  private runtimes: Runtime[] = [];
  /** Projeto sem Maven/Gradle: onde estão os fontes (o jdtls sozinho não acha `src/`). */
  private semBuild: ProjetoSemBuild | null = null;
  private geracao = 0;

  /** Projeto de Java? Decide pelo índice da busca (pom.xml, build.gradle ou .java). */
  readonly ehJava = computed(() => !!this.busca.indice()?.arquivos.some((a) => MARCAS_DE_JAVA.test(a.relativo)));

  constructor() {
    // Liga/desliga conforme o projeto aberto.
    effect(() => {
      const raiz = this.projeto.raiz();
      const java = this.ehJava();
      untracked(() => {
        if (raiz && java && this.servidor?.raiz !== raiz) void this.iniciar(raiz);
        else if ((!raiz || !java) && this.servidor) void this.parar();
        else if (!java && !this.servidor) this.estado.set({ fase: 'inativo' });
      });
    });

    // Mantém os buffers Java abertos também abertos no jdtls.
    effect(() => {
      const buffers = this.editor.buffers();
      if (!this.pronto()) return;
      untracked(() => this.sincronizar(buffers));
    });

    this.editor.aoSalvar((b) => this.aoSalvar(b));

    // Arquivos criados/alterados/removidos fora do editor: o jdtls recompila e reimporta.
    effect(() => {
      const m = this.projeto.mudancas();
      if (m) untracked(() => this.avisarMudancas(m));
    });
    registrarProvedores(this, this.editor, this.mensagens, this.escolha);
    // Só em desenvolvimento: inspecionar o jdtls pelo DevTools.
    if (isDevMode()) (window as unknown as { seedyJdtls: JdtlsService }).seedyJdtls = this;

    // Diagnósticos de arquivos que só agora ganharam modelo.
    monaco.editor.onDidCreateModel((m) => {
      const d = this.diagnosticos.get(m.uri.toString());
      if (d) {
        monaco.editor.setModelMarkers(m, 'jdtls', d.map(paraMarcador));
        this.aplicarDicas(m, d);
      }
    });
  }

  /**
   * URI para mandar ao jdtls. Para código de biblioteca (`jdt://`), a original que
   * ele mandou: o Monaco recodifica a URI e o jdtls não reconheceria a versão dele.
   */
  uriLsp(uri: monaco.Uri): string {
    return this.urisOriginais.get(uri.toString()) ?? uri.toString();
  }

  /**
   * Modelo (somente leitura) com o código de uma classe de biblioteca ou do JDK.
   * O jdtls devolve o código-fonte anexado ou, sem ele, o decompilado.
   */
  async modeloDeClasse(uri: string): Promise<monaco.editor.ITextModel | null> {
    const uriMonaco = monaco.Uri.parse(uri);
    const existente = monaco.editor.getModel(uriMonaco);
    if (existente) return existente;
    const cliente = this.cliente();
    if (!cliente) return null;
    const conteudo = await cliente.pedir<string | null>('java/classFileContents', { uri }).catch(() => null);
    if (!conteudo) return null;
    this.urisOriginais.set(uriMonaco.toString(), uri);
    return monaco.editor.getModel(uriMonaco) ?? monaco.editor.createModel(conteudo, 'java', uriMonaco);
  }

  /**
   * Os diagnósticos do jdtls, do jeito que ele mandou, que tocam o intervalo.
   * As ações rápidas precisam deles intactos (com `source`, `code`, `data`).
   */
  diagnosticosEm(uri: string, intervalo: { start: { line: number }; end: { line: number } }): DiagnosticoLsp[] {
    return (this.diagnosticos.get(uri) ?? []).filter(
      (d) => d.range.start.line <= intervalo.end.line && d.range.end.line >= intervalo.start.line,
    );
  }

  /** Todos os diagnósticos do jdtls agora (erros e avisos), por URI do arquivo. */
  todosOsDiagnosticos(): [string, DiagnosticoLsp[]][] {
    return [...this.diagnosticos.entries()].filter(([, d]) => d.length);
  }

  /** Pasta do projeto que o jdtls está atendendo. */
  raiz(): string | null {
    return this.servidor?.raiz ?? null;
  }

  cliente(): ClienteLsp | null {
    return this.pronto() ? (this.servidor?.cliente ?? null) : null;
  }

  /** Comando do jdtls (`workspace/executeCommand`), ex.: classpath do projeto, sessão de debug. */
  /**
   * Projeto sem build: o jdtls guarda as pastas de fonte do primeiro import (e às vezes
   * infere errado, ex.: src/br/com/x). Confere e corrige para as que o Seedy detectou.
   */
  private async ajustarFontes(): Promise<void> {
    const sb = this.semBuild;
    const raiz = this.servidor?.raiz;
    if (!sb || !raiz) return;
    try {
      const r = await this.executar<{ data?: { path: string }[] }>('java.project.listSourcePaths');
      const atuais = (r?.data ?? []).map((d) => d.path);
      const sep = raiz.includes('\\') ? '\\' : '/';
      const desejadas = sb.fontes.map((f) => `${raiz.replace(/[\\/]+$/, '')}${sep}${f.replace(/[\\/]+/g, sep)}`);
      const norm = (c: string) => c.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
      const faltam = desejadas.filter((d) => !atuais.some((a) => norm(a) === norm(d)));
      const sobram = atuais.filter((a) => !desejadas.some((d) => norm(a) === norm(d)));
      if (!faltam.length && !sobram.length) return;
      for (const c of sobram) await this.executar('java.project.removeFromSourcePath', monaco.Uri.file(c).toString()).catch(() => undefined);
      for (const c of faltam) await this.executar('java.project.addToSourcePath', monaco.Uri.file(c).toString()).catch(() => undefined);
      this.mensagens.mostrar(`fontes do projeto: ${sb.fontes.join(', ')}`);
    } catch {
      /* jdtls antigo sem esses comandos: fica com o que ele inferiu */
    }
  }

  async executar<T = unknown>(comando: string, ...argumentos: unknown[]): Promise<T> {
    const c = this.cliente();
    if (!c) throw new Error('o jdtls ainda não está pronto');
    return c.pedir('workspace/executeCommand', { command: comando, arguments: argumentos }) as Promise<T>;
  }

  /** Aplica uma WorkspaceEdit: abre (em segundo plano) os arquivos tocados e edita os modelos. */
  async aplicarEdicao(edicao: EdicaoDeWorkspaceLsp): Promise<{ applied: boolean; arquivos: number }> {
    const porArquivo = edicoesPorArquivo(edicao);
    for (const [uri, edits] of porArquivo) {
      const buffer = await this.editor.abrir(caminhoDaUri(uriMonaco(uri)), undefined, undefined, false);
      if (!buffer) return { applied: false, arquivos: 0 };
      buffer.modelo.pushEditOperations([], edits.map(paraEdicao).map((e) => ({ range: e.range, text: e.text })), () => null);
    }
    return { applied: true, arquivos: porArquivo.size };
  }

  /** Escolhe o JDK que roda o jdtls (precisa ser da versão mínima ou mais novo) e reinicia. */
  async escolherJdk(): Promise<void> {
    const todos = await ponte.java.jdks();
    const minimo = (await ponte.java.estado(null))?.javaMinimo ?? 25;
    const servem = todos.filter((j) => j.maior >= minimo);
    if (!servem.length) {
      this.mensagens.erro(`nenhum JDK ${minimo}+ instalado para rodar o jdtls`);
      return;
    }
    const atual = (await ponte.java.estado(this.jdkEscolhido()))?.jdk?.home;
    const escolhido = await this.escolha.escolherUm(
      'JDK DO JDTLS',
      servem.map((j) => ({ rotulo: `Java ${j.versao}${j.home === atual ? '  (atual)' : ''}`, detalhe: j.home, valor: j.home })),
      `só ${minimo}+ roda o jdtls; o projeto usa o JDK da versão dele`,
    );
    if (!escolhido) return;
    await this.usarJdk(escolhido);
  }

  /** Guarda o JDK que roda o jdtls e reinicia (a escolha pela tela e pela IA passam por aqui). */
  async usarJdk(escolhido: string): Promise<void> {
    try {
      localStorage.setItem(CHAVE_JDK, escolhido);
    } catch {
      /* sem armazenamento: vale só nesta sessão */
    }
    this.jdkDaSessao = escolhido;
    this.mensagens.mostrar('reiniciando o jdtls com o JDK escolhido…');
    await this.reiniciar();
  }

  private jdkDaSessao: string | null = null;

  private jdkEscolhido(): string | null {
    try {
      return this.jdkDaSessao ?? localStorage.getItem(CHAVE_JDK);
    } catch {
      return this.jdkDaSessao;
    }
  }

  /** Reinicia o servidor (ex.: depois de mudar o JDK). */
  async reiniciar(): Promise<void> {
    const raiz = this.projeto.raiz();
    await this.parar();
    if (raiz && this.ehJava()) await this.iniciar(raiz);
  }

  private async iniciar(raiz: string): Promise<void> {
    await this.parar();
    const geracao = ++this.geracao;
    const atual = () => geracao === this.geracao;

    if (!noApp()) {
      this.estado.set({ fase: 'navegador', detalhe: 'só no app' });
      return;
    }
    const java = await ponte.java.estado(this.jdkEscolhido());
    if (!atual() || !java) return;
    if (!java.jdk) {
      this.estado.set({ fase: 'sem-java', detalhe: `precisa do JDK ${java.javaMinimo}+` });
      this.mensagens.erro(`jdtls: nenhum JDK ${java.javaMinimo}+ encontrado (instale um ou defina SEEDY_JAVA_HOME)`);
      return;
    }

    try {
      if (!java.jdtlsInstalado) {
        this.estado.set({ fase: 'baixando', detalhe: 'baixando' });
        this.mensagens.mostrar(`baixando o jdtls ${java.versaoJdtls} (só na primeira vez)…`);
        await ponte.java.instalar((p) => {
          if (!atual()) return;
          const detalhe =
            p.fase === 'baixando'
              ? `baixando ${mb(p.baixado)}${p.total ? ` / ${mb(p.total)}` : ''}`
              : p.fase === 'verificando' ? 'verificando' : p.fase === 'extraindo' ? 'extraindo' : 'pronto';
          this.estado.set({ fase: 'baixando', detalhe });
        });
        if (!atual()) return;
      }

      this.estado.set({ fase: 'iniciando', detalhe: 'iniciando' });
      let cliente!: ClienteLsp;
      this.runtimes = runtimesDe(await ponte.java.jdks());
      this.semBuild = await projetoSemBuild(raiz);
      const { id, pid, preferencias } = await ponte.java.iniciar(
        raiz,
        this.jdkEscolhido(),
        (m) => cliente.receber(m),
        () => this.aoEncerrar(geracao),
      );
      cliente = new ClienteLsp((texto) => ponte.java.enviar(id, texto));
      this.servidor = { id, cliente, raiz };
      if (!atual()) return void this.parar();
      this.ouvir(cliente, geracao);

      this.preferencias = preferencias;
      // O debug (Fase 5) é um plugin do jdtls: sem ele o resto funciona igual.
      const debug = await ponte.java.debugPlugin().catch((e) => {
        this.mensagens.falha('o depurador Java (java-debug) não carregou', e);
        return null;
      });
      const resultado = await cliente.pedir('initialize', parametrosDeInicio(raiz, pid, preferencias, this.runtimes, debug ? [debug] : [], this.semBuild));
      if (!atual()) return;
      const capacidades = resultado?.capabilities ?? {};
      this.legenda = capacidades.semanticTokensProvider?.legend ?? null;
      this.gatilhos = capacidades.completionProvider?.triggerCharacters ?? this.gatilhos;
      cliente.notificar('initialized', {});
      cliente.notificar('workspace/didChangeConfiguration', { settings: configuracao(preferencias, this.runtimes, this.semBuild) });
      this.estado.set({ fase: 'importando', detalhe: 'importando' });
      this.sincronizar(this.editor.buffers());
    } catch (e) {
      if (!atual()) return;
      this.estado.set({ fase: 'erro', detalhe: 'erro' });
      this.mensagens.falha('não consegui iniciar o jdtls', e);
    }
  }

  private async parar(): Promise<void> {
    this.geracao++;
    const s = this.servidor;
    this.servidor = null;
    for (const a of this.abertos.values()) a.inscricao.dispose();
    this.abertos.clear();
    this.limparDiagnosticos();
    if (!s) return;
    this.estado.set({ fase: 'inativo' });
    try {
      await Promise.race([s.cliente.pedir('shutdown'), new Promise((r) => setTimeout(r, 2000))]);
      s.cliente.notificar('exit');
    } catch {
      /* já parado */
    }
    s.cliente.encerrar();
    await ponte.java.parar(s.id).catch(() => {});
  }

  private aoEncerrar(geracao: number): void {
    if (geracao !== this.geracao) return;
    this.servidor?.cliente.encerrar();
    this.servidor = null;
    this.abertos.clear();
    this.estado.set({ fase: 'erro', detalhe: 'parou' });
    this.mensagens.erro('jdtls parou (reinicie: Ctrl+Shift+Espaço, l)');
  }

  private ouvir(cliente: ClienteLsp, geracao: number): void {
    const atual = () => geracao === this.geracao;

    cliente.aoNotificar('textDocument/publishDiagnostics', (p: { uri: string; diagnostics: DiagnosticoLsp[] }) => {
      if (!atual()) return;
      const uri = uriMonaco(p.uri);
      this.diagnosticos.set(uri.toString(), p.diagnostics);
      const modelo = monaco.editor.getModel(uri);
      if (modelo) {
        monaco.editor.setModelMarkers(modelo, 'jdtls', p.diagnostics.map(paraMarcador));
        this.aplicarDicas(modelo, p.diagnostics);
      }
    });

    // Status do jdtls: "Starting", "ServiceReady", "Error"...
    cliente.aoNotificar('language/status', (p: { type: string; message: string }) => {
      if (!atual()) return;
      if (p.type === 'ServiceReady' || p.type === 'Started') {
        this.estado.set({ fase: 'pronto' });
        if (p.type === 'ServiceReady') void this.ajustarFontes();
      }
      else if (p.type === 'Error') {
        this.estado.set({ fase: 'erro', detalhe: 'erro' });
        this.mensagens.erro(`jdtls: ${p.message}`);
      }
    });

    // Progresso da importação (Maven/Gradle, compilação).
    cliente.aoNotificar('language/progressReport', (p: { complete: boolean; task?: string; workDone?: number; totalWork?: number }) => {
      if (!atual() || this.estado().fase === 'pronto') return;
      const pct = p.totalWork ? Math.round(((p.workDone ?? 0) / p.totalWork) * 100) : null;
      this.estado.set({ fase: 'importando', detalhe: pct !== null ? `importando ${pct}%` : 'importando' });
    });

    cliente.aoNotificar('window/showMessage', (p: { type: number; message: string }) => {
      if (!atual()) return;
      if (p.type === 1) this.mensagens.erro(`jdtls: ${p.message}`);
      else if (p.type === 2) this.mensagens.mostrar(`jdtls: ${p.message}`);
    });

    cliente.aoPedir('workspace/applyEdit', async (p: { edit: EdicaoDeWorkspaceLsp }) => {
      const r = await this.aplicarEdicao(p.edit);
      return { applied: r.applied };
    });
    cliente.aoPedir('workspace/configuration', (p: { items: { section?: string }[] }) =>
      p.items.map((i) => (i.section === 'java' || !i.section ? configuracao(this.preferencias, this.runtimes, this.semBuild).java : null)),
    );
    cliente.aoPedir('client/registerCapability', () => null);
    cliente.aoPedir('client/unregisterCapability', () => null);
    cliente.aoPedir('window/workDoneProgress/create', () => null);
    cliente.aoPedir('window/showMessageRequest', () => null);
    cliente.aoPedir('workspace/workspaceFolders', () => [
      { uri: monaco.Uri.file(this.servidor?.raiz ?? '').toString(), name: this.projeto.nome() },
    ]);
  }

  private sincronizar(buffers: Buffer[]): void {
    const cliente = this.servidor?.cliente;
    if (!cliente) return;
    // Código de biblioteca não precisa de didOpen: o jdtls lê direto do .class.
    const java = buffers.filter((b) => b.modelo.getLanguageId() === 'java' && !b.modelo.isDisposed() && !b.somenteLeitura);
    const chaves = new Set(java.map((b) => b.modelo.uri.toString()));

    for (const [uri, a] of this.abertos) {
      if (chaves.has(uri)) continue;
      a.inscricao.dispose();
      this.abertos.delete(uri);
      cliente.notificar('textDocument/didClose', { textDocument: { uri } });
    }
    for (const b of java) {
      const uri = b.modelo.uri.toString();
      if (this.abertos.has(uri)) continue;
      const modelo = b.modelo;
      cliente.notificar('textDocument/didOpen', {
        textDocument: { uri, languageId: 'java', version: modelo.getVersionId(), text: modelo.getValue() },
      });
      const inscricao = modelo.onDidChangeContent(() =>
        this.servidor?.cliente.notificar('textDocument/didChange', {
          textDocument: { uri, version: modelo.getVersionId() },
          contentChanges: [{ text: modelo.getValue() }],
        }),
      );
      this.abertos.set(uri, { modelo, inscricao });
    }
  }

  private avisarMudancas(m: Mudancas): void {
    const cliente = this.servidor?.cliente;
    if (!cliente) return;
    const interessa = (p: string) => p.endsWith('.java') || ARQUIVOS_DE_BUILD.test(p);
    const uri = (p: string) => monaco.Uri.file(p).toString();
    const changes = [
      ...m.criados.filter(interessa).map((p) => ({ uri: uri(p), type: 1 })),
      // Abertos no editor o jdtls já acompanha pelo didChange.
      ...m.alterados.filter((p) => interessa(p) && !this.abertos.has(uri(p))).map((p) => ({ uri: uri(p), type: 2 })),
      ...m.removidos.filter(interessa).map((p) => ({ uri: uri(p), type: 3 })),
    ];
    if (changes.length) cliente.notificar('workspace/didChangeWatchedFiles', { changes });
  }

  private aoSalvar(b: Buffer): void {
    const cliente = this.servidor?.cliente;
    if (!cliente) return;
    const uri = b.modelo.uri.toString();
    if (this.abertos.has(uri)) cliente.notificar('textDocument/didSave', { textDocument: { uri } });
    if (ARQUIVOS_DE_BUILD.test(b.caminho)) {
      cliente.notificar('workspace/didChangeWatchedFiles', { changes: [{ uri, type: 2 }] });
      this.mensagens.mostrar('jdtls: reimportando o projeto…');
    }
  }

  private limparDiagnosticos(): void {
    for (const uri of this.diagnosticos.keys()) {
      const m = monaco.editor.getModel(monaco.Uri.parse(uri));
      if (m) {
        monaco.editor.setModelMarkers(m, 'jdtls', []);
        this.aplicarDicas(m, []);
      }
    }
    this.diagnosticos.clear();
  }

  /**
   * Código desnecessário (import, variável, campo ou método não usado) ganha uma
   * dica no fim da linha, como no mockup 01: "◆ import não usado".
   */
  private aplicarDicas(modelo: monaco.editor.ITextModel, diagnosticos: DiagnosticoLsp[]): void {
    if (modelo.isDisposed()) return;
    const porLinha = new Map<number, string>();
    for (const d of diagnosticos) {
      if (!d.tags?.includes(1)) continue;
      const linha = d.range.end.line + 1;
      if (linha <= modelo.getLineCount() && !porLinha.has(linha)) porLinha.set(linha, dicaCurta(d.message));
    }
    const novas = [...porLinha].map(([linha, texto]) => {
      const fim = modelo.getLineMaxColumn(linha);
      return {
        range: new monaco.Range(linha, fim, linha, fim),
        options: { after: { content: `  ◆ ${texto}`, inlineClassName: 'dica-inline' }, showIfCollapsed: true },
      };
    });
    const chave = modelo.uri.toString();
    this.dicas.set(chave, modelo.deltaDecorations(this.dicas.get(chave) ?? [], novas));
  }
}

/** Mensagem do compilador (em inglês) → dica curta em português. */
function dicaCurta(mensagem: string): string {
  const regras: [RegExp, string][] = [
    [/^The import .+ is never used/, 'import não usado'],
    [/^The value of the local variable .+ is not used/, 'variável não usada'],
    [/^The value of the field .+ is not used/, 'campo não usado'],
    [/^The (private )?method .+ is never used/, 'método não usado'],
    [/^The (private )?(type|constructor) .+ is never used/, 'não usado'],
    [/^The value of the parameter .+ is not used/, 'parâmetro não usado'],
    [/^Unnecessary/, 'desnecessário'],
  ];
  return regras.find(([re]) => re.test(mensagem))?.[1] ?? mensagem.slice(0, 60);
}

const CHAVE_JDK = 'seedy.jdtlsJdk';

interface Runtime {
  name: string;
  path: string;
}

/** Um JDK por versão, com o nome que o jdtls espera ("JavaSE-1.8", "JavaSE-21"...). */
function runtimesDe(jdks: Jdk[]): Runtime[] {
  const porVersao = new Map<number, Runtime>();
  for (const j of jdks) {
    if (porVersao.has(j.maior)) continue; // a lista vem do mais novo ao mais velho
    porVersao.set(j.maior, { name: j.maior <= 8 ? `JavaSE-1.${j.maior}` : `JavaSE-${j.maior}`, path: j.home });
  }
  return [...porVersao.values()];
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

/** Configurações do jdtls (as mesmas chaves `java.*` da extensão do VS Code). */
/** Fontes de um projeto sem ferramenta de build (relativos à raiz). */
export interface ProjetoSemBuild {
  fontes: string[];
  saida: string;
}

/**
 * Projeto sem pom.xml/build.gradle (nem .project do Eclipse): diz ao jdtls onde estão os
 * fontes. Vale o que o IntelliJ marcou no .iml; senão, `src/` (e `test/`) se existirem.
 * Sem isso o jdtls toma a raiz como fonte e reclama do `package` de cada arquivo.
 */
export async function projetoSemBuild(raiz: string): Promise<ProjetoSemBuild | null> {
  const nomes = (await ponte.lerPasta(raiz).catch(() => [])).map((e) => ({ nome: e.nome, pasta: e.pasta, caminho: e.caminho }));
  if (nomes.some((e) => !e.pasta && /^(pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|\.project)$/.test(e.nome))) return null;
  const fontes = new Set<string>();
  for (const iml of nomes.filter((e) => !e.pasta && e.nome.endsWith('.iml'))) {
    const xml = await ponte.lerArquivo(iml.caminho).catch(() => '');
    for (const m of xml.matchAll(/<sourceFolder\s[^>]*url="file:\/\/\$MODULE_DIR\$\/([^"]+)"[^>]*>/g)) {
      if (!/type="java-(test-)?resource"/.test(m[0])) fontes.add(m[1]);
    }
  }
  if (!fontes.size) {
    for (const pasta of ['src', 'test']) if (nomes.some((e) => e.pasta && e.nome === pasta)) fontes.add(pasta);
  }
  return fontes.size ? { fontes: [...fontes], saida: 'bin' } : null;
}

function configuracao(preferencias: string | null, runtimes: Runtime[], semBuild: ProjetoSemBuild | null = null) {
  return {
    java: {
      // Projeto sem build: fontes e saída das classes (bin/), e os jars de lib/.
      project: semBuild ? { sourcePaths: semBuild.fontes, outputPath: semBuild.saida, referencedLibraries: ['lib/**/*.jar'] } : undefined,
      // Cada projeto compila contra o JDK da versão dele (release do pom.xml/build.gradle).
      configuration: { updateBuildConfiguration: 'automatic', runtimes },
      // Preferências do compilador (ex.: avisar import não usado), editáveis pelo usuário.
      settings: preferencias ? { url: preferencias } : undefined,
      format: { enabled: true },
      signatureHelp: { enabled: true },
      contentProvider: { preferred: 'fernflower' },
      completion: {
        enabled: true,
        guessMethodArguments: 'insertBestGuessedArguments',
        importOrder: ['java', 'javax', 'org', 'com', ''],
      },
      sources: { organizeImports: { starThreshold: 99, staticStarThreshold: 99 } },
      // Os arquivos do Eclipse (.project, .classpath, .settings) ficam no cache do
      // jdtls, não dentro do projeto do usuário.
      import: { maven: { enabled: true }, gradle: { enabled: true }, generatesMetadataFilesAtProjectRoot: false },
      autobuild: { enabled: true },
    },
  };
}

function parametrosDeInicio(raiz: string, pid: number, preferencias: string, runtimes: Runtime[], bundles: string[], semBuild: ProjetoSemBuild | null) {
  const uri = monaco.Uri.file(raiz).toString();
  const formatos = ['markdown', 'plaintext'];
  return {
    processId: pid,
    clientInfo: { name: 'Seedy' },
    locale: 'pt-br',
    rootPath: raiz,
    rootUri: uri,
    workspaceFolders: [{ uri, name: raiz.split(/[\\/]/).pop() }],
    capabilities: {
      workspace: {
        applyEdit: true,
        workspaceEdit: { documentChanges: true },
        configuration: true,
        workspaceFolders: true,
        didChangeConfiguration: { dynamicRegistration: false },
        didChangeWatchedFiles: { dynamicRegistration: false },
        symbol: { dynamicRegistration: false },
        executeCommand: { dynamicRegistration: false },
      },
      textDocument: {
        synchronization: { didSave: true, willSave: false, willSaveWaitUntil: false },
        completion: {
          contextSupport: true,
          completionItem: {
            snippetSupport: true,
            documentationFormat: formatos,
            labelDetailsSupport: true,
            deprecatedSupport: true,
            tagSupport: { valueSet: [1] },
            resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] },
          },
        },
        hover: { contentFormat: formatos },
        signatureHelp: {
          signatureInformation: { documentationFormat: formatos, parameterInformation: { labelOffsetSupport: true } },
          contextSupport: true,
        },
        definition: { linkSupport: false },
        typeDefinition: { linkSupport: false },
        implementation: { linkSupport: false },
        references: {},
        documentHighlight: {},
        documentSymbol: { hierarchicalDocumentSymbolSupport: true },
        formatting: {},
        rangeFormatting: {},
        rename: { prepareSupport: true },
        codeAction: {
          dataSupport: true,
          isPreferredSupport: true,
          resolveSupport: { properties: ['edit'] },
          codeActionLiteralSupport: {
            codeActionKind: {
              valueSet: ['', 'quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'source', 'source.organizeImports'],
            },
          },
        },
        publishDiagnostics: { relatedInformation: true, tagSupport: { valueSet: [1, 2] } },
        semanticTokens: {
          requests: { full: { delta: false }, range: false },
          tokenTypes: [],
          tokenModifiers: [],
          formats: ['relative'],
        },
      },
      window: { workDoneProgress: true, showMessage: {} },
    },
    initializationOptions: {
      bundles,
      workspaceFolders: [uri],
      settings: configuracao(preferencias, runtimes, semBuild),
      extendedClientCapabilities: {
        progressReportProvider: true,
        classFileContentsSupport: true,
        overrideMethodsPromptSupport: true,
        hashCodeEqualsPromptSupport: true,
        advancedOrganizeImportsSupport: false,
        generateToStringPromptSupport: true,
        advancedGenerateAccessorsSupport: true,
        generateConstructorsPromptSupport: true,
        generateDelegateMethodsPromptSupport: false,
        advancedExtractRefactoringSupport: false,
        moveRefactoringSupport: false,
        clientHoverProvider: false,
        clientDocumentSymbolProvider: false,
        gradleChecksumWrapperPromptSupport: false,
        resolveAdditionalTextEditsSupport: true,
        inferSelectedTextSupport: false,
      },
    },
  };
}
