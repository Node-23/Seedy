/**
 * Markdown ao vivo (mockup 43), como o "Live Preview" do Obsidian: o texto aparece formatado no
 * próprio editor e só a linha do cursor mostra os símbolos. O arquivo não muda: tudo é decoração
 * do Monaco, uma linha da tela para cada linha do arquivo (o vim continua andando por elas).
 *
 * `trechosDoMarkdown` diz o que fazer em cada linha, sem depender do Monaco; `ligarMarkdownVivo`
 * transforma isso em decorações.
 */
import { monaco } from './monaco';

export interface Trecho {
  linha: number;
  /** Colunas do Monaco (a primeira é 1; `ate` não entra). Numa linha inteira, as duas são 1. */
  de: number;
  ate: number;
  /** Classe CSS do texto (ou da linha, se `linhaInteira`). */
  classe?: string;
  linhaInteira?: boolean;
  /** Esconde o texto do intervalo. */
  oculto?: boolean;
  /** Texto que só aparece na tela, antes do intervalo. */
  antes?: { texto: string; classe: string };
  /** Título: tamanho da letra e altura da linha (vezes os do editor). */
  titulo?: { tamanho: number; altura: number };
  /** Barra à esquerda da linha (citação). */
  barra?: boolean;
}

const TITULOS = [
  { tamanho: 1.85, altura: 1.9 },
  { tamanho: 1.4, altura: 1.55 },
  { tamanho: 1.2, altura: 1.35 },
  { tamanho: 1.08, altura: 1.15 },
  { tamanho: 1, altura: 1 },
  { tamanho: 1, altura: 1 },
];

/**
 * O que decorar. `ativas` são as linhas com cursor ou seleção: nelas os símbolos ficam à vista
 * (apagados), mas o tamanho e o peso continuam.
 */
export function trechosDoMarkdown(linhas: string[], ativas: ReadonlySet<number>): Trecho[] {
  const saida: Trecho[] = [];
  let cerca: string | null = null;
  let i = 0;
  /** Linhas até aqui já tiveram o texto corrido marcado junto com a primeira do parágrafo. */
  let corridas = 0;

  // Cabeçalho do Obsidian (--- ... --- no topo): fica como texto, apagado.
  if (linhas[0] === '---') {
    const fim = linhas.indexOf('---', 1);
    if (fim > 0) {
      for (; i <= fim; i++) saida.push({ linha: i + 1, de: 1, ate: 1, linhaInteira: true, classe: 'mdv-cabecalho' });
    }
  }

  for (; i < linhas.length; i++) {
    const texto = linhas[i];
    const linha = i + 1;
    const ativa = ativas.has(linha);
    const tudo = texto.length + 1;
    /** Um símbolo do markdown: some, ou fica apagado na linha do cursor. */
    const simbolo = (de: number, ate: number) =>
      saida.push(ativa ? { linha, de, ate, classe: 'mdv-simbolo' } : { linha, de, ate, oculto: true });

    const marcaDeCerca = /^\s{0,3}(```+|~~~+)\s*([\w+#.-]*)/.exec(texto);
    if (cerca) {
      const fecha = !!marcaDeCerca && marcaDeCerca[1].startsWith(cerca) && !marcaDeCerca[2];
      saida.push({ linha, de: 1, ate: 1, linhaInteira: true, classe: fecha ? 'mdv-bloco mdv-bloco-fim' : 'mdv-bloco' });
      if (fecha) {
        simbolo(1, tudo);
        cerca = null;
      }
      continue;
    }
    if (marcaDeCerca) {
      cerca = marcaDeCerca[1];
      saida.push({ linha, de: 1, ate: 1, linhaInteira: true, classe: 'mdv-bloco mdv-bloco-inicio' });
      simbolo(1, tudo);
      if (!ativa && marcaDeCerca[2]) saida.push({ linha, de: tudo, ate: tudo, antes: { texto: marcaDeCerca[2], classe: 'mdv-linguagem' } });
      continue;
    }

    if (texto.includes('|') && ehSeparadorDeTabela(linhas[i + 1] ?? '')) {
      i = tabela(linhas, i, ativas, saida) - 1;
      continue;
    }

    const titulo = /^(#{1,6})(\s+|$)/.exec(texto);
    if (titulo) {
      saida.push({ linha, de: 1, ate: tudo, classe: 'mdv-titulo mdv-h' + titulo[1].length, titulo: TITULOS[titulo[1].length - 1] });
      simbolo(1, titulo[0].length + 1);
      inline(texto, titulo[0].length, texto.length, naLinha(linha, ativa, saida));
      continue;
    }

    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(texto)) {
      if (!ativa) saida.push({ linha, de: 1, ate: 1, linhaInteira: true, classe: 'mdv-regua' });
      simbolo(1, tudo);
      continue;
    }

    let inicio = 0;
    const citacao = /^(\s{0,3}>\s?)+/.exec(texto);
    if (citacao) {
      inicio = citacao[0].length;
      saida.push({ linha, de: 1, ate: 1, linhaInteira: true, barra: true });
      saida.push({ linha, de: inicio + 1, ate: tudo, classe: 'mdv-citacao' });
      simbolo(1, inicio + 1);
    }

    const resto = texto.slice(inicio);
    const tarefa = /^(\s*)([-*+] \[([ xX])\] )/.exec(resto);
    const item = /^(\s*)([-*+])\s/.exec(resto);
    if (tarefa) {
      const de = inicio + tarefa[1].length + 1;
      const feita = tarefa[3] !== ' ';
      inicio += tarefa[0].length;
      simbolo(de, inicio + 1);
      if (!ativa) saida.push({ linha, de, ate: inicio + 1, antes: { texto: feita ? '✓' : ' ', classe: feita ? 'mdv-tarefa mdv-tarefa-feita' : 'mdv-tarefa' } });
      if (feita) saida.push({ linha, de: inicio + 1, ate: tudo, classe: 'mdv-riscado' });
    } else if (item) {
      const de = inicio + item[1].length + 1;
      inicio += item[0].length;
      simbolo(de, de + 1);
      if (!ativa) saida.push({ linha, de, ate: de + 1, antes: { texto: '•', classe: 'mdv-marcador' } });
    }

    if (i < corridas) continue;
    // Citação não continua na linha de baixo (cada uma tem o seu ">").
    if (citacao) inline(texto, inicio, texto.length, naLinha(linha, ativa, saida));
    else corridas = i + paragrafo(linhas, i, inicio, ativas, saida);
  }
  return saida;
}

type Marcar = (a: number, b: number, classe: string | null) => void;

/**
 * Negrito, itálico, riscado, `código`, [links](url) e [[links de notas]] entre `de` e `ate`.
 * `marcar` recebe posições em `texto`; classe null é um símbolo do markdown.
 */
function inline(texto: string, de: number, ate: number, marcar: Marcar): void {
  const simbolo = (a: number, b: number) => marcar(a, b, null);
  const letra = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

  let i = de;
  while (i < ate) {
    const c = texto[i];
    if (c === '\\') {
      if (i + 1 < ate && /[\\`*_{}[\]()#+\-.!~|>]/.test(texto[i + 1])) simbolo(i, i + 1);
      i += 2;
      continue;
    }
    if (c === '`') {
      const n = /^`+/.exec(texto.slice(i))![0].length;
      const fim = texto.indexOf('`'.repeat(n), i + n);
      if (fim > i && fim < ate) {
        simbolo(i, i + n);
        marcar(i + n, fim, 'mdv-codigo');
        simbolo(fim, fim + n);
        i = fim + n;
      } else i += n;
      continue;
    }
    const nota = /^\[\[([^\]|]+\|)?([^\]]+)\]\]/.exec(texto.slice(i, ate));
    if (nota) {
      const a = i + 2 + (nota[1]?.length ?? 0);
      simbolo(i, a);
      marcar(a, a + nota[2].length, 'mdv-link');
      simbolo(a + nota[2].length, i + nota[0].length);
      i += nota[0].length;
      continue;
    }
    const link = /^(!?\[)((?:\\.|[^\]\\])*)\]\((?:[^()\s]|\([^()]*\))*(?:\s+"[^"]*")?\)/.exec(texto.slice(i, ate));
    if (link) {
      const a = i + link[1].length;
      const b = a + link[2].length;
      simbolo(i, a);
      marcar(a, b, 'mdv-link');
      inline(texto, a, b, marcar);
      simbolo(b, i + link[0].length);
      i += link[0].length;
      continue;
    }
    const marca = /^(\*\*\*|\*\*|__|~~|\*|_)/.exec(texto.slice(i, ate))?.[1];
    if (marca) {
      // "_" no meio de palavra (nome_de_variavel) não é itálico.
      const abre = !/\s/.test(texto[i + marca.length] ?? ' ') && !(marca[0] === '_' && letra(texto[i - 1]));
      let fim = abre ? texto.indexOf(marca, i + marca.length + 1) : -1;
      while (fim > 0 && (/\s/.test(texto[fim - 1]) || (marca[0] === '_' && letra(texto[fim + marca.length])))) fim = texto.indexOf(marca, fim + 1);
      if (fim > 0 && fim + marca.length <= ate) {
        const a = i + marca.length;
        const classes = { '***': 'mdv-negrito mdv-italico', '**': 'mdv-negrito', __: 'mdv-negrito', '~~': 'mdv-riscado', '*': 'mdv-italico', _: 'mdv-italico' };
        simbolo(i, a);
        marcar(a, fim, classes[marca as keyof typeof classes]);
        inline(texto, a, fim, marcar);
        simbolo(fim, fim + marca.length);
        i = fim + marca.length;
      } else i += marca.length;
      continue;
    }
    i++;
  }
}

/** Marcações de dentro de uma linha: símbolos somem, ou ficam apagados na linha do cursor. */
function naLinha(linha: number, ativa: boolean, saida: Trecho[]): Marcar {
  return (a, b, classe) =>
    saida.push(classe ? { linha, de: a + 1, ate: b + 1, classe } : ativa ? { linha, de: a + 1, ate: b + 1, classe: 'mdv-simbolo' } : { linha, de: a + 1, ate: b + 1, oculto: true });
}

/** Uma linha que começa outro bloco não continua o parágrafo de cima. */
const NOVO_BLOCO = /^\s*($|#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~|<|\|)|^\s{0,3}([-*_=])(\s*\2){2,}\s*$/;

/**
 * O texto corrido que começa em `linhas[i]` (na posição `inicio`) pode seguir nas linhas de baixo:
 * um negrito aberto numa linha fecha na outra. Devolve quantas linhas ele ocupa.
 */
function paragrafo(linhas: string[], i: number, inicio: number, ativas: ReadonlySet<number>, saida: Trecho[]): number {
  const pedacos = [{ linha: i + 1, coluna: inicio, texto: linhas[i].slice(inicio) }];
  for (let n = i + 1; n < linhas.length && !NOVO_BLOCO.test(linhas[n]) && !ehSeparadorDeTabela(linhas[n + 1] ?? ''); n++) {
    const recuo = linhas[n].length - linhas[n].trimStart().length;
    pedacos.push({ linha: n + 1, coluna: recuo, texto: linhas[n].slice(recuo) });
  }
  const junto = pedacos.map((p) => p.texto).join('\n');
  inline(junto, 0, junto.length, (a, b, classe) => {
    let comeco = 0;
    for (const p of pedacos) {
      const de = Math.max(a, comeco) - comeco;
      const ate = Math.min(b, comeco + p.texto.length) - comeco;
      if (de < ate) naLinha(p.linha, ativas.has(p.linha), saida)(p.coluna + de, p.coluna + ate, classe);
      comeco += p.texto.length + 1;
    }
  });
  return pedacos.length;
}

function ehSeparadorDeTabela(texto: string): boolean {
  return texto.includes('-') && texto.includes('|') && /^\s*\|?(\s*:?-+:?\s*\|)*\s*:?-+:?\s*\|?\s*$/.test(texto);
}

/** As células de uma linha de tabela: onde cada "|" está e o trecho entre eles. */
function barras(texto: string): number[] {
  const posicoes: number[] = [];
  for (let i = 0; i < texto.length; i++) {
    if (texto[i] === '\\') i++;
    else if (texto[i] === '|') posicoes.push(i);
  }
  return posicoes;
}

/** Quantas letras um texto ocupa na tela, sem os símbolos escondidos. */
function larguraVisivel(texto: string): number {
  let some = 0;
  inline(texto, 0, texto.length, (a, b, classe) => {
    if (!classe) some += b - a;
  });
  return [...texto].length - some;
}

/**
 * Tabela: continua uma linha do arquivo por linha da tela. Os "|" das pontas somem, os de dentro
 * ficam apagados e as colunas se alinham com espaços que só existem na tela; a linha do separador
 * vira um traço. Devolve a primeira linha depois dela.
 */
function tabela(linhas: string[], inicio: number, ativas: ReadonlySet<number>, saida: Trecho[]): number {
  let fim = inicio + 2;
  while (fim < linhas.length && linhas[fim].includes('|') && linhas[fim].trim()) fim++;

  /** Células sem os "|" das pontas: [começo, fim] de cada uma. */
  const celulasDe = (texto: string) => {
    const p = barras(texto);
    const cortes = [-1, ...p, texto.length];
    const celulas = cortes.slice(0, -1).map((c, n) => [c + 1, cortes[n + 1]] as const);
    if (celulas.length && !texto.slice(...celulas[0]).trim()) celulas.shift();
    if (celulas.length && !texto.slice(...celulas[celulas.length - 1]).trim()) celulas.pop();
    return celulas;
  };
  const larguras: number[] = [];
  for (let i = inicio; i < fim; i++) {
    if (i === inicio + 1) continue;
    celulasDe(linhas[i]).forEach(([a, b], n) => (larguras[n] = Math.max(larguras[n] ?? 1, larguraVisivel(linhas[i].slice(a, b).trim()))));
  }
  /** A largura da tabela na tela: as células, com " | " entre elas. */
  const largura = larguras.reduce((n, l) => n + l, 0) + 3 * Math.max(0, larguras.length - 1);

  for (let i = inicio; i < fim; i++) {
    const texto = linhas[i];
    const linha = i + 1;
    const tudo = texto.length + 1;
    const ativa = ativas.has(linha);
    saida.push({ linha, de: 1, ate: 1, linhaInteira: true, classe: 'mdv-tabela' });
    if (ativa) {
      saida.push({ linha, de: 1, ate: tudo, classe: 'mdv-simbolo' });
      continue;
    }
    if (i === inicio + 1) {
      saida.push({ linha, de: 1, ate: tudo, oculto: true, antes: { texto: ' '.repeat(largura), classe: 'mdv-traco' } });
      continue;
    }
    const celulas = celulasDe(texto);
    let feito = 0;
    /** Espaços que faltam à célula anterior para a coluna alinhar. */
    let anterior = '';
    celulas.forEach(([a, b], n) => {
      const bruto = texto.slice(a, b);
      const comeco = a + (bruto.length - bruto.trimStart().length);
      const termino = Math.max(comeco, a + bruto.trimEnd().length);
      const sobra = ' '.repeat(Math.max(0, larguras[n] - larguraVisivel(texto.slice(comeco, termino))));
      // Do fim da célula anterior até o começo desta (o "|" e os espaços) vira o preenchimento e " | ".
      saida.push({ linha, de: feito + 1, ate: comeco + 1, oculto: true, antes: n ? { texto: `${anterior} | `, classe: 'mdv-grade' } : undefined });
      if (i === inicio) saida.push({ linha, de: comeco + 1, ate: termino + 1, classe: 'mdv-negrito' });
      inline(texto, comeco, termino, naLinha(linha, false, saida));
      anterior = sobra;
      feito = termino;
    });
    saida.push({ linha, de: feito + 1, ate: tudo, oculto: true });
  }
  return fim;
}

/** Decorações do Monaco para um trecho. */
function decoracao(t: Trecho, tamanhoBase: number): monaco.editor.IModelDeltaDecoration {
  const nunca = monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges;
  const classes = [t.oculto ? 'mdv-oculto' : '', t.linhaInteira ? '' : (t.classe ?? '')].filter(Boolean).join(' ');
  return {
    range: new monaco.Range(t.linha, t.de, t.linha, t.ate),
    options: {
      stickiness: nunca,
      isWholeLine: t.linhaInteira,
      className: t.linhaInteira ? t.classe : undefined,
      linesDecorationsClassName: t.barra ? 'mdv-barra' : undefined,
      inlineClassName: classes || undefined,
      // Muda a largura das letras: o Monaco precisa medir na tela, e não contar caracteres.
      inlineClassNameAffectsLetterSpacing: !!classes,
      showIfCollapsed: !!t.antes,
      before: t.antes && {
        content: t.antes.texto,
        inlineClassName: t.antes.classe,
        inlineClassNameAffectsLetterSpacing: true,
        cursorStops: monaco.editor.InjectedTextCursorStops.None,
      },
      fontSize: t.titulo && `${Math.round(tamanhoBase * t.titulo.tamanho)}px`,
      lineHeight: t.titulo?.altura,
    },
  };
}

/** Acima disso o arquivo abre como fonte: redecorar a cada cursor ficaria pesado. */
const LIMITE_DE_LINHAS = 5000;

/**
 * Mantém as decorações de um editor enquanto `ligado()` for verdade. `atualizar` refaz na hora
 * (trocou o modo, o arquivo ou a fonte).
 */
export function ligarMarkdownVivo(
  instancia: monaco.editor.IStandaloneCodeEditor,
  ligado: () => boolean,
): { atualizar(): void; dispose(): void } {
  const colecao = instancia.createDecorationsCollection();
  let marcado = '';
  const atualizar = () => {
    const modelo = instancia.getModel();
    const vivo = !!modelo && ligado() && modelo.getLineCount() <= LIMITE_DE_LINHAS;
    if (!vivo) {
      colecao.clear();
      marcado = '';
      return;
    }
    const ativas = new Set<number>();
    for (const s of instancia.getSelections() ?? []) {
      for (let l = s.startLineNumber; l <= s.endLineNumber; l++) ativas.add(l);
    }
    const tamanho = instancia.getOption(monaco.editor.EditorOption.fontInfo).fontSize;
    // Andar na mesma linha não muda nada: não redesenha.
    const chave = `${modelo.uri}|${modelo.getVersionId()}|${[...ativas].join()}|${tamanho}`;
    if (chave === marcado && colecao.length) return;
    marcado = chave;
    colecao.set(trechosDoMarkdown(modelo.getLinesContent(), ativas).map((t) => decoracao(t, tamanho)));
  };
  const ouvintes = [
    instancia.onDidChangeCursorSelection(atualizar),
    instancia.onDidChangeModelContent(atualizar),
    instancia.onDidChangeModel(() => {
      marcado = '';
      atualizar();
    }),
  ];
  return {
    atualizar: () => {
      marcado = '';
      atualizar();
    },
    dispose: () => {
      ouvintes.forEach((o) => o.dispose());
      colecao.clear();
    },
  };
}
