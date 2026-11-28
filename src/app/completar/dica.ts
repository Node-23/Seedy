import * as monaco from 'monaco-editor';

/**
 * A caixinha "Tab aceitar · esc descartar" embaixo da sugestão (mockup 37). Aparece quando o
 * Monaco está mostrando texto fantasma e some com ele.
 */
export function ligarDicaDoCompletar(instancia: monaco.editor.IStandaloneCodeEditor, detalhe: () => string): monaco.IDisposable {
  const caixa = document.createElement('div');
  caixa.className = 'completar-dica';
  let linha = 0;
  let visivel = false;
  const widget: monaco.editor.IContentWidget = {
    getId: () => `seedy.completar.${instancia.getId()}`,
    getDomNode: () => caixa,
    // Dentro do editor: perto da borda, o Monaco a puxa para a esquerda.
    allowEditorOverflow: false,
    getPosition: () => ({
      position: { lineNumber: linha, column: 1 },
      preference: [monaco.editor.ContentWidgetPositionPreference.BELOW],
    }),
  };

  const esconder = () => {
    if (!visivel) return;
    visivel = false;
    instancia.removeContentWidget(widget);
  };

  const conferir = () => {
    // O Monaco não avisa por evento; o elemento do texto fantasma diz se ele está na tela.
    const fantasma = instancia.getContainerDomNode().querySelector('.ghost-text-decoration, .ghost-text');
    const posicao = instancia.getPosition();
    const modelo = instancia.getModel();
    if (!fantasma || !posicao || !modelo) return esconder();
    const nova = Math.min(modelo.getLineCount(), posicao.lineNumber + 1);
    // Só mexe no DOM quando muda: quem observa é o próprio DOM do editor.
    const texto = detalhe();
    if (caixa.dataset['detalhe'] !== texto) {
      caixa.dataset['detalhe'] = texto;
      caixa.innerHTML = `<span><kbd>Tab</kbd> aceitar</span><span><kbd>Ctrl+→</kbd> palavra</span><span><kbd>esc</kbd> descartar</span><span class="suave"></span>`;
      caixa.lastElementChild!.textContent = texto;
    }
    if (visivel && nova === linha) return;
    esconder();
    linha = nova;
    visivel = true;
    instancia.addContentWidget(widget);
  };

  // O texto fantasma entra no DOM depois do evento: confere no próximo quadro.
  let agendado = 0;
  const agendar = () => {
    cancelAnimationFrame(agendado);
    agendado = requestAnimationFrame(conferir);
  };
  const observador = new MutationObserver(agendar);
  // O container existe desde o começo; as linhas, só depois que há um arquivo.
  observador.observe(instancia.getContainerDomNode(), { subtree: true, childList: true });
  const foco = instancia.onDidBlurEditorText(esconder);
  return {
    dispose: () => {
      observador.disconnect();
      cancelAnimationFrame(agendado);
      foco.dispose();
      esconder();
    },
  };
}
