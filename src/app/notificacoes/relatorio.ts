import { Notificacao } from '../nucleo/mensagens.service';

/** Para onde os relatórios de erro vão (o e-mail do projeto). */
export const EMAIL_DOS_RELATORIOS = 'matheus.dev@hotmail.com';

/** O limite do `abrir_link` do núcleo (e de vários programas de e-mail). */
const LIMITE_DO_LINK = 2000;

export interface DadosDoRelatorio {
  erro: Notificacao;
  oQueFazia: string;
  versao: string;
  sistema: string;
  projeto: string;
  tela: string;
  ultimas: Notificacao[];
}

export const hora = (d: Date): string => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Tira o nome do usuário dos caminhos e o que parecer senha ou token. */
export function limpar(texto: string): string {
  return texto
    .replace(/([A-Za-z]:[\\/]+Users[\\/]+|[\\/]home[\\/]+|[\\/]Users[\\/]+)[^\\/\n"':]+/g, '~')
    .replace(/(:\/\/)[^/\s:@]+:[^/\s@]+@/g, '$1***:***@')
    .replace(/\b(senha|password|passwd|pwd|secret|token|api[_-]?key|authorization)(["']?\s*[=:]\s*)(?:(?:Bearer|Basic)\s+)?("[^"]*"|'[^']*'|[^\s&;,]+)/gi, '$1$2***')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{16,}|github_pat_\w{20,}|sk-[\w-]{16,})\b/g, '***');
}

export function montarRelatorio(d: DadosDoRelatorio): string {
  const linhas = [
    `Seedy ${d.versao} · ${d.sistema} · ${d.projeto} · tela: ${d.tela}`,
    `Quando: ${d.erro.quando.toLocaleString('pt-BR')}`,
    '',
    'O que eu estava fazendo:',
    d.oQueFazia.trim() || '(não contou)',
    '',
    'Erro:',
    d.erro.completo,
    '',
    'Últimas notificações:',
    ...d.ultimas.map((n) => `- ${hora(n.quando)} [${n.tipo}] ${n.titulo}`),
  ];
  return limpar(linhas.join('\n'));
}

/** `mailto:` com o relatório; se não couber, corta e avisa que o inteiro está copiado. */
export function linkDeEmail(assunto: string, relatorio: string): string {
  const montar = (corpo: string) => `mailto:${EMAIL_DOS_RELATORIOS}?subject=${codificar(assunto)}&body=${codificar(corpo.replace(/\n/g, '\r\n'))}`;
  const inteiro = montar(relatorio);
  if (inteiro.length <= LIMITE_DO_LINK) return inteiro;
  const aviso = 'O relatório completo está copiado: apague este texto e cole com Ctrl+V.\n\n';
  let tamanho = relatorio.length;
  while (tamanho > 0 && montar(aviso + relatorio.slice(0, tamanho)).length > LIMITE_DO_LINK) tamanho -= 50;
  return montar(aviso + relatorio.slice(0, Math.max(0, tamanho)));
}

/** encodeURIComponent que não quebra num par substituto cortado ao meio. */
function codificar(texto: string): string {
  return encodeURIComponent(texto.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, ''));
}
