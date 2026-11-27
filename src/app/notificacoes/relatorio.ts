import { Notificacao } from '../nucleo/mensagens.service';

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

/** A mensagem de um pânico ("panicked at arquivo:linha:coluna:" vem antes dela). */
export const resumoDoPanico = (detalhe: string): string => {
  const [primeira, segunda] = detalhe.split('\n');
  return (segunda || primeira).slice(0, 80);
};

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

/** O evento que vai ao Sentry: tudo passa por `limpar`. Falhas iguais são agrupadas pelo título. */
export function eventoDoSentry(d: DadosDoRelatorio): object {
  const titulo = limpar(d.erro.titulo);
  return {
    event_id: crypto.randomUUID().replace(/-/g, ''),
    timestamp: d.erro.quando.getTime() / 1000,
    platform: 'other',
    level: 'error',
    release: `seedy@${d.versao}`,
    message: { formatted: titulo },
    fingerprint: [titulo],
    tags: { sistema: d.sistema, projeto: d.projeto, tela: d.tela },
    extra: { o_que_fazia: limpar(d.oQueFazia.trim()) || '(não contou)', relatorio: montarRelatorio(d) },
  };
}
