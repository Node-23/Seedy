/**
 * Grafo de commits em faixas (lanes), como o log do mockup 04.
 *
 * Os commits vêm em ordem topológica (filhos antes dos pais). Cada faixa
 * "espera" um commit; o commit ocupa a faixa que o espera (ou uma nova),
 * e a faixa passa a esperar o primeiro pai. Pais extras (merge) abrem ou
 * reaproveitam faixas. Cada linha guarda as faixas antes e depois do commit,
 * que é tudo o que o desenho precisa.
 */
export interface LinhaDoGrafo {
  /** Faixa do commit. */
  coluna: number;
  /** Ligações da metade de cima: faixa de cima → faixa no meio da linha. */
  cima: Ligacao[];
  /** Ligações da metade de baixo: faixa no meio → faixa de baixo. */
  baixo: Ligacao[];
  /** Quantas faixas existem nesta linha (para a largura do desenho). */
  largura: number;
  /** Merge (mais de um pai): o nó é desenhado vazado. */
  merge: boolean;
}

export interface Ligacao {
  de: number;
  para: number;
  /** Cor = índice da faixa onde a linha nasceu (estável ao longo do caminho). */
  cor: number;
}

export function montarGrafo(commits: { hash: string; pais: string[] }[]): LinhaDoGrafo[] {
  // faixas[i] = hash que a faixa i espera (null = livre); cores[i] = cor da faixa.
  let faixas: (string | null)[] = [];
  let cores: number[] = [];
  let proximaCor = 0;
  const visiveis = new Set(commits.map((c) => c.hash));
  const saida: LinhaDoGrafo[] = [];

  for (const c of commits) {
    const antes = [...faixas];
    const coresAntes = [...cores];
    let coluna = faixas.indexOf(c.hash);
    if (coluna < 0) {
      coluna = livre(faixas);
      faixas[coluna] = c.hash;
      cores[coluna] = proximaCor++;
    }
    const corDoCommit = cores[coluna];

    // Metade de cima: quem esperava este commit converge para o nó; o resto segue reto.
    const cima: Ligacao[] = [];
    antes.forEach((h, i) => {
      if (h === null) return;
      cima.push({ de: i, para: h === c.hash ? coluna : i, cor: coresAntes[i] });
    });
    // As outras faixas que esperavam este commit (vários filhos) se encerram aqui.
    faixas = faixas.map((h, i) => (h === c.hash && i !== coluna ? null : h));

    // Pais: o primeiro segue na faixa do commit; os outros abrem/reaproveitam faixas.
    const pais = c.pais.filter((p) => visiveis.has(p));
    if (pais.length === 0) {
      faixas[coluna] = null;
    } else {
      faixas[coluna] = pais[0];
      for (const p of pais.slice(1)) {
        if (faixas.includes(p)) continue;
        const i = livre(faixas);
        faixas[i] = p;
        cores[i] = proximaCor++;
      }
    }

    // Metade de baixo: do nó para cada pai; as demais faixas seguem retas.
    const baixo: Ligacao[] = [];
    const outrosPais = pais.slice(1);
    faixas.forEach((h, i) => {
      if (h === null) return;
      // Faixa que já passava por esta linha (outra branch): segue reta.
      const passava = i !== coluna && antes[i] != null && antes[i] !== c.hash;
      if (passava) baixo.push({ de: i, para: i, cor: cores[i] });
      // Do nó para o primeiro pai (mesma faixa) e para os pais do merge.
      if (i === coluna) baixo.push({ de: coluna, para: i, cor: corDoCommit });
      else if (outrosPais.includes(h)) baixo.push({ de: coluna, para: i, cor: cores[i] });
    });

    // Corta faixas livres do fim, para o desenho não crescer à toa.
    while (faixas.length && faixas[faixas.length - 1] === null) {
      faixas.pop();
      cores.pop();
    }
    cores = cores.slice(0, faixas.length);

    saida.push({
      coluna,
      cima,
      baixo,
      largura: Math.max(antes.length, faixas.length, coluna + 1),
      merge: pais.length > 1,
    });
  }
  return saida;
}

function livre(faixas: (string | null)[]): number {
  const i = faixas.indexOf(null);
  return i >= 0 ? i : faixas.length;
}
