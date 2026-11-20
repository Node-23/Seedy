/**
 * Casamento aproximado (fuzzy) para a busca.
 *
 * Trecho contínuo vale mais que letras espalhadas; começo do nome ou de palavra
 * (camelCase, `_`, `.`, `/`) vale mais que meio de palavra. Devolve as posições
 * casadas para a interface sublinhar.
 */
export interface Casamento {
  pontos: number;
  posicoes: number[];
}

function inicioDePalavra(texto: string, i: number): boolean {
  if (i === 0) return true;
  const antes = texto[i - 1];
  const atual = texto[i];
  return /[_\-./\\\s(]/.test(antes) || (antes === antes.toLowerCase() && atual !== atual.toLowerCase());
}

export function casar(consulta: string, texto: string): Casamento | null {
  if (!consulta) return { pontos: 0, posicoes: [] };
  const q = consulta.toLowerCase();
  const t = texto.toLowerCase();

  // 1. Trecho contínuo: prefere o que começa numa palavra, e o mais à esquerda.
  let melhor = -1;
  for (let i = t.indexOf(q); i >= 0; i = t.indexOf(q, i + 1)) {
    if (melhor < 0) melhor = i;
    if (inicioDePalavra(texto, i)) {
      melhor = i;
      break;
    }
  }
  if (melhor >= 0) {
    const bonus = melhor === 0 ? 300 : inicioDePalavra(texto, melhor) ? 150 : 0;
    // Mesmas maiúsculas/minúsculas da consulta: "reserv" prefere reservar() a Reserva.
    const mesmaCaixa = texto.startsWith(consulta, melhor) ? 40 : 0;
    return {
      pontos: 1000 + bonus + mesmaCaixa - melhor - (texto.length - q.length) * 0.5,
      posicoes: Array.from({ length: q.length }, (_, k) => melhor + k),
    };
  }

  // 2. Letras na ordem, com buracos (ex.: "fsv" → FeiraService).
  const posicoes: number[] = [];
  let pontos = 500;
  let j = 0;
  for (let i = 0; i < t.length && j < q.length; i++) {
    if (t[i] !== q[j]) continue;
    if (posicoes.length) pontos -= (i - posicoes[posicoes.length - 1] - 1) * 3;
    if (inicioDePalavra(texto, i)) pontos += 20;
    posicoes.push(i);
    j++;
  }
  return j === q.length ? { pontos: pontos - texto.length * 0.5, posicoes } : null;
}

/** Posições de todas as ocorrências literais (sem diferenciar maiúsculas, exceto se a consulta tiver). */
export function ocorrencias(consulta: string, texto: string): number[] {
  if (!consulta) return [];
  const diferencia = consulta !== consulta.toLowerCase();
  const q = diferencia ? consulta : consulta.toLowerCase();
  const t = diferencia ? texto : texto.toLowerCase();
  const saida: number[] = [];
  for (let i = t.indexOf(q); i >= 0; i = t.indexOf(q, i + q.length)) {
    for (let k = 0; k < q.length; k++) saida.push(i + k);
  }
  return saida;
}
