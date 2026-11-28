/** O que vai ao modelo e como a resposta se encaixa na linha. Sem dependências, para testar à parte. */

const ANTES = 3000;
const DEPOIS = 1200;

/** Um pedaço do arquivo antes e depois do cursor, começando e terminando em linha inteira. */
export function trechoEmVolta(texto: string, posicao: number): { prefixo: string; sufixo: string } {
  let prefixo = texto.slice(Math.max(0, posicao - ANTES), posicao);
  if (posicao > ANTES) prefixo = prefixo.slice(prefixo.indexOf('\n') + 1);
  let sufixo = texto.slice(posicao, posicao + DEPOIS);
  if (posicao + DEPOIS < texto.length) {
    const fim = sufixo.lastIndexOf('\n');
    if (fim > 0) sufixo = sufixo.slice(0, fim);
  }
  return { prefixo, sufixo };
}

/**
 * Com texto à direita do cursor, a sugestão ou o substitui (quando termina igual a ele) ou entra
 * antes dele numa linha só. Devolve quantos caracteres da linha ela cobre.
 */
export function ondeInserir(sugestao: string, restoDaLinha: string): { texto: string; substitui: number } | null {
  const resto = restoDaLinha.trimEnd();
  if (!resto) return { texto: sugestao, substitui: restoDaLinha.length };
  const [primeira] = sugestao.split('\n');
  if (primeira.endsWith(resto)) return { texto: primeira, substitui: restoDaLinha.length };
  // No meio de um nome não dá para encaixar nada com segurança.
  if (/^[\w$]/.test(resto)) return null;
  return { texto: primeira, substitui: 0 };
}

const MAXIMO_DE_LINHAS = 8;
const recuo = (linha: string): number => linha.length - linha.trimStart().length;

/**
 * O modelo não sabe quando parar e segue escrevendo os métodos seguintes. A sugestão vai só até o
 * fim do bloco onde está o cursor: para numa linha em branco, antes do que fecha o bloco de fora e
 * não repete o fechamento que o editor já pôs depois do cursor.
 */
export function cortarNoBloco(sugestao: string, linhaDoCursor: string, sufixo: string): string {
  const linhas = sugestao.replace(/\r/g, '').split('\n');
  const base = recuo(linhaDoCursor);
  const ficam = [linhas[0]];
  let comecou = linhas[0].trim() !== '';
  for (const linha of linhas.slice(1)) {
    if (!linha.trim()) {
      if (comecou) break;
    } else {
      // Menos recuo que a linha do cursor: é o bloco de fora fechando.
      if (comecou && recuo(linha) < base) break;
      comecou = true;
    }
    ficam.push(linha);
    if (ficam.length >= MAXIMO_DE_LINHAS) break;
  }
  const jaExiste = sufixo.split('\n').slice(1).find((l) => l.trim())?.trimEnd();
  if (ficam.length > 1 && jaExiste && /^\s*[)\]}]+[;,]?$/.test(jaExiste) && ficam.at(-1)!.trimEnd() === jaExiste) ficam.pop();
  return ficam.join('\n').trimEnd();
}

/** Arquivos que não saem da máquina: no modo API não há sugestão neles. */
export function arquivoSensivel(nome: string): boolean {
  return /^\.env(\..+)?$|\.(pem|key|p12|pfx|jks|keystore|chave)$|^(id_rsa|id_ed25519)$|credenti|secret|segredo/i.test(nome);
}
