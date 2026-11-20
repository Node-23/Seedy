/**
 * Conversões entre os tipos do LSP (linhas/colunas a partir de 0) e os do
 * Monaco (a partir de 1). Só os pedaços do protocolo que o Seedy usa.
 */
import { monaco } from '../editor/monaco';

export interface PosicaoLsp {
  line: number;
  character: number;
}
export interface IntervaloLsp {
  start: PosicaoLsp;
  end: PosicaoLsp;
}
export interface EdicaoLsp {
  range: IntervaloLsp;
  newText: string;
}
export interface LocalLsp {
  uri: string;
  range: IntervaloLsp;
}
export interface EdicaoDeWorkspaceLsp {
  changes?: Record<string, EdicaoLsp[]>;
  documentChanges?: ({ textDocument: { uri: string }; edits: EdicaoLsp[] } | { kind: string })[];
}

export const paraPosicaoLsp = (p: monaco.IPosition): PosicaoLsp => ({ line: p.lineNumber - 1, character: p.column - 1 });

export const paraIntervalo = (r: IntervaloLsp): monaco.IRange => ({
  startLineNumber: r.start.line + 1,
  startColumn: r.start.character + 1,
  endLineNumber: r.end.line + 1,
  endColumn: r.end.character + 1,
});

export const paraIntervaloLsp = (r: monaco.IRange): IntervaloLsp => ({
  start: { line: r.startLineNumber - 1, character: r.startColumn - 1 },
  end: { line: r.endLineNumber - 1, character: r.endColumn - 1 },
});

export const paraEdicao = (e: EdicaoLsp): monaco.languages.TextEdit => ({ range: paraIntervalo(e.range), text: e.newText });

/**
 * URI no formato do Monaco. O jdtls manda `file:///C:/x`; o Monaco usa `file:///c%3A/x`.
 * Passar por `Uri.parse` deixa as duas iguais (é a chave dos modelos).
 */
export const uriMonaco = (uri: string): monaco.Uri => monaco.Uri.parse(uri);

/** Caminho no disco de uma URI `file:`, com a letra do drive em maiúscula no Windows. */
export function caminhoDaUri(uri: monaco.Uri): string {
  return uri.fsPath.replace(/^([a-z]):/, (_, letra: string) => `${letra.toUpperCase()}:`);
}

/** As edições de uma WorkspaceEdit agrupadas por arquivo (ignora criar/renomear arquivo). */
export function edicoesPorArquivo(edicao: EdicaoDeWorkspaceLsp): Map<string, EdicaoLsp[]> {
  const saida = new Map<string, EdicaoLsp[]>();
  const juntar = (uri: string, edits: EdicaoLsp[]) => {
    const chave = uriMonaco(uri).toString();
    saida.set(chave, [...(saida.get(chave) ?? []), ...edits]);
  };
  for (const [uri, edits] of Object.entries(edicao.changes ?? {})) juntar(uri, edits);
  for (const d of edicao.documentChanges ?? []) if ('textDocument' in d) juntar(d.textDocument.uri, d.edits);
  return saida;
}

/** Texto de hover/documentação do LSP (MarkupContent, MarkedString ou lista) em markdown. */
export function paraMarkdown(conteudo: any): monaco.IMarkdownString[] {
  if (!conteudo) return [];
  const lista = Array.isArray(conteudo) ? conteudo : [conteudo];
  return lista
    .map((c) => {
      if (typeof c === 'string') return { value: c };
      if ('kind' in c) return { value: c.kind === 'markdown' ? c.value : escaparMarkdown(c.value) };
      return { value: '```' + (c.language ?? '') + '\n' + c.value + '\n```' };
    })
    .filter((m) => m.value.trim());
}

const escaparMarkdown = (t: string) => t.replace(/[\\`*_{}[\]()#+\-.!]/g, '\\$&');

export function documentacao(doc: any): string | monaco.IMarkdownString | undefined {
  if (!doc) return undefined;
  return typeof doc === 'string' ? doc : paraMarkdown(doc)[0];
}

const K = monaco.languages.CompletionItemKind;
/** CompletionItemKind do LSP (1..25) → Monaco. */
const TIPOS_DE_COMPLETAR: Record<number, monaco.languages.CompletionItemKind> = {
  1: K.Text, 2: K.Method, 3: K.Function, 4: K.Constructor, 5: K.Field, 6: K.Variable, 7: K.Class,
  8: K.Interface, 9: K.Module, 10: K.Property, 11: K.Unit, 12: K.Value, 13: K.Enum, 14: K.Keyword,
  15: K.Snippet, 16: K.Color, 17: K.File, 18: K.Reference, 19: K.Folder, 20: K.EnumMember,
  21: K.Constant, 22: K.Struct, 23: K.Event, 24: K.Operator, 25: K.TypeParameter,
};
export const tipoDeCompletar = (k?: number) => (k ? (TIPOS_DE_COMPLETAR[k] ?? K.Text) : K.Text);

const S = monaco.languages.SymbolKind;
/** SymbolKind do LSP (1..26) → Monaco (mesma ordem, a partir de 0). */
export const tipoDeSimbolo = (k: number): monaco.languages.SymbolKind => (k >= 1 && k <= 26 ? k - 1 : S.Variable);

const M = monaco.MarkerSeverity;
export const gravidade = (s?: number) => (s === 1 ? M.Error : s === 2 ? M.Warning : s === 3 ? M.Info : M.Hint);

export interface DiagnosticoLsp {
  range: IntervaloLsp;
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
  tags?: number[];
}

export function paraMarcador(d: DiagnosticoLsp): monaco.editor.IMarkerData {
  return {
    ...paraIntervalo(d.range),
    severity: gravidade(d.severity),
    message: d.message,
    code: d.code !== undefined ? String(d.code) : undefined,
    source: d.source,
    tags: d.tags?.map((t) => (t === 1 ? monaco.MarkerTag.Unnecessary : monaco.MarkerTag.Deprecated)),
  };
}
