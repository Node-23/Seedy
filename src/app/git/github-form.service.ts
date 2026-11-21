import { inject, Injectable, signal } from '@angular/core';
import { GitService } from './git.service';
import { GithubService } from './github.service';
import { ponte } from '../nucleo/ponte';
import { MensagensService } from '../nucleo/mensagens.service';
import { EscolhaService } from '../escolha/escolha.service';

export type TipoDeFormulario = 'pr' | 'issue';

export interface RepositorioRemoto {
  dono: string;
  nome: string;
}

interface Criado {
  number: number;
  html_url: string;
}

/**
 * Criar pull request e issue no GitHub sem sair do Seedy (␣ P / ␣ I), com a conta
 * conectada. O PR vai da branch atual (enviada antes, se preciso) para a base escolhida.
 */
@Injectable({ providedIn: 'root' })
export class GithubFormService {
  private readonly git = inject(GitService);
  private readonly github = inject(GithubService);
  private readonly mensagens = inject(MensagensService);
  private readonly escolha = inject(EscolhaService);

  readonly aberta = signal(false);
  readonly tipo = signal<TipoDeFormulario>('pr');
  readonly repo = signal<RepositorioRemoto | null>(null);
  readonly titulo = signal('');
  readonly corpo = signal('');
  /** PR: branch de origem e as bases possíveis (a principal primeiro). */
  readonly cabeca = signal('');
  readonly base = signal('');
  readonly bases = signal<string[]>([]);
  readonly rascunho = signal(false);
  /** Issue: atribuir à conta conectada. */
  readonly paraMim = signal(true);
  readonly abrirDepois = signal(true);
  readonly enviando = signal(false);
  private focoAnterior: HTMLElement | null = null;

  async abrir(tipo: TipoDeFormulario): Promise<void> {
    if (!this.git.ehRepositorio()) {
      this.mensagens.alerta('este projeto não é um repositório git');
      return;
    }
    if (!this.github.usuario()) {
      await this.github.conectar();
      if (!this.github.usuario()) return;
    }
    const repo = await this.repositorio();
    if (!repo) {
      this.mensagens.erro('o remoto origin não é um repositório do GitHub');
      return;
    }
    this.focoAnterior = document.activeElement as HTMLElement | null;
    try {
      if (tipo === 'pr' && !(await this.prepararPr(repo))) return;
      if (tipo === 'issue') {
        this.titulo.set('');
        this.corpo.set('');
        this.paraMim.set(true);
      }
    } catch (e) {
      this.mensagens.erro(String(e));
      return;
    }
    this.repo.set(repo);
    this.tipo.set(tipo);
    this.aberta.set(true);
  }

  fechar(): void {
    this.aberta.set(false);
    const anterior = this.focoAnterior;
    this.focoAnterior = null;
    if (anterior?.isConnected && anterior !== document.body) queueMicrotask(() => anterior.focus());
  }

  /** Cria o PR ou a issue; devolve true se deu certo (a janela fecha). */
  async enviar(): Promise<boolean> {
    const repo = this.repo();
    const titulo = this.titulo().trim();
    if (!repo || this.enviando()) return false;
    if (!titulo) {
      this.mensagens.erro('escreva o título');
      return false;
    }
    this.enviando.set(true);
    try {
      const caminho = `/repos/${repo.dono}/${repo.nome}`;
      const criado =
        this.tipo() === 'pr'
          ? await ponte.github.api<Criado>('POST', `${caminho}/pulls`, {
              title: titulo,
              body: this.corpo(),
              head: this.cabeca(),
              base: this.base(),
              draft: this.rascunho(),
            })
          : await ponte.github.api<Criado>('POST', `${caminho}/issues`, {
              title: titulo,
              body: this.corpo(),
              ...(this.paraMim() && this.github.usuario() ? { assignees: [this.github.usuario()!.login] } : {}),
            });
      this.mensagens.mostrar(`${this.tipo() === 'pr' ? 'pull request' : 'issue'} #${criado.number} criado`);
      if (this.abrirDepois()) await ponte.github.abrirNoNavegador(criado.html_url).catch(() => undefined);
      this.titulo.set('');
      this.corpo.set('');
      this.fechar();
      return true;
    } catch (e) {
      this.mensagens.erro(String(e));
      return false;
    } finally {
      this.enviando.set(false);
    }
  }

  /** dono/nome do origin, se ele for do github.com (https ou ssh). */
  async repositorio(): Promise<RepositorioRemoto | null> {
    const url = (await this.git.rodar(['remote', 'get-url', 'origin']).catch(() => '')).trim();
    return lerUrlDoGithub(url);
  }

  private async prepararPr(repo: RepositorioRemoto): Promise<boolean> {
    const estado = this.git.estado();
    const branch = estado?.branch;
    if (!branch) {
      this.mensagens.erro('HEAD destacado: faça checkout de uma branch para abrir o PR');
      return false;
    }
    const caminho = `/repos/${repo.dono}/${repo.nome}`;
    const info = await ponte.github.api<{ default_branch: string }>('GET', caminho);
    if (branch === info.default_branch) {
      this.mensagens.erro(`você está na ${branch}: crie uma branch (␣ b) para o pull request`);
      return false;
    }

    // Já existe um PR aberto desta branch? Oferece abrir em vez de criar outro.
    const abertos = await ponte.github.api<Criado[]>('GET', `${caminho}/pulls?state=open&head=${encodeURIComponent(`${repo.dono}:${branch}`)}`);
    if (abertos.length) {
      const abrir = await this.escolha.escolherUm(`JÁ EXISTE O PR #${abertos[0].number}`, [
        { rotulo: 'Abrir no navegador', valor: true },
        { rotulo: 'Cancelar', valor: false },
      ]);
      if (abrir) await ponte.github.abrirNoNavegador(abertos[0].html_url);
      return false;
    }

    // A branch precisa estar no GitHub, com todos os commits.
    if (!estado.upstream || estado.aFrente > 0) {
      const enviar = await this.escolha.escolherUm(
        estado.upstream ? `ENVIAR ${estado.aFrente} ${estado.aFrente === 1 ? 'COMMIT' : 'COMMITS'} ANTES?` : `ENVIAR ${branch} ANTES?`,
        [
          { rotulo: 'Fazer push e continuar', detalhe: estado.upstream ? 'git push' : `cria origin/${branch}`, valor: true },
          { rotulo: 'Cancelar', valor: false },
        ],
        'o pull request usa o que está no GitHub',
      );
      if (!enviar || !(await this.git.push())) return false;
    }

    const lista = await ponte.github.api<{ name: string }[]>('GET', `${caminho}/branches?per_page=100`);
    const nomes = lista.map((b) => b.name).filter((n) => n !== branch);
    const bases = [info.default_branch, ...nomes.filter((n) => n !== info.default_branch)];
    this.bases.set(bases);
    this.base.set(bases[0]);
    this.cabeca.set(branch);
    this.rascunho.set(false);
    await this.sugerirTexto(branch, bases[0]);
    return true;
  }

  /** Título e descrição a partir dos commits que só a branch tem (como o IntelliJ). */
  async sugerirTexto(branch: string, base: string): Promise<void> {
    const log = await this.git.rodar(['log', '--no-merges', '--format=%s', `origin/${base}..HEAD`]).catch(() => '');
    const assuntos = log.split(/\r?\n/).filter(Boolean).reverse();
    this.titulo.set(assuntos.length === 1 ? assuntos[0] : tituloDaBranch(branch));
    this.corpo.set(assuntos.length > 1 ? assuntos.map((a) => `- ${a}`).join('\n') : '');
  }
}

/** `https://github.com/dono/nome(.git)` ou `git@github.com:dono/nome(.git)`. */
export function lerUrlDoGithub(url: string): RepositorioRemoto | null {
  const m = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? { dono: m[1], nome: m[2] } : null;
}

/** `feature/limite-de-bancas` → `Limite de bancas`. */
function tituloDaBranch(branch: string): string {
  const t = (branch.split('/').pop() ?? branch).replace(/[-_]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
