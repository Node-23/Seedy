/** Os tipos do menu "Novo" (mockup 40), os esqueletos e os nomes. Sem dependências, para testar à parte. */

export type TipoNovo = 'java' | 'arquivo' | 'pasta' | 'ts' | 'tsx' | 'angular' | 'html' | 'css' | 'json' | 'yaml' | 'xml' | 'sql' | 'md';
export type TipoJava = 'class' | 'interface' | 'record' | 'enum' | 'anotacao';

export interface ItemNovo {
  tipo: TipoNovo;
  /** Marca curta ao lado do nome, como na árvore. */
  marca: string;
  rotulo: string;
  tecla: string;
  grupo: 'java' | 'web' | 'dados';
}

export const ITENS: ItemNovo[] = [
  { tipo: 'java', marca: '☕', rotulo: 'Classe Java…', tecla: 'j', grupo: 'java' },
  { tipo: 'arquivo', marca: '▤', rotulo: 'Arquivo…', tecla: 'a', grupo: 'java' },
  { tipo: 'pasta', marca: '▸', rotulo: 'Pasta…', tecla: 'p', grupo: 'java' },
  { tipo: 'ts', marca: 'TS', rotulo: 'TypeScript', tecla: 't', grupo: 'web' },
  { tipo: 'tsx', marca: 'TS', rotulo: 'Componente React (.tsx)', tecla: 'r', grupo: 'web' },
  { tipo: 'angular', marca: 'TS', rotulo: 'Componente Angular', tecla: 'g', grupo: 'web' },
  { tipo: 'html', marca: '<>', rotulo: 'HTML', tecla: 'h', grupo: 'web' },
  { tipo: 'css', marca: '#', rotulo: 'CSS / SCSS', tecla: 'c', grupo: 'web' },
  { tipo: 'json', marca: '{}', rotulo: 'JSON', tecla: 'n', grupo: 'dados' },
  { tipo: 'yaml', marca: 'YML', rotulo: 'YAML', tecla: 'y', grupo: 'dados' },
  { tipo: 'xml', marca: 'XML', rotulo: 'XML', tecla: 'x', grupo: 'dados' },
  { tipo: 'sql', marca: 'SQL', rotulo: 'SQL', tecla: 's', grupo: 'dados' },
  { tipo: 'md', marca: 'MD', rotulo: 'Markdown', tecla: 'm', grupo: 'dados' },
];

export const TIPOS_JAVA: { tipo: TipoJava; marca: string; rotulo: string }[] = [
  { tipo: 'class', marca: 'C', rotulo: 'Classe' },
  { tipo: 'interface', marca: 'I', rotulo: 'Interface' },
  { tipo: 'record', marca: 'R', rotulo: 'Record' },
  { tipo: 'enum', marca: 'E', rotulo: 'Enum' },
  { tipo: 'anotacao', marca: '@', rotulo: 'Anotação' },
];

const partes = (caminho: string): string[] => caminho.split(/[\\/]+/).filter(Boolean);

/** Numa pasta de fontes Java, o que vier depois dela é o pacote. null: não é pasta de fontes Java. */
export function pacoteDe(pasta: string): string | null {
  const p = partes(pasta);
  for (let i = p.length - 1; i >= 0; i--) {
    if (p[i] === 'java' && (p[i - 1] === 'main' || p[i - 1] === 'test')) return p.slice(i + 1).join('.');
    if (p[i] === 'src') {
      // "src/main" e "src/test" sem o "java" depois (resources, a própria pasta) não são fontes.
      return p[i + 1] === 'main' || p[i + 1] === 'test' ? null : p.slice(i + 1).join('.');
    }
  }
  return null;
}

/** "br.com.mana.Fair" para uma classe numa pasta de fontes; null para o resto. */
export function nomeDaClasse(caminho: string): string | null {
  const arquivo = partes(caminho).at(-1) ?? '';
  const pacote = pacoteDe(partes(caminho).slice(0, -1).join('/'));
  if (!/\.java$/.test(arquivo) || pacote === null) return null;
  return [pacote, arquivo.replace(/\.java$/, '')].filter(Boolean).join('.');
}

/** Os itens na ordem do lugar: Java primeiro em projeto Java; em projeto web, o web primeiro. */
export function ordenar(webPrimeiro: boolean): ItemNovo[] {
  if (!webPrimeiro) return ITENS;
  const base = ITENS.filter((i) => i.tipo === 'arquivo' || i.tipo === 'pasta');
  return [...base, ...ITENS.filter((i) => i.grupo === 'web'), ...ITENS.filter((i) => i.tipo === 'java'), ...ITENS.filter((i) => i.grupo === 'dados')];
}

/** O que impede o nome (null = pode). `/` cria pastas; nada de sair da pasta nem de caracteres proibidos. */
export function problemaNoNome(nome: string): string | null {
  const n = nome.trim();
  if (!n) return 'escreva um nome';
  if (/^[\\/]|^[A-Za-z]:/.test(n)) return 'o nome é dentro da pasta, não um caminho completo';
  const ps = n.split(/[\\/]/);
  if (ps.some((p) => p === '..' || p === '.')) return 'o nome não pode usar . ou .. como pasta';
  if (ps.some((p) => !p)) return 'falta o nome depois da /';
  if (ps.some((p) => /[<>:"|?*\u0000-\u001f]/.test(p))) return 'o nome tem um caractere que o sistema não aceita';
  if (ps.some((p) => /[ .]$/.test(p))) return 'o nome não pode terminar com espaço ou ponto';
  return null;
}

const IDENTIFICADOR = /^[A-Za-z_$][\w$]*$/;
const PALAVRAS = new Set('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null'.split(' '));

/** "dto.ReservaRequest" dentro do pacote da pasta: pacote completo, subpastas e nome da classe. */
export function classeJava(nome: string, pacoteDaPasta: string | null): { nome: string; pacote: string; subpastas: string[] } | string {
  const ps = nome.trim().replace(/\.java$/, '').split(/[./\\]/);
  if (ps.some((p) => !IDENTIFICADOR.test(p) || PALAVRAS.has(p))) return 'esse nome não vale em Java';
  const subpastas = ps.slice(0, -1);
  return { nome: ps.at(-1)!, pacote: [pacoteDaPasta, ...subpastas].filter(Boolean).join('.'), subpastas };
}

export function conteudoJava(tipo: TipoJava, nome: string, pacote: string): string {
  const corpo = {
    class: `public class ${nome} {\n}\n`,
    interface: `public interface ${nome} {\n}\n`,
    record: `public record ${nome}() {\n}\n`,
    enum: `public enum ${nome} {\n}\n`,
    anotacao: `public @interface ${nome} {\n}\n`,
  }[tipo];
  return (pacote ? `package ${pacote};\n\n` : '') + corpo;
}

const pascal = (nome: string): string => nome.split(/[^A-Za-z0-9]+/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join('');
const kebab = (nome: string): string => nome.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

const EXTENSAO: Partial<Record<TipoNovo, string>> = { ts: '.ts', tsx: '.tsx', html: '.html', css: '.css', json: '.json', yaml: '.yml', xml: '.xml', sql: '.sql', md: '.md' };
const JA_TEM: Partial<Record<TipoNovo, RegExp>> = { css: /\.(css|scss|sass|less)$/i, yaml: /\.ya?ml$/i, html: /\.html?$/i };

/** O arquivo (relativo à pasta) e o conteúdo inicial dos tipos prontos. */
export function arquivoDoTipo(tipo: Exclude<TipoNovo, 'java' | 'pasta'>, nome: string): { arquivo: string; conteudo: string } {
  const limpo = nome.trim().replace(/\\/g, '/');
  if (tipo === 'arquivo') return { arquivo: limpo, conteudo: '' };
  const corte = limpo.lastIndexOf('/') + 1;
  const pasta = limpo.slice(0, corte);
  let base = limpo.slice(corte);
  if (tipo === 'angular') {
    base = kebab(base.replace(/(\.component)?(\.ts)?$/i, ''));
    const classe = pascal(base);
    return {
      arquivo: `${pasta}${base}.component.ts`,
      conteudo: `import { Component } from '@angular/core';\n\n@Component({\n  selector: 'app-${base}',\n  template: \`\`,\n})\nexport class ${classe}Component {\n}\n`,
    };
  }
  const extensao = EXTENSAO[tipo]!;
  const temExtensao = (JA_TEM[tipo] ?? new RegExp(`\\${extensao}$`, 'i')).test(base);
  const arquivo = `${pasta}${base}${temExtensao ? '' : extensao}`;
  const semExtensao = base.replace(/\.[^.]+$/, '') || base;
  const conteudo: Partial<Record<TipoNovo, string>> = {
    tsx: `export function ${pascal(semExtensao)}() {\n  return <div></div>;\n}\n`,
    html: '<!doctype html>\n<html lang="pt-BR">\n<head>\n  <meta charset="utf-8">\n  <title></title>\n</head>\n<body>\n</body>\n</html>\n',
    json: '{\n}\n',
    xml: '<?xml version="1.0" encoding="UTF-8"?>\n',
    md: `# ${semExtensao}\n`,
  };
  return { arquivo, conteudo: conteudo[tipo] ?? '' };
}

/** "Nome.ext" já usado: "Nome2.ext", "Nome3.ext"… (a primeira que estiver livre é com quem chama). */
export function outroNome(nome: string, n: number): string {
  const ponto = nome.indexOf('.', 1);
  return ponto < 0 ? `${nome}${n}` : `${nome.slice(0, ponto)}${n}${nome.slice(ponto)}`;
}

/** Uma classe colada com outro nome ou em outro pacote leva os dois junto, como no IntelliJ. */
export function ajustarClasseColada(conteudo: string, antigo: string, novo: string, pacote: string | null): string {
  let saida = antigo === novo ? conteudo : conteudo.replace(new RegExp(`(?<![\\w$])${antigo.replace(/\$/g, '\\$')}(?![\\w$])`, 'g'), novo);
  if (pacote === null) return saida;
  const declaracao = /^[ \t]*package\s+[\w.$]+\s*;[ \t]*(\r?\n)?/m;
  if (!pacote) return saida.replace(declaracao, '');
  if (declaracao.test(saida)) return saida.replace(declaracao, (_, fim) => `package ${pacote};${fim ?? ''}`);
  return `package ${pacote};\n\n${saida}`;
}
