import { inject, Injectable, isDevMode, signal } from '@angular/core';
import { GitService } from './git.service';
import { ponte } from '../nucleo/ponte';
import { MensagensService } from '../nucleo/mensagens.service';
import { MergeService } from './merge.service';

/** Um arquivo guardado: o patch dele contra o HEAD de quando foi guardado. */
export interface ArquivoNaPrateleira {
  relativo: string;
  patch: string;
  mais: number;
  menos: number;
  /** Conteúdo guardado como objeto do git (para juntar em três vias se o arquivo mudar). */
  blob?: string;
}

/** Um conjunto de mudanças guardado na prateleira (o "shelf" do IntelliJ). */
export interface ItemDaPrateleira {
  id: string;
  nome: string;
  /** Em milissegundos. */
  data: number;
  branch: string | null;
  arquivos: ArquivoNaPrateleira[];
}

const ARQUIVO = 'seedy-prateleira.json';

/**
 * Prateleira, como o Shelf do IntelliJ: guarda mudanças escolhidas (arquivo a arquivo)
 * com um nome, tira da árvore de trabalho e devolve depois, inteiras ou só alguns
 * arquivos. Diferente do stash, cada item é um patch independente, que dá para
 * aplicar em outra branch e em partes. Fica dentro da pasta .git (nunca vai no commit).
 */
@Injectable({ providedIn: 'root' })
export class PrateleiraService {
  private readonly git = inject(GitService);
  private readonly mensagens = inject(MensagensService);
  private readonly merge = inject(MergeService);

  readonly itens = signal<ItemDaPrateleira[]>([]);
  /** Pasta .git de cada raiz já consultada. */
  private readonly pastasGit = new Map<string, string>();

  constructor() {
    // Só em desenvolvimento: inspecionar pelo DevTools.
    if (isDevMode()) Object.assign(window, { seedyPrateleira: this });
  }

  /** Relê a prateleira do repositório aberto. */
  async carregar(): Promise<void> {
    const caminho = await this.caminho();
    if (!caminho) {
      this.itens.set([]);
      return;
    }
    try {
      const dados = JSON.parse(await ponte.lerArquivo(caminho)) as { itens?: ItemDaPrateleira[] };
      this.itens.set(dados.itens ?? []);
    } catch {
      this.itens.set([]);
    }
  }

  /**
   * Guarda os arquivos (caminhos relativos à raiz do repositório) com um nome e os tira
   * da árvore de trabalho (voltam ao HEAD; arquivos novos somem).
   */
  async guardar(nome: string, relativos: string[]): Promise<boolean> {
    const raiz = this.git.estado()?.raiz;
    if (!raiz) return false;
    const alterados = this.git.alterados().filter((a) => relativos.includes(a.relativo) && a.letra !== 'C');
    if (!alterados.length) {
      this.mensagens.alerta('nada para guardar');
      return false;
    }
    // Renomeado: o caminho antigo vai junto (aparece como apagado depois do reset).
    const todos = [...new Set(alterados.flatMap((a) => (a.de ? [a.de, a.relativo] : [a.relativo])))];
    const novos = alterados.filter((a) => a.letra === '?' || a.letra === 'A' || a.letra === 'R').map((a) => a.relativo);

    // 1. Tudo fora do índice; arquivos novos entram "com intenção" para aparecerem no diff.
    if (!(await this.rodar(raiz, ['reset', '-q', '--', ...todos]))) return false;
    if (novos.length && !(await this.rodar(raiz, ['add', '-N', '--', ...novos]))) return false;

    // 2. Um patch por arquivo (para devolver em partes depois).
    const arquivos: ArquivoNaPrateleira[] = [];
    for (const rel of todos) {
      const r = await ponte.git(raiz, ['diff', '--binary', '--full-index', '--no-color', '--', rel]);
      if (r.codigo !== 0 || !r.saida.trim()) continue;
      const { mais, menos } = contar(r.saida);
      const apagado = /^deleted file mode/m.test(r.saida);
      const blob = apagado ? undefined : (await ponte.git(raiz, ['hash-object', '-w', '--', rel])).saida.trim() || undefined;
      arquivos.push({ relativo: rel, patch: garantirFimDeLinha(r.saida), mais, menos, blob });
    }
    if (!arquivos.length) {
      if (novos.length) await this.rodar(raiz, ['reset', '-q', '--', ...novos]);
      this.mensagens.alerta('nada para guardar: os arquivos não têm diferenças');
      return false;
    }

    // 3. Grava a prateleira ANTES de mexer nos arquivos: se algo falhar, nada se perde.
    const item: ItemDaPrateleira = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      nome,
      data: Date.now(),
      branch: this.git.estado()?.branch ?? null,
      arquivos,
    };
    await this.carregar();
    await this.gravar([item, ...this.itens()]);

    // 4. Desfaz as mudanças na árvore de trabalho aplicando o patch ao contrário.
    const tudo = arquivos.map((a) => a.patch).join('');
    const desfeito = await ponte.git(raiz, ['apply', '-R', '--binary', '--whitespace=nowarn', '-'], tudo);
    if (novos.length) await ponte.git(raiz, ['reset', '-q', '--', ...novos]);
    await this.git.atualizar();
    this.git.versao.update((v) => v + 1);
    if (desfeito.codigo !== 0) {
      this.mensagens.erro(`guardado na prateleira, mas não consegui limpar os arquivos: ${(desfeito.erro || desfeito.saida).trim().split('\n')[0]}`);
      return false;
    }
    this.mensagens.mostrar(`${arquivos.length} ${arquivos.length === 1 ? 'arquivo guardado' : 'arquivos guardados'} na prateleira: ${nome}`);
    return true;
  }

  /**
   * Devolve à árvore de trabalho os arquivos escolhidos do item (todos, se não disser).
   * O que voltou sai da prateleira; o item some quando fica vazio.
   */
  async devolver(id: string, relativos?: string[], manter = false): Promise<boolean> {
    const raiz = this.git.estado()?.raiz;
    const item = this.itens().find((i) => i.id === id);
    if (!raiz || !item) return false;
    const escolhidos = item.arquivos.filter((a) => !relativos || relativos.includes(a.relativo));
    if (!escolhidos.length) return false;
    const patch = escolhidos.map((a) => a.patch).join('');

    // Primeiro tudo de uma vez; se não encaixar, arquivo a arquivo, juntando em três vias
    // o que mudou desde que foi guardado (conflitos abrem no merge de 3 colunas).
    const tudo = await ponte.git(raiz, ['apply', '--binary', '--whitespace=nowarn', '-'], patch);
    const devolvidos: ArquivoNaPrateleira[] = [];
    const falhas: string[] = [];
    let juntados = 0;
    let comConflito = 0;
    if (tudo.codigo === 0) devolvidos.push(...escolhidos);
    else {
      for (const a of escolhidos) {
        const r = await ponte.git(raiz, ['apply', '--binary', '--whitespace=nowarn', '-'], a.patch);
        if (r.codigo === 0) {
          devolvidos.push(a);
          continue;
        }
        const junta = await this.juntar(raiz, a, item.nome);
        if (junta === 'falhou') falhas.push(a.relativo);
        else {
          devolvidos.push(a);
          juntados++;
          if (junta === 'conflito') comConflito++;
        }
      }
    }
    await this.git.atualizar();
    this.git.versao.update((v) => v + 1);

    if (devolvidos.length && !manter) {
      const restantes = item.arquivos.filter((a) => !devolvidos.includes(a));
      const lista = this.itens().flatMap((i) => (i.id !== id ? [i] : restantes.length ? [{ ...i, arquivos: restantes }] : []));
      await this.gravar(lista);
    }
    if (comConflito) {
      this.merge.origemDeles.set(`prateleira: ${item.nome}`);
      this.mensagens.mostrar(`${comConflito} ${comConflito === 1 ? 'arquivo ficou' : 'arquivos ficaram'} em conflito: ␣ m abre o merge`);
    } else if (falhas.length) {
      this.mensagens.erro(`não consegui devolver ${falhas.map((f) => f.split('/').pop()).join(', ')} (continua na prateleira)`);
    } else {
      this.mensagens.mostrar(`${devolvidos.length} ${devolvidos.length === 1 ? 'arquivo devolvido' : 'arquivos devolvidos'}${juntados ? ` (${juntados} juntado em três vias)` : ''}`);
    }
    return !falhas.length;
  }

  /**
   * Junta em três vias: base = o arquivo de quando foi guardado, "seu" = o arquivo agora,
   * "deles" = o que está na prateleira. Com conflito, o índice ganha os 3 estágios (como
   * num merge do git), então o merge em 3 colunas abre esse arquivo.
   */
  private async juntar(raiz: string, a: ArquivoNaPrateleira, nome: string): Promise<'ok' | 'conflito' | 'falhou'> {
    const indice = /^index ([0-9a-f]+)\.\.[0-9a-f]+(?: (\d+))?/m.exec(a.patch);
    const modo = indice?.[2] ?? /^new file mode (\d+)/m.exec(a.patch)?.[1] ?? '100644';
    const curta = indice && !/^0+$/.test(indice[1]) ? indice[1] : null;
    if (!a.blob || !curta) return 'falhou';
    // O índice do patch pode vir abreviado: o update-index precisa do hash inteiro.
    const base = (await ponte.git(raiz, ['rev-parse', '--verify', '--quiet', `${curta}^{blob}`])).saida.trim();
    const existe = await ponte.git(raiz, ['cat-file', '-e', a.blob]);
    const seu = await ponte.git(raiz, ['hash-object', '-w', '--', a.relativo]);
    if (!base || existe.codigo !== 0 || seu.codigo !== 0) return 'falhou';
    const o = seu.saida.trim();
    const r = await ponte.git(raiz, ['merge-file', '--object-id', '-L', 'atual', '-L', 'base', '-L', `prateleira: ${nome}`, o, base, a.blob]);
    const resultado = r.saida.trim();
    if (r.codigo < 0 || !/^[0-9a-f]{40,64}$/.test(resultado)) return 'falhou';
    // Volta ao formato da árvore (fim de linha CRLF, se for o caso) e grava.
    const texto = await ponte.git(raiz, ['cat-file', '--filters', `--path=${a.relativo}`, resultado]);
    if (texto.codigo !== 0) return 'falhou';
    await ponte.gravarArquivo(this.git.absoluto(a.relativo), texto.saida);
    if (r.codigo === 0) return 'ok';
    const estagios = [`0 ${'0'.repeat(40)}\t${a.relativo}`, `${modo} ${base} 1\t${a.relativo}`, `${modo} ${o} 2\t${a.relativo}`, `${modo} ${a.blob} 3\t${a.relativo}`];
    await ponte.git(raiz, ['update-index', '--index-info'], estagios.join('\n') + '\n');
    return 'conflito';
  }

  async apagar(id: string): Promise<void> {
    await this.gravar(this.itens().filter((i) => i.id !== id));
  }

  async renomear(id: string, nome: string): Promise<void> {
    await this.gravar(this.itens().map((i) => (i.id === id ? { ...i, nome } : i)));
  }

  private async gravar(itens: ItemDaPrateleira[]): Promise<void> {
    const caminho = await this.caminho();
    if (!caminho) return;
    await ponte.gravarArquivo(caminho, JSON.stringify({ versao: 1, itens }, null, 1));
    this.itens.set(itens);
  }

  /** O arquivo da prateleira, dentro da pasta .git do repositório (vale para worktrees). */
  private async caminho(): Promise<string | null> {
    const raiz = this.git.estado()?.raiz;
    if (!raiz) return null;
    let pasta = this.pastasGit.get(raiz);
    if (!pasta) {
      const r = await ponte.git(raiz, ['rev-parse', '--absolute-git-dir']);
      if (r.codigo !== 0) return null;
      pasta = r.saida.trim();
      this.pastasGit.set(raiz, pasta);
    }
    const sep = /^[a-zA-Z]:/.test(pasta) ? '\\' : '/';
    return (pasta + '/' + ARQUIVO).replace(/[\\/]/g, sep);
  }

  private async rodar(raiz: string, args: string[]): Promise<boolean> {
    const r = await ponte.git(raiz, args);
    if (r.codigo !== 0) this.mensagens.erro(`prateleira: ${(r.erro || r.saida).trim().split('\n')[0]}`);
    return r.codigo === 0;
  }
}

function contar(patch: string): { mais: number; menos: number } {
  let mais = 0;
  let menos = 0;
  for (const l of patch.split('\n')) {
    if (l.startsWith('+') && !l.startsWith('+++')) mais++;
    else if (l.startsWith('-') && !l.startsWith('---')) menos++;
  }
  return { mais, menos };
}

function garantirFimDeLinha(patch: string): string {
  return patch.endsWith('\n') ? patch : patch + '\n';
}
