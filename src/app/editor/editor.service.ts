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
  }

  sujo(b: Buffer): boolean {
    this.edicoes();
    return b.modelo.getAlternativeVersionId() !== b.versaoSalva;
  }

  async abrir(caminho: string): Promise<void> {
    if (!this.buffers().some((b) => b.caminho === caminho)) {
      let conteudo: string;
      try {
        conteudo = await ponte.lerArquivo(caminho);
      } catch (e) {
        this.mensagens.erro(String(e));
        return;
      }
      const uri = monaco.Uri.file(caminho);
      const modelo =
        monaco.editor.getModel(uri) ?? monaco.editor.createModel(conteudo, this.linguagemDe(caminho), uri);
      modelo.onDidChangeContent(() => this.edicoes.update((n) => n + 1));
      const buffer: Buffer = { caminho, nome: nomeBase(caminho), modelo, versaoSalva: modelo.getAlternativeVersionId() };
      this.buffers.update((lista) => [...lista, buffer]);
    }
    this.ativo.set(caminho);
  }

  async salvar(caminho = this.ativo()): Promise<void> {
    const b = this.buffers().find((x) => x.caminho === caminho);
    if (!b) return;
    try {
      await ponte.gravarArquivo(b.caminho, b.modelo.getValue());
      b.versaoSalva = b.modelo.getAlternativeVersionId();
      this.edicoes.update((n) => n + 1);
      this.mensagens.mostrar(`"${b.nome}" ${b.modelo.getLineCount()}L gravado`);
    } catch (e) {
      this.mensagens.erro(String(e));
    }
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

  private linguagemDe(caminho: string): string {
    const nome = nomeBase(caminho).toLowerCase();
    const ext = nome.includes('.') ? nome.slice(nome.lastIndexOf('.')) : '';
    const linguagem = monaco.languages
      .getLanguages()
      .find((l) => l.filenames?.some((f) => f.toLowerCase() === nome) || l.extensions?.includes(ext));
    return linguagem?.id ?? 'plaintext';
  }
}
