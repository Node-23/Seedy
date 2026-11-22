import type { RegraAnalise } from '../nucleo/ponte';

/**
 * Regras de negócio (Fase 9, aba 2). Ficam em `.seedy/regras.md`, que o git ignora (só desta máquina) e dá
 * para editar à mão: o título e o texto são do usuário; o comentário `seedy` de cada regra
 * liga a regra ao código (a chave vem da análise) e guarda se ela já foi revisada.
 */
export type EstadoRegra = 'nova' | 'revisada';

export interface RegraEscrita {
  id: string;
  /** Chave da análise; vazia numa regra escrita à mão (sem ligação com o código). */
  chave: string;
  dominio: string;
  titulo: string;
  descricao: string;
  estado: EstadoRegra;
}

export interface ArquivoRegras {
  /** Quando os textos foram escritos (pela IA ou tirados do código). */
  escritasEm: string | null;
  pelaIa: boolean;
  regras: RegraEscrita[];
}

export const ARQUIVO_VAZIO: ArquivoRegras = { escritasEm: null, pelaIa: false, regras: [] };

const CABECALHO = /<!--\s*seedy:\s*escritas\s+(pela IA|do código)\s+em\s+([^>]+?)\s*-->/;
const LIGACAO = /<!--\s*seedy\s+([^>]*?)\s*-->/;
const ATRIBUTO = /(\w+)="([^"]*)"/g;

export function lerRegras(texto: string): ArquivoRegras {
  const arquivo: ArquivoRegras = { escritasEm: null, pelaIa: false, regras: [] };
  const cab = CABECALHO.exec(texto);
  if (cab) {
    arquivo.pelaIa = cab[1] === 'pela IA';
    arquivo.escritasEm = cab[2];
  }
  let dominio = 'geral';
  let atual: RegraEscrita | null = null;
  const fechar = () => {
    if (atual) arquivo.regras.push({ ...atual, descricao: atual.descricao.trim() });
    atual = null;
  };
  for (const linha of texto.split(/\r?\n/)) {
    const h2 = /^##\s+(?!#)(.+?)\s*$/.exec(linha);
    const h3 = /^###\s+(R\d+)\s*[·\-–—:]\s*(.+?)\s*$/.exec(linha);
    if (h2) {
      fechar();
      dominio = h2[1].trim().toLowerCase();
    } else if (h3) {
      fechar();
      atual = { id: h3[1], chave: '', dominio, titulo: h3[2], descricao: '', estado: 'nova' };
    } else if (atual && LIGACAO.test(linha) && !CABECALHO.test(linha)) {
      const corpo = LIGACAO.exec(linha)![1];
      for (const m of corpo.matchAll(ATRIBUTO)) {
        if (m[1] === 'chave') atual.chave = m[2];
        if (m[1] === 'estado') atual.estado = m[2] === 'revisada' ? 'revisada' : 'nova';
      }
    } else if (atual && !/^#\s/.test(linha)) {
      atual.descricao += linha + '\n';
    }
  }
  fechar();
  return arquivo;
}

export function escreverRegras(arquivo: ArquivoRegras): string {
  const partes = [
    '# Regras de negócio',
    '',
    `<!-- seedy: escritas ${arquivo.pelaIa ? 'pela IA' : 'do código'} em ${arquivo.escritasEm ?? agora()} -->`,
    'Gerado pelo Seedy a partir do código (␣ A, aba Regras). Edite à vontade: o título e o texto',
    'são seus; o comentário `seedy` de cada regra liga a regra ao código e guarda a revisão.',
  ];
  const dominios = [...new Set(arquivo.regras.map((r) => r.dominio))];
  for (const d of dominios) {
    partes.push('', `## ${d}`);
    for (const r of arquivo.regras.filter((x) => x.dominio === d)) {
      partes.push('', `### ${r.id} · ${r.titulo.replace(/\s+/g, ' ').trim()}`);
      partes.push(`<!-- seedy ${r.chave ? `chave="${r.chave}" ` : ''}estado="${r.estado}" -->`);
      if (r.descricao.trim()) partes.push(r.descricao.trim());
    }
  }
  return partes.join('\n') + '\n';
}

/** Linha (1-based) do título da regra no texto do arquivo. */
export function linhaDaRegra(texto: string, id: string): number {
  const i = texto.split(/\r?\n/).findIndex((l) => new RegExp(`^###\\s+${id}\\b`).test(l));
  return i < 0 ? 1 : i + 1;
}

export function agora(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function proximoId(regras: { id: string }[]): string {
  const maior = Math.max(0, ...regras.map((r) => Number(/^R(\d+)$/.exec(r.id)?.[1] ?? 0)));
  return `R${maior + 1}`;
}

// ---------- texto tirado do código (sem IA) ----------

const STATUS: Record<number, string> = {
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 410: 'Gone',
  412: 'Precondition Failed', 422: 'Unprocessable Entity', 429: 'Too Many Requests', 500: 'Internal Server Error',
};

export function nomeDoStatus(s: number): string {
  return STATUS[s] ?? '';
}

function maiuscula(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function metodo(r: RegraAnalise): string {
  return r.metodo ? `${r.componente.split('#').pop()}.${r.metodo}` : r.componente.split('#').pop()!;
}

/** `fixedRate = 300000` → "a cada 5 min"; `cron = "0 0 2 * * *"` → "todo dia às 02:00". */
export function quando(detalhe: string): string {
  const ms = /fixed(?:Rate|Delay)\s*=\s*(\d+)/.exec(detalhe);
  if (ms) {
    const n = Number(ms[1]);
    if (n % 3_600_000 === 0) return `a cada ${n / 3_600_000} h`;
    if (n % 60_000 === 0) return `a cada ${n / 60_000} min`;
    return `a cada ${n / 1000} s`;
  }
  const cron = /cron\s*=\s*"([^"]+)"/.exec(detalhe)?.[1];
  if (cron) {
    const [seg, min, hora, dia, , semana] = cron.split(/\s+/);
    if (/^\d+$/.test(min ?? '') && /^\d+$/.test(hora ?? '') && dia === '*' && (semana ?? '*') === '*' && /^\d+$/.test(seg ?? '0')) {
      return `todo dia às ${hora.padStart(2, '0')}:${min.padStart(2, '0')}`;
    }
    return `pelo cron ${cron}`;
  }
  const ejb = /hour\s*=\s*"(\d+)"/.exec(detalhe);
  if (ejb) return `todo dia às ${ejb[1].padStart(2, '0')}:00`;
  return detalhe ? `(${detalhe})` : 'de tempos em tempos';
}

/** `@NotBlank @Size(max = 5)` / `required, maxLength(5)` → "obrigatório, até 5 caracteres". */
export function validacoes(detalhe: string): string {
  const partes: string[] = [];
  const num = (re: RegExp) => re.exec(detalhe)?.[1];
  if (/NotNull|NotBlank|NotEmpty|required|nullable\s*=\s*false/.test(detalhe)) partes.push('obrigatório');
  const max = num(/max\s*=\s*(\d+)/) ?? num(/maxLength\((\d+)\)/);
  const min = num(/min\s*=\s*(\d+)/) ?? num(/minLength\((\d+)\)/);
  if (min && max) partes.push(`de ${min} a ${max} caracteres`);
  else if (max && /Size|Length|maxLength/.test(detalhe)) partes.push(`até ${max} caracteres`);
  else if (min && /Size|Length|minLength/.test(detalhe)) partes.push(`pelo menos ${min} caracteres`);
  const minimo = num(/@(?:Min|DecimalMin)\(\s*(?:value\s*=\s*)?"?(-?[\d.]+)/) ?? num(/Validators\.min\((-?[\d.]+)\)/);
  const maximo = num(/@(?:Max|DecimalMax)\(\s*(?:value\s*=\s*)?"?(-?[\d.]+)/) ?? num(/Validators\.max\((-?[\d.]+)\)/);
  if (minimo) partes.push(`no mínimo ${minimo}`);
  if (maximo) partes.push(`no máximo ${maximo}`);
  if (/Positive\b/.test(detalhe)) partes.push('maior que zero');
  if (/PositiveOrZero/.test(detalhe)) partes.push('zero ou mais');
  if (/Email|email/.test(detalhe)) partes.push('e-mail válido');
  if (/Pattern|pattern/.test(detalhe)) partes.push('no formato esperado');
  if (/Future/.test(detalhe)) partes.push('data no futuro');
  if (/Past/.test(detalhe)) partes.push('data no passado');
  if (/CPF/.test(detalhe)) partes.push('CPF válido');
  if (/CNPJ/.test(detalhe)) partes.push('CNPJ válido');
  if (/unique\s*=\s*true/.test(detalhe)) partes.push('único');
  return partes.join(', ') || detalhe;
}

/** Título e texto de uma regra só com o que o código diz (antes da IA reescrever). */
export function textoDoCodigo(r: RegraAnalise): { titulo: string; descricao: string } {
  const status = r.status ? ` e a API responde ${r.status}` : '';
  switch (r.tipo) {
    case 'excecao':
    case 'desvio': {
      const cond = r.condicao ? (r.condicao.endsWith(' vazio') ? `\`${r.condicao.slice(0, -6)}\` não encontra nada` : `\`${r.condicao}\``) : null;
      const titulo = r.mensagem ? maiuscula(r.mensagem) : cond ? `${r.metodo}: recusa quando ${r.condicao}` : `${r.metodo} recusa`;
      const acao = r.excecao
        ? `\`${metodo(r)}\` lança \`${r.excecao}\`${r.mensagem ? ` com "${r.mensagem}"` : ''}`
        : r.status
          ? `\`${metodo(r)}\` responde ${r.status}`
          : `\`${metodo(r)}\` volta para a tela${r.mensagem ? ` com "${r.mensagem}"` : ' com o erro'}`;
      return { titulo, descricao: `${cond ? `Quando ${cond}, ` : 'Sempre: '}${acao}${r.excecao ? status : ''}.` };
    }
    case 'validacao': {
      const v = validacoes(r.detalhe);
      return { titulo: `${maiuscula(r.condicao ?? 'campo')}: ${v}`, descricao: `O campo \`${r.condicao}\` de \`${metodo(r)}\` precisa ser ${v}${r.mensagem ? ` ("${r.mensagem}")` : ''}.` };
    }
    case 'agendada': {
      const q = quando(r.detalhe);
      return { titulo: `Rotina ${r.metodo} roda ${q}`, descricao: `\`${metodo(r)}\` é agendado (${r.detalhe.replace(/\s+/g, ' ')}) e roda ${q}, sem ninguém pedir.` };
    }
    case 'permissao': {
      const quem = /hasRole\(\s*'([^']+)'\)/.exec(r.detalhe)?.[1] ?? /"([^"]+)"/.exec(r.detalhe)?.[1] ?? r.detalhe;
      return { titulo: `Só ${quem} pode ${r.metodo}`, descricao: `\`${metodo(r)}\` exige ${r.detalhe}.` };
    }
  }
}

/** Trechos de um texto com `código` marcado (para pintar sem innerHTML). */
export function trechosDoTexto(texto: string): { texto: string; codigo: boolean }[] {
  return texto.split(/(`[^`]+`)/).filter(Boolean).map((t) => (t.startsWith('`') && t.endsWith('`') ? { texto: t.slice(1, -1), codigo: true } : { texto: t, codigo: false }));
}
