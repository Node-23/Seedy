/**
 * Markdown do chat da IA, só o que ela usa: negrito, itálico, `código`, links, títulos, listas
 * (- e 1.), blocos de código e citações. Vira uma árvore de dados que a tela desenha (nada de
 * innerHTML), e os links só valem com http, https ou mailto.
 */

export type Inline =
  | { t: 'texto'; v: string }
  | { t: 'negrito'; v: Inline[] }
  | { t: 'italico'; v: Inline[] }
  | { t: 'codigo'; v: string }
  | { t: 'link'; v: Inline[]; url: string };

export interface ItemDeLista {
  inline: Inline[];
  filhos: Lista | null;
}

export interface Lista {
  ordenada: boolean;
  inicio: number;
  itens: ItemDeLista[];
}

export type Bloco =
  | { t: 'paragrafo'; inline: Inline[] }
  | { t: 'titulo'; nivel: number; inline: Inline[] }
  | { t: 'lista'; lista: Lista }
  | { t: 'codigo'; linguagem: string; texto: string }
  | { t: 'citacao'; inline: Inline[] };

const URL_SEGURA = /^(https?:\/\/|mailto:)[^\s"<>]+$/i;

/** Texto corrido → partes com formatação. */
export function parseInline(texto: string): Inline[] {
  const saida: Inline[] = [];
  let acumulado = '';
  const soltar = () => {
    if (acumulado) saida.push({ t: 'texto', v: acumulado });
    acumulado = '';
  };
  let i = 0;
  while (i < texto.length) {
    const c = texto[i];
    const resto = texto.slice(i);

    // `código`
    if (c === '`') {
      const fim = texto.indexOf('`', i + 1);
      if (fim > i + 1) {
        soltar();
        saida.push({ t: 'codigo', v: texto.slice(i + 1, fim) });
        i = fim + 1;
        continue;
      }
    }
    // **negrito** (também __negrito__)
    if (resto.startsWith('**') || resto.startsWith('__')) {
      const marca = resto.slice(0, 2);
      const fim = texto.indexOf(marca, i + 2);
      if (fim > i + 2 && !/^\s/.test(texto[i + 2]) && (marca === '**' || !/\w/.test(texto[i - 1] ?? ' '))) {
        soltar();
        saida.push({ t: 'negrito', v: parseInline(texto.slice(i + 2, fim)) });
        i = fim + 2;
        continue;
      }
    }
    // *itálico* e _itálico_ (o _ só nas bordas de palavra: snake_case fica como está)
    if ((c === '*' || c === '_') && texto[i + 1] !== c && texto[i + 1] && !/\s/.test(texto[i + 1])) {
      const antes = texto[i - 1] ?? ' ';
      if (c === '*' || !/\w/.test(antes)) {
        let fim = i + 1;
        while ((fim = texto.indexOf(c, fim)) !== -1) {
          const depois = texto[fim + 1] ?? ' ';
          if (!/\s/.test(texto[fim - 1]) && (c === '*' || !/\w/.test(depois)) && texto[fim + 1] !== c) break;
          fim++;
        }
        if (fim > i + 1) {
          soltar();
          saida.push({ t: 'italico', v: parseInline(texto.slice(i + 1, fim)) });
          i = fim + 1;
          continue;
        }
      }
    }
    // [texto](url)
    if (c === '[') {
      const m = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(resto);
      if (m && URL_SEGURA.test(m[2])) {
        soltar();
        saida.push({ t: 'link', v: parseInline(m[1]), url: m[2] });
        i += m[0].length;
        continue;
      }
    }
    // https://... solto
    if ((c === 'h' || c === 'H') && /^https?:\/\//i.test(resto) && !/\w/.test(texto[i - 1] ?? ' ')) {
      const m = /^https?:\/\/[^\s<>"]+/i.exec(resto)!;
      // A pontuação do fim da frase não faz parte do endereço.
      let url = m[0];
      while (/[.,;:!?)\]}'"]$/.test(url) && !(url.endsWith(')') && url.includes('('))) url = url.slice(0, -1);
      if (URL_SEGURA.test(url)) {
        soltar();
        saida.push({ t: 'link', v: [{ t: 'texto', v: url }], url });
        i += url.length;
        continue;
      }
    }
    acumulado += c;
    i++;
  }
  soltar();
  return saida;
}

const LINHA_DE_LISTA = /^(\s*)([-*+•]|\d+[.)])\s+(.*)$/;

/** Documento inteiro → blocos. Aguenta texto pela metade (o chat vai chegando em pedaços). */
export function parseMarkdown(texto: string): Bloco[] {
  const linhas = texto.replace(/\r\n?/g, '\n').split('\n');
  const blocos: Bloco[] = [];
  let paragrafo: string[] = [];
  const fecharParagrafo = () => {
    if (paragrafo.length) blocos.push({ t: 'paragrafo', inline: parseInline(paragrafo.join('\n')) });
    paragrafo = [];
  };

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];

    // ``` bloco de código ```
    const cerca = /^\s*```\s*([\w+-]*)\s*$/.exec(linha);
    if (cerca) {
      fecharParagrafo();
      const dentro: string[] = [];
      i++;
      while (i < linhas.length && !/^\s*```\s*$/.test(linhas[i])) dentro.push(linhas[i++]);
      blocos.push({ t: 'codigo', linguagem: cerca[1], texto: dentro.join('\n') });
      continue;
    }
    if (!linha.trim()) {
      fecharParagrafo();
      continue;
    }
    const titulo = /^(#{1,4})\s+(.*)$/.exec(linha);
    if (titulo) {
      fecharParagrafo();
      blocos.push({ t: 'titulo', nivel: titulo[1].length, inline: parseInline(titulo[2].trim()) });
      continue;
    }
    if (/^\s*>\s?/.test(linha)) {
      fecharParagrafo();
      const citacao = [linha.replace(/^\s*>\s?/, '')];
      while (i + 1 < linhas.length && /^\s*>\s?/.test(linhas[i + 1])) citacao.push(linhas[++i].replace(/^\s*>\s?/, ''));
      blocos.push({ t: 'citacao', inline: parseInline(citacao.join('\n')) });
      continue;
    }
    if (LINHA_DE_LISTA.test(linha)) {
      fecharParagrafo();
      const [lista, proximo] = lerLista(linhas, i);
      blocos.push({ t: 'lista', lista });
      i = proximo - 1;
      continue;
    }
    paragrafo.push(linha);
  }
  fecharParagrafo();
  return blocos;
}

/** Lê uma lista a partir de `inicio`; devolve a lista e a linha onde ela terminou. */
function lerLista(linhas: string[], inicio: number): [Lista, number] {
  const primeira = LINHA_DE_LISTA.exec(linhas[inicio])!;
  const base = primeira[1].length;
  const lista: Lista = { ordenada: /\d/.test(primeira[2]), inicio: /\d/.test(primeira[2]) ? parseInt(primeira[2], 10) : 1, itens: [] };
  let i = inicio;
  while (i < linhas.length) {
    const linha = linhas[i];
    const m = LINHA_DE_LISTA.exec(linha);
    if (!m) {
      // Uma linha em branco só encerra a lista se o que vem depois não for item dela.
      if (!linha.trim()) {
        let j = i;
        while (j < linhas.length && !linhas[j].trim()) j++;
        const seguinte = linhas[j] !== undefined ? LINHA_DE_LISTA.exec(linhas[j]) : null;
        if (seguinte && seguinte[1].length >= base && /\d/.test(seguinte[2]) === lista.ordenada) {
          i = j;
          continue;
        }
        break;
      }
      // Continuação do item (indentada): vira mais texto do último item.
      if (/^\s+\S/.test(linha) && lista.itens.length && linha.search(/\S/) > base) {
        const ultimo = lista.itens[lista.itens.length - 1];
        ultimo.inline = parseInline(inlineParaTexto(ultimo.inline) + '\n' + linha.trim());
        i++;
        continue;
      }
      break;
    }
    const recuo = m[1].length;
    const ordenada = /\d/.test(m[2]);
    if (recuo < base || (recuo === base && ordenada !== lista.ordenada)) break;
    if (recuo >= base + 2 && lista.itens.length) {
      // Sublista do último item.
      const [filha, proximo] = lerLista(linhas, i);
      lista.itens[lista.itens.length - 1].filhos = filha;
      i = proximo;
      continue;
    }
    lista.itens.push({ inline: parseInline(m[3]), filhos: null });
    i++;
  }
  return [lista, i];
}

/** De volta ao texto cru (para juntar a continuação de um item e reler). */
export function inlineParaTexto(partes: Inline[]): string {
  return partes
    .map((p) => {
      switch (p.t) {
        case 'texto': return p.v;
        case 'codigo': return '`' + p.v + '`';
        case 'negrito': return '**' + inlineParaTexto(p.v) + '**';
        case 'italico': return '*' + inlineParaTexto(p.v) + '*';
        case 'link': return `[${inlineParaTexto(p.v)}](${p.url})`;
      }
    })
    .join('');
}
