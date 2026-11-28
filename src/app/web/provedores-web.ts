/**
 * Recursos do Monaco ligados aos servidores web (Fase 6): completar, hover, assinatura,
 * ir para a definição, usos, destacar, renomear, símbolos e ações rápidas (TypeScript +
 * correções do ESLint). TS/JS vão para o typescript-language-server; os templates .html
 * do Angular, para o Angular Language Service. Formatar é com o Prettier (ver prettier.ts).
 */
import { monaco } from '../editor/monaco';
import { EditorService } from '../editor/editor.service';
import {
  caminhoDaUri,
  documentacao,
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
} from '../java/conversao';
import type { WebLspService } from './web-lsp.service';

const LINGUAGENS = ['typescript', 'javascript', 'html'];
const CMD_EXECUTAR = 'seedy.web.executar';

export function registrarProvedoresWeb(web: WebLspService, editor: EditorService): void {
  const doc = (m: monaco.editor.ITextModel) => ({ uri: m.uri.toString() });
  const pos = (m: monaco.editor.ITextModel, p: monaco.IPosition) => ({ textDocument: doc(m), position: paraPosicaoLsp(p) });

  const locais = async (resultado: LocalLsp | LocalLsp[] | null | undefined): Promise<monaco.languages.Location[]> => {
    const lista = (Array.isArray(resultado) ? resultado : resultado ? [resultado] : []).map((l: any) =>
      'targetUri' in l ? { uri: l.targetUri, range: l.targetSelectionRange ?? l.targetRange } : l,
    ) as LocalLsp[];
    const saida: monaco.languages.Location[] = [];
    for (const l of lista) {
      const uri = uriMonaco(l.uri);
      if (uri.scheme === 'file' && (await editor.garantirModelo(caminhoDaUri(uri)))) saida.push({ uri, range: paraIntervalo(l.range) });
    }
    return saida;
  };

  for (const L of LINGUAGENS) {
    // ---------- completar ----------
    const originais = new WeakMap<monaco.languages.CompletionItem, { item: any; tipo: string }>();
    monaco.languages.registerCompletionItemProvider(L, {
      triggerCharacters: ['.', '"', "'", '/', '@', '<', '(', '[', ' ', '*', '#', '|', ':'],
      async provideCompletionItems(m, p, contexto, token) {
        const s = web.servidorDe(m);
        if (!s) return undefined;
        // Caractere que não é gatilho deste servidor: deixa para o próximo que o usuário digitar.
        if (contexto.triggerKind === monaco.languages.CompletionTriggerKind.TriggerCharacter && contexto.triggerCharacter && !s.gatilhos.includes(contexto.triggerCharacter)) return undefined;
        const r = await s.cliente
          .pedir(
            'textDocument/completion',
            { ...pos(m, p), context: { triggerKind: contexto.triggerKind + 1, triggerCharacter: contexto.triggerCharacter } },
            token,
          )
          .catch(() => null);
        const lista: any[] = Array.isArray(r) ? r : (r?.items ?? []);
        const palavra = m.getWordUntilPosition(p);
        const intervalo = new monaco.Range(p.lineNumber, palavra.startColumn, p.lineNumber, p.column);
        return {
          incomplete: !!r?.isIncomplete,
          suggestions: lista.map((i) => {
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
              range: edicao ? paraIntervalo(edicao.range ?? edicao.replace) : intervalo,
              additionalTextEdits: i.additionalTextEdits?.map(paraEdicao),
              commitCharacters: i.commitCharacters,
            };
            originais.set(item, { item: i, tipo: s.tipo });
            return item;
          }),
        };
      },
      async resolveCompletionItem(item, token) {
        const o = originais.get(item);
        const s = o ? web.servidor(o.tipo as 'ts' | 'angular') : null;
        if (!o || !s) return item;
        const r = await s.cliente.pedir('completionItem/resolve', o.item, token).catch(() => null);
        if (!r) return item;
        return {
          ...item,
          detail: r.detail ?? item.detail,
          documentation: documentacao(r.documentation) ?? item.documentation,
          additionalTextEdits: r.additionalTextEdits?.map(paraEdicao) ?? item.additionalTextEdits,
        };
      },
    });

    monaco.languages.registerHoverProvider(L, {
      async provideHover(m, p, token) {
        const s = web.servidorDe(m);
        const r = s ? await s.cliente.pedir('textDocument/hover', pos(m, p), token).catch(() => null) : null;
        if (!r?.contents) return null;
        return { contents: paraMarkdown(r.contents), range: r.range ? paraIntervalo(r.range) : undefined };
      },
    });

    monaco.languages.registerSignatureHelpProvider(L, {
      signatureHelpTriggerCharacters: ['(', ','],
      signatureHelpRetriggerCharacters: [')'],
      async provideSignatureHelp(m, p, token) {
        const s = web.servidorDe(m);
        const r = s ? await s.cliente.pedir('textDocument/signatureHelp', pos(m, p), token).catch(() => null) : null;
        if (!r?.signatures?.length) return null;
        return {
          value: {
            activeSignature: r.activeSignature ?? 0,
            activeParameter: r.activeParameter ?? 0,
            signatures: r.signatures.map((sg: any) => ({
              label: sg.label,
              documentation: documentacao(sg.documentation),
              parameters: (sg.parameters ?? []).map((pa: any) => ({ label: pa.label, documentation: documentacao(pa.documentation) })),
            })),
          },
          dispose() {},
        };
      },
    });

    const local = (metodo: string) => ({
      async provide(m: monaco.editor.ITextModel, p: monaco.Position, token: monaco.CancellationToken) {
        const s = web.servidorDe(m);
        return s ? locais(await s.cliente.pedir(metodo, pos(m, p), token).catch(() => null)) : null;
      },
    });
    monaco.languages.registerDefinitionProvider(L, { provideDefinition: local('textDocument/definition').provide });
    monaco.languages.registerTypeDefinitionProvider(L, { provideTypeDefinition: local('textDocument/typeDefinition').provide });
    monaco.languages.registerImplementationProvider(L, { provideImplementation: local('textDocument/implementation').provide });
    monaco.languages.registerReferenceProvider(L, {
      async provideReferences(m, p, ctx, token) {
        const s = web.servidorDe(m);
        return s ? locais(await s.cliente.pedir('textDocument/references', { ...pos(m, p), context: { includeDeclaration: ctx.includeDeclaration } }, token).catch(() => null)) : null;
      },
    });
    monaco.languages.registerDocumentHighlightProvider(L, {
      async provideDocumentHighlights(m, p, token) {
        const s = web.servidorDe(m);
        const r: { range: IntervaloLsp; kind?: number }[] | null = s ? await s.cliente.pedir('textDocument/documentHighlight', pos(m, p), token).catch(() => null) : null;
        return (r ?? []).map((h) => ({ range: paraIntervalo(h.range), kind: h.kind ? h.kind - 1 : undefined }));
      },
    });

    monaco.languages.registerDocumentSymbolProvider(L, {
      async provideDocumentSymbols(m, token) {
        const s = web.servidorDe(m);
        const r: any[] | null = s ? await s.cliente.pedir('textDocument/documentSymbol', { textDocument: doc(m) }, token).catch(() => null) : null;
        const converter = (x: any): monaco.languages.DocumentSymbol => ({
          name: x.name,
          detail: x.detail ?? '',
          kind: tipoDeSimbolo(x.kind),
          tags: [],
          range: paraIntervalo(x.range ?? x.location.range),
          selectionRange: paraIntervalo(x.selectionRange ?? x.location.range),
          children: (x.children ?? []).map(converter),
        });
        return (r ?? []).map(converter);
      },
    });

    monaco.languages.registerRenameProvider(L, {
      async provideRenameEdits(m, p, novoNome, token) {
        const s = web.servidorDe(m);
        const r = s ? await s.cliente.pedir('textDocument/rename', { ...pos(m, p), newName: novoNome }, token).catch(() => null) : null;
        if (!r) return { edits: [], rejectReason: 'não dá para renomear aqui' };
        const edicao = await edicaoDeWorkspace(r);
        editor.avisarRefatoracao(edicao.edits.map((e) => (e as monaco.languages.IWorkspaceTextEdit).resource));
        return edicao;
      },
      async resolveRenameLocation(m, p, token) {
        const s = web.servidorDe(m);
        const r = s ? await s.cliente.pedir('textDocument/prepareRename', pos(m, p), token).catch(() => null) : null;
        if (!r) return { range: new monaco.Range(p.lineNumber, p.column, p.lineNumber, p.column), text: '', rejectReason: 'não dá para renomear aqui' };
        const range = paraIntervalo(r.range ?? r);
        return { range, text: r.placeholder ?? m.getValueInRange(range) };
      },
    });

    // ---------- ações rápidas (TypeScript + ESLint) ----------
    monaco.languages.registerCodeActionProvider(L, {
      async provideCodeActions(m, intervalo, contexto, token) {
        const alvos = [web.servidorDe(m), /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(m.uri.path) ? web.servidor('eslint') : null].filter((x) => !!x);
        const diagnostics = contexto.markers.map((mk) => ({
          range: paraIntervaloLsp(mk),
          message: mk.message.replace(/^eslint: /, '').replace(/ \([^)]*\)$/, ''),
          severity: mk.severity === monaco.MarkerSeverity.Error ? 1 : mk.severity === monaco.MarkerSeverity.Warning ? 2 : 3,
          code: mk.code ? (typeof mk.code === 'string' ? mk.code : mk.code.value) : undefined,
          source: mk.source,
        }));
        const acoes: monaco.languages.CodeAction[] = [];
        for (const s of alvos) {
          const r: any[] | null = await s.cliente
            .pedir('textDocument/codeAction', { textDocument: doc(m), range: paraIntervaloLsp(intervalo), context: { diagnostics, only: contexto.only ? [contexto.only] : undefined } }, token)
            .catch(() => null);
          for (const a of r ?? []) {
            const comando = a.command && typeof a.command === 'object' ? a.command : 'command' in a && typeof a.command === 'string' ? a : null;
            acoes.push({
              title: s.tipo === 'eslint' ? `eslint: ${a.title}` : a.title,
              kind: a.kind,
              isPreferred: a.isPreferred,
              edit: a.edit ? await edicaoDeWorkspace(a.edit) : undefined,
              command: comando ? { id: CMD_EXECUTAR, title: a.title, arguments: [s.tipo, comando.command, comando.arguments ?? []] } : undefined,
            });
          }
        }
        return { actions: acoes, dispose() {} };
      },
    });
  }

  monaco.editor.registerCommand(CMD_EXECUTAR, async (_acessor, tipo: 'ts' | 'angular' | 'eslint', command: string, args: unknown[]) => {
    await web.servidor(tipo)?.cliente.pedir('workspace/executeCommand', { command, arguments: args }).catch(() => null);
  });

  async function edicaoDeWorkspace(e: any): Promise<monaco.languages.WorkspaceEdit> {
    const edits: monaco.languages.IWorkspaceTextEdit[] = [];
    const porArquivo: [string, any[]][] = e.changes
      ? Object.entries(e.changes)
      : (e.documentChanges ?? []).filter((d: any) => d.textDocument).map((d: any) => [d.textDocument.uri, d.edits]);
    for (const [uri, lista] of porArquivo) {
      const b = await editor.abrir(caminhoDaUri(uriMonaco(uri)), undefined, undefined, false);
      if (!b) continue;
      for (const t of lista) edits.push({ resource: b.modelo.uri, textEdit: paraEdicao(t), versionId: undefined });
    }
    return { edits };
  }
}
