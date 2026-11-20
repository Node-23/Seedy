/**
 * Regras da busca de texto do lado da interface: a mesma expressão que o
 * núcleo usa (busca.rs), para sublinhar os trechos encontrados e para o
 * modo navegador.
 */
export interface OpcoesTexto {
  /** Diferenciar maiúsculas; sem valor = só se a consulta tiver maiúscula. */
  diferenciar?: boolean;
  palavra?: boolean;
  regex?: boolean;
  /** Máscara de arquivos, ex.: `*.java, *.xml, !*Test.java`. */
  mascara?: string;
}

const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Lança erro se a expressão regular for inválida. */
export function expressaoDeBusca(consulta: string, opcoes: OpcoesTexto = {}): RegExp {
  const base = opcoes.regex ? consulta : escapar(consulta);
  const padrao = opcoes.palavra ? `\\b(?:${base})\\b` : base;
  const diferencia = opcoes.diferenciar ?? consulta !== consulta.toLowerCase();
  return new RegExp(padrao, diferencia ? 'g' : 'gi');
}

/** Posições (caracteres) de todos os trechos encontrados na linha. */
export function trechosEncontrados(expressao: RegExp, linha: string): number[] {
  const saida: number[] = [];
  expressao.lastIndex = 0;
  for (const m of linha.matchAll(expressao)) {
    if (!m[0].length) continue;
    for (let k = 0; k < m[0].length; k++) saida.push(m.index! + k);
  }
  return saida;
}

/** Versão simples da máscara (o núcleo usa os globs do crate `ignore`). */
export function passaNaMascara(mascara: string | undefined, relativo: string): boolean {
  const globs = (mascara ?? '').split(',').map((g) => g.trim()).filter(Boolean);
  if (!globs.length) return true;
  const casa = (glob: string) => {
    const re = new RegExp(
      '^' + escapar(glob).replace(/\\\*\\\*/g, '.*').replace(/\\\*/g, '[^/]*').replace(/\\\?/g, '[^/]') + '$',
    );
    return re.test(glob.includes('/') ? relativo : relativo.split('/').pop()!);
  };
  const inclui = globs.filter((g) => !g.startsWith('!'));
  const exclui = globs.filter((g) => g.startsWith('!')).map((g) => g.slice(1));
  return (!inclui.length || inclui.some(casa)) && !exclui.some(casa);
}
