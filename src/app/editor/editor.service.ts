import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { monaco } from './monaco';
import { definirTemaMonaco } from './tema-monaco';
import { nomeBase, ponte } from '../nucleo/ponte';
import { MensagensService } from '../nucleo/mensagens.service';
import { TemaService } from '../tema/tema';
import { ProjetoService } from '../nucleo/projeto.service';

const CHAVE_MARKDOWN = 'seedy.markdown';

export interface Buffer {
  caminho: string;
  nome: string;
  modelo: monaco.editor.ITextModel;
  /** Versão do modelo no último salvamento; diferente = arquivo sujo. */
  versaoSalva: number;
  /**
   * Buffer que não é um arquivo do projeto (ex.: código de biblioteca vindo do jdtls).
   * Não salva, não edita; `caminho` é a URI e `descricao` o nome para mostrar.
   */
  somenteLeitura?: boolean;
  descricao?: string;
}

export type ModoVim = 'normal' | 'insert' | 'visual' | 'replace';

/**
 * Buffers abertos (arquivos), qual está ativo, e o estado que a statusline
 * mostra (modo do vim, posição do cursor, linguagem).
 */
@Injectable({ providedIn: 'root' })
export class EditorService {
  private readonly mensagens = inject(MensagensService);
  private readonly temaService = inject(TemaService);
  private readonly projeto = inject(ProjetoService);

  readonly buffers = signal<Buffer[]>([]);
  readonly ativo = signal<string | null>(null);
  readonly bufferAtivo = computed(() => this.buffers().find((b) => b.caminho === this.ativo()) ?? null);

  readonly modo = signal<ModoVim>('normal');
  readonly cursor = signal({ linha: 1, coluna: 1 });
  /** Incrementa a cada edição, para os indicadores de "sujo" atualizarem. */
  readonly edicoes = signal(0);
  /** Nos .md: formatado no próprio editor ("ao vivo") ou o texto puro ("fonte"). */
  readonly markdownAoVivo = signal(localStorage.getItem(CHAVE_MARKDOWN) !== 'fonte');

  // ---------- divisão do editor (dois painéis lado a lado) ----------

  /**
   * Editor dividido: qual painel tem o foco e qual arquivo está no outro.
   * `ativo` é sempre o arquivo do painel focado; trocar o foco troca os dois.
   * null = um painel só.
   */
  readonly divisao = signal<{ focado: 0 | 1; outro: string | null } | null>(null);
  readonly painelFocado = computed<0 | 1>(() => this.divisao()?.focado ?? 0);

  private readonly instancias: (monaco.editor.IStandaloneCodeEditor | null)[] = [null, null];

  /** Instância do Monaco do painel focado (registrada pelo EditorComponent). */
  get instancia(): monaco.editor.IStandaloneCodeEditor | null {
    return this.instancias[this.painelFocado()];
  }

  registrarInstancia(painel: 0 | 1, instancia: monaco.editor.IStandaloneCodeEditor | null): void {
    this.instancias[painel] = instancia;
  }

  /** Buffer mostrado num painel. */
  bufferDoPainel(painel: 0 | 1): Buffer | null {
    const d = this.divisao();
    if (!d || painel === d.focado) return this.bufferAtivo();
    return this.buffers().find((b) => b.caminho === d.outro) ?? null;
  }

  /**
   * Divide o editor (o painel novo, à direita, fica com o foco). Com `caminho`, abre
   * o arquivo nele; sem, os dois mostram o arquivo atual. Já dividido: abre no outro painel.
   */
  async dividir(caminho?: string, linha?: number): Promise<void> {
    const d = this.divisao();
    if (!d) this.divisao.set({ focado: 1, outro: this.ativo() });
    else this.focarPainel(d.focado === 0 ? 1 : 0);
    if (caminho) await this.abrir(caminho, linha);
    queueMicrotask(() => this.instancia?.focus());
  }

  focarPainel(painel: 0 | 1): void {
    const d = this.divisao();
    if (!d || d.focado === painel) return;
    const daqui = this.ativo();
    this.ativo.set(d.outro);
    this.divisao.set({ focado: painel, outro: daqui });
    this.instancias[painel]?.focus();
  }

  /** Fecha um painel da divisão (o focado, por padrão); o outro fica sozinho. */
  fecharPainel(painel = this.painelFocado()): void {
    const d = this.divisao();
    if (!d) return;
    if (painel === d.focado) this.ativo.set(d.outro);
    this.divisao.set(null);
    queueMicrotask(() => this.instancia?.focus());
  }

  constructor() {
    effect(() => definirTemaMonaco(this.temaService.tema()));

    // Arquivo alterado fora do editor (git, build, outro programa): recarrega se o buffer não tem edição.
    effect(() => {
      const m = this.projeto.mudancas();
      // "Criado" também conta: muitos programas gravam num temporário e renomeiam por cima.
      if (m) untracked(() => void this.recarregarDoDisco([...m.alterados, ...m.criados]));
    });

    // Cada arquivo que vira o ativo entra no histórico (alt+← / alt+→).
    effect(() => {
      const ativo = this.ativo();
      untracked(() => this.registrarVisita(ativo));
    });

    // Quando o Monaco quer abrir outro arquivo (ir para definição, lista de usos),
    // quem abre é o Seedy, como um buffer.
    monaco.editor.registerEditorOpener({
      openCodeEditor: (_origem, recurso, selecao) => {
        const pos = selecao && 'startLineNumber' in selecao
          ? { linha: selecao.startLineNumber, coluna: selecao.startColumn }
          : selecao ? { linha: selecao.lineNumber, coluna: selecao.column } : null;
        if (recurso.scheme !== 'file') {
          // Modelo virtual (ex.: jdt:// do jdtls), criado por quem achou a definição.
          const modelo = monaco.editor.getModel(recurso);
          if (!modelo) return false;
          this.abrirModelo(modelo, undefined, pos?.linha, pos?.coluna);
          return true;
        }
        const caminho = recurso.fsPath.replace(/^([a-z]):/, (_, l: string) => `${l.toUpperCase()}:`);
        void this.abrir(caminho, pos?.linha, pos?.coluna);
        return true;
      },
    });
  }

  /** Um arquivo Markdown que dá para ver ao vivo. */
  ehMarkdown(b: Buffer | null): boolean {
    return !!b && !b.somenteLeitura && /\.(md|markdown)$/i.test(b.caminho);
  }

  mostrarMarkdown(aoVivo: boolean): void {
    this.markdownAoVivo.set(aoVivo);
    localStorage.setItem(CHAVE_MARKDOWN, aoVivo ? 'vivo' : 'fonte');
    this.instancia?.focus();
  }

  alternarMarkdown(): void {
    if (!this.ehMarkdown(this.bufferAtivo())) return this.mensagens.mostrar('abra um arquivo .md para alternar entre ao vivo e fonte');
    this.mostrarMarkdown(!this.markdownAoVivo());
  }

  sujo(b: Buffer): boolean {
    this.edicoes();
    if (b.somenteLeitura) return false;
    return b.modelo.getAlternativeVersionId() !== b.versaoSalva;
  }

  /**
   * Abre o arquivo (ou só ativa, se já estiver aberto); com `linha`, leva o cursor até ela.
   * Com `ativar` = false, o arquivo vira um buffer sem trocar o que está na tela
   * (ex.: arquivos alterados por um "renomear" em vários arquivos).
   */
  async abrir(caminho: string, linha?: number, coluna?: number, ativar = true): Promise<Buffer | null> {
    let buffer = this.bufferDe(caminho);
    if (!buffer) {
      const modelo = await this.garantirModelo(caminho);
      if (!modelo) return null;
      buffer = this.bufferDe(caminho); // pode ter sido aberto enquanto lia o disco
      if (!buffer) {
        modelo.onDidChangeContent(() => this.edicoes.update((n) => n + 1));
        buffer = { caminho, nome: nomeBase(caminho), modelo, versaoSalva: modelo.getAlternativeVersionId() };
        this.buffers.update((lista) => [...lista, buffer!]);
      }
    }
    if (ativar) {
      this.ativo.set(buffer.caminho);
      if (linha) this.irPara(buffer, linha, coluna);
    }
    return buffer;
  }

  /** Buffer aberto deste arquivo, comparando pela URI (no Windows, `c:\` e `C:\` são o mesmo). */
  bufferDe(caminho: string): Buffer | undefined {
    const direto = this.buffers().find((b) => b.caminho === caminho);
    if (direto) return direto;
    const uri = monaco.Uri.file(caminho).toString();
    return this.buffers().find((b) => b.modelo.uri.toString() === uri);
  }

  /**
   * Abre como buffer somente leitura um modelo que não é arquivo do projeto
   * (código de biblioteca/JDK). `descricao` aparece na statusline e nas migalhas.
   */
  abrirModelo(modelo: monaco.editor.ITextModel, descricao?: string, linha?: number, coluna?: number): Buffer {
    const chave = modelo.uri.toString();
    let buffer = this.buffers().find((b) => b.caminho === chave);
    if (!buffer) {
      const nome = decodeURIComponent(modelo.uri.path.split('/').pop() ?? chave);
      buffer = {
        caminho: chave,
        nome,
        modelo,
        versaoSalva: modelo.getAlternativeVersionId(),
        somenteLeitura: true,
        descricao: descricao ?? descricaoDeClasse(modelo.uri) ?? nome,
      };
      this.buffers.update((lista) => [...lista, buffer!]);
    }
    this.ativo.set(buffer.caminho);
    if (linha) this.irPara(buffer, linha, coluna);
    return buffer;
  }

  /**
   * Modelo do Monaco para o arquivo, sem abrir buffer. O Monaco precisa do modelo
   * para mostrar prévia de definição e lista de usos de arquivos fechados.
   */
  async garantirModelo(caminho: string): Promise<monaco.editor.ITextModel | null> {
    const uri = monaco.Uri.file(caminho);
    const existente = monaco.editor.getModel(uri);
    if (existente) return existente;
    let conteudo: string;
    try {
      conteudo = await ponte.lerArquivo(caminho);
    } catch (e) {
      this.mensagens.erro(String(e));
      return null;
    }
    return monaco.editor.getModel(uri) ?? monaco.editor.createModel(conteudo, this.linguagemDe(caminho), uri);
  }

  private async recarregarDoDisco(caminhos: string[]): Promise<void> {
    for (const caminho of caminhos) {
      const b = this.bufferDe(caminho);
      if (!b || b.somenteLeitura || this.sujo(b)) continue;
      let conteudo: string;
      try {
        conteudo = await ponte.lerArquivo(b.caminho);
      } catch {
        continue;
      }
      // O próprio salvar do Seedy também gera aviso: aí o conteúdo é igual e nada muda.
      const semCr = (t: string) => t.replace(/\r\n/g, '\n');
      if (semCr(conteudo) === semCr(b.modelo.getValue())) continue;
      const antes = b.modelo.getValue();
      b.modelo.pushEditOperations([], [{ range: b.modelo.getFullModelRange(), text: conteudo }], () => null);
      b.versaoSalva = b.modelo.getAlternativeVersionId();
      for (const fn of this.ouvintesDeRecarregar) fn(b, antes, conteudo);
      this.edicoes.update((n) => n + 1);
      this.mensagens.mostrar(`"${b.nome}" mudou no disco e foi recarregado`);
    }
  }

  /** Avisos de arquivo salvo (o jdtls usa para recompilar e reimportar o pom.xml). */
  aoSalvar(fn: (b: Buffer) => void): void {
    this.ouvintesDeSalvar.push(fn);
  }

  private readonly ouvintesDeSalvar: ((b: Buffer) => void)[] = [];

  /** Roda antes de gravar (ex.: o Prettier formata o arquivo do projeto web). */
  private readonly ouvintesDeRefatorar: ((caminho: string, conteudo: string | null) => void)[] = [];

  /** Chamado antes de o Monaco aplicar um renomear (o histórico local guarda o que havia). */
  antesDeRefatorar(fn: (caminho: string, conteudo: string | null) => void): void {
    this.ouvintesDeRefatorar.push(fn);
  }

  /** Os provedores de linguagem avisam quais arquivos o renomear vai tocar. */
  avisarRefatoracao(recursos: monaco.Uri[]): void {
    for (const uri of new Map(recursos.filter((r) => r.scheme === 'file').map((r) => [r.toString(), r])).values()) {
      // Sem buffer aberto, o conteúdo é o do disco.
      const noDisco = uri.fsPath.replace(/^([a-z]):/, (_, letra: string) => `${letra.toUpperCase()}:`);
      const buffer = this.bufferDe(noDisco);
      for (const fn of this.ouvintesDeRefatorar) fn(buffer?.caminho ?? noDisco, buffer?.modelo.getValue() ?? null);
    }
  }

  antesDeSalvar(fn: (b: Buffer) => Promise<void>): void {
    this.preparadoresDeSalvar.push(fn);
  }

  private readonly preparadoresDeSalvar: ((b: Buffer) => Promise<void>)[] = [];

  /** Avisos de buffer recarregado por mudança feita fora do editor (antes, depois). */
  aoRecarregar(fn: (b: Buffer, antes: string, depois: string) => void): void {
    this.ouvintesDeRecarregar.push(fn);
  }

  private readonly ouvintesDeRecarregar: ((b: Buffer, antes: string, depois: string) => void)[] = [];

  private irPara(b: Buffer, linha: number, coluna?: number): void {
    const instancia = this.instancia;
    if (!instancia) return;
    this.mostrarModelo(b.modelo, false);
    const n = Math.min(linha, b.modelo.getLineCount());
    const c = coluna ?? (b.modelo.getLineFirstNonWhitespaceColumn(n) || 1);
    instancia.setPosition({ lineNumber: n, column: c });
    instancia.revealLineInCenter(n);
    instancia.focus();
  }

  /**
   * Troca o modelo na tela guardando cursor/rolagem do que sai e devolvendo os do
   * que entra (o Monaco descarta isso no setModel). `restaurar` = false quando
   * quem chama já vai posicionar o cursor (ex.: abrir numa linha).
   */
  mostrarModelo(modelo: monaco.editor.ITextModel | null, restaurar = true, instancia = this.instancia): void {
    if (!instancia) return;
    const atual = instancia.getModel();
    if (atual === modelo) return;
    if (atual && !atual.isDisposed()) {
      const estado = instancia.saveViewState();
      if (estado) this.estadosDeVista.set(atual.uri.toString(), estado);
    }
    instancia.setModel(modelo);
    const estado = modelo && restaurar ? this.estadosDeVista.get(modelo.uri.toString()) : undefined;
    if (estado) instancia.restoreViewState(estado);
  }

  private readonly estadosDeVista = new Map<string, monaco.editor.ICodeEditorViewState>();

  // ---------- histórico de arquivos vistos (alt+← / alt+→) ----------

  private historico: string[] = [];
  private posicaoNoHistorico = -1;

  /** Volta (-1) ou avança (1) nos arquivos vistos; reabre o que tinha sido fechado. */
  async navegar(passo: 1 | -1): Promise<void> {
    let i = this.posicaoNoHistorico + passo;
    while (i >= 0 && i < this.historico.length) {
      const alvo = this.historico[i];
      const aberto = this.buffers().find((b) => b.caminho === alvo);
      // Código de biblioteca fechado não tem como reabrir daqui: sai do histórico.
      if (!aberto && alvo.includes('://')) {
        this.historico.splice(i, 1);
        if (passo < 0) i--;
        else if (i <= this.posicaoNoHistorico) this.posicaoNoHistorico--;
        continue;
      }
      // Antes de ativar: assim a visita não entra de novo no histórico.
      this.posicaoNoHistorico = i;
      if (aberto) this.ativo.set(alvo);
      else if (!(await this.abrir(alvo))) return;
      return;
    }
    this.mensagens.mostrar(passo < 0 ? 'início do histórico (alt+→ avança)' : 'fim do histórico (alt+← volta)');
  }

  private registrarVisita(caminho: string | null): void {
    if (!caminho || this.historico[this.posicaoNoHistorico] === caminho) return;
    this.historico = [...this.historico.slice(0, this.posicaoNoHistorico + 1), caminho].slice(-100);
    this.posicaoNoHistorico = this.historico.length - 1;
  }

  async salvar(caminho = this.ativo(), avisar = true): Promise<boolean> {
    const b = this.buffers().find((x) => x.caminho === caminho);
    if (!b) return false;
    if (b.somenteLeitura) {
      if (avisar) this.mensagens.mostrar(`"${b.nome}" é somente leitura`);
      return false;
    }
    for (const fn of this.preparadoresDeSalvar) await fn(b).catch((e) => this.mensagens.erro(String(e)));
    try {
      await ponte.gravarArquivo(b.caminho, b.modelo.getValue());
      b.versaoSalva = b.modelo.getAlternativeVersionId();
      this.edicoes.update((n) => n + 1);
      if (avisar) this.mensagens.mostrar(`"${b.nome}" ${b.modelo.getLineCount()}L gravado`);
      for (const fn of this.ouvintesDeSalvar) fn(b);
      return true;
    } catch (e) {
      this.mensagens.erro(String(e));
      return false;
    }
  }

  /** Salva todos os buffers alterados (:wa). */
  async salvarTodos(): Promise<void> {
    const sujos = this.buffers().filter((b) => this.sujo(b));
    let gravados = 0;
    for (const b of sujos) if (await this.salvar(b.caminho, false)) gravados++;
    this.mensagens.mostrar(gravados ? `${gravados} ${gravados === 1 ? 'arquivo gravado' : 'arquivos gravados'}` : 'nada para gravar');
  }

  fechar(caminho = this.ativo(), forcar = false): void {
    const lista = this.buffers();
    const i = lista.findIndex((b) => b.caminho === caminho);
    if (i < 0) return;
    const b = lista[i];
    if (this.sujo(b) && !forcar) {
      this.mensagens.erro(`"${b.nome}" tem alterações não salvas (:w para salvar, :q! para descartar)`);
      return;
    }
    // O outro painel mostra este buffer: a divisão fecha junto.
    if (this.divisao()?.outro === b.caminho) this.divisao.set(null);
    const resto = lista.filter((x) => x !== b);
    this.buffers.set(resto);
    if (this.ativo() === b.caminho) this.ativo.set(resto[Math.min(i, resto.length - 1)]?.caminho ?? null);
    b.modelo.dispose();
  }

  proximo(passo: 1 | -1): void {
    const lista = this.buffers();
    if (lista.length < 2) return;
    const i = lista.findIndex((b) => b.caminho === this.ativo());
    this.ativo.set(lista[(i + passo + lista.length) % lista.length].caminho);
  }

  focar(): void {
    this.instancia?.focus();
  }

  /** Buscar no arquivo aberto (Ctrl+F): a caixa de busca do próprio Monaco. */
  buscarNoArquivo(): void {
    const instancia = this.instancia;
    if (!instancia || !this.bufferAtivo()) {
      this.mensagens.alerta('abra um arquivo para buscar nele (ctrl+p)');
      return;
    }
    instancia.focus();
    void instancia.getAction('actions.find')?.run();
  }

  linguagemDe(caminho: string): string {
    const nome = nomeBase(caminho).toLowerCase();
    const ext = nome.includes('.') ? nome.slice(nome.lastIndexOf('.')) : '';
    const linguagem = monaco.languages
      .getLanguages()
      .find((l) => l.filenames?.some((f) => f.toLowerCase() === nome) || l.extensions?.includes(ext));
    return linguagem?.id ?? 'plaintext';
  }
}

/** `jdt://contents/java.base/java.util/ArrayList.class?...` (ou `.java`) → `java.util.ArrayList`. */
function descricaoDeClasse(uri: monaco.Uri): string | null {
  if (uri.scheme !== 'jdt') return null;
  const partes = decodeURIComponent(uri.path).split('/').filter(Boolean);
  const classe = partes.pop()?.replace(/\.(class|java)$/, '');
  const pacote = partes.pop();
  return classe ? (pacote ? `${pacote}.${classe}` : classe) : null;
}
