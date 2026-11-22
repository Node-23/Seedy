import { effect, inject, Injectable, isDevMode, signal, untracked } from '@angular/core';
import { monaco } from './monaco';
import { EditorService } from './editor.service';
import { EscolhaService } from '../escolha/escolha.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { ProjetoService } from '../nucleo/projeto.service';
import { ponte } from '../nucleo/ponte';

export interface Marca {
  /** Caminho relativo à raiz do projeto, com `/`. */
  caminho: string;
  linha: number;
  /** O texto da linha quando foi marcada (para achar na lista). */
  texto: string;
}

const LIMPAR = Symbol('limpar');

/**
 * Bookmarks no código: marcam uma linha (barra rosa na margem) para voltar a ela depois.
 * `␣ M` marca/desmarca a linha, `ctrl+F2` também, `␣ B` lista e vai até uma marca.
 * Ficam em `.seedy/bookmarks.json` (só desta máquina, o git ignora; dá para editar à mão) e acompanham a
 * linha quando o código muda acima dela.
 */
@Injectable({ providedIn: 'root' })
export class BookmarksService {
  private readonly editor = inject(EditorService);
  private readonly escolha = inject(EscolhaService);
  private readonly mensagens = inject(MensagensService);
  private readonly projeto = inject(ProjetoService);

  readonly marcas = signal<Marca[]>([]);
  private readonly decoracoes = new Map<monaco.editor.ITextModel, string[]>();
  private readonly ouvindo = new WeakSet<monaco.editor.ITextModel>();
  private salvando: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      this.projeto.raiz();
      untracked(() => void this.carregar());
    });
    effect(() => {
      const m = this.projeto.mudancas();
      if (m && [...m.alterados, ...m.criados].some((c) => /[\\/]\.seedy[\\/]bookmarks\.json$/.test(c))) untracked(() => void this.carregar());
    });
    effect(() => {
      const marcas = this.marcas();
      const buffers = this.editor.buffers();
      untracked(() => this.desenhar(marcas, buffers.map((b) => ({ caminho: b.caminho, modelo: b.modelo }))));
    });
    if (isDevMode()) Object.assign(window, { seedyBookmarks: this });
  }

  // ---------- arquivo ----------

  private separador(): string {
    return (this.projeto.raiz() ?? '').includes('\\') ? '\\' : '/';
  }

  private arquivo(): string | null {
    const raiz = this.projeto.raiz();
    if (!raiz) return null;
    const sep = this.separador();
    return `${raiz.replace(/[\\/]+$/, '')}${sep}.seedy${sep}bookmarks.json`;
  }

  private async carregar(): Promise<void> {
    const caminho = this.arquivo();
    const texto = caminho ? await ponte.lerArquivo(caminho).catch(() => null) : null;
    try {
      const lido = texto ? JSON.parse(texto) : [];
      const marcas = (Array.isArray(lido) ? lido : []).filter((m): m is Marca => typeof m?.caminho === 'string' && Number.isInteger(m?.linha) && m.linha > 0);
      if (JSON.stringify(marcas) !== JSON.stringify(this.marcas())) this.marcas.set(marcas);
    } catch {
      this.marcas.set([]);
      this.mensagens.erro('.seedy/bookmarks.json inválido');
    }
  }

  private async salvar(marcas: Marca[]): Promise<void> {
    this.marcas.set(marcas);
    const caminho = this.arquivo();
    if (!caminho) return;
    await ponte.gravarArquivo(caminho, JSON.stringify(marcas, null, 2) + '\n').catch((e) => this.mensagens.erro(String(e)));
  }

  relativo(caminho: string): string {
    const raiz = (this.projeto.raiz() ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
    const c = caminho.replace(/\\/g, '/');
    return raiz && c.toLowerCase().startsWith(raiz.toLowerCase() + '/') ? c.slice(raiz.length + 1) : c;
  }

  private absoluto(rel: string): string {
    const raiz = (this.projeto.raiz() ?? '').replace(/[\\/]+$/, '');
    const sep = this.separador();
    return `${raiz}${sep}${rel.split('/').join(sep)}`;
  }

  // ---------- ações ----------

  /** Marca ou desmarca uma linha (por padrão, a do cursor; o clique na margem passa a dela). */
  async alternar(linhaDada?: number, caminhoDado?: string): Promise<void> {
    const caminho = caminhoDado ?? this.editor.ativo();
    const modelo = caminhoDado ? this.editor.buffers().find((b) => b.caminho === caminhoDado)?.modelo : this.editor.instancia?.getModel();
    const linha = linhaDada ?? this.editor.instancia?.getPosition()?.lineNumber;
    if (!modelo || !linha || !caminho || !this.projeto.raiz()) {
      this.mensagens.alerta('abra um arquivo do projeto para marcar uma linha');
      return;
    }
    const rel = this.relativo(caminho);
    const marcas = this.marcas();
    const ja = marcas.some((m) => m.caminho === rel && m.linha === linha);
    if (ja) {
      await this.salvar(marcas.filter((m) => !(m.caminho === rel && m.linha === linha)));
      this.mensagens.mostrar(`bookmark removido (${rel}:${linha})`);
    } else {
      const texto = modelo.getLineContent(linha).trim().slice(0, 80);
      await this.salvar([...marcas, { caminho: rel, linha, texto }]);
      this.mensagens.mostrar(`bookmark em ${rel}:${linha}`);
    }
  }

  /** Lista as marcas (ordem de arquivo e linha); escolher uma abre o arquivo na linha. */
  async listar(): Promise<void> {
    const marcas = [...this.marcas()].sort((a, b) => a.caminho.localeCompare(b.caminho) || a.linha - b.linha);
    if (!marcas.length) {
      this.mensagens.alerta('nenhum bookmark ainda: ␣ M marca a linha do cursor');
      return;
    }
    const alvo = await this.escolha.escolherUm<Marca | typeof LIMPAR>(
      'BOOKMARKS',
      [
        ...marcas.map((m) => ({ rotulo: `${m.caminho}:${m.linha}`, detalhe: m.texto, valor: m })),
        { rotulo: 'remover todos', detalhe: `${marcas.length} ${marcas.length === 1 ? 'marca' : 'marcas'}`, valor: LIMPAR },
      ],
      '⏎ vai até a linha · ␣ M na linha remove a marca',
    );
    if (alvo === LIMPAR) await this.salvar([]);
    else if (alvo) await this.editor.abrir(this.absoluto(alvo.caminho), alvo.linha);
  }

  // ---------- marcas no editor ----------

  private desenhar(marcas: Marca[], buffers: { caminho: string; modelo: monaco.editor.ITextModel }[]): void {
    for (const b of buffers) {
      if (b.modelo.isDisposed()) continue;
      const rel = this.relativo(b.caminho);
      const novas: monaco.editor.IModelDeltaDecoration[] = marcas
        .filter((m) => m.caminho === rel && m.linha <= b.modelo.getLineCount())
        .map((m) => ({
          range: new monaco.Range(m.linha, 1, m.linha, 1),
          options: { isWholeLine: true, className: 'bookmark-linha', linesDecorationsClassName: 'bookmark-margem', stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges },
        }));
      this.decoracoes.set(b.modelo, b.modelo.deltaDecorations(this.decoracoes.get(b.modelo) ?? [], novas));
      if (!this.ouvindo.has(b.modelo)) {
        this.ouvindo.add(b.modelo);
        b.modelo.onDidChangeContent(() => this.acompanhar(b.modelo, b.caminho));
      }
    }
    for (const modelo of [...this.decoracoes.keys()]) if (modelo.isDisposed()) this.decoracoes.delete(modelo);
  }

  /** O código mudou: as marcas do arquivo vão para onde as linhas foram. */
  private acompanhar(modelo: monaco.editor.ITextModel, caminho: string): void {
    if (this.salvando) clearTimeout(this.salvando);
    this.salvando = setTimeout(() => {
      this.salvando = null;
      const ids = this.decoracoes.get(modelo);
      if (!ids || modelo.isDisposed()) return;
      const rel = this.relativo(caminho);
      const linhas = ids.map((id) => modelo.getDecorationRange(id)?.startLineNumber).filter((l): l is number => !!l);
      const doArquivo = this.marcas().filter((m) => m.caminho === rel);
      if (linhas.length !== doArquivo.length) return;
      const ordenadas = [...linhas].sort((a, b) => a - b);
      const antigas = doArquivo.map((m) => m.linha).sort((a, b) => a - b);
      if (ordenadas.every((l, i) => l === antigas[i])) return;
      const novas = ordenadas.map((l) => ({ caminho: rel, linha: l, texto: modelo.getLineContent(l).trim().slice(0, 80) }));
      void this.salvar([...this.marcas().filter((m) => m.caminho !== rel), ...novas]);
    }, 600);
  }
}
