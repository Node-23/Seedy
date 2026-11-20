import { monaco } from '../editor/monaco';

/**
 * Coloração da prévia da busca, com os mesmos tokens do Monaco, mas em HTML
 * comum: assim dá para sublinhar o termo buscado por cima da sintaxe.
 * Segue o Alabaster: só comentário, string, constante e definição ganham cor.
 */
function classeDoToken(tipo: string): string {
  if (tipo.startsWith('comment')) return 'sx-comentario';
  if (tipo.startsWith('string') || tipo.startsWith('attribute.value')) return 'sx-string';
  if (tipo.startsWith('number') || tipo.startsWith('constant') || /^keyword\.(true|false|null)/.test(tipo)) {
    return 'sx-constante';
  }
  if (tipo.startsWith('type.identifier.definition') || tipo.startsWith('entity.name.function')) return 'sx-definicao';
  return '';
}

/** Para arquivos muito grandes, colore só a janela visível (pode errar comentários de bloco). */
const MAXIMO_DE_LINHAS_COM_CONTEXTO = 5000;

/** Classe de sintaxe de cada caractere das linhas [inicio, fim) do texto. */
export async function classesDeSintaxe(
  linhas: string[],
  inicio: number,
  fim: number,
  linguagem: string,
): Promise<string[][]> {
  // colorize espera a gramática carregar; tokenize, sozinho, não espera.
  await monaco.editor.colorize('', linguagem, {});
  const desde = fim > MAXIMO_DE_LINHAS_COM_CONTEXTO ? inicio : 0;
  const tokens = monaco.editor.tokenize(linhas.slice(desde, fim).join('\n'), linguagem);
  const saida: string[][] = [];
  for (let n = inicio; n < fim; n++) {
    const linha = linhas[n];
    const classes = new Array<string>(linha.length).fill('');
    const ts = tokens[n - desde] ?? [];
    ts.forEach((t, k) => {
      const ate = Math.min(ts[k + 1]?.offset ?? linha.length, linha.length);
      const classe = classeDoToken(t.type);
      for (let c = t.offset; c < ate; c++) classes[c] = classe;
    });
    saida.push(classes);
  }
  return saida;
}

export interface Pedaco {
  texto: string;
  classe: string;
}

export interface LinhaPrevia {
  numero: number;
  alvo: boolean;
  pedacos: Pedaco[];
  /** Prévia de substituição: a linha de antes ("sai") e a de depois ("entra"). */
  tipo?: 'sai' | 'entra';
}

export interface Previa {
  /** Linha em destaque (1 = começo do arquivo). */
  linha: number;
  linhas: LinhaPrevia[];
}

export interface PedidoDePrevia {
  conteudo: string;
  linguagem: string;
  /** Linha em destaque; sem ela, a prévia mostra o começo do arquivo. */
  linha?: number;
  /** O que sublinhar ('casado') e o que pintar como definição, em cada linha. */
  marcas: (texto: string, alvo: boolean) => { casado?: Iterable<number>; definicao?: Iterable<number> };
  linhasAntes?: number;
  maximo?: number;
}

/** Trecho do arquivo em volta da linha, já colorido e com as marcas aplicadas. */
export async function montarPrevia(p: PedidoDePrevia): Promise<Previa> {
  const linhas = p.conteudo.split(/\r?\n/);
  const alvo = Math.min(Math.max(p.linha ?? 1, 1), linhas.length);
  const inicio = Math.max(0, alvo - 1 - (p.linha ? (p.linhasAntes ?? 3) : 0));
  const fim = Math.min(linhas.length, inicio + (p.maximo ?? 40));
  const sintaxe = await classesDeSintaxe(linhas, inicio, fim, p.linguagem);

  const saida: LinhaPrevia[] = [];
  for (let n = inicio; n < fim; n++) {
    const texto = linhas[n];
    const ehAlvo = !!p.linha && n + 1 === alvo;
    const m = p.marcas(texto, ehAlvo);
    const casado = new Set(m.casado ?? []);
    const definicao = new Set(m.definicao ?? []);
    const classes = sintaxe[n - inicio];
    saida.push({
      numero: n + 1,
      alvo: ehAlvo,
      pedacos: emPedacos(texto || ' ', (i) =>
        [definicao.has(i) ? 'sx-definicao' : (classes[i] ?? ''), casado.has(i) ? 'casado' : ''].join(' ').trim(),
      ),
    });
  }
  return { linha: alvo, linhas: saida };
}

/** Junta caracteres vizinhos com a mesma classe num pedaço só. */
export function emPedacos(texto: string, classeDe: (i: number) => string): Pedaco[] {
  const saida: Pedaco[] = [];
  for (let i = 0; i < texto.length; i++) {
    const classe = classeDe(i);
    const ultimo = saida[saida.length - 1];
    if (ultimo && ultimo.classe === classe) ultimo.texto += texto[i];
    else saida.push({ texto: texto[i], classe });
  }
  return saida;
}
