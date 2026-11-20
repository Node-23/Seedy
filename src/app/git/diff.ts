/**
 * Diferenças entre textos: leitura do diff unificado do git, diff de linhas
 * (Myers) para as marcas na margem do editor, e diff3 para o merge em três
 * colunas com o "resolver simples".
 */

// ---------- diff unificado (saída do git) ----------

export interface LinhaDeDiff {
  tipo: 'contexto' | 'mais' | 'menos' | 'cabecalho';
  texto: string;
  antigo?: number;
  novo?: number;
}

/** Hunks do `git diff`, sem o cabeçalho do arquivo (diff/index/---/+++). */
export function lerDiffUnificado(texto: string): LinhaDeDiff[] {
  const saida: LinhaDeDiff[] = [];
  let antigo = 0;
  let novo = 0;
  let dentro = false;
  for (const linha of texto.split(/\r?\n/)) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(linha);
    if (h) {
      antigo = Number(h[1]);
      novo = Number(h[2]);
      dentro = true;
      saida.push({ tipo: 'cabecalho', texto: linha });
      continue;
    }
    if (!dentro || linha.startsWith('\\')) continue;
    if (linha.startsWith('+')) saida.push({ tipo: 'mais', texto: linha.slice(1), novo: novo++ });
    else if (linha.startsWith('-')) saida.push({ tipo: 'menos', texto: linha.slice(1), antigo: antigo++ });
    else if (linha.startsWith(' ') || linha === '') saida.push({ tipo: 'contexto', texto: linha.slice(1), antigo: antigo++, novo: novo++ });
  }
  // Linha vazia no fim do texto do git não é contexto.
  while (saida.length && saida[saida.length - 1].tipo === 'contexto' && saida[saida.length - 1].texto === '' && texto.endsWith('\n')) {
    saida.pop();
    break;
  }
  return saida;
}

// ---------- diff de linhas (Myers) ----------

/** Trecho que mudou: linhas [aInicio, aFim) de A viraram [bInicio, bFim) de B. */
export interface Mudanca {
  aInicio: number;
  aFim: number;
  bInicio: number;
  bFim: number;
}

/** Diferenças entre duas listas de linhas, como trechos (algoritmo de Myers, O(ND)). */
export function diffDeLinhas(a: string[], b: string[]): Mudanca[] {
  // Prefixo e sufixo iguais saem antes: a maioria das edições é pequena.
  let ini = 0;
  while (ini < a.length && ini < b.length && a[ini] === b[ini]) ini++;
  let fimA = a.length;
  let fimB = b.length;
  while (fimA > ini && fimB > ini && a[fimA - 1] === b[fimB - 1]) {
    fimA--;
    fimB--;
  }
  const A = a.slice(ini, fimA);
  const B = b.slice(ini, fimB);
  const n = A.length;
  const m = B.length;
  if (!n && !m) return [];
  if (!n || !m) return [{ aInicio: ini, aFim: ini + n, bInicio: ini, bFim: ini + m }];

  const max = n + m;
  const v = new Int32Array(2 * max + 2);
  const trilha: Int32Array[] = [];
  let d = 0;
  outer: for (; d <= max; d++) {
    trilha.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const desce = k === -d || (k !== d && v[max + k - 1] < v[max + k + 1]);
      let x = desce ? v[max + k + 1] : v[max + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) {
        x++;
        y++;
      }
      v[max + k] = x;
      if (x >= n && y >= m) break outer;
    }
  }

  // Volta pelo caminho marcando as linhas apagadas (A) e inseridas (B).
  const apagadas = new Uint8Array(n);
  const inseridas = new Uint8Array(m);
  let x = n;
  let y = m;
  for (let dd = d; dd > 0; dd--) {
    const vv = trilha[dd];
    const k = x - y;
    const desce = k === -dd || (k !== dd && vv[max + k - 1] < vv[max + k + 1]);
    const kAnt = desce ? k + 1 : k - 1;
    const xAnt = vv[max + kAnt];
    const yAnt = xAnt - kAnt;
    while (x > xAnt && y > yAnt) {
      x--;
      y--;
    }
    if (desce) inseridas[--y] = 1;
    else apagadas[--x] = 1;
  }

  // Junta linhas vizinhas em trechos.
  const saida: Mudanca[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && !apagadas[i] && !inseridas[j]) {
      i++;
      j++;
      continue;
    }
    const m0 = { aInicio: ini + i, aFim: ini + i, bInicio: ini + j, bFim: ini + j };
    while (i < n && apagadas[i]) i++;
    while (j < m && inseridas[j]) j++;
    m0.aFim = ini + i;
    m0.bFim = ini + j;
    saida.push(m0);
  }
  return saida;
}

// ---------- diff3 (merge em três colunas) ----------

export type TipoDeBloco = 'igual' | 'seu' | 'deles' | 'ambos-iguais' | 'conflito';

export interface Bloco {
  tipo: TipoDeBloco;
  base: string[];
  seu: string[];
  deles: string[];
}

/**
 * Divide em blocos: iguais, mudados só de um lado, mudados igual dos dois lados,
 * e conflitos (os dois lados mudaram diferente o mesmo trecho da base).
 */
export function diff3(base: string[], seu: string[], deles: string[]): Bloco[] {
  const ms = diffDeLinhas(base, seu);
  const md = diffDeLinhas(base, deles);
  // Regiões da base tocadas por alguma mudança, juntando as que se sobrepõem.
  type Regiao = { ini: number; fim: number; s: Mudanca[]; d: Mudanca[] };
  const todas = [...ms.map((m) => ({ m, lado: 's' as const })), ...md.map((m) => ({ m, lado: 'd' as const }))].sort(
    (x, y) => x.m.aInicio - y.m.aInicio || x.m.aFim - y.m.aFim,
  );
  const regioes: Regiao[] = [];
  for (const { m, lado } of todas) {
    const ultima = regioes[regioes.length - 1];
    // Encostar (inserção no mesmo ponto) também conta como sobreposição.
    if (ultima && m.aInicio <= ultima.fim && (m.aInicio < ultima.fim || m.aInicio === m.aFim || ultima.ini === ultima.fim || m.aInicio === ultima.ini)) {
      ultima.fim = Math.max(ultima.fim, m.aFim);
      (lado === 's' ? ultima.s : ultima.d).push(m);
    } else {
      regioes.push({ ini: m.aInicio, fim: m.aFim, s: lado === 's' ? [m] : [], d: lado === 'd' ? [m] : [] });
    }
  }

  // Fora das mudanças, cada lado é a base deslocada; o deslocamento acumula
  // a cada região (linhas que o lado ganhou ou perdeu).
  const trecho = (mudancas: Mudanca[], r: Regiao, desloc: number) => {
    if (!mudancas.length) return { ini: r.ini + desloc, fim: r.fim + desloc };
    const primeira = mudancas[0];
    const ultima = mudancas[mudancas.length - 1];
    return { ini: primeira.bInicio - (primeira.aInicio - r.ini), fim: ultima.bFim + (r.fim - ultima.aFim) };
  };

  const blocos: Bloco[] = [];
  let posBase = 0;
  let deslocSeu = 0;
  let deslocDeles = 0;
  for (const r of regioes) {
    if (r.ini > posBase) {
      blocos.push({ tipo: 'igual', base: base.slice(posBase, r.ini), seu: [], deles: [] });
    }
    const ts = trecho(r.s, r, deslocSeu);
    const td = trecho(r.d, r, deslocDeles);
    const s = seu.slice(ts.ini, ts.fim);
    const d = deles.slice(td.ini, td.fim);
    deslocSeu = ts.fim - r.fim;
    deslocDeles = td.fim - r.fim;
    const tipo: TipoDeBloco = !r.d.length ? 'seu' : !r.s.length ? 'deles' : iguais(s, d) ? 'ambos-iguais' : 'conflito';
    blocos.push({ tipo, base: base.slice(r.ini, r.fim), seu: s, deles: d });
    posBase = r.fim;
  }
  if (posBase < base.length) blocos.push({ tipo: 'igual', base: base.slice(posBase), seu: [], deles: [] });
  // Blocos iguais guardam o mesmo texto nos três lados.
  for (const b of blocos) if (b.tipo === 'igual') b.deles = b.seu = b.base;
  return blocos;
}

const iguais = (a: string[], b: string[]) => a.length === b.length && a.every((l, i) => l === b[i]);
const semEspacos = (l: string[]) => l.map((x) => x.replace(/\s+/g, '')).join('\n');

/**
 * "Resolver simples" para um conflito: o que dá para decidir sem perguntar.
 * - só diferença de espaço/indentação → fica o seu;
 * - só imports dos dois lados → junta os dois, sem repetir, em ordem;
 * - um lado contém o outro inteiro (o outro só acrescentou linhas) → fica o maior.
 * Devolve null quando é um conflito de verdade.
 */
export function resolverSimples(b: Bloco): { linhas: string[]; motivo: string } | null {
  if (b.tipo !== 'conflito') return null;
  if (semEspacos(b.seu) === semEspacos(b.deles)) return { linhas: b.seu, motivo: 'só espaço' };
  const ehImport = (l: string) => /^\s*import\s+[\w.*]+\s*;\s*$/.test(l) || !l.trim();
  if (b.seu.every(ehImport) && b.deles.every(ehImport)) {
    const juntos = [...new Set([...b.seu, ...b.deles].filter((l) => l.trim()))].sort((x, y) => x.trim().localeCompare(y.trim()));
    return { linhas: juntos, motivo: 'imports dos dois lados' };
  }
  const contem = (maior: string[], menor: string[]) => {
    let i = 0;
    for (const l of maior) if (i < menor.length && l === menor[i]) i++;
    return i === menor.length;
  };
  if (iguais(b.base, b.seu.filter((l) => b.base.includes(l))) && contem(b.deles, b.seu) && b.base.every((l) => b.seu.includes(l))) {
    return { linhas: b.deles, motivo: 'só deles acrescentou' };
  }
  if (iguais(b.base, b.deles.filter((l) => b.base.includes(l))) && contem(b.seu, b.deles) && b.base.every((l) => b.deles.includes(l))) {
    return { linhas: b.seu, motivo: 'só você acrescentou' };
  }
  return null;
}
