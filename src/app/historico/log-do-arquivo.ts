/** Leitura do `git log` de um arquivo (ou de um trecho dele) para a tela do mockup 48. */

export interface CommitDoArquivo {
  hash: string;
  autor: string;
  data: number;
  assunto: string;
  refs: string[];
  /** Nome do arquivo neste commit e no anterior (mudam num renomear). */
  caminho: string;
  caminhoAntes: string;
  mais: number;
  menos: number;
  /** No histórico de um trecho: o texto dele antes e depois (o git já recorta). */
  antes?: string;
  depois?: string;
  /** Número da primeira linha de cada lado do trecho. */
  linhaAntes?: number;
  linhaDepois?: number;
}

const INICIO = '\x1e';
const SEP = '\x1f';
export const FORMATO = `%x1e%H%x1f%an%x1f%at%x1f%s%x1f%D`;

function cabecalho(linha: string, relativo: string): CommitDoArquivo {
  const [hash, autor, data, assunto, refs] = linha.split(SEP);
  const nomes = (refs ?? '')
    .split(', ')
    .map((r) => r.replace(/^HEAD -> /, '').replace(/^tag: /, ''))
    .filter((r) => r && r !== 'HEAD' && !r.endsWith('/HEAD'));
  return { hash, autor, data: Number(data), assunto, refs: nomes, caminho: relativo, caminhoAntes: relativo, mais: 0, menos: 0 };
}

/** `a => b`, `pasta/{a => b}/x`: [antes, depois]. */
function nomes(bruto: string): [string, string] {
  const chaves = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(bruto);
  if (chaves) {
    const junta = (meio: string) => `${chaves[1]}${meio}${chaves[4]}`.replace(/\/\//g, '/');
    return [junta(chaves[2]), junta(chaves[3])];
  }
  const solto = /^(.*) => (.*)$/.exec(bruto);
  return solto ? [solto[1], solto[2]] : [bruto, bruto];
}

/** Saída de `git log --follow -M --numstat --format=FORMATO`. */
export function lerLogDoArquivo(saida: string, relativo: string): CommitDoArquivo[] {
  return saida
    .split(INICIO)
    .filter((b) => b.trim())
    .map((bloco) => {
      const [primeira, ...resto] = bloco.split('\n');
      const c = cabecalho(primeira.replace(/\r$/, ''), relativo);
      for (const linha of resto) {
        const [mais, menos, ...nome] = linha.replace(/\r$/, '').split('\t');
        if (!nome.length) continue;
        c.mais = Number(mais) || 0;
        c.menos = Number(menos) || 0;
        [c.caminhoAntes, c.caminho] = nomes(nome.join('\t'));
      }
      return c;
    });
}

/** Saída de `git log -L a,b:arquivo --format=FORMATO`: cada commit traz o patch do trecho. */
export function lerLogDoTrecho(saida: string, relativo: string): CommitDoArquivo[] {
  return saida
    .split(INICIO)
    .filter((b) => b.trim())
    .map((bloco) => {
      const [primeira, ...resto] = bloco.split('\n');
      const c = cabecalho(primeira.replace(/\r$/, ''), relativo);
      const antes: string[] = [];
      const depois: string[] = [];
      let noTrecho = false;
      for (const linha of resto.map((l) => l.replace(/\r$/, ''))) {
        const de = /^--- (?:a\/(.*)|\/dev\/null)$/.exec(linha);
        const para = /^\+\+\+ b\/(.*)$/.exec(linha);
        if (!noTrecho && de) c.caminhoAntes = de[1] ?? relativo;
        else if (!noTrecho && para) c.caminho = para[1];
        else if (linha.startsWith('@@')) {
          const numeros = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(linha);
          c.linhaAntes ??= Number(numeros?.[1]) || 1;
          c.linhaDepois ??= Number(numeros?.[2]) || 1;
          noTrecho = true;
        }
        else if (!noTrecho) continue;
        else if (linha.startsWith('+')) {
          depois.push(linha.slice(1));
          c.mais++;
        } else if (linha.startsWith('-')) {
          antes.push(linha.slice(1));
          c.menos++;
        } else if (linha.startsWith(' ')) {
          antes.push(linha.slice(1));
          depois.push(linha.slice(1));
        } else if (linha.startsWith('diff ')) noTrecho = false;
      }
      c.antes = antes.join('\n');
      c.depois = depois.join('\n');
      return c;
    });
}
