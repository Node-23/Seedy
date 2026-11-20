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
