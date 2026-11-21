/**
 * Posições do mapa de containers (mockup 15): um bloco por rede, colunas por camada de
 * dependência (quem chama à esquerda, quem é chamado à direita) e o "host" à esquerda.
 */
import { ContainerDocker } from '../nucleo/ponte';
import { Conexao, HOST } from './docker.service';

export const LARGURA_NO = 240;
export const ALTURA_NO = 84;
const COLUNA = 350;
const LINHA = 112;
const MARGEM_REDE = 30;
const TOPO_REDE = 38;
const X_REDES = 176;

export interface NoDoMapa {
  nome: string;
  x: number;
  y: number;
}

export interface RedeDoMapa {
  nome: string;
  x: number;
  y: number;
  largura: number;
  altura: number;
}

export interface Desenho {
  nos: NoDoMapa[];
  redes: RedeDoMapa[];
  host: NoDoMapa | null;
  largura: number;
  altura: number;
}

/** Rede principal de um container (a primeira que não é a "bridge" padrão, se houver). */
export function redePrincipal(c: ContainerDocker): string {
  return c.redes.find((r) => r.nome !== 'bridge')?.nome ?? c.redes[0]?.nome ?? 'sem rede';
}

export function desenhar(containers: ContainerDocker[], conexoes: Conexao[]): Desenho {
  const porRede = new Map<string, ContainerDocker[]>();
  for (const c of containers) porRede.set(redePrincipal(c), [...(porRede.get(redePrincipal(c)) ?? []), c]);
  const entre = conexoes.filter((x) => x.de !== HOST);

  const nos: NoDoMapa[] = [];
  const redes: RedeDoMapa[] = [];
  let y = 14;
  let largura = 0;
  // Redes com mais containers primeiro (o compose do projeto costuma ser a maior).
  const ordem = [...porRede.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  for (const [rede, lista] of ordem) {
    const nomes = new Set(lista.map((c) => c.nome));
    // Camada = maior distância a partir de quem não é chamado por ninguém (dentro da rede).
    const camada = new Map(lista.map((c) => [c.nome, 0]));
    for (let i = 0; i < lista.length; i++) {
      for (const x of entre) {
        if (!nomes.has(x.de) || !nomes.has(x.para)) continue;
        const nova = Math.min(lista.length - 1, camada.get(x.de)! + 1);
        if (nova > camada.get(x.para)!) camada.set(x.para, nova);
      }
    }
    const colunas: string[][] = [];
    for (const c of lista.slice().sort((a, b) => a.nome.localeCompare(b.nome))) (colunas[camada.get(c.nome)!] ??= []).push(c.nome);
    const usadas = colunas.filter((c) => c?.length);
    const linhas = Math.max(...usadas.map((c) => c.length));
    usadas.forEach((coluna, ci) =>
      coluna.forEach((nome, li) => nos.push({ nome, x: X_REDES + MARGEM_REDE + ci * COLUNA, y: y + TOPO_REDE + li * LINHA + (linhas - coluna.length) * (LINHA / 2) })),
    );
    const larguraRede = MARGEM_REDE * 2 + (usadas.length - 1) * COLUNA + LARGURA_NO;
    const alturaRede = TOPO_REDE + (linhas - 1) * LINHA + ALTURA_NO + 22;
    redes.push({ nome: rede, x: X_REDES, y, largura: larguraRede, altura: alturaRede });
    largura = Math.max(largura, X_REDES + larguraRede);
    y += alturaRede + 30;
  }
  const altura = Math.max(y, 120);
  const temPortas = conexoes.some((x) => x.de === HOST);
  const host = temPortas ? { nome: HOST, x: 12, y: Math.max(14, Math.min(altura - ALTURA_NO - 40, altura / 2 - ALTURA_NO)) } : null;
  return { nos, redes, host, largura: largura + 20, altura };
}

/** Caminho (curva) de uma seta entre dois nós; `desvio` separa setas do mesmo par. */
export function caminho(de: NoDoMapa, para: NoDoMapa, desvio: number, largura = LARGURA_NO): { d: string; rx: number; ry: number } {
  const praFrente = para.x >= de.x + largura / 2;
  const x1 = praFrente ? de.x + largura : de.x + largura / 2;
  const y1 = praFrente ? de.y + ALTURA_NO / 2 + desvio : de.y + (para.y > de.y ? ALTURA_NO : 0);
  const x2 = para.x - 4;
  const y2 = para.y + ALTURA_NO / 2 + desvio;
  const dx = Math.max(40, Math.abs(x2 - x1) / 2);
  const d = praFrente ? `M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}` : `M${x1} ${y1} C${x1} ${(y1 + y2) / 2}, ${x2 - 60} ${y2}, ${x2} ${y2}`;
  return { d, rx: (x1 + x2) / 2, ry: (y1 + y2) / 2 - 6 };
}
