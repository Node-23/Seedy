/**
 * Prettier nos projetos web (mockup 13): formatar (shift+alt+F / menu do Monaco) e, quando
 * o projeto tem configuração do Prettier, formatar ao salvar. Usa o Prettier do projeto
 * (ou o que o Seedy instalou) pelo núcleo.
 */
import { monaco } from '../editor/monaco';
import { Buffer, EditorService } from '../editor/editor.service';
import { ponte } from '../nucleo/ponte';
import type { WebLspService } from './web-lsp.service';

const LINGUAGENS = ['typescript', 'javascript', 'html', 'css', 'scss', 'less', 'json', 'markdown', 'yaml'];
const EXTENSOES = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|html|css|scss|less|json|md|ya?ml)$/i;

export function suportadoPeloPrettier(caminho: string): boolean {
  return EXTENSOES.test(caminho) && !/(^|[\\/])(package-lock\.json|node_modules[\\/])/.test(caminho);
}

/** Formata o texto do modelo; null = nada mudou (ou o Prettier falhou e já avisou). */
async function formatado(raiz: string, modelo: monaco.editor.ITextModel, caminho: string): Promise<string | null> {
  const texto = modelo.getValue();
  const novo = await ponte.web.formatar(raiz, caminho, texto);
  return novo === texto ? null : novo;
}

export function registrarPrettier(web: WebLspService, editor: EditorService, raiz: () => string | null, formatarAoSalvar: () => boolean = () => true): void {
  for (const L of LINGUAGENS) {
    monaco.languages.registerDocumentFormattingEditProvider(L, {
      displayName: 'Prettier',
      async provideDocumentFormattingEdits(modelo) {
        const r = raiz();
        if (!web.web() || !r || modelo.uri.scheme !== 'file') return [];
        const caminho = modelo.uri.fsPath;
        if (!suportadoPeloPrettier(caminho)) return [];
        const novo = await formatado(r, modelo, caminho);
        return novo === null ? [] : [{ range: modelo.getFullModelRange(), text: novo }];
      },
    });
  }

  // Ao salvar, só quando o projeto usa Prettier (tem .prettierrc ou "prettier" no package.json).
  editor.antesDeSalvar(async (b: Buffer) => {
    const r = raiz();
    if (!r || !formatarAoSalvar() || !web.web()?.prettier || !suportadoPeloPrettier(b.caminho)) return;
    const novo = await formatado(r, b.modelo, b.caminho);
    if (novo === null) return;
    const instancia = editor.instancia;
    const selecoes = instancia?.getModel() === b.modelo ? instancia.getSelections() : null;
    b.modelo.pushEditOperations(selecoes ?? [], [{ range: b.modelo.getFullModelRange(), text: novo }], () => selecoes);
  });
}
