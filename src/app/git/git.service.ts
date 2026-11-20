import { computed, effect, inject, Injectable, isDevMode, signal, untracked } from '@angular/core';
import { ponte } from '../nucleo/ponte';
import { ProjetoService } from '../nucleo/projeto.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { EditorService } from '../editor/editor.service';

/** Situação de um arquivo no Git, como letra (a árvore e o commit mostram). */
export type LetraGit = 'M' | 'A' | 'D' | 'R' | 'C' | '?';

export interface ArquivoAlterado {
  /** Caminho relativo à raiz do repositório, com "/". */
  relativo: string;
  caminho: string;
  letra: LetraGit;
  /** Já está no stage (índice). */
  noIndice: boolean;
  /** Para renomeados: de onde veio. */
  de?: string;
}

export interface EstadoGit {
  /** Pasta raiz do repositório (pode ser acima do projeto). */
  raiz: string;
  branch: string | null;
  upstream: string | null;
  aFrente: number;
  atras: number;
  /** Merge, cherry-pick ou rebase parado por conflito. */
  operacao: 'merge' | 'cherry-pick' | 'rebase' | 'revert' | null;
}

export interface Commit {
  hash: string;
  pais: string[];
  autor: string;
  data: number;
  assunto: string;
  refs: RefDoCommit[];
}

export interface RefDoCommit {
  nome: string;
  tipo: 'head' | 'local' | 'remota' | 'tag';
}

export interface Branch {
  nome: string;
  upstream: string | null;
  aFrente: number;
  atras: number;
  atual: boolean;
}

export interface Branches {
  locais: Branch[];
  remotas: Map<string, string[]>;
  tags: string[];
  stash: { ref: string; mensagem: string }[];
}

export interface DetalheDoCommit {
  hash: string;
  autor: string;
  email: string;
  data: number;
  pais: string[];
  mensagem: string;
  arquivos: { relativo: string; letra: LetraGit; mais: number; menos: number; de?: string }[];
}

const SEP = '\x1f';
const FIM = '\x1e';

/**
 * Git do projeto aberto: estado (branch, à frente/atrás, arquivos alterados),
 * leituras (log, branches, commit, diff) e operações (commit, push, pull,
 * checkout...). Tudo passa pelo `git` da máquina, via núcleo.
 */
@Injectable({ providedIn: 'root' })
export class GitService {
  private readonly projeto = inject(ProjetoService);
  private readonly mensagens = inject(MensagensService);
  private readonly editor = inject(EditorService);

  readonly estado = signal<EstadoGit | null>(null);
  readonly alterados = signal<ArquivoAlterado[]>([]);
  /** Muda a cada operação que altera a história (o log se refaz). */
  readonly versao = signal(0);
  /** Operação em andamento (push, pull...), para a interface mostrar. */
  readonly ocupado = signal<string | null>(null);
  /** Remoto principal (origin) e onde ele está (github, gitlab, local...). */
  readonly remoto = signal<{ nome: string; host: string } | null>(null);
  /** Quantos commits o log da tela do Git mostra (a statusline exibe). */
  readonly totalDeCommits = signal(0);

  readonly ehRepositorio = computed(() => !!this.estado());
  readonly conflitos = computed(() => this.alterados().filter((a) => a.letra === 'C'));
  private readonly porCaminho = computed(() => new Map(this.alterados().map((a) => [chave(a.caminho), a])));

  constructor() {
    // Projeto novo ou mudança no disco (inclusive .git/HEAD): relê o estado.
    effect(() => {
      this.projeto.versao();
      this.projeto.mudancas();
      const raiz = this.projeto.raiz();
      untracked(() => this.agendarAtualizacao(raiz));
    });
    this.editor.aoSalvar(() => this.agendarAtualizacao(this.projeto.raiz()));
    // Só em desenvolvimento: inspecionar pelo DevTools.
    if (isDevMode()) (window as unknown as { seedyGit: GitService }).seedyGit = this;
  }

  letraDe(caminho: string): LetraGit | null {
    return this.porCaminho().get(chave(caminho))?.letra ?? null;
  }

  // ---------- leitura ----------

  private temporizador: ReturnType<typeof setTimeout> | undefined;
  private agendarAtualizacao(raiz: string | null): void {
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => void this.atualizar(raiz), 150);
  }

  async atualizar(raiz = this.projeto.raiz()): Promise<void> {
    if (!raiz) {
      this.estado.set(null);
      this.alterados.set([]);
      return;
    }
    const topo = await ponte.git(raiz, ['rev-parse', '--show-toplevel', '--git-dir']);
    if (topo.codigo !== 0) {
      this.estado.set(null);
      this.alterados.set([]);
      return;
    }
    const raizRepo = topo.saida.trim().split(/\r?\n/)[0];
    const r = await ponte.git(raiz, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']);
    if (r.codigo !== 0) return;
    const { estado, alterados } = lerStatus(r.saida, raizRepo);
    estado.operacao = await this.operacaoEmAndamento(raizRepo);
    this.estado.set(estado);
    this.alterados.set(alterados);
    this.remoto.set(await this.remotoPrincipal());
  }

  private async operacaoEmAndamento(raiz: string): Promise<EstadoGit['operacao']> {
    const existe = async (ref: string) => (await ponte.git(raiz, ['rev-parse', '-q', '--verify', ref])).codigo === 0;
    if (await existe('MERGE_HEAD')) return 'merge';
    if (await existe('CHERRY_PICK_HEAD')) return 'cherry-pick';
    if (await existe('REVERT_HEAD')) return 'revert';
    for (const pasta of ['rebase-merge', 'rebase-apply']) {
      const r = await ponte.git(raiz, ['rev-parse', '--git-path', pasta]);
      const caminho = r.saida.trim();
      const absoluto = /^([a-zA-Z]:|\/)/.test(caminho) ? caminho : `${raiz}/${caminho}`;
      if (r.codigo === 0 && (await ponte.lerPasta(absoluto).then(() => true, () => false))) return 'rebase';
    }
    return null;
  }

  /** Commits (todas as branches ou só a atual), na ordem do grafo. */
  async log(todas: boolean, limite = 400): Promise<Commit[]> {
    const raiz = this.raizRepo();
    if (!raiz) return [];
    const quais = todas ? ['--branches', '--remotes', '--tags', 'HEAD'] : ['HEAD'];
    const r = await this.rodar(['log', ...quais, '--topo-order', `-n${limite}`, `--format=%H${SEP}%P${SEP}%an${SEP}%at${SEP}%s${SEP}%D${FIM}`]);
    return r
      .split(FIM)
      .map((l) => l.replace(/^\s+/, ''))
      .filter(Boolean)
      .map((l) => {
        const [hash, pais, autor, data, assunto, refs] = l.split(SEP);
        return { hash, pais: pais ? pais.split(' ') : [], autor, data: Number(data), assunto, refs: lerRefs(refs ?? '') };
      });
  }

  async branches(): Promise<Branches> {
    const r = await this.rodar([
      'for-each-ref',
      `--format=%(refname)${SEP}%(upstream:short)${SEP}%(upstream:track)${SEP}%(HEAD)`,
      'refs/heads',
      'refs/remotes',
      'refs/tags',
    ]);
    const locais: Branch[] = [];
    const remotas = new Map<string, string[]>();
    const tags: string[] = [];
    for (const linha of r.split(/\r?\n/).filter(Boolean)) {
      const [ref, upstream, track, head] = linha.split(SEP);
      if (ref.startsWith('refs/heads/')) {
        locais.push({
          nome: ref.slice(11),
          upstream: upstream || null,
          aFrente: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
          atras: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
          atual: head === '*',
        });
      } else if (ref.startsWith('refs/remotes/')) {
        const [remoto, ...resto] = ref.slice(13).split('/');
        const nome = resto.join('/');
        if (nome === 'HEAD') continue;
        remotas.set(remoto, [...(remotas.get(remoto) ?? []), nome]);
      } else if (ref.startsWith('refs/tags/')) {
        tags.push(ref.slice(10));
      }
    }
    const st = await this.rodar(['stash', 'list', `--format=%gd${SEP}%s`]).catch(() => '');
    const stash = st
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => {
        const [ref, msg] = l.split(SEP);
        return { ref, mensagem: msg.replace(/^On [^:]+: /, '') };
      });
    tags.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return { locais, remotas, tags, stash };
  }

  async detalhe(hash: string): Promise<DetalheDoCommit> {
    const cab = await this.rodar(['show', '-s', `--format=%H${SEP}%an${SEP}%ae${SEP}%at${SEP}%P${SEP}%B`, hash]);
    const [h, autor, email, data, pais, ...msg] = cab.split(SEP);
    const listaPais = pais ? pais.trim().split(' ').filter(Boolean) : [];
    const base = listaPais[0];
    const contra = base ? ['diff', '-M', base, h] : ['show', '-M', '--format=', h];
    const [numstat, status] = await Promise.all([this.rodar([...contra, '--numstat']), this.rodar([...contra, '--name-status'])]);
    const letras = new Map<string, { letra: LetraGit; de?: string }>();
    for (const l of status.split(/\r?\n/).filter(Boolean)) {
      const [st, a, b] = l.split('\t');
      const letra = (st[0] === 'R' ? 'R' : st[0] === 'A' ? 'A' : st[0] === 'D' ? 'D' : 'M') as LetraGit;
      letras.set(b ?? a, { letra, de: b ? a : undefined });
    }
    const arquivos = numstat
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => {
        const [mais, menos, ...nome] = l.split('\t');
        // Renomeado aparece como "a => b" ou "dir/{a => b}".
        const bruto = nome.join('\t');
        const relativo = bruto.includes('=>') ? bruto.replace(/\{([^}]*) => ([^}]*)\}/, '$2').replace(/^.* => /, '') : bruto;
        const info = letras.get(relativo) ?? { letra: 'M' as LetraGit };
        return { relativo, letra: info.letra, de: info.de, mais: Number(mais) || 0, menos: Number(menos) || 0 };
      });
    return { hash: h.trim(), autor, email, data: Number(data), pais: listaPais, mensagem: msg.join(SEP).trim(), arquivos };
  }

  /** Diff unificado de um arquivo num commit (contra o primeiro pai). */
  async diffDoArquivo(hash: string, pais: string[], relativo: string): Promise<string> {
    const args = pais[0] ? ['diff', '-M', pais[0], hash, '--', relativo] : ['show', '-M', '--format=', hash, '--', relativo];
    return this.rodar(args);
  }

  /** Conteúdo de um arquivo numa revisão (`HEAD`, um hash, `:1` base do merge...). Vazio se não existe. */
  async conteudo(rev: string, relativo: string): Promise<string> {
    const raiz = this.raizRepo();
    if (!raiz) return '';
    const r = await ponte.git(raiz, ['show', `${rev}:${relativo}`]);
    return r.codigo === 0 ? r.saida : '';
  }

  /** Caminho relativo à raiz do repositório (com "/"), para os comandos do git. */
  relativo(caminho: string): string | null {
    const raiz = this.raizRepo();
    if (!raiz) return null;
    const c = caminho.replace(/\\/g, '/');
    const r = raiz.replace(/\\/g, '/');
    return chave(c).startsWith(chave(r) + '/') ? c.slice(r.length + 1) : null;
  }

  absoluto(relativo: string): string {
    const raiz = this.raizRepo() ?? '';
    const sep = /^[a-zA-Z]:/.test(raiz) ? '\\' : '/';
    return (raiz + '/' + relativo).replace(/\//g, sep);
  }

  // ---------- operações ----------

  /** Roda uma operação que muda o repositório, com aviso de ocupado e de erro. */
  async operar(rotulo: string, args: string[], sucesso?: string): Promise<boolean> {
    if (this.ocupado()) {
      this.mensagens.erro(`espere terminar: ${this.ocupado()}`);
      return false;
    }
    this.ocupado.set(rotulo);
    this.mensagens.mostrar(`${rotulo}…`);
    try {
      const raiz = this.raizRepo();
      const r = await ponte.git(raiz, args);
      if (r.codigo !== 0) {
        this.mensagens.erro(`${rotulo}: ${resumoDoErro(r.erro || r.saida)}`);
        return false;
      }
      if (sucesso) this.mensagens.mostrar(sucesso);
      return true;
    } finally {
      this.ocupado.set(null);
      this.versao.update((v) => v + 1);
      await this.atualizar();
    }
  }

  async commit(relativos: string[], mensagem: string, emendar: boolean): Promise<boolean> {
    if (!(await this.operar('preparando arquivos', ['add', '-A', '--', ...relativos]))) return false;
    const args = ['commit', '-m', mensagem, ...(emendar ? ['--amend'] : []), '--', ...relativos];
    return this.operar(emendar ? 'emendando o commit' : 'fazendo commit', args, emendar ? 'commit emendado' : 'commit feito');
  }

  async push(): Promise<boolean> {
    const e = this.estado();
    if (!e?.branch) return false;
    // Branch nova, sem upstream: cria no origin, como o IntelliJ.
    const args = e.upstream ? ['push'] : ['push', '-u', 'origin', e.branch];
    return this.operar('enviando (push)', args, 'push feito');
  }

  pull(): Promise<boolean> {
    return this.operar('atualizando (pull)', ['pull', '--no-edit'], 'pull feito');
  }

  fetch(): Promise<boolean> {
    return this.operar('buscando (fetch)', ['fetch', '--all', '--prune'], 'fetch feito');
  }

  checkout(alvo: string): Promise<boolean> {
    return this.operar(`checkout ${alvo}`, ['checkout', alvo], `agora em ${alvo}`);
  }

  /** Checkout de uma branch remota: cria a local que acompanha a remota. */
  checkoutRemota(remoto: string, nome: string): Promise<boolean> {
    return this.operar(`checkout ${nome}`, ['checkout', '-b', nome, '--track', `${remoto}/${nome}`], `agora em ${nome}`);
  }

  criarBranch(nome: string, ponto?: string): Promise<boolean> {
    return this.operar(`criando ${nome}`, ['checkout', '-b', nome, ...(ponto ? [ponto] : [])], `branch ${nome} criada`);
  }

  apagarBranch(nome: string, forcar = false): Promise<boolean> {
    return this.operar(`apagando ${nome}`, ['branch', forcar ? '-D' : '-d', nome], `branch ${nome} apagada`);
  }

  merge(nome: string): Promise<boolean> {
    return this.operar(`merge de ${nome}`, ['merge', '--no-edit', nome], `merge de ${nome} feito`);
  }

  cherryPick(hash: string): Promise<boolean> {
    return this.operar('cherry-pick', ['cherry-pick', hash], 'cherry-pick feito');
  }

  reverter(hash: string): Promise<boolean> {
    return this.operar('revert', ['revert', '--no-edit', hash], 'commit revertido');
  }

  guardarStash(mensagem: string): Promise<boolean> {
    return this.operar('guardando (stash)', ['stash', 'push', '--include-untracked', '-m', mensagem], 'alterações guardadas no stash');
  }

  aplicarStash(ref: string, remover: boolean): Promise<boolean> {
    return this.operar('aplicando stash', ['stash', remover ? 'pop' : 'apply', ref], remover ? 'stash aplicado e removido' : 'stash aplicado');
  }

  apagarStash(ref: string): Promise<boolean> {
    return this.operar('apagando stash', ['stash', 'drop', ref], 'stash apagado');
  }

  /** Desfaz as alterações locais de arquivos (volta ao que está no HEAD). */
  descartar(relativos: string[], novos: string[]): Promise<boolean> {
    const tarefas = [
      relativos.length ? ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...relativos] : null,
      novos.length ? ['clean', '-f', '--', ...novos] : null,
    ].filter((a): a is string[] => !!a);
    return tarefas.reduce<Promise<boolean>>(
      async (ok, args) => (await ok) && this.operar('descartando alterações', args),
      Promise.resolve(true),
    );
  }

  /** Termina o merge/cherry-pick/rebase depois de resolver os conflitos. */
  async concluirOperacao(): Promise<boolean> {
    const op = this.estado()?.operacao;
    if (!op) return true;
    const args = op === 'merge' ? ['commit', '--no-edit', '--cleanup=strip'] : [op, '--continue'];
    return this.operar(`concluindo ${op}`, args, `${op} concluído`);
  }

  abortarOperacao(): Promise<boolean> {
    const op = this.estado()?.operacao;
    if (!op) return Promise.resolve(true);
    return this.operar(`abortando ${op}`, [op, '--abort'], `${op} abortado`);
  }

  async remotoPrincipal(): Promise<{ nome: string; host: string } | null> {
    const r = await this.rodar(['remote', '-v']).catch(() => '');
    const linha = r.split(/\r?\n/).find((l) => l.startsWith('origin')) ?? r.split(/\r?\n/)[0];
    if (!linha) return null;
    const [nome, url] = linha.split(/\s+/);
    const host = /github\.com/.test(url) ? 'github' : /gitlab/.test(url) ? 'gitlab' : /bitbucket/.test(url) ? 'bitbucket' : /^[a-zA-Z]:|^\/|^file:/.test(url) ? 'local' : (/\/\/([^/]+)/.exec(url)?.[1] ?? 'remoto');
    return { nome, host };
  }

  private raizRepo(): string | null {
    return this.estado()?.raiz ?? null;
  }

  /** Roda um comando de leitura e devolve a saída; erro vira exceção. */
  async rodar(args: string[]): Promise<string> {
    const raiz = this.raizRepo() ?? this.projeto.raiz();
    const r = await ponte.git(raiz, args);
    if (r.codigo !== 0) throw new Error(resumoDoErro(r.erro || r.saida));
    return r.saida;
  }
}

/** Chave para comparar caminhos (no Windows, sem diferenciar maiúsculas e barras). */
export function chave(caminho: string): string {
  const c = caminho.replace(/\\/g, '/');
  return /^[a-zA-Z]:/.test(c) ? c.toLowerCase() : c;
}

function resumoDoErro(texto: string): string {
  const linhas = texto.split(/\r?\n/).map((l) => l.replace(/^(error|fatal|hint): /, '').trim()).filter(Boolean);
  return linhas.filter((l) => !/^\(use "git/.test(l)).slice(0, 2).join(' — ') || 'falhou';
}

function lerRefs(texto: string): RefDoCommit[] {
  return texto
    .split(', ')
    .filter(Boolean)
    .flatMap((r): RefDoCommit[] => {
      if (r.startsWith('HEAD -> ')) return [{ nome: r.slice(8), tipo: 'head' }];
      if (r === 'HEAD') return [{ nome: 'HEAD', tipo: 'head' }];
      if (r.startsWith('tag: ')) return [{ nome: r.slice(5), tipo: 'tag' }];
      if (r.endsWith('/HEAD')) return [];
      return [{ nome: r, tipo: r.includes('/') && /^(origin|upstream)\//.test(r) ? 'remota' : 'local' }];
    });
}

/** `git status --porcelain=v2 --branch -z` → estado e arquivos alterados. */
export function lerStatus(saida: string, raiz: string): { estado: EstadoGit; alterados: ArquivoAlterado[] } {
  const estado: EstadoGit = { raiz, branch: null, upstream: null, aFrente: 0, atras: 0, operacao: null };
  const alterados: ArquivoAlterado[] = [];
  const partes = saida.split('\0');
  const absoluto = (rel: string) => {
    const sep = /^[a-zA-Z]:/.test(raiz) ? '\\' : '/';
    return (raiz + '/' + rel).replace(/\//g, sep);
  };
  for (let i = 0; i < partes.length; i++) {
    const p = partes[i];
    if (!p) continue;
    if (p.startsWith('# branch.head ')) estado.branch = p.slice(14) === '(detached)' ? null : p.slice(14);
    else if (p.startsWith('# branch.upstream ')) estado.upstream = p.slice(18);
    else if (p.startsWith('# branch.ab ')) {
      const [a, b] = p.slice(12).split(' ');
      estado.aFrente = Math.abs(Number(a));
      estado.atras = Math.abs(Number(b));
    } else if (p.startsWith('1 ') || p.startsWith('2 ')) {
      const campos = p.split(' ');
      const xy = campos[1];
      const rel = campos.slice(p.startsWith('1 ') ? 8 : 9).join(' ');
      const de = p.startsWith('2 ') ? partes[++i] : undefined;
      alterados.push({ relativo: rel, caminho: absoluto(rel), letra: letraDoXY(xy, !!de), noIndice: xy[0] !== '.', de });
    } else if (p.startsWith('u ')) {
      const rel = p.split(' ').slice(10).join(' ');
      alterados.push({ relativo: rel, caminho: absoluto(rel), letra: 'C', noIndice: false });
    } else if (p.startsWith('? ')) {
      const rel = p.slice(2);
      alterados.push({ relativo: rel, caminho: absoluto(rel), letra: '?', noIndice: false });
    }
  }
  return { estado, alterados };
}

function letraDoXY(xy: string, renomeado: boolean): LetraGit {
  if (renomeado) return 'R';
  if (xy.includes('A')) return 'A';
  if (xy.includes('D')) return 'D';
  return 'M';
}
