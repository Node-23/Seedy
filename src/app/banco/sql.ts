/** Trecho de uma instrução no texto do editor (offsets em caracteres). */
export interface Instrucao {
  inicio: number;
  fim: number;
  texto: string;
}

/**
 * Divide o SQL em instruções pelo `;`, sem cortar dentro de strings, identificadores
 * entre aspas, comentários ou blocos `$tag$` (o mesmo critério do núcleo, `banco/sql.rs`).
 */
export function instrucoes(sql: string): Instrucao[] {
  const saida: Instrucao[] = [];
  let inicio = 0;
  let i = 0;
  const n = sql.length;
  const fechar = (fim: number) => {
    const bruto = sql.slice(inicio, fim);
    if (!semComentarios(bruto).trim()) return;
    // A instrução começa depois dos comentários e espaços do começo.
    let ini = inicio;
    for (;;) {
      while (ini < fim && /\s/.test(sql[ini])) ini++;
      if (sql.startsWith('--', ini)) {
        const q = sql.indexOf('\n', ini);
        ini = q < 0 || q > fim ? fim : q + 1;
      } else if (sql.startsWith('/*', ini)) {
        const q = sql.indexOf('*/', ini + 2);
        ini = q < 0 || q > fim ? fim : q + 2;
      } else break;
    }
    const texto = sql.slice(ini, fim).trimEnd();
    saida.push({ inicio: ini, fim: ini + texto.length, texto });
  };
  while (i < n) {
    const c = sql[i];
    if (c === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++;
    } else if (c === '/' && sql[i + 1] === '*') {
      const f = sql.indexOf('*/', i + 2);
      i = f < 0 ? n : f + 2;
    } else if (c === "'" || c === '"' || c === '`') {
      i++;
      while (i < n) {
        if (sql[i] === c) {
          if (sql[i + 1] === c) {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
    } else if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const f = sql.indexOf(m[0], i + m[0].length);
        i = f < 0 ? n : f + m[0].length;
      } else i++;
    } else if (c === ';') {
      fechar(i);
      i++;
      inicio = i;
    } else i++;
  }
  fechar(n);
  return saida;
}

export function semComentarios(sql: string): string {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** A instrução onde está o cursor (ou a mais perto antes dele, se estiver num vão). */
export function instrucaoNoCursor(sql: string, offset: number): Instrucao | null {
  const lista = instrucoes(sql);
  if (!lista.length) return null;
  const dentro = lista.find((x) => offset >= x.inicio && offset <= x.fim + 1);
  if (dentro) return dentro;
  const antes = lista.filter((x) => x.fim < offset);
  return antes.length ? antes[antes.length - 1] : lista[0];
}

/** Escreve no banco? (mesma regra do núcleo; usada para confirmar antes em Produção). */
export function escreve(instrucao: string): boolean {
  const t = semComentarios(instrucao).trim().toLowerCase();
  const p = /^\(*\s*([a-z_]+)/.exec(t)?.[1] ?? '';
  const leitura = ['select', 'with', 'values', 'table', 'show', 'explain', 'describe', 'desc', 'set', 'use'];
  if (!leitura.includes(p)) return true;
  if (p === 'with' && /\b(insert|update|delete|merge)\b/.test(t)) return true;
  if (p === 'select' && /\bfor\s+update\b/.test(t)) return true;
  if (p === 'explain' && /^explain\s+analy[sz]e\b/.test(t) && /\b(insert|update|delete|merge)\b/.test(t)) return true;
  if (p === 'set' && /\b(transaction|characteristics|default_transaction_read_only|transaction_read_only)\b/.test(t)) return true;
  return false;
}

/** Palavras-chave para o autocompletar (comuns aos três bancos). */
export const PALAVRAS_SQL = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'LIKE', 'ILIKE', 'BETWEEN', 'EXISTS',
  'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'FULL JOIN', 'CROSS JOIN', 'ON', 'USING', 'AS',
  'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'FETCH FIRST', 'DISTINCT', 'UNION', 'UNION ALL', 'EXCEPT', 'INTERSECT',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'NULLIF', 'CAST',
  'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'RETURNING', 'WITH', 'EXPLAIN',
  'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'CREATE INDEX', 'CREATE VIEW', 'TRUNCATE',
  'BEGIN', 'COMMIT', 'ROLLBACK', 'ASC', 'DESC', 'NULLS FIRST', 'NULLS LAST', 'TRUE', 'FALSE',
  'CURRENT_DATE', 'CURRENT_TIMESTAMP', 'NOW()', 'DATE_TRUNC',
];

/** Apelidos de tabela no texto: `from feira f`, `join banca as b` → { f: 'feira', b: 'banca' }. */
export function apelidos(sql: string): Map<string, string> {
  const m = new Map<string, string>();
  const re = /\b(?:from|join|update|into)\s+([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?)(?:\s+(?:as\s+)?([A-Za-z_][\w$]*))?/gi;
  const reservadas = new Set(['where', 'on', 'join', 'left', 'right', 'inner', 'full', 'cross', 'group', 'order', 'limit', 'set', 'values', 'using', 'natural', 'union']);
  for (let r = re.exec(sql); r; r = re.exec(sql)) {
    const tabela = r[1].split('.').pop()!;
    m.set(tabela.toLowerCase(), tabela);
    const ap = r[2]?.toLowerCase();
    if (ap && !reservadas.has(ap)) m.set(ap, tabela);
  }
  return m;
}
