/**
 * Cards do TODO e o arquivo `.seedy/todo.md` (vai para o git; dá para editar à mão):
 *
 *   - [ ] Limite de bancas vem do banco
 *     Hoje é LIMITE_BANCAS fixo.                     ← nota (linhas indentadas)
 *     -> codigo: back/src/.../ReservaService.java:24 ← ligações: tipo: alvo | rótulo
 *     -> regra: excecao:ReservaService.reservar:1a2b | R12 Feira lotada
 *   - [x] Card feito
 */
export type TipoLigacao = 'codigo' | 'regra' | 'caminho' | 'bloco' | 'container' | 'banco';

export interface Ligacao {
  tipo: TipoLigacao;
  /** codigo: caminho relativo:linha · regra: chave · caminho: Comp.metodo · bloco: id · container: nome · banco: id do perfil. */
  alvo: string;
  rotulo: string;
}

export interface Card {
  id: number;
  titulo: string;
  nota: string;
  feito: boolean;
  ligacoes: Ligacao[];
}

const TIPOS: TipoLigacao[] = ['codigo', 'regra', 'caminho', 'bloco', 'container', 'banco'];

export function lerTodo(texto: string): Card[] {
  const cards: Card[] = [];
  let atual: Card | null = null;
  let id = 1;
  for (const linha of texto.split(/\r?\n/)) {
    const card = /^\s{0,1}[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(linha);
    if (card) {
      atual = { id: id++, titulo: card[2].trim(), nota: '', feito: card[1] !== ' ', ligacoes: [] };
      cards.push(atual);
      continue;
    }
    if (!atual) continue;
    const lig = /^\s+->\s*(\w+)\s*:\s*(.+?)\s*$/.exec(linha);
    if (lig && TIPOS.includes(lig[1] as TipoLigacao)) {
      const [alvo, ...resto] = lig[2].split(' | ');
      atual.ligacoes.push({ tipo: lig[1] as TipoLigacao, alvo: alvo.trim(), rotulo: (resto.join(' | ') || alvo).trim() });
    } else if (/^\s{2,}\S/.test(linha)) {
      atual.nota += (atual.nota ? '\n' : '') + linha.trim();
    } else if (linha.trim() === '' || /^#/.test(linha)) {
      continue;
    } else {
      atual = null;
    }
  }
  return cards;
}

export function escreverTodo(cards: Card[]): string {
  const partes = ['# TODO', '', 'Cards do Seedy (␣ T). Edite à vontade; as linhas `->` ligam o card ao código, regras, diagramas e containers.', ''];
  const ordem = [...cards.filter((c) => !c.feito), ...cards.filter((c) => c.feito)];
  for (const c of ordem) {
    partes.push(`- [${c.feito ? 'x' : ' '}] ${c.titulo.replace(/\s+/g, ' ').trim()}`);
    for (const l of c.nota.split('\n').map((x) => x.trim()).filter(Boolean)) partes.push(`  ${l}`);
    for (const l of c.ligacoes) partes.push(`  -> ${l.tipo}: ${l.alvo}${l.rotulo && l.rotulo !== l.alvo ? ` | ${l.rotulo}` : ''}`);
  }
  return partes.join('\n') + '\n';
}

export const ICONE: Record<TipoLigacao, string> = { codigo: '{}', regra: '⚑', caminho: '⇢', bloco: '▦', container: '◇', banco: '◆' };
export const COR: Record<TipoLigacao, string> = { codigo: 'destaque-texto', regra: 'aviso-texto', caminho: 'destaque-texto', bloco: 'suave', container: 'rosa-texto', banco: 'destaque-texto' };
