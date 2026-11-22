import { computed, effect, inject, Injectable, isDevMode, signal, untracked } from '@angular/core';
import { monaco } from '../editor/monaco';
import { Buffer, EditorService } from '../editor/editor.service';
import { ProjetoService } from '../nucleo/projeto.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { Mudancas, nomeBase, noApp, ponte, TipoServidorWeb } from '../nucleo/ponte';
import { ClienteLsp } from '../java/lsp';
import { caminhoDaUri, DiagnosticoLsp, EdicaoDeWorkspaceLsp, edicoesPorArquivo, paraEdicao, paraMarcador } from '../java/conversao';
import { registrarProvedoresWeb } from './provedores-web';
import { ConfigService } from '../config/config.service';
import { registrarPrettier } from './prettier';

/** O que o projeto web tem (lido da raiz). */
export interface ProjetoWeb {
  angular: boolean;
  /** Tem `react` nas dependências do package.json (o TypeScript atende .tsx/.jsx; não há servidor à parte). */
  react: boolean;
  eslint: boolean;
  /** Configuração nova do ESLint (eslint.config.*), padrão desde o ESLint 9. */
  eslintPlano: boolean;
  prettier: boolean;
}

export type FaseWeb = 'inativo' | 'sem-node' | 'instalando' | 'iniciando' | 'pronto' | 'erro';

interface ServidorWeb {
  tipo: TipoServidorWeb;
  id: number;
  cliente: ClienteLsp;
  pronto: boolean;
  gatilhos: string[];
  assinatura: string[];
  abertos: Map<string, monaco.IDisposable>;
  /** O servidor só manda diagnósticos quando pedidos (textDocument/diagnostic), como o do ESLint. */
  puxaDiagnosticos: boolean;
}

const EXT_TS = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i;
const ESLINT_CONFIG = /^(eslint\.config\.(js|mjs|cjs|ts|mts|cts)|\.eslintrc(\.(js|cjs|json|ya?ml))?)$/;
const PRETTIER_CONFIG = /^(\.prettierrc(\.(json|ya?ml|js|cjs|mjs|toml))?|prettier\.config\.(js|cjs|mjs|ts))$/;

/** languageId do LSP pela extensão. */
export function idDeLinguagem(caminho: string): string | null {
  const ext = caminho.slice(caminho.lastIndexOf('.') + 1).toLowerCase();
  return (
    ({ ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescriptreact', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascriptreact', html: 'html' } as Record<string, string>)[ext] ??
    null
  );
}

/**
 * Projetos web (Fase 6, mockup 13): typescript-language-server para TS/JS, Angular
 * Language Service para os templates e o servidor do ESLint, cada um com o seu processo.
 * Instala os servidores com o npm na primeira vez. Os provedores do Monaco escolhem o
 * servidor pelo arquivo (ver provedores-web.ts).
 */
@Injectable({ providedIn: 'root' })
export class WebLspService {
  private readonly config = inject(ConfigService);
  private readonly editor = inject(EditorService);
  private readonly projeto = inject(ProjetoService);
  private readonly mensagens = inject(MensagensService);

  readonly web = signal<ProjetoWeb | null>(null);
  readonly fase = signal<FaseWeb>('inativo');
  readonly detalhe = signal('');
  /** Avisos do ESLint (para a statusline). */
  readonly avisosEslint = signal(0);
  readonly servidores = signal<Partial<Record<TipoServidorWeb, ServidorWeb>>>({});
  readonly ativo = computed(() => !!this.web());

  private geracao = 0;
  private readonly dicas = new Map<string, string[]>();
  private readonly diagnosticosEslint = new Map<string, number>();

  constructor() {
    effect(() => {
      const raiz = this.projeto.raiz();
      this.projeto.versao();
      untracked(() => void this.verificar(raiz));
    });
    // Buffers abertos ficam abertos nos servidores.
    effect(() => {
      const buffers = this.editor.buffers();
      this.servidores();
      untracked(() => this.sincronizar(buffers));
    });
    effect(() => {
      const m = this.projeto.mudancas();
      if (m) untracked(() => this.avisarMudancas(m));
    });
    this.editor.aoSalvar((b) => {
      for (const s of Object.values(this.servidores())) {
        const uri = b.modelo.uri.toString();
        if (s?.abertos.has(uri)) s.cliente.notificar('textDocument/didSave', { textDocument: { uri } });
      }
    });
    registrarProvedoresWeb(this, this.editor);
    registrarPrettier(this, this.editor, () => this.projeto.raiz(), () => this.config.atual().editor.formatarAoSalvar);
    if (isDevMode()) Object.assign(window, { seedyWeb: this });
  }

  servidor(tipo: TipoServidorWeb): ServidorWeb | null {
    const s = this.servidores()[tipo];
    return s?.pronto ? s : null;
  }

  /** Qual servidor responde por um arquivo (TS/JS → ts; HTML → angular). */
  servidorDe(modelo: monaco.editor.ITextModel): ServidorWeb | null {
    if (modelo.uri.scheme !== 'file') return null;
    const c = modelo.uri.path;
    if (EXT_TS.test(c)) return this.servidor('ts');
    if (/\.html$/i.test(c)) return this.servidor('angular');
    return null;
  }

  // ---------- ciclo de vida ----------

  private async verificar(raiz: string | null): Promise<void> {
    const geracao = ++this.geracao;
    const nomes = raiz ? (await ponte.lerPasta(raiz).catch(() => [])).filter((e) => !e.pasta).map((e) => e.nome) : [];
    if (geracao !== this.geracao) return;
    if (!raiz || !nomes.includes('package.json')) {
      if (this.web()) this.parar();
      this.web.set(null);
      return;
    }
    let prettier = nomes.some((n) => PRETTIER_CONFIG.test(n));
    let react = false;
    try {
      const pkg = JSON.parse(await ponte.lerArquivo(`${raiz.replace(/[\\/]+$/, '')}${raiz.includes('\\') ? '\\' : '/'}package.json`));
      prettier ||= !!pkg.prettier;
      react = !!(pkg.dependencies?.react || pkg.devDependencies?.react);
    } catch {
      /* package.json inválido: segue sem */
    }
    const web: ProjetoWeb = {
      angular: nomes.includes('angular.json'),
      react,
      eslint: nomes.some((n) => ESLINT_CONFIG.test(n)),
      eslintPlano: nomes.some((n) => n.startsWith('eslint.config.')),
      prettier,
    };
    const antes = this.web();
    this.web.set(web);
    const mesmo = antes && antes.angular === web.angular && antes.react === web.react && antes.eslint === web.eslint && Object.keys(this.servidores()).length;
    if (!mesmo && noApp()) await this.iniciar(raiz, web, geracao);
  }

  private async iniciar(raiz: string, web: ProjetoWeb, geracao: number): Promise<void> {
    this.parar();
    const estado = await ponte.web.estado();
    if (geracao !== this.geracao) return;
    if (!estado.node) {
      this.fase.set('sem-node');
      this.mensagens.mostrar(`projeto web: instale o Node para ter ${nomesDoWeb(web)} no editor`);
      return;
    }
    if (!estado.instalado) {
      this.fase.set('instalando');
      this.detalhe.set('instalando os servidores web (npm)…');
      this.mensagens.mostrar(`baixando os servidores de ${nomesDoWeb(web)} (só na primeira vez)…`);
      try {
        await ponte.web.instalar((l) => this.detalhe.set(l.slice(0, 120)));
      } catch (e) {
        this.fase.set('erro');
        this.mensagens.erro(String(e));
        return;
      }
      if (geracao !== this.geracao) return;
    }
    this.fase.set('iniciando');
    const tipos: TipoServidorWeb[] = ['ts', ...(web.angular ? (['angular'] as const) : []), ...(web.eslint ? (['eslint'] as const) : [])];
    await Promise.all(tipos.map((t) => this.subir(t, raiz, geracao)));
    if (geracao !== this.geracao) return;
    // Com o servidor de TS no ar, o TypeScript embutido do Monaco sai (senão tudo aparece em dobro).
    if (this.servidor('ts')) ligarTsEmbutido(false);
    this.fase.set(Object.values(this.servidores()).some((s) => s?.pronto) ? 'pronto' : 'erro');
  }

  private async subir(tipo: TipoServidorWeb, raiz: string, geracao: number): Promise<void> {
    let cliente!: ClienteLsp;
    try {
      const id = await ponte.web.lspIniciar(
        tipo,
        raiz,
        (m) => cliente.receber(m),
        () => this.aoEncerrar(tipo, geracao),
      );
      cliente = new ClienteLsp((texto) => ponte.java.enviar(id, texto));
      const s: ServidorWeb = { tipo, id, cliente, pronto: false, gatilhos: ['.'], assinatura: ['('], abertos: new Map(), puxaDiagnosticos: false };
      this.ouvir(s, raiz);
      const uri = monaco.Uri.file(raiz).toString();
      const r = await cliente.pedir('initialize', {
        processId: null,
        clientInfo: { name: 'Seedy' },
        locale: 'pt-br',
        rootPath: raiz,
        rootUri: uri,
        workspaceFolders: [{ uri, name: nomeBase(raiz) }],
        capabilities: CAPACIDADES,
        initializationOptions: tipo === 'ts' ? { preferences: { includeCompletionsForModuleExports: true, includeCompletionsWithInsertText: true, importModuleSpecifierPreference: 'shortest' } } : undefined,
      });
      if (geracao !== this.geracao) return void ponte.java.parar(id);
      const cap = r?.capabilities ?? {};
      s.gatilhos = cap.completionProvider?.triggerCharacters ?? s.gatilhos;
      s.assinatura = cap.signatureHelpProvider?.triggerCharacters ?? s.assinatura;
      s.puxaDiagnosticos = !!cap.diagnosticProvider;
      cliente.notificar('initialized', {});
      if (tipo === 'eslint') cliente.notificar('workspace/didChangeConfiguration', { settings: {} });
      s.pronto = true;
      this.servidores.update((m) => ({ ...m, [tipo]: s }));
    } catch (e) {
      this.mensagens.erro(`${NOMES[tipo]}: ${(e as Error).message ?? e}`);
    }
  }

  private ouvir(s: ServidorWeb, raiz: string): void {
    const c = s.cliente;
    c.aoNotificar('textDocument/publishDiagnostics', (p: { uri: string; diagnostics: DiagnosticoLsp[] }) => this.diagnosticos(s.tipo, p.uri, p.diagnostics));
    c.aoPedir('workspace/configuration', (p: { items: { section?: string; scopeUri?: string }[] }) =>
      p.items.map((i) => (s.tipo === 'eslint' ? configuracaoEslint(raiz, !!this.web()?.eslintPlano, i.scopeUri) : null)),
    );
    c.aoPedir('workspace/workspaceFolders', () => [{ uri: monaco.Uri.file(raiz).toString(), name: nomeBase(raiz) }]);
    c.aoPedir('workspace/applyEdit', async (p: { edit: EdicaoDeWorkspaceLsp }) => ({ applied: await this.aplicarEdicao(p.edit) }));
    c.aoPedir('window/workDoneProgress/create', () => null);
    c.aoPedir('workspace/diagnostic/refresh', () => {
      for (const uri of s.abertos.keys()) this.puxar(s, uri);
      return null;
    });
    c.aoPedir('client/registerCapability', () => null);
    c.aoPedir('window/showMessageRequest', () => null);
    // ESLint: pede licença para rodar a biblioteca do projeto (4 = permitido).
    c.aoPedir('eslint/confirmESLintExecution', () => 4);
    c.aoPedir('eslint/openDoc', () => ({}));
    c.aoPedir('eslint/probeFailed', () => ({}));
    c.aoPedir('eslint/noLibrary', () => ({}));
    c.aoPedir('eslint/noConfig', () => ({}));
    c.aoNotificar('window/showMessage', (p: { type: number; message: string }) => {
      if (p.type === 1) this.mensagens.erro(`${NOMES[s.tipo]}: ${p.message}`);
    });
  }

  private aoEncerrar(tipo: TipoServidorWeb, geracao: number): void {
    if (geracao !== this.geracao) return;
    const s = this.servidores()[tipo];
    s?.cliente.encerrar();
    for (const d of s?.abertos.values() ?? []) d.dispose();
    this.servidores.update((m) => {
      const n = { ...m };
      delete n[tipo];
      return n;
    });
    this.mensagens.erro(`${NOMES[tipo]} parou`);
  }

  parar(): void {
    for (const s of Object.values(this.servidores())) {
      if (!s) continue;
      s.cliente.encerrar();
      for (const d of s.abertos.values()) d.dispose();
      void ponte.java.parar(s.id).catch(() => undefined);
    }
    this.servidores.set({});
    for (const uri of [...this.dicas.keys()]) this.limparDicas(uri);
    for (const m of monaco.editor.getModels()) for (const dono of ['ts', 'angular', 'eslint']) monaco.editor.setModelMarkers(m, dono, []);
    this.diagnosticosEslint.clear();
    this.avisosEslint.set(0);
    ligarTsEmbutido(true);
    this.fase.set('inativo');
  }

  // ---------- documentos ----------

  /** Quais servidores recebem o arquivo. */
  private destinos(caminho: string): TipoServidorWeb[] {
    const web = this.web();
    if (!web) return [];
    if (EXT_TS.test(caminho)) return ['ts', ...(web.angular && /\.ts$/i.test(caminho) ? (['angular'] as const) : []), ...(web.eslint ? (['eslint'] as const) : [])];
    if (/\.html$/i.test(caminho) && web.angular) return ['angular'];
    return [];
  }

  private sincronizar(buffers: Buffer[]): void {
    const servidores = this.servidores();
    for (const s of Object.values(servidores)) {
      if (!s?.pronto) continue;
      const queremos = buffers.filter((b) => !b.somenteLeitura && !b.modelo.isDisposed() && this.destinos(b.caminho).includes(s.tipo));
      const chaves = new Set(queremos.map((b) => b.modelo.uri.toString()));
      for (const [uri, d] of s.abertos) {
        if (chaves.has(uri)) continue;
        d.dispose();
        s.abertos.delete(uri);
        s.cliente.notificar('textDocument/didClose', { textDocument: { uri } });
      }
      for (const b of queremos) {
        const uri = b.modelo.uri.toString();
        if (s.abertos.has(uri)) continue;
        const modelo = b.modelo;
        s.cliente.notificar('textDocument/didOpen', {
          textDocument: { uri, languageId: idDeLinguagem(b.caminho) ?? modelo.getLanguageId(), version: modelo.getVersionId(), text: modelo.getValue() },
        });
        s.abertos.set(
          uri,
          modelo.onDidChangeContent(() => {
            s.cliente.notificar('textDocument/didChange', { textDocument: { uri, version: modelo.getVersionId() }, contentChanges: [{ text: modelo.getValue() }] });
            this.puxar(s, uri);
          }),
        );
        this.puxar(s, uri);
      }
    }
  }

  private avisarMudancas(m: Mudancas): void {
    const interessa = (p: string) => EXT_TS.test(p) || /(^|[\\/])(package\.json|tsconfig[^\\/]*\.json)$/.test(p);
    const uri = (p: string) => monaco.Uri.file(p).toString();
    const changes = [
      ...m.criados.filter(interessa).map((p) => ({ uri: uri(p), type: 1 })),
      ...m.alterados.filter(interessa).map((p) => ({ uri: uri(p), type: 2 })),
      ...m.removidos.filter(interessa).map((p) => ({ uri: uri(p), type: 3 })),
    ];
    if (!changes.length) return;
    for (const s of Object.values(this.servidores())) s?.cliente.notificar('workspace/didChangeWatchedFiles', { changes });
  }

  // ---------- diagnósticos ----------

  private readonly esperas = new Map<string, ReturnType<typeof setTimeout>>();

  /** Servidor de diagnóstico "pull": pede os problemas do arquivo (com uma pausa entre teclas). */
  private puxar(s: ServidorWeb, uri: string): void {
    if (!s.puxaDiagnosticos) return;
    const chave = `${s.tipo} ${uri}`;
    clearTimeout(this.esperas.get(chave));
    this.esperas.set(
      chave,
      setTimeout(async () => {
        this.esperas.delete(chave);
        const r = await s.cliente.pedir('textDocument/diagnostic', { textDocument: { uri } }).catch(() => null);
        if (r?.kind === 'full') this.diagnosticos(s.tipo, uri, r.items ?? []);
      }, 350),
    );
  }

  private diagnosticos(tipo: TipoServidorWeb, uri: string, lista: DiagnosticoLsp[]): void {
    const modelo = monaco.editor.getModel(monaco.Uri.parse(uri));
    if (tipo === 'eslint') {
      this.diagnosticosEslint.set(monaco.Uri.parse(uri).toString(), lista.length);
      this.avisosEslint.set([...this.diagnosticosEslint.values()].reduce((a, b) => a + b, 0));
    }
    if (!modelo) return;
    monaco.editor.setModelMarkers(
      modelo,
      tipo,
      lista.map((d) => {
        const m = paraMarcador(d);
        if (tipo === 'eslint') m.message = `eslint: ${d.message}${(d as any).code ? ` (${typeof (d as any).code === 'object' ? (d as any).code.value : (d as any).code})` : ''}`;
        return m;
      }),
    );
    if (tipo === 'eslint') this.dicasEslint(modelo, lista);
  }

  /** "◆ eslint: …" no fim da linha (mockup 13), uma por linha. */
  private dicasEslint(modelo: monaco.editor.ITextModel, lista: DiagnosticoLsp[]): void {
    const porLinha = new Map<number, string>();
    for (const d of lista) {
      const l = d.range.start.line + 1;
      if (!porLinha.has(l) && l <= modelo.getLineCount()) porLinha.set(l, d.message.split('\n')[0]);
    }
    const chave = modelo.uri.toString();
    const novas = [...porLinha].map(([l, t]) => {
      const col = modelo.getLineMaxColumn(l);
      return { range: new monaco.Range(l, col, l, col), options: { after: { content: `   ◆ eslint: ${t}`, inlineClassName: 'dica-eslint' }, showIfCollapsed: true } };
    });
    this.dicas.set(chave, modelo.deltaDecorations(this.dicas.get(chave) ?? [], novas));
  }

  private limparDicas(uri: string): void {
    const m = monaco.editor.getModel(monaco.Uri.parse(uri));
    if (m) m.deltaDecorations(this.dicas.get(uri) ?? [], []);
    this.dicas.delete(uri);
  }

  // ---------- edições ----------

  /** WorkspaceEdit de um servidor: abre os arquivos (em segundo plano) e edita os modelos. */
  async aplicarEdicao(edicao: EdicaoDeWorkspaceLsp | null): Promise<boolean> {
    if (!edicao) return false;
    for (const [chave, lista] of edicoesPorArquivo(edicao)) {
      const b = await this.editor.abrir(caminhoDaUri(monaco.Uri.parse(chave)), undefined, undefined, false);
      if (!b) return false;
      b.modelo.pushEditOperations([], lista.map(paraEdicao).map((e) => ({ range: e.range, text: e.text })), () => null);
    }
    return true;
  }
}

/** "TypeScript, React e ESLint": o que este projeto web usa (para as mensagens). */
function nomesDoWeb(web: ProjetoWeb): string {
  const n = ['TypeScript', ...(web.react ? ['React'] : []), ...(web.angular ? ['Angular'] : []), ...(web.eslint ? ['ESLint'] : [])];
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} e ${n.at(-1)}` : n[0];
}

const NOMES: Record<TipoServidorWeb, string> = { ts: 'TypeScript', angular: 'Angular', eslint: 'ESLint' };

/** O TypeScript embutido do Monaco: desligado quando o typescript-language-server responde. */
function ligarTsEmbutido(ligado: boolean): void {
  const modos = {
    completionItems: ligado,
    hovers: ligado,
    documentSymbols: ligado,
    definitions: ligado,
    references: ligado,
    documentHighlights: ligado,
    rename: ligado,
    diagnostics: ligado,
    documentRangeFormattingEdits: ligado,
    signatureHelp: ligado,
    onTypeFormattingEdits: ligado,
    codeActions: ligado,
    inlayHints: ligado,
  };
  monaco.typescript.typescriptDefaults.setModeConfiguration(modos);
  monaco.typescript.javascriptDefaults.setModeConfiguration(modos);
}

/** Configuração que o servidor do ESLint pede (as chaves da extensão do VS Code). */
function configuracaoEslint(raiz: string, plano: boolean, escopo?: string) {
  return {
    validate: 'on',
    packageManager: 'npm',
    useESLintClass: false,
    useFlatConfig: plano,
    experimental: { useFlatConfig: plano },
    codeAction: { disableRuleComment: { enable: true, location: 'separateLine' }, showDocumentation: { enable: false } },
    codeActionOnSave: { enable: false, mode: 'all' },
    format: false,
    quiet: false,
    onIgnoredFiles: 'off',
    options: {},
    rulesCustomizations: [],
    run: 'onType',
    problems: { shortenToSingleLine: false },
    nodePath: null,
    workingDirectory: { mode: 'location' },
    workspaceFolder: { uri: monaco.Uri.file(raiz).toString(), name: nomeBase(raiz) },
    scopeUri: escopo,
  };
}

const FORMATOS = ['markdown', 'plaintext'];
const CAPACIDADES = {
  workspace: {
    applyEdit: true,
    workspaceEdit: { documentChanges: true },
    configuration: true,
    workspaceFolders: true,
    didChangeConfiguration: { dynamicRegistration: false },
    didChangeWatchedFiles: { dynamicRegistration: false },
    executeCommand: { dynamicRegistration: false },
  },
  textDocument: {
    synchronization: { didSave: true, willSave: false, willSaveWaitUntil: false },
    completion: {
      contextSupport: true,
      completionItem: {
        snippetSupport: true,
        documentationFormat: FORMATOS,
        labelDetailsSupport: true,
        deprecatedSupport: true,
        tagSupport: { valueSet: [1] },
        resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] },
        insertReplaceSupport: false,
      },
    },
    hover: { contentFormat: FORMATOS },
    signatureHelp: { signatureInformation: { documentationFormat: FORMATOS, parameterInformation: { labelOffsetSupport: true } }, contextSupport: true },
    definition: { linkSupport: false },
    typeDefinition: { linkSupport: false },
    implementation: { linkSupport: false },
    references: {},
    documentHighlight: {},
    documentSymbol: { hierarchicalDocumentSymbolSupport: true },
    rename: { prepareSupport: true },
    codeAction: {
      dataSupport: true,
      isPreferredSupport: true,
      resolveSupport: { properties: ['edit'] },
      codeActionLiteralSupport: { codeActionKind: { valueSet: ['', 'quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'source', 'source.organizeImports', 'source.fixAll'] } },
    },
    publishDiagnostics: { relatedInformation: true, tagSupport: { valueSet: [1, 2] } },
    diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
  },
  window: { workDoneProgress: true, showMessage: {} },
};
