import { monaco } from './monaco';
import { Tema } from '../tema/tema';

/**
 * Gera o tema do Monaco a partir do tema do Seedy.
 *
 * Segue a ideia do Alabaster: só quatro coisas ganham cor —
 * strings, constantes (números, true/false/null), comentários e definições.
 * Palavras-chave, tipos e o resto ficam na cor padrão do texto.
 * (Definições de verdade dependem do jdtls; até lá, só as que o Monarch reconhece.)
 */
export function definirTemaMonaco(tema: Tema): void {
  const s = tema.sintaxe;
  const c = tema.cores;
  const hex = (cor: string) => cor.replace('#', '');

  monaco.editor.defineTheme('seedy', {
    base: 'vs-dark',
    inherit: false,
    rules: [
      { token: '', foreground: hex(s.padrao), background: hex(c.painel) },
      { token: 'comment', foreground: hex(s.comentario) },
      { token: 'string', foreground: hex(s.string) },
      { token: 'string.escape', foreground: hex(s.string) },
      { token: 'attribute.value', foreground: hex(s.string) },
      { token: 'number', foreground: hex(s.constante) },
      { token: 'constant', foreground: hex(s.constante) },
      { token: 'keyword.true', foreground: hex(s.constante) },
      { token: 'keyword.false', foreground: hex(s.constante) },
      { token: 'keyword.null', foreground: hex(s.constante) },
      { token: 'type.identifier.definition', foreground: hex(s.definicao) },
      { token: 'entity.name.function', foreground: hex(s.definicao) },
      // Tokens semânticos do jdtls: declarações de classes, métodos e campos.
      { token: 'definicao', foreground: hex(s.definicao) },
      { token: 'tag', foreground: hex(s.padrao) },
      { token: 'keyword', foreground: hex(s.padrao) },
      { token: 'type', foreground: hex(s.padrao) },
      { token: 'delimiter', foreground: hex(s.padrao) },
      { token: 'annotation', foreground: hex(s.padrao) },
    ],
    colors: {
      'editor.background': c.painel,
      'editor.foreground': s.padrao,
      'editorGutter.background': c.painel,
      'editorLineNumber.foreground': c.textoSuave,
      'editorLineNumber.activeForeground': c.destaque,
      'editor.lineHighlightBackground': c.selecao,
      'editor.lineHighlightBorder': '#00000000',
      'editorCursor.foreground': c.destaque,
      'editorCursor.background': c.textoSobreDestaque,
      'editor.selectionBackground': c.destaque + '55',
      'editor.inactiveSelectionBackground': c.destaque + '30',
      'editor.findMatchBackground': c.aviso + '55',
      'editor.findMatchHighlightBackground': c.aviso + '30',
      // Alabaster: parênteses e chaves na cor do texto (sem arco-íris).
      ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`editorBracketHighlight.foreground${n}`, s.padrao])),
      'editorBracketHighlight.unexpectedBracket.foreground': c.erro,
      'editorBracketMatch.background': c.selecao,
      'editorBracketMatch.border': c.destaque,
      'editorIndentGuide.background1': '#00000000',
      'editorIndentGuide.activeBackground1': c.selecao,
      'editorWhitespace.foreground': c.selecao,
      'editorWidget.background': c.painelElevado,
      'editorWidget.border': c.borda,
      'editorSuggestWidget.background': c.painelElevado,
      'editorSuggestWidget.border': c.borda,
      'editorSuggestWidget.foreground': c.texto,
      'editorSuggestWidget.selectedBackground': c.selecao,
      'editorSuggestWidget.highlightForeground': c.destaque,
      'editorHoverWidget.background': c.painelElevado,
      'editorHoverWidget.border': c.borda,
      'editorError.foreground': c.erro,
      'editorWarning.foreground': c.aviso,
      'editorInfo.foreground': c.destaque,
      'editorGutter.addedBackground': c.sucesso,
      'editorGutter.modifiedBackground': c.destaque,
      'editorGutter.deletedBackground': c.erro,
      'scrollbar.shadow': '#00000000',
      'scrollbarSlider.background': c.selecao + 'aa',
      'scrollbarSlider.hoverBackground': c.selecao,
      'scrollbarSlider.activeBackground': c.destaque + '66',
      'focusBorder': '#00000000',
      'input.background': c.fundo,
      'input.foreground': c.texto,
      'input.border': c.borda,
      'input.placeholderForeground': c.textoSuave,
      'inputOption.activeBackground': c.destaque,
      'inputOption.activeForeground': c.textoSobreDestaque,
      'inputOption.activeBorder': c.borda,
      'inputValidation.errorBackground': c.erroFundo,
      'inputValidation.errorBorder': c.erro,
      'widget.shadow': '#00000000',
      'icon.foreground': c.textoSuave,
      'toolbar.hoverBackground': c.selecao,
      'editor.findRangeHighlightBackground': c.selecao,
      // Destaque das ocorrências do símbolo sob o cursor (jdtls).
      'editor.wordHighlightBackground': c.selecao,
      'editor.wordHighlightStrongBackground': c.selecao,
      'editor.wordHighlightBorder': c.destaque + '66',
      'editor.wordHighlightStrongBorder': c.destaque + '99',
      'editorLightBulb.foreground': c.aviso,
      'editorLightBulbAutoFix.foreground': c.destaque,
      // Painel de usos / prévia de definição (alt+F7, gr).
      'peekView.border': c.borda,
      'peekViewTitle.background': c.painelElevado,
      'peekViewTitleLabel.foreground': c.texto,
      'peekViewTitleDescription.foreground': c.textoSuave,
      'peekViewEditor.background': c.fundo,
      'peekViewEditorGutter.background': c.fundo,
      'peekViewEditor.matchHighlightBackground': c.destaque + '40',
      'peekViewResult.background': c.painelElevado,
      'peekViewResult.fileForeground': c.texto,
      'peekViewResult.lineForeground': c.textoSuave,
      'peekViewResult.selectionBackground': c.selecao,
      'peekViewResult.selectionForeground': c.texto,
      'peekViewResult.matchHighlightBackground': c.destaque + '40',
      'list.hoverBackground': c.selecao,
      'list.activeSelectionBackground': c.selecao,
      'list.activeSelectionForeground': c.texto,
      'list.inactiveSelectionBackground': c.selecao,
      'list.focusOutline': c.destaque,
      'list.highlightForeground': c.destaque,
      'quickInput.background': c.painelElevado,
      'quickInput.foreground': c.texto,
      'quickInputList.focusBackground': c.selecao,
      'pickerGroup.foreground': c.destaque,
    },
  });
  monaco.editor.setTheme('seedy');
}
