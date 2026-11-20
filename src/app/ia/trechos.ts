import { diffDeLinhas } from '../git/diff';

export interface LinhaDeTrecho {
  tipo: 'mais' | 'menos' | 'igual' | 'corte';
  texto: string;
}

/**
 * As mudanças entre `antes` e `depois` como linhas −/+, com `contexto` linhas iguais em
 * volta de cada trecho (o resto vira "⋯"). `limite` corta listas muito grandes.
 */
export function trechos(antes: string | null, depois: string, contexto = 2, limite = 200): { linhas: LinhaDeTrecho[]; mais: number; menos: number } {
  const a = antes === null ? [] : antes.replace(/\r\n/g, '\n').split('\n');
  const b = depois.replace(/\r\n/g, '\n').split('\n');
  const mudancas = diffDeLinhas(a, b);
  const linhas: LinhaDeTrecho[] = [];
  let mais = 0;
  let menos = 0;
  let ultimoB = 0; // próxima linha de B ainda não mostrada
  for (const m of mudancas) {
    const iniCtx = Math.max(ultimoB, m.bInicio - contexto);
    if (iniCtx > ultimoB) linhas.push({ tipo: 'corte', texto: '⋯' });
    for (let i = iniCtx; i < m.bInicio; i++) linhas.push({ tipo: 'igual', texto: b[i] });
    for (let i = m.aInicio; i < m.aFim; i++, menos++) linhas.push({ tipo: 'menos', texto: a[i] });
    for (let i = m.bInicio; i < m.bFim; i++, mais++) linhas.push({ tipo: 'mais', texto: b[i] });
    const fimCtx = Math.min(b.length, m.bFim + contexto);
    for (let i = m.bFim; i < fimCtx; i++) linhas.push({ tipo: 'igual', texto: b[i] });
    ultimoB = fimCtx;
  }
  if (mudancas.length && ultimoB < b.length) linhas.push({ tipo: 'corte', texto: '⋯' });
  if (linhas.length > limite) {
    const resto = linhas.length - limite;
    return { linhas: [...linhas.slice(0, limite), { tipo: 'corte', texto: `⋯ mais ${resto} linhas (D abre o diff completo)` }], mais, menos };
  }
  return { linhas, mais, menos };
}
