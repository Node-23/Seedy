import { inject, Injectable } from '@angular/core';
import { monaco } from '../editor/monaco';
import { EditorService } from '../editor/editor.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { ponte } from '../nucleo/ponte';
import { GitService } from './git.service';
import { dataCurta } from './tempo';

interface LinhaDeBlame {
  hash: string;
  autor: string;
  data: number;
  resumo: string;
}

const LARGURA_AUTOR = 12;

/**
 * Anotações do git (blame), como o "Annotate" do IntelliJ: autor e data no começo
 * de cada bloco de linhas do mesmo commit, e o commit no hover. Alterna com Alt+Shift+K.
 * Usa o texto do buffer (com o que ainda não foi salvo).
 */
@Injectable({ providedIn: 'root' })
export class BlameService {
  private readonly editor = inject(EditorService);
  private readonly git = inject(GitService);
  private readonly mensagens = inject(MensagensService);
  /** Decorações ativas por modelo. */
  private readonly ativos = new Map<string, string[]>();

  async alternar(): Promise<void> {
    const modelo = this.editor.instancia?.getModel();
    if (!modelo) return;
    const chave = modelo.uri.toString();
    const ids = this.ativos.get(chave);
    if (ids) {
      modelo.deltaDecorations(ids, []);
      this.ativos.delete(chave);
      return;
    }
    const relativo = this.git.relativo(modelo.uri.fsPath);
    const raiz = this.git.estado()?.raiz;
    if (!relativo || !raiz) {
      this.mensagens.alerta('este arquivo não está num repositório git');
      return;
    }
    const r = await ponte.git(raiz, ['blame', '--porcelain', '--contents', '-', '--', relativo], modelo.getValue());
    if (r.codigo !== 0) {
      this.mensagens.erro(`blame: ${(r.erro || r.saida).trim().split('\n')[0]}`);
      return;
    }
    const linhas = lerBlame(r.saida);
    const decoracoes: monaco.editor.IModelDeltaDecoration[] = [];
    let anterior = '';
    linhas.forEach((l, i) => {
      if (!l || i >= modelo.getLineCount()) return;
      const novo = l.hash !== anterior;
      anterior = l.hash;
      const naoCommitado = /^0+$/.test(l.hash);
      const texto = novo
        ? `${(naoCommitado ? 'você' : l.autor).slice(0, LARGURA_AUTOR).padEnd(LARGURA_AUTOR)} ${naoCommitado ? 'não salvo' : dataCurta(l.data)}`
        : '';
      decoracoes.push({
        range: new monaco.Range(i + 1, 1, i + 1, 1),
        options: {
          before: { content: texto.padEnd(LARGURA_AUTOR + 15) + ' ', inlineClassName: novo ? 'blame-anotacao inicio' : 'blame-anotacao' },
          // Intervalo vazio (início da linha): sem isto o Monaco não desenha.
          showIfCollapsed: true,
          hoverMessage: naoCommitado ? { value: 'ainda não commitado' } : { value: `**${l.hash.slice(0, 7)}** ${l.resumo}\n\n${l.autor} · ${dataCurta(l.data)}` },
        },
      });
    });
    this.ativos.set(chave, modelo.deltaDecorations([], decoracoes));
  }
}

/** `git blame --porcelain` → dados de cada linha final (índice 0 = linha 1). */
export function lerBlame(saida: string): LinhaDeBlame[] {
  const commits = new Map<string, LinhaDeBlame>();
  const porLinha: LinhaDeBlame[] = [];
  let atual: { hash: string; linha: number } | null = null;
  for (const l of saida.split(/\r?\n/)) {
    const cab = /^([0-9a-f]{40}) \d+ (\d+)/.exec(l);
    if (cab) {
      atual = { hash: cab[1], linha: Number(cab[2]) };
      if (!commits.has(cab[1])) commits.set(cab[1], { hash: cab[1], autor: '', data: 0, resumo: '' });
      continue;
    }
    if (!atual) continue;
    const c = commits.get(atual.hash)!;
    if (l.startsWith('author ')) c.autor = l.slice(7);
    else if (l.startsWith('author-time ')) c.data = Number(l.slice(12));
    else if (l.startsWith('summary ')) c.resumo = l.slice(8);
    else if (l.startsWith('\t')) porLinha[atual.linha - 1] = c;
  }
  return porLinha;
}
