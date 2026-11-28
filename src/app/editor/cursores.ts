import { monaco } from './monaco';

/** O que do monaco-vim interessa aqui. */
interface Vim {
  on(evento: 'vim-mode-change', fn: (e: { mode: string }) => void): void;
}

/**
 * Vários cursores com o Vim. Ao entrar na inserção, o monaco-vim trata mais de um cursor
 * como bloco visual e os refaz em linhas seguidas; aqui `i`, `a`, `I` e `A` valem para os
 * cursores onde eles estão, e as outras entradas (`o`, `s`, `c`...) ficam só com o primeiro.
 */
export function ligarCursoresNoVim(instancia: monaco.editor.IStandaloneCodeEditor, hospedeiro: HTMLElement, vim: Vim): monaco.IDisposable {
  let antes: { tecla: string; selecoes: monaco.Selection[] } | null = null;
  // Na captura: as seleções como estavam antes de o Vim receber a tecla.
  const guardar = (e: KeyboardEvent) => {
    const selecoes = instancia.getSelections() ?? [];
    antes = selecoes.length > 1 ? { tecla: e.key, selecoes } : null;
  };
  hospedeiro.addEventListener('keydown', guardar, true);

  vim.on('vim-mode-change', (e) => {
    const guardado = antes;
    antes = null;
    if (e.mode !== 'insert' || !guardado) return;
    queueMicrotask(() => {
      const modelo = instancia.getModel();
      if (!modelo) return;
      const coluna: Record<string, (p: monaco.Position) => number> = {
        i: (p) => p.column,
        a: (p) => Math.min(p.column + 1, modelo.getLineMaxColumn(p.lineNumber)),
        I: (p) => modelo.getLineFirstNonWhitespaceColumn(p.lineNumber) || modelo.getLineMaxColumn(p.lineNumber),
        A: (p) => modelo.getLineMaxColumn(p.lineNumber),
      };
      const nova = coluna[guardado.tecla];
      if (!nova) {
        const primeira = instancia.getSelection();
        if (primeira) instancia.setSelections([primeira]);
        return;
      }
      instancia.setSelections(
        guardado.selecoes.map((s) => {
          const p = s.getPosition();
          const c = nova(p);
          return new monaco.Selection(p.lineNumber, c, p.lineNumber, c);
        }),
      );
    });
  });

  return { dispose: () => hospedeiro.removeEventListener('keydown', guardar, true) };
}
