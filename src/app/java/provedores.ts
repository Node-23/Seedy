/**
 * Liga o jdtls aos recursos do Monaco para a linguagem `java`: completar,
 * hover, assinatura, ir para definição/implementação, usos, destacar,
 * renomear, formatar, ações rápidas (inclui organizar imports), símbolos
 * do arquivo e tokens semânticos (só definições, no espírito do Alabaster).
 */
import { monaco } from '../editor/monaco';
import { EditorService } from '../editor/editor.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { JdtlsService } from './jdtls.service';
import {
  caminhoDaUri,
  documentacao,
  EdicaoDeWorkspaceLsp,
  edicoesPorArquivo,
  IntervaloLsp,
  LocalLsp,
  paraEdicao,
  paraIntervalo,
  paraIntervaloLsp,
  paraMarkdown,
  paraPosicaoLsp,
  tipoDeCompletar,
  tipoDeSimbolo,
  uriMonaco,
} from './conversao';

const L = 'java';
/** Comando do Monaco que executa um comando do jdtls (usado pelas ações rápidas). */
const CMD_EXECUTAR = 'seedy.jdtls.executar';
/** Comando do Monaco que abre o renomear no nome que o "extrair" acabou de criar. */
const CMD_RENOMEAR_EXTRAIDO = 'seedy.jdtls.renomearExtraido';

/**
 * Nome que o jdtls deu ao extrair: a declaração nova no texto inserido
 * (método `private int extracted(`, campo `private int size;`, variável `int size =`).
 */
export function nomeExtraido(edicao: EdicaoDeWorkspaceLsp): string | null {
  const textos = [...edicoesPorArquivo(edicao).values()].flat().map((e) => e.newText);
  const tipo = String.raw`[\w$<>\[\],.?]+(?:\s*<[^>]*>)?`;
  const padroes = [
    new RegExp(String.raw`(?:private|protected|public)\s+(?:static\s+)?(?:final\s+)?${tipo}\s+(\w+)\s*\(`),
    new RegExp(String.raw`(?:private|protected|public)\s+(?:static\s+)?(?:final\s+)?${tipo}\s+(\w+)\s*[;=]`),
    new RegExp(String.raw`(?:^|[\s;{])(?:final\s+)?(?:var|${tipo})\s+(\w+)\s*=`),
  ];
  for (const re of padroes) {
    for (const t of textos) {
      const m = re.exec(t);
      if (m) return m[1];
    }
  }
  return null;
}

/** Tipos (LSP) que contam como definição quando vêm com o modificador `declaration`. */
const TIPOS_DE_DEFINICAO = new Set([
  'class', 'interface', 'enum', 'enumMember', 'record', 'recordComponent', 'method', 'property', 'annotation', 'annotationMember',
]);

export function registrarProvedores(jdtls: JdtlsService, editor: EditorService, mensagens: MensagensService): void {
  const doc = (m: monaco.editor.ITextModel) => ({ uri: jdtls.uriLsp(m.uri) });
  const pos = (m: monaco.editor.ITextModel, p: monaco.IPosition) => ({ textDocument: doc(m), position: paraPosicaoLsp(p) });

  /** Garante modelos para os arquivos de destino (o Monaco precisa deles para prévias e listas). */
  const locais = async (resultado: LocalLsp | LocalLsp[] | null | undefined): Promise<monaco.languages.Location[]> => {
    const lista = (Array.isArray(resultado) ? resultado : resultado ? [resultado] : []).map((l: any) =>
      'targetUri' in l ? { uri: l.targetUri, range: l.targetSelectionRange ?? l.targetRange } : l,
    ) as LocalLsp[];
    const saida: monaco.languages.Location[] = [];
    for (const l of lista) {
      const uri = uriMonaco(l.uri);
      if (uri.scheme === 'file') {
        if (await editor.garantirModelo(caminhoDaUri(uri))) saida.push({ uri, range: paraIntervalo(l.range) });
      } else if (uri.scheme === 'jdt') {
        // Biblioteca ou JDK: o jdtls manda o código (fonte anexado ou decompilado).
        const modelo = await jdtls.modeloDeClasse(l.uri);
        if (modelo) saida.push({ uri: modelo.uri, range: paraIntervalo(l.range) });
        else mensagens.mostrar('o jdtls não tem o código desta classe');
      }
    }
    return saida;
  };

  /** WorkspaceEdit do LSP → Monaco, abrindo em segundo plano os arquivos que mudam. */
  const edicaoDeWorkspace = async (e: EdicaoDeWorkspaceLsp | null): Promise<monaco.languages.WorkspaceEdit> => {
    const edits: monaco.languages.IWorkspaceTextEdit[] = [];
    if (!e) return { edits };
    for (const [chave, lista] of edicoesPorArquivo(e)) {
      const uri = monaco.Uri.parse(chave);
      const b = await editor.abrir(caminhoDaUri(uri), undefined, undefined, false);
      if (!b) continue;
      for (const t of lista) edits.push({ resource: b.modelo.uri, textEdit: paraEdicao(t), versionId: undefined });
    }
    return { edits };
  };

  // ---------- completar ----------
  const originais = new WeakMap<monaco.languages.CompletionItem, any>();
  const paraItem = (i: any, intervaloPadrao: monaco.IRange): monaco.languages.CompletionItem => {
    const edicao = i.textEdit;
    const item: monaco.languages.CompletionItem = {
      label: i.labelDetails ? { label: i.label, detail: i.labelDetails.detail, description: i.labelDetails.description } : i.label,
      kind: tipoDeCompletar(i.kind),
      detail: i.detail,
      documentation: documentacao(i.documentation),
      sortText: i.sortText,
      filterText: i.filterText,
      preselect: i.preselect,
      tags: i.deprecated || i.tags?.includes(1) ? [monaco.languages.CompletionItemTag.Deprecated] : undefined,
      insertText: edicao?.newText ?? i.insertText ?? i.label,
      insertTextRules: i.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
      range: edicao ? paraIntervalo(edicao.range ?? edicao.replace) : intervaloPadrao,
      additionalTextEdits: i.additionalTextEdits?.map(paraEdicao),
      commitCharacters: i.commitCharacters,
    };
    pospor(item, intervaloPadrao);
    originais.set(item, i);
    return item;
  };

  /**
   * Templates "postfix" (`feira.nnull` → `if (feira != null)`) trocam a expressão
   * inteira; o Monaco os pontua contra "feira." e eles passam na frente dos métodos.
   * Aqui a inserção fica só na palavra depois do ponto e apagar a expressão vira
   * uma edição adicional: mesmo resultado, mas no fim da lista (como no IntelliJ).
   */
  const pospor = (item: monaco.languages.CompletionItem, palavra: monaco.IRange) => {
    const r = item.range as monaco.IRange;
    const comecaAntes = r.startLineNumber === palavra.startLineNumber && r.startColumn < palavra.startColumn;
    if (!comecaAntes || r.endLineNumber !== palavra.endLineNumber) return;
    item.additionalTextEdits = [
      { range: new monaco.Range(r.startLineNumber, r.startColumn, palavra.startLineNumber, palavra.startColumn), text: '' },
      ...(item.additionalTextEdits ?? []),
    ];
    item.range = { ...palavra, endColumn: Math.max(palavra.endColumn, r.endColumn) };
    item.filterText = typeof item.label === 'string' ? item.label : item.label.label;
    item.sortText = `~${item.sortText ?? ''}`;
  };

  monaco.languages.registerCompletionItemProvider(L, {
    get triggerCharacters() {
      return jdtls.gatilhos;
    },
    async provideCompletionItems(m, p, contexto, cancel) {
      const c = jdtls.cliente();
      if (!c) return { suggestions: [] };
      const r = await c.pedir(
        'textDocument/completion',
        { ...pos(m, p), context: { triggerKind: contexto.triggerKind + 1, triggerCharacter: contexto.triggerCharacter } },
        cancel,
      );
      const palavra = m.getWordUntilPosition(p);
      const padrao = { startLineNumber: p.lineNumber, startColumn: palavra.startColumn, endLineNumber: p.lineNumber, endColumn: p.column };
      const itens = Array.isArray(r) ? r : (r?.items ?? []);
      return { suggestions: itens.map((i: any) => paraItem(i, padrao)), incomplete: !!r?.isIncomplete };
    },
    async resolveCompletionItem(item, cancel) {
      const c = jdtls.cliente();
      const original = originais.get(item);
      if (!c || !original) return item;
      const r = await c.pedir('completionItem/resolve', original, cancel);
      return {
        ...item,
        detail: r?.detail ?? item.detail,
        documentation: documentacao(r?.documentation) ?? item.documentation,
        additionalTextEdits: r?.additionalTextEdits?.map(paraEdicao) ?? item.additionalTextEdits,
      };
    },
  });

  // ---------- hover e assinatura ----------
  monaco.languages.registerHoverProvider(L, {
    async provideHover(m, p, cancel) {
      const r = await jdtls.cliente()?.pedir('textDocument/hover', pos(m, p), cancel);
      if (!r?.contents) return null;
      return { contents: paraMarkdown(r.contents), range: r.range ? paraIntervalo(r.range) : undefined };
    },
  });

  monaco.languages.registerSignatureHelpProvider(L, {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [')'],
    async provideSignatureHelp(m, p, cancel) {
      const r = await jdtls.cliente()?.pedir('textDocument/signatureHelp', pos(m, p), cancel);
      if (!r?.signatures?.length) return null;
      return {
        value: {
          activeSignature: r.activeSignature ?? 0,
          activeParameter: r.activeParameter ?? 0,
          signatures: r.signatures.map((s: any) => ({
            label: s.label,
            documentation: documentacao(s.documentation),
            parameters: (s.parameters ?? []).map((pa: any) => ({ label: pa.label, documentation: documentacao(pa.documentation) })),
            activeParameter: s.activeParameter,
          })),
        },
        dispose: () => {},
      };
    },
  });

  // ---------- navegação ----------
  monaco.languages.registerDefinitionProvider(L, {
    provideDefinition: async (m, p, cancel) => locais(await jdtls.cliente()?.pedir('textDocument/definition', pos(m, p), cancel)),
  });
  monaco.languages.registerTypeDefinitionProvider(L, {
    provideTypeDefinition: async (m, p, cancel) => locais(await jdtls.cliente()?.pedir('textDocument/typeDefinition', pos(m, p), cancel)),
  });
  monaco.languages.registerImplementationProvider(L, {
    provideImplementation: async (m, p, cancel) => locais(await jdtls.cliente()?.pedir('textDocument/implementation', pos(m, p), cancel)),
  });
  monaco.languages.registerReferenceProvider(L, {
    provideReferences: async (m, p, ctx, cancel) =>
      locais(await jdtls.cliente()?.pedir('textDocument/references', { ...pos(m, p), context: ctx }, cancel)),
  });
  monaco.languages.registerDocumentHighlightProvider(L, {
    async provideDocumentHighlights(m, p, cancel) {
      const r = await jdtls.cliente()?.pedir('textDocument/documentHighlight', pos(m, p), cancel);
      return (r ?? []).map((h: { range: IntervaloLsp; kind?: number }) => ({ range: paraIntervalo(h.range), kind: (h.kind ?? 1) - 1 }));
    },
  });

  monaco.languages.registerDocumentSymbolProvider(L, {
    displayName: 'jdtls',
    async provideDocumentSymbols(m, cancel) {
      const r = await jdtls.cliente()?.pedir('textDocument/documentSymbol', { textDocument: doc(m) }, cancel);
      const converter = (s: any): monaco.languages.DocumentSymbol => ({
        name: s.name,
        detail: s.detail ?? '',
        kind: tipoDeSimbolo(s.kind),
        tags: [],
        range: paraIntervalo(s.range ?? s.location.range),
        selectionRange: paraIntervalo(s.selectionRange ?? s.location.range),
        children: (s.children ?? []).map(converter),
      });
      return (r ?? []).map(converter);
    },
  });

  // ---------- edição ----------
  monaco.languages.registerRenameProvider(L, {
    async provideRenameEdits(m, p, novoNome, cancel) {
      const c = jdtls.cliente();
      if (!c) return { edits: [] };
      const r = await c.pedir('textDocument/rename', { ...pos(m, p), newName: novoNome }, cancel);
      const edicao = await edicaoDeWorkspace(r);
      const arquivos = new Set(edicao.edits.map((e) => (e as monaco.languages.IWorkspaceTextEdit).resource.toString())).size;
      if (arquivos > 1) mensagens.mostrar(`renomeado em ${arquivos} arquivos — :wa (ou ctrl+shift+s) grava todos`);
      return edicao;
    },
    async resolveRenameLocation(m, p, cancel) {
      const c = jdtls.cliente();
      if (!c) return { range: new monaco.Range(p.lineNumber, p.column, p.lineNumber, p.column), text: '', rejectReason: 'jdtls não está pronto' };
      const r = await c.pedir('textDocument/prepareRename', pos(m, p), cancel).catch(() => null);
      if (!r) {
        return { range: new monaco.Range(p.lineNumber, p.column, p.lineNumber, p.column), text: '', rejectReason: 'não dá para renomear isto' };
      }
      const intervalo = paraIntervalo('range' in r ? r.range : r);
      return { range: intervalo, text: 'placeholder' in r ? r.placeholder : m.getValueInRange(intervalo) };
    },
  });

  monaco.languages.registerDocumentFormattingEditProvider(L, {
    displayName: 'jdtls',
    async provideDocumentFormattingEdits(m, opcoes, cancel) {
      const r = await jdtls.cliente()?.pedir(
        'textDocument/formatting',
        { textDocument: doc(m), options: { tabSize: opcoes.tabSize, insertSpaces: opcoes.insertSpaces } },
        cancel,
      );
      return (r ?? []).map(paraEdicao);
    },
  });
  monaco.languages.registerDocumentRangeFormattingEditProvider(L, {
    displayName: 'jdtls',
    async provideDocumentRangeFormattingEdits(m, intervalo, opcoes, cancel) {
      const r = await jdtls.cliente()?.pedir(
        'textDocument/rangeFormatting',
        { textDocument: doc(m), range: paraIntervaloLsp(intervalo), options: { tabSize: opcoes.tabSize, insertSpaces: opcoes.insertSpaces } },
        cancel,
      );
      return (r ?? []).map(paraEdicao);
    },
  });

  // ---------- ações rápidas (alt+enter) e organizar imports ----------
  monaco.editor.registerCommand(CMD_EXECUTAR, async (_acessor, comando: { command: string; arguments?: unknown[] }) => {
    const c = jdtls.cliente();
    if (!c) return;
    if (comando.command === 'java.apply.workspaceEdit' && comando.arguments?.[0]) {
      await jdtls.aplicarEdicao(comando.arguments[0] as EdicaoDeWorkspaceLsp);
      return;
    }
    await c.pedir('workspace/executeCommand', { command: comando.command, arguments: comando.arguments }).catch((e) => mensagens.erro(`jdtls: ${e.message ?? e}`));
  });

  // Depois de extrair: põe o cursor no nome gerado mais perto de onde foi pedido e abre o renomear.
  monaco.editor.registerCommand(CMD_RENOMEAR_EXTRAIDO, (_acessor, args: { nome: string; linha: number }) => {
    const ed = editor.instancia;
    const m = ed?.getModel();
    if (!ed || !m) return;
    const achados = m.findMatches(`\\b${args.nome}\\b`, false, true, true, null, false);
    const perto = achados.sort(
      (a, b) => Math.abs(a.range.startLineNumber - args.linha) - Math.abs(b.range.startLineNumber - args.linha),
    )[0];
    if (!perto) return;
    ed.setPosition({ lineNumber: perto.range.startLineNumber, column: perto.range.startColumn });
    ed.focus();
    // Espera o jdtls receber o texto novo (didChange) antes de pedir o renomear.
    setTimeout(() => ed.trigger('extrair', 'editor.action.rename', null), 150);
  });

  const originaisDeAcao = new WeakMap<monaco.languages.CodeAction, any>();
  const paraAcao = async (a: any): Promise<monaco.languages.CodeAction> => {
    // Sem "kind", é um Command solto (formato antigo do LSP).
    if (typeof a.command === 'string') {
      return { title: a.title, command: { id: CMD_EXECUTAR, title: a.title, arguments: [a] } };
    }
    const acao: monaco.languages.CodeAction = {
      title: a.title,
      kind: a.kind,
      isPreferred: a.isPreferred,
      disabled: a.disabled?.reason,
      diagnostics: a.diagnostics?.map((d: any) => ({ ...paraIntervalo(d.range), message: d.message, severity: monaco.MarkerSeverity.Error })),
      // A edição só é convertida em resolveCodeAction, ao aplicar: listar ações
      // (a lâmpada) não pode abrir os arquivos que elas tocariam.
      command: a.command ? { id: CMD_EXECUTAR, title: a.command.title, arguments: [a.command] } : undefined,
    };
    originaisDeAcao.set(acao, a);
    return acao;
  };

  monaco.languages.registerCodeActionProvider(
    L,
    {
      async provideCodeActions(m, intervalo, contexto, cancel) {
        const c = jdtls.cliente();
        if (!c) return { actions: [], dispose: () => {} };
        const intervaloLsp = paraIntervaloLsp(intervalo);
        const r = await c.pedir(
          'textDocument/codeAction',
          {
            textDocument: doc(m),
            range: intervaloLsp,
            context: {
              diagnostics: jdtls.diagnosticosEm(m.uri.toString(), intervaloLsp),
              only: contexto.only ? [contexto.only] : undefined,
              triggerKind: contexto.trigger,
            },
          },
          cancel,
        );
        // Lembra onde foi pedida (para achar o nome extraído depois).
        for (const a of r ?? []) a.__linha = intervalo.startLineNumber;
        return { actions: await Promise.all((r ?? []).map(paraAcao)), dispose: () => {} };
      },
      async resolveCodeAction(acao, cancel) {
        const original = originaisDeAcao.get(acao);
        const c = jdtls.cliente();
        if (!original || !c) return acao;
        const { __linha: _linha, ...paraOJdtls } = original;
        const edicao: EdicaoDeWorkspaceLsp | undefined = original.edit ?? (await c.pedir('codeAction/resolve', paraOJdtls, cancel))?.edit;
        // O Monaco só copia `edit` do resultado: muda a própria ação.
        acao.edit = edicao ? await edicaoDeWorkspace(edicao) : undefined;
        // Extrair variável/método/campo: o jdtls inventa o nome ("size", "extracted");
        // depois de aplicar, já abre o renomear nele, como o IntelliJ.
        const nome = String(original.kind ?? '').startsWith('refactor.extract') && edicao ? nomeExtraido(edicao) : null;
        if (nome && !acao.command) {
          acao.command = { id: CMD_RENOMEAR_EXTRAIDO, title: 'renomear', arguments: [{ nome, linha: original.__linha }] };
        }
        return acao;
      },
    },
    { providedCodeActionKinds: ['quickfix', 'refactor', 'source', 'source.organizeImports'] },
  );

  // ---------- tokens semânticos: só definições ganham cor (Alabaster) ----------
  monaco.languages.registerDocumentSemanticTokensProvider(L, {
    getLegend: () => ({ tokenTypes: ['definicao'], tokenModifiers: [] }),
    async provideDocumentSemanticTokens(m, _ultimo, cancel) {
      const legenda = jdtls.legenda;
      const r = await jdtls.cliente()?.pedir('textDocument/semanticTokens/full', { textDocument: doc(m) }, cancel);
      if (!r?.data || !legenda) return null;
      return { data: soDefinicoes(r.data, legenda), resultId: undefined };
    },
    releaseDocumentSemanticTokens: () => {},
  });
}

/**
 * Filtra os tokens do jdtls (formato relativo: Δlinha, Δcoluna, tamanho, tipo, modificadores)
 * para ficar só com declarações de classes, métodos e campos, todas com o tipo 0 ("definicao").
 */
export function soDefinicoes(dados: number[], legenda: { tokenTypes: string[]; tokenModifiers: string[] }): Uint32Array {
  const bitDeclaracao = legenda.tokenModifiers.indexOf('declaration');
  if (bitDeclaracao < 0) return new Uint32Array();
  const saida: number[] = [];
  let linha = 0;
  let coluna = 0;
  let ultimaLinha = 0;
  let ultimaColuna = 0;
  for (let i = 0; i + 4 < dados.length; i += 5) {
    const [dLinha, dColuna, tamanho, tipo, mods] = dados.slice(i, i + 5);
    linha += dLinha;
    coluna = dLinha ? dColuna : coluna + dColuna;
    const ehDefinicao = TIPOS_DE_DEFINICAO.has(legenda.tokenTypes[tipo]) && (mods & (1 << bitDeclaracao)) !== 0;
    if (!ehDefinicao) continue;
    saida.push(linha - ultimaLinha, linha === ultimaLinha ? coluna - ultimaColuna : coluna, tamanho, 0, 0);
    ultimaLinha = linha;
    ultimaColuna = coluna;
  }
  return new Uint32Array(saida);
}
