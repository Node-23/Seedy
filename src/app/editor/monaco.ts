/**
 * Ponto único de entrada do Monaco: configura os web workers e reexporta a API.
 * Todo o resto do app importa o Monaco daqui.
 */
import * as monaco from 'monaco-editor';

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_id: string, rotulo: string) {
    switch (rotulo) {
      case 'typescript':
      case 'javascript':
        return new Worker(new URL('./trabalhadores/ts.worker', import.meta.url), { type: 'module' });
      case 'css':
      case 'scss':
      case 'less':
        return new Worker(new URL('./trabalhadores/css.worker', import.meta.url), { type: 'module' });
      case 'html':
      case 'handlebars':
      case 'razor':
        return new Worker(new URL('./trabalhadores/html.worker', import.meta.url), { type: 'module' });
      case 'json':
        return new Worker(new URL('./trabalhadores/json.worker', import.meta.url), { type: 'module' });
      default:
        return new Worker(new URL('./trabalhadores/editor.worker', import.meta.url), { type: 'module' });
    }
  },
};

/**
 * Todo diff passa por aqui. Cada editor criado passa a ser a "fábrica" das dicas flutuantes do
 * Monaco, que é global; o diff é descartado depois, e aí menus como o das ações rápidas abriam
 * vazios ("InstantiationService has been disposed"). Criar um editor comum em seguida devolve a
 * fábrica aos serviços que nunca são descartados.
 */
export function criarEditorDeDiff(hospedeiro: HTMLElement, opcoes: monaco.editor.IStandaloneDiffEditorConstructionOptions): monaco.editor.IStandaloneDiffEditor {
  const diff = monaco.editor.createDiffEditor(hospedeiro, opcoes);
  monaco.editor.create(document.createElement('div'), { model: null }).dispose();
  return diff;
}

export { monaco };
