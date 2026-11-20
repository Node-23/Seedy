import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { monaco } from './monaco';
import { definirTemaMonaco } from './tema-monaco';
import { nomeBase, ponte } from '../nucleo/ponte';
import { MensagensService } from '../nucleo/mensagens.service';
import { TemaService } from '../tema/tema';

export interface Buffer {
  caminho: string;
  nome: string;
  modelo: monaco.editor.ITextModel;
  /** Versão do modelo no último salvamento; diferente = arquivo sujo. */
  versaoSalva: number;
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

  readonly buffers = signal<Buffer[]>([]);
  readonly ativo = signal<string | null>(null);
  readonly bufferAtivo = computed(() => this.buffers().find((b) => b.caminho === this.ativo()) ?? null);

  readonly modo = signal<ModoVim>('normal');
  readonly cursor = signal({ linha: 1, coluna: 1 });
  /** Incrementa a cada edição, para os indicadores de "sujo" atualizarem. */
  readonly edicoes = signal(0);

  /** Instância do editor, registrada pelo EditorComponent. */
  instancia: monaco.editor.IStandaloneCodeEditor | null = null;

  constructor() {
    effect(() => definirTemaMonaco(this.temaService.tema()));

    // Quando o Monaco quer abrir outro arquivo (ir para definição, lista de usos),
    // quem abre é o Seedy, como um buffer.
    monaco.editor.registerEditorOpener({
      openCodeEditor: (_origem, recurso, selecao) => {
        if (recurso.scheme !== 'file') return false;
        const pos = selecao && 'startLineNumber' in selecao
          ? { linha: selecao.startLineNumber, coluna: selecao.startColumn }
          : selecao ? { linha: selecao.lineNumber, coluna: selecao.column } : null;
        const caminho = recurso.fsPath.replace(/^([a-z]):/, (_, l: string) => `${l.toUpperCase()}:`);
        void this.abrir(caminho, pos?.linha, pos?.coluna);
        return true;
      },
    });
  }

  sujo(b: Buffer): boolean {
    this.edicoes();
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
    const uri = monaco.Uri.file(caminho).toString();
    return this.buffers().find((b) => b.modelo.uri.toString() === uri);
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

  /** Avisos de arquivo salvo (o jdtls usa para recompilar e reimportar o pom.xml). */
  aoSalvar(fn: (b: Buffer) => void): void {
    this.ouvintesDeSalvar.push(fn);
  }

  private readonly ouvintesDeSalvar: ((b: Buffer) => void)[] = [];

  private irPara(b: Buffer, linha: number, coluna?: number): void {
    const instancia = this.instancia;
    if (!instancia) return;
    if (instancia.getModel() !== b.modelo) instancia.setModel(b.modelo);
    const n = Math.min(linha, b.modelo.getLineCount());
    const c = coluna ?? (b.modelo.getLineFirstNonWhitespaceColumn(n) || 1);
    instancia.setPosition({ lineNumber: n, column: c });
    instancia.revealLineInCenter(n);
    instancia.focus();
  }

  private irParaLinha(caminho: string, linha: number): void {
    const b = this.buffers().find((x) => x.caminho === caminho);
    const instancia = this.instancia;
    if (!b || !instancia) return;
    if (instancia.getModel() !== b.modelo) instancia.setModel(b.modelo);
    const n = Math.min(linha, b.modelo.getLineCount());
    const coluna = b.modelo.getLineFirstNonWhitespaceColumn(n) || 1;
    instancia.setPosition({ lineNumber: n, column: coluna });
    instancia.revealLineInCenter(n);
    instancia.focus();
  }

  async salvar(caminho = this.ativo(), avisar = true): Promise<boolean> {
    const b = this.buffers().find((x) => x.caminho === caminho);
    if (!b) return false;
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
      this.mensagens.mostrar('abra um arquivo para buscar nele (ctrl+p)');
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
