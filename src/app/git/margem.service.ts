import { effect, inject, Injectable, untracked } from '@angular/core';
import { monaco } from '../editor/monaco';
import { Buffer, EditorService } from '../editor/editor.service';
import { GitService } from './git.service';
import { diffDeLinhas } from './diff';

interface Acompanhado {
  modelo: monaco.editor.ITextModel;
  /** Linhas do arquivo no HEAD; null = o arquivo não é acompanhado pelo git. */
  base: string[] | null;
  ids: string[];
  inscricao: monaco.IDisposable;
  temporizador?: ReturnType<typeof setTimeout>;
}

/**
 * Marcas na margem do editor comparando o buffer com o último commit (HEAD):
 * barra verde = linhas novas, lavanda = alteradas, triângulo vermelho = apagadas.
 * Atualiza enquanto você digita e depois de commit/checkout/pull.
 */
@Injectable({ providedIn: 'root' })
export class MargemGitService {
  private readonly editor = inject(EditorService);
  private readonly git = inject(GitService);
  private readonly acompanhados = new Map<string, Acompanhado>();

  constructor() {
    effect(() => {
      const buffers = this.editor.buffers();
      untracked(() => this.sincronizar(buffers));
    });
    // Commit, checkout, pull, stash...: o HEAD mudou, as bases também.
    effect(() => {
      this.git.versao();
      this.git.estado();
      untracked(() => {
        for (const a of this.acompanhados.values()) void this.carregarBase(a);
      });
    });
  }

  private sincronizar(buffers: Buffer[]): void {
    const vivos = new Set<string>();
    for (const b of buffers) {
      if (b.somenteLeitura || b.modelo.isDisposed()) continue;
      const chave = b.modelo.uri.toString();
      vivos.add(chave);
      if (this.acompanhados.has(chave)) continue;
      const a: Acompanhado = {
        modelo: b.modelo,
        base: null,
        ids: [],
        inscricao: b.modelo.onDidChangeContent(() => this.agendar(a)),
      };
      this.acompanhados.set(chave, a);
      void this.carregarBase(a);
    }
    for (const [chave, a] of this.acompanhados) {
      if (vivos.has(chave)) continue;
      a.inscricao.dispose();
      clearTimeout(a.temporizador);
      this.acompanhados.delete(chave);
    }
  }

  private async carregarBase(a: Acompanhado): Promise<void> {
    const caminho = a.modelo.uri.fsPath;
    const relativo = this.git.relativo(caminho);
    if (!relativo) {
      a.base = null;
    } else {
      const r = await this.git.rodar(['show', `HEAD:${relativo}`]).then(
        (t) => t,
        () => null,
      );
      // Fora do HEAD: arquivo novo (tudo verde) ou ignorado pelo git (sem marcas).
      a.base = r !== null ? r.split(/\r?\n/) : this.git.letraDe(caminho) === '?' || this.git.letraDe(caminho) === 'A' ? [] : null;
      if (a.base && r !== null && r.endsWith('\n')) a.base.pop();
    }
    this.pintar(a);
  }

  private agendar(a: Acompanhado): void {
    clearTimeout(a.temporizador);
    a.temporizador = setTimeout(() => this.pintar(a), 250);
  }

  private pintar(a: Acompanhado): void {
    if (a.modelo.isDisposed()) return;
    const decoracoes: monaco.editor.IModelDeltaDecoration[] = [];
    if (a.base) {
      const atual = a.modelo.getLinesContent();
      if (atual.length && atual[atual.length - 1] === '') atual.pop();
      for (const m of diffDeLinhas(a.base, atual)) {
        const apagou = m.bInicio === m.bFim;
        const novo = m.aInicio === m.aFim;
        if (apagou) {
          const linha = Math.max(1, Math.min(m.bInicio, a.modelo.getLineCount()));
          decoracoes.push({ range: new monaco.Range(linha, 1, linha, 1), options: { linesDecorationsClassName: 'margem-git-apagou' } });
          continue;
        }
        decoracoes.push({
          range: new monaco.Range(m.bInicio + 1, 1, m.bFim, 1),
          options: { isWholeLine: true, linesDecorationsClassName: novo ? 'margem-git-novo' : 'margem-git-mudou' },
        });
      }
    }
    a.ids = a.modelo.deltaDecorations(a.ids, decoracoes);
  }
}
