/** Leitura da saída dos servidores (JBoss/WildFly, Tomcat e logs de aplicação). */

export type NivelDeLog = 'erro' | 'aviso' | 'info' | 'debug';

/** Frame de stack trace: `at pacote.Classe.metodo(Classe.java:212)`. */
export interface Frame {
  classe: string;
  metodo: string;
  arquivo: string;
  linha: number | null;
}

export interface LinhaDeLog {
  /** Número sequencial (identidade estável para a lista). */
  n: number;
  texto: string;
  nivel: NivelDeLog | null;
  /** HH:MM:SS, quando a linha traz. */
  hora: string | null;
  /** A linha sem a hora e o nível (o que a tela mostra depois deles). */
  mensagem: string;
  frame: Frame | null;
  /** Linha de pilha (frame, "Caused by", "... N more"). */
  pilha: boolean;
  /** Mensagem do próprio Seedy (hot swap, parado...), não do servidor. */
  seedy?: boolean;
}

const NIVEIS: Record<string, NivelDeLog> = {
  SEVERE: 'erro', ERROR: 'erro', FATAL: 'erro', GRAVE: 'erro',
  WARN: 'aviso', WARNING: 'aviso', AVISO: 'aviso', ADVERTÊNCIA: 'aviso',
  INFO: 'info', INFORMAÇÕES: 'info', CONFIG: 'info',
  DEBUG: 'debug', FINE: 'debug', FINER: 'debug', FINEST: 'debug', TRACE: 'debug',
};
const RE_NIVEL = /(?:^|[\s[(])(SEVERE|ERROR|FATAL|GRAVE|WARNING|WARN|AVISO|ADVERTÊNCIA|INFORMAÇÕES|INFO|CONFIG|DEBUG|FINEST|FINER|FINE|TRACE)(?=[\s\]):]|$)/;
const RE_HORA = /(\d{2}:\d{2}:\d{2})[,.]\d{3}/;
const RE_FRAME = /^\s*at\s+(?:[\w.$@-]+\/{1,2})?([\w$.]+)\.([\w$<>-]+)\(([^:()]*)(?::(\d+))?\)/;
const RE_EXCECAO = /^(?:Caused by:\s*|Suppressed:\s*)?[a-z][\w$]*(?:\.[\w$]+)+(?:Exception|Error|Throwable)\b/;

/** Interpreta uma linha; `anterior` dá contexto (frames herdam o nível do erro de cima). */
export function lerLinha(texto: string, n: number, anterior: LinhaDeLog | null): LinhaDeLog {
  const frameM = RE_FRAME.exec(texto);
  if (frameM) {
    return {
      n, texto, nivel: anterior?.nivel ?? 'erro', hora: null, mensagem: texto, pilha: true,
      frame: { classe: frameM[1], metodo: frameM[2], arquivo: frameM[3], linha: frameM[4] ? Number(frameM[4]) : null },
    };
  }
  if (/^\s+\.\.\.\s*\d+\s+(more|common frames omitted)/.test(texto)) {
    return { n, texto, nivel: anterior?.nivel ?? 'erro', hora: null, mensagem: texto, pilha: true, frame: null };
  }
  if (RE_EXCECAO.test(texto.trim())) {
    return { n, texto, nivel: 'erro', hora: null, mensagem: texto.trim(), pilha: /^\s*(Caused by|Suppressed)/.test(texto), frame: null };
  }
  const cabeca = texto.slice(0, 80);
  const nivelM = RE_NIVEL.exec(cabeca);
  const horaM = RE_HORA.exec(cabeca);
  let mensagem = texto;
  if (nivelM) {
    // Tudo até o nível (data, hora) sai da mensagem; categoria/thread ficam.
    const fim = nivelM.index + nivelM[0].length;
    mensagem = texto.slice(fim).replace(/^[\s\]:]+/, '');
  }
  return {
    n,
    texto,
    nivel: nivelM ? NIVEIS[nivelM[1]] : null,
    hora: horaM?.[1] ?? null,
    mensagem,
    frame: null,
    pilha: false,
  };
}

/** A linha que diz que o servidor terminou de subir, e em quanto tempo (ms). */
export function subiu(texto: string): number | null {
  // WildFly: "WFLYSRV0025: WildFly ... started in 4123ms"; Tomcat: "Server startup in [1234] milliseconds".
  const w = /WFLYSRV002[56].*started(?: \(with errors\))? in (\d+)ms/.exec(texto);
  if (w) return Number(w[1]);
  const t = /(?:Server startup in|inicialização do servidor em) \[?([\d.,]+)\]?\s*(ms|milliseconds|milissegundos)/i.exec(texto);
  if (t) return Number(t[1].replace(/[.,]/g, ''));
  return null;
}

/** A aplicação acabou de (re)subir? */
export function aplicacaoPronta(texto: string): boolean {
  return /WFLYSRV0010: Deployed|WFLYSRV0016: Replaced deployment|Deployment of (deployment descriptor|web application directory) .* has finished|Reloading Context with name .* is completed/.test(texto);
}

/** Pacotes de framework/servidor: na pilha, ficam recolhidos. */
export function deFramework(classe: string): boolean {
  return /^(java|javax|jakarta|jdk|sun|com\.sun|org\.apache|org\.jboss|io\.undertow|org\.wildfly|org\.xnio|org\.springframework|org\.hibernate|org\.eclipse|com\.google|net\.bytebuddy|org\.glassfish|io\.netty|com\.fasterxml|org\.slf4j|ch\.qos|org\.postgresql|com\.mysql|oracle\.jdbc)\./.test(classe);
}
