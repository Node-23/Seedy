import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { Branches, Commit, DetalheDoCommit, GitService, LetraGit } from './git.service';
import { GithubService } from './github.service';
import { PrateleiraService } from './prateleira.service';
import { DiffService } from './diff.service';
import { LinhaDeDiff, lerDiffUnificado } from './diff';
import { montarGrafo, LinhaDoGrafo } from './grafo';
import { dataCurta, haQuanto } from './tempo';
import { LayoutService } from '../layout/layout.service';
import { EscolhaService } from '../escolha/escolha.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { EditorService } from '../editor/editor.service';

type Foco = 'branches' | 'log' | 'commit';

type ItemDeBranch =
  | { tipo: 'titulo'; texto: string }
  | { tipo: 'local'; nome: string; atual: boolean; aFrente: number; atras: number }
  | { tipo: 'remoto'; nome: string; aberto: boolean }
  | { tipo: 'remota'; remoto: string; nome: string }
  | { tipo: 'tag'; nome: string }
  | { tipo: 'stash'; ref: string; mensagem: string }
  | { tipo: 'prateleira'; id: string; nome: string; arquivos: number; branch: string | null };

const CORES = ['--destaque', '--rosa', '--sucesso', '--aviso', '--erro'];
const ALTURA = 40;
const PASSO = 20;
const MARGEM = 14;
const LIMITE_DO_DIFF = 400;

/**
 * Tela do Git (mockup 04): branches à esquerda, log com o grafo no meio,
 * o commit selecionado (arquivos e diff) à direita. Tudo pelo teclado:
 * h/l trocam de painel, j/k navegam, esc volta ao editor.
 */
@Component({
  selector: 'sd-git',
  template: `
    <div class="git-tela" (keydown)="teclarGeral($event)">
      <!-- BRANCHES -->
      <section #painelBranches class="painel git-branches" [class.focado]="foco() === 'branches'" tabindex="0"
               aria-label="Branches" (focus)="foco.set('branches')" (keydown)="teclarBranches($event)">
        <div class="painel-faixa"><span class="rotulo">BRANCHES</span><kbd>h</kbd></div>
        <div class="git-branches-lista" role="listbox" aria-label="Branches, tags e stash">
          @for (item of itensBranches(); track $index; let i = $index) {
            @switch (item.tipo) {
              @case ('titulo') { <div class="git-grupo">{{ item.texto }}</div> }
              @default {
                <div class="git-branch" role="option" [id]="'git-branch-' + i"
                     [class.selecionado]="i === selBranch() && foco() === 'branches'"
                     [class.atual]="item.tipo === 'local' && item.atual"
                     [class.recuado]="item.tipo === 'remota'"
                     (click)="selBranch.set(i); foco.set('branches')" (dblclick)="ativarBranch(item)">
                  @switch (item.tipo) {
                    @case ('local') {
                      <span class="git-bolinha">{{ item.atual ? '●' : '' }}</span>
                      <span class="git-nome">{{ item.nome }}</span>
                      <span class="espaco"></span>
                      @if (item.aFrente) { <span class="git-conta-commits">↑{{ item.aFrente }}</span> }
                      @if (item.atras) { <span class="git-conta-commits">↓{{ item.atras }}</span> }
                    }
                    @case ('remoto') { <span class="seta">{{ item.aberto ? '▾' : '▸' }}</span><span class="git-nome">{{ item.nome }}</span> }
                    @case ('remota') { <span class="git-nome">{{ item.nome }}</span> }
                    @case ('tag') { <span class="git-nome">{{ item.nome }}</span> }
                    @case ('stash') { <span class="git-nome">{{ item.mensagem }}</span> }
                    @case ('prateleira') {
                      <span class="git-nome" [title]="item.branch ? 'guardado em ' + item.branch : ''">{{ item.nome }}</span>
                      <span class="espaco"></span>
                      <span class="git-conta-commits">{{ item.arquivos }}</span>
                    }
                  }
                </div>
              }
            }
          }
        </div>
        <div class="git-conta">
          @if (github.usuario(); as u) {
            <button class="git-conta-botao" title="Conta do GitHub (clique para desconectar)" (click)="github.desconectar()">
              @if (u.avatar) { <img [src]="u.avatar" alt="" class="git-avatar" /> }
              <span>&#64;{{ u.login }}</span>
            </button>
            <button class="botao-icone" title="Clonar um repositório seu" aria-label="Clonar do GitHub" (click)="github.clonar()">⤓</button>
          } @else {
            <button class="git-conta-botao" [disabled]="github.conectando()" (click)="github.conectar()">
              {{ github.conectando() ? 'conectando…' : 'conectar GitHub' }}
            </button>
          }
        </div>
        <button class="botao git-nova-branch" (click)="novaBranch()">+ nova branch</button>
      </section>

      <!-- LOG -->
      <section #painelLog class="painel git-log" [class.focado]="foco() === 'log'" tabindex="0" aria-label="Log"
               (focus)="foco.set('log')" (keydown)="teclarLog($event)">
        <div class="painel-faixa">
          <span class="rotulo">LOG</span>
          <label class="git-filtro">
            <span class="destaque-texto">/</span>
            <input #campoFiltro type="text" spellcheck="false" aria-label="Filtrar o log"
                   placeholder="filtrar por autor, mensagem ou hash"
                   [value]="filtro()" (input)="filtro.set($any($event.target).value)" (keydown)="teclarFiltro($event)" />
          </label>
          <span class="espaco"></span>
          <button class="git-todas" (click)="todas.update((v) => !v)" title="Alternar (a)">
            {{ todas() ? 'todas as branches ✓' : 'só a branch atual' }}
          </button>
        </div>
        @if (avisoDeOperacao(); as aviso) {
          <div class="git-aviso">
            <span>{{ aviso }}</span>
            <span class="espaco"></span>
            @if (git.conflitos().length) { <button class="botao" (click)="resolverConflitos()">resolver <kbd>r</kbd></button> }
            @else { <button class="botao destaque" (click)="git.concluirOperacao()">concluir</button> }
            <button class="botao" (click)="git.abortarOperacao()">abortar</button>
          </div>
        }
        <div #listaLog class="git-commits" role="listbox" aria-label="Commits">
          @for (c of visiveis(); track c.commit.hash; let i = $index) {
            <div class="git-commit" role="option" [id]="'git-commit-' + i" [class.selecionado]="i === selecionado()"
                 [attr.aria-selected]="i === selecionado()" (click)="selecionado.set(i); foco.set('log')" (dblclick)="diffCompleto()">
              <svg class="git-grafo" [attr.width]="larguraDoGrafo()" [attr.height]="altura" aria-hidden="true">
                @if (c.linha; as l) {
                  @for (x of l.cima; track $index) { <path [attr.d]="caminho(x.de, x.para, 0)" [style.stroke]="cor(x.cor)" /> }
                  @for (x of l.baixo; track $index) { <path [attr.d]="caminho(x.de, x.para, 1)" [style.stroke]="cor(x.cor)" /> }
                  <circle [attr.cx]="xDe(l.coluna)" [attr.cy]="altura / 2" [attr.r]="c.oco ? 6 : 4.5"
                          [class.oco]="c.oco" [style.stroke]="cor(corDoNo(l))" [style.fill]="c.oco ? null : cor(corDoNo(l))" />
                } @else {
                  <circle [attr.cx]="xDe(0)" [attr.cy]="altura / 2" r="4.5" [style.fill]="cor(0)" [style.stroke]="cor(0)" />
                }
              </svg>
              <span class="git-assunto">
                @for (r of c.commit.refs; track r.nome) {
                  <span class="git-ref" [attr.data-tipo]="r.tipo" [class.principal]="r.tipo === 'local' && ehPrincipal(r.nome)">
                    {{ r.tipo === 'head' ? 'HEAD → ' + r.nome : r.nome }}
                  </span>
                }
                <span class="git-mensagem" [class.suave]="c.commit.pais.length > 1">{{ c.commit.assunto }}</span>
              </span>
              <span class="git-autor suave">{{ c.commit.autor }}</span>
              <span class="git-quando suave">{{ c.quando }}</span>
              <span class="git-hash" [class.destaque-texto]="c.ehHead">{{ c.commit.hash.slice(0, 7) }}</span>
            </div>
          } @empty {
            <div class="busca-vazio suave">{{ carregando() ? 'lendo o histórico…' : git.ehRepositorio() ? 'nada encontrado' : 'este projeto não é um repositório git' }}</div>
          }
        </div>
        <div class="busca-dicas">
          <span><span class="tecla">j k</span> navegar</span>
          <span><span class="tecla">⏎</span> diff</span>
          <span><span class="tecla">c</span> checkout</span>
          <span><span class="tecla">p</span> cherry-pick</span>
          <span><span class="tecla">b</span> nova branch aqui</span>
          <span class="espaco"></span>
          <span>esc volta ao editor</span>
        </div>
      </section>

      <!-- COMMIT -->
      <section #painelCommit class="painel git-detalhe" [class.focado]="foco() === 'commit'" tabindex="0" aria-label="Commit"
               (focus)="foco.set('commit')" (keydown)="teclarCommit($event)">
        <div class="painel-faixa">
          <span class="rotulo">COMMIT</span>
          @if (detalhe(); as d) { <span class="destaque-texto">{{ d.hash.slice(0, 7) }}</span> }
        </div>
        @if (detalhe(); as d) {
          <div class="git-detalhe-mensagem">
            <div class="forte">{{ titulo(d.mensagem) }}</div>
            @if (corpo(d.mensagem); as corpo) { <p>{{ corpo }}</p> }
            <div class="suave">{{ d.autor }} · {{ dataCurta(d.data) }}@if (d.pais.length) { · {{ d.pais.length > 1 ? 'pais' : 'pai' }} {{ curtos(d.pais) }} }</div>
          </div>
          <div class="git-arquivos">
            <div class="git-arquivos-resumo">
              {{ d.arquivos.length }} {{ d.arquivos.length === 1 ? 'arquivo' : 'arquivos' }}
              <span class="git-mais">+{{ total(d, 'mais') }}</span> <span class="git-menos">−{{ total(d, 'menos') }}</span>
            </div>
            @for (a of d.arquivos; track a.relativo; let i = $index) {
              <div class="git-arquivo" [class.selecionado]="i === arquivoSel()" (click)="arquivoSel.set(i)" (dblclick)="diffCompleto()">
                <span class="git-letra" [attr.data-letra]="a.letra">{{ a.letra }}</span>
                <span class="git-nome" [title]="a.relativo">{{ nomeDe(a.relativo) }}</span>
                <span class="espaco"></span>
                @if (a.mais) { <span class="git-mais">+{{ a.mais }}</span> }
                @if (a.menos) { <span class="git-menos">−{{ a.menos }}</span> }
              </div>
            }
          </div>
          <div class="git-diff">
            @for (l of diff(); track $index) {
              <div class="git-diff-linha" [attr.data-tipo]="l.tipo">
                <span class="git-diff-sinal">{{ l.tipo === 'mais' ? '+' : l.tipo === 'menos' ? '−' : '' }}</span><span>{{ l.texto }}</span>
              </div>
            }
          </div>
          <div class="git-detalhe-acoes">
            <button class="botao destaque" (click)="diffCompleto()">diff completo <kbd>⏎</kbd></button>
            <button class="botao" (click)="reverter()">reverter</button>
          </div>
        } @else {
          <div class="busca-vazio suave">selecione um commit</div>
        }
      </section>
    </div>
  `,
})
export class GitComponent {
  protected readonly git = inject(GitService);
  protected readonly github = inject(GithubService);
  private readonly prateleira = inject(PrateleiraService);
  private readonly layout = inject(LayoutService);
  private readonly escolha = inject(EscolhaService);
  private readonly mensagens = inject(MensagensService);
  private readonly diffs = inject(DiffService);
  private readonly editor = inject(EditorService);

  private readonly painelBranches = viewChild<ElementRef<HTMLElement>>('painelBranches');
  private readonly painelLog = viewChild<ElementRef<HTMLElement>>('painelLog');
  private readonly painelCommit = viewChild<ElementRef<HTMLElement>>('painelCommit');
  private readonly campoFiltro = viewChild<ElementRef<HTMLInputElement>>('campoFiltro');
  private readonly listaLog = viewChild<ElementRef<HTMLElement>>('listaLog');

  protected readonly altura = ALTURA;
  protected readonly dataCurta = dataCurta;
  protected readonly foco = signal<Foco>('log');
  protected readonly todas = signal(true);
  protected readonly filtro = signal('');
  protected readonly carregando = signal(false);
  private readonly commits = signal<Commit[]>([]);
  private readonly branches = signal<Branches | null>(null);
  private readonly remotosAbertos = signal(new Set<string>(['origin']));
  protected readonly selecionado = signal(0);
  protected readonly selBranch = signal(1);
  protected readonly detalhe = signal<DetalheDoCommit | null>(null);
  protected readonly arquivoSel = signal(0);
  protected readonly diff = signal<LinhaDeDiff[]>([]);

  private readonly grafo = computed(() => montarGrafo(this.commits()));
  protected readonly larguraDoGrafo = computed(
    () => MARGEM + Math.max(1, ...this.grafo().map((l) => l.largura)) * PASSO - PASSO / 2 + 6,
  );

  /** Commits na tela; com filtro, sem o grafo (as linhas não fariam sentido). */
  protected readonly visiveis = computed(() => {
    const q = this.filtro().trim().toLowerCase();
    const grafo = this.grafo();
    const agora = Date.now() / 1000;
    return this.commits()
      .map((commit, i) => ({
        commit,
        linha: q ? null : grafo[i],
        quando: haQuanto(commit.data, agora),
        ehHead: commit.refs.some((r) => r.tipo === 'head'),
        oco: commit.pais.length > 1 || commit.refs.some((r) => r.tipo === 'head'),
      }))
      .filter(
        (c) =>
          !q ||
          c.commit.assunto.toLowerCase().includes(q) ||
          c.commit.autor.toLowerCase().includes(q) ||
          c.commit.hash.startsWith(q) ||
          c.commit.refs.some((r) => r.nome.toLowerCase().includes(q)),
      );
  });

  protected readonly itensBranches = computed<ItemDeBranch[]>(() => {
    const b = this.branches();
    if (!b) return [];
    const itens: ItemDeBranch[] = [{ tipo: 'titulo', texto: 'LOCAIS' }];
    for (const l of b.locais) itens.push({ tipo: 'local', nome: l.nome, atual: l.atual, aFrente: l.aFrente, atras: l.atras });
    if (b.remotas.size) {
      itens.push({ tipo: 'titulo', texto: 'REMOTAS' });
      for (const [remoto, nomes] of b.remotas) {
        const aberto = this.remotosAbertos().has(remoto);
        itens.push({ tipo: 'remoto', nome: remoto, aberto });
        if (aberto) for (const n of nomes) itens.push({ tipo: 'remota', remoto, nome: n });
      }
    }
    if (b.tags.length) {
      itens.push({ tipo: 'titulo', texto: 'TAGS' });
      for (const t of b.tags) itens.push({ tipo: 'tag', nome: t });
    }
    if (b.stash.length) {
      itens.push({ tipo: 'titulo', texto: 'STASH' });
      for (const s of b.stash) itens.push({ tipo: 'stash', ref: s.ref, mensagem: s.mensagem });
    }
    const prateleira = this.prateleira.itens();
    if (prateleira.length) {
      itens.push({ tipo: 'titulo', texto: 'PRATELEIRA' });
      for (const p of prateleira) itens.push({ tipo: 'prateleira', id: p.id, nome: p.nome, arquivos: p.arquivos.length, branch: p.branch });
    }
    return itens;
  });

  protected readonly avisoDeOperacao = computed(() => {
    const op = this.git.estado()?.operacao;
    const n = this.git.conflitos().length;
    if (!op && !n) return null;
    if (!op) return `${n} ${n === 1 ? 'arquivo em conflito' : 'arquivos em conflito'} (devolvidos da prateleira)`;
    const nome = op === 'cherry-pick' ? 'cherry-pick' : op === 'rebase' ? 'rebase' : op === 'revert' ? 'revert' : 'merge';
    return n ? `${nome} em andamento: ${n} ${n === 1 ? 'arquivo em conflito' : 'arquivos em conflito'}` : `${nome} em andamento, sem conflitos`;
  });

  constructor() {
    // Histórico e branches: ao abrir, a cada operação e ao trocar "todas as branches".
    effect(() => {
      this.git.versao();
      const todas = this.todas();
      const raiz = this.git.estado()?.raiz;
      if (!raiz) return;
      untracked(() => void this.carregar(todas));
    });

    // Detalhe do commit selecionado.
    effect((aoLimpar) => {
      const c = this.visiveis()[this.selecionado()]?.commit;
      let valido = true;
      aoLimpar(() => (valido = false));
      if (!c) {
        this.detalhe.set(null);
        return;
      }
      const t = setTimeout(async () => {
        const d = await this.git.detalhe(c.hash).catch(() => null);
        if (!valido) return;
        this.detalhe.set(d);
        this.arquivoSel.set(0);
      }, 60);
      aoLimpar(() => clearTimeout(t));
    });

    // Diff do arquivo selecionado no commit.
    effect((aoLimpar) => {
      const d = this.detalhe();
      const a = d?.arquivos[this.arquivoSel()];
      let valido = true;
      aoLimpar(() => (valido = false));
      if (!d || !a) {
        this.diff.set([]);
        return;
      }
      void this.git
        .diffDoArquivo(d.hash, d.pais, a.relativo)
        .then((t) => valido && this.diff.set(lerDiffUnificado(t).slice(0, LIMITE_DO_DIFF)))
        .catch(() => valido && this.diff.set([]));
    });

    // Foco no log ao abrir a tela.
    queueMicrotask(() => this.painelLog()?.nativeElement.focus());
  }

  // ---------- desenho ----------

  protected xDe(coluna: number): number {
    return MARGEM + coluna * PASSO;
  }

  /** Metade de cima (0) ou de baixo (1) de uma linha do grafo, com curva quando muda de faixa. */
  protected caminho(de: number, para: number, metade: 0 | 1): string {
    const y0 = metade * (ALTURA / 2);
    const y1 = y0 + ALTURA / 2;
    const x0 = this.xDe(de);
    const x1 = this.xDe(para);
    if (x0 === x1) return `M${x0} ${y0} L${x1} ${y1}`;
    const meio = (y0 + y1) / 2;
    return `M${x0} ${y0} C${x0} ${meio} ${x1} ${meio} ${x1} ${y1}`;
  }

  protected cor(indice: number): string {
    return `var(${CORES[indice % CORES.length]})`;
  }

  protected corDoNo(l: LinhaDoGrafo): number {
    return l.baixo.find((x) => x.de === l.coluna && x.para === l.coluna)?.cor ?? l.cima.find((x) => x.para === l.coluna)?.cor ?? 0;
  }

  protected ehPrincipal(nome: string): boolean {
    return nome === 'main' || nome === 'master';
  }

  protected titulo(msg: string): string {
    return msg.split(/\r?\n/)[0];
  }

  protected corpo(msg: string): string {
    return msg.split(/\r?\n/).slice(1).join('\n').trim();
  }

  protected curtos(hashes: string[]): string {
    return hashes.map((h) => h.slice(0, 7)).join(', ');
  }

  protected total(d: DetalheDoCommit, campo: 'mais' | 'menos'): number {
    return d.arquivos.reduce((s, a) => s + a[campo], 0);
  }

  protected nomeDe(relativo: string): string {
    return relativo.split('/').pop() ?? relativo;
  }

  // ---------- teclado ----------

  protected teclarGeral(e: KeyboardEvent): void {
    if (e.key === 'Escape' && !(e.target as HTMLElement).closest('input')) {
      e.preventDefault();
      this.voltar();
    }
  }

  protected teclarLog(e: KeyboardEvent): void {
    if ((e.target as HTMLElement).closest('input') || e.ctrlKey || e.altKey || e.metaKey) return;
    const total = this.visiveis().length;
    const ir = (i: number) => {
      this.selecionado.set(Math.max(0, Math.min(total - 1, i)));
      queueMicrotask(() => document.getElementById('git-commit-' + this.selecionado())?.scrollIntoView({ block: 'nearest' }));
    };
    switch (e.key) {
      case 'j':
      case 'ArrowDown':
        ir(this.selecionado() + 1);
        break;
      case 'k':
      case 'ArrowUp':
        ir(this.selecionado() - 1);
        break;
      case 'g':
        ir(0);
        break;
      case 'G':
        ir(total - 1);
        break;
      case 'Enter':
        void this.diffCompleto();
        break;
      case 'c':
        void this.checkoutDoCommit();
        break;
      case 'p':
        void this.cherryPick();
        break;
      case 'b':
        void this.novaBranch(this.commitSelecionado()?.hash);
        break;
      case 'r':
        if (this.git.conflitos().length) this.resolverConflitos();
        else void this.reverter();
        break;
      case 'a':
        this.todas.update((v) => !v);
        break;
      case '/':
        this.campoFiltro()?.nativeElement.focus();
        break;
      case 'h':
      case 'ArrowLeft':
        this.focar('branches');
        break;
      case 'l':
      case 'ArrowRight':
        this.focar('commit');
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  protected teclarFiltro(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') this.filtro.set('');
      this.selecionado.set(0);
      this.focar('log');
    }
  }

  protected teclarBranches(e: KeyboardEvent): void {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const itens = this.itensBranches();
    const mover = (passo: number) => {
      let i = this.selBranch();
      do i += passo;
      while (i >= 0 && i < itens.length && itens[i].tipo === 'titulo');
      if (i >= 0 && i < itens.length) this.selBranch.set(i);
      queueMicrotask(() => document.getElementById('git-branch-' + this.selBranch())?.scrollIntoView({ block: 'nearest' }));
    };
    const item = itens[this.selBranch()];
    switch (e.key) {
      case 'j':
      case 'ArrowDown':
        mover(1);
        break;
      case 'k':
      case 'ArrowUp':
        mover(-1);
        break;
      case 'Enter':
        if (item) void this.ativarBranch(item);
        break;
      case 'm':
        if (item?.tipo === 'local' || item?.tipo === 'remota') void this.mergeDe(item);
        break;
      case 'd':
        if (item?.tipo === 'local' || item?.tipo === 'stash' || item?.tipo === 'prateleira') void this.apagar(item);
        break;
      case 'r':
        if (item?.tipo === 'prateleira') void this.renomearPrateleira(item);
        break;
      case 'n':
        void this.novaBranch();
        break;
      case 'l':
      case 'ArrowRight':
        this.focar('log');
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  protected teclarCommit(e: KeyboardEvent): void {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const n = this.detalhe()?.arquivos.length ?? 0;
    switch (e.key) {
      case 'j':
      case 'ArrowDown':
        this.arquivoSel.set(Math.min(n - 1, this.arquivoSel() + 1));
        break;
      case 'k':
      case 'ArrowUp':
        this.arquivoSel.set(Math.max(0, this.arquivoSel() - 1));
        break;
      case 'Enter':
        void this.diffCompleto();
        break;
      case 'h':
      case 'ArrowLeft':
        this.focar('log');
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  // ---------- ações ----------

  private async carregar(todas: boolean): Promise<void> {
    this.carregando.set(true);
    try {
      const [commits, branches] = await Promise.all([this.git.log(todas), this.git.branches(), this.prateleira.carregar()]);
      this.commits.set(commits);
      this.git.totalDeCommits.set(commits.length);
      this.branches.set(branches);
      if (this.selecionado() >= commits.length) this.selecionado.set(0);
      // Seleção começa na branch atual.
      const i = this.itensBranches().findIndex((it) => it.tipo === 'local' && it.atual);
      if (i >= 0 && this.foco() !== 'branches') this.selBranch.set(i);
    } catch (e) {
      this.mensagens.erro(`git: ${(e as Error).message}`);
    } finally {
      this.carregando.set(false);
    }
  }

  private focar(f: Foco): void {
    this.foco.set(f);
    const alvo = f === 'branches' ? this.painelBranches() : f === 'log' ? this.painelLog() : this.painelCommit();
    alvo?.nativeElement.focus();
  }

  private voltar(): void {
    this.layout.tela.set('editor');
    queueMicrotask(() => this.editor.focar());
  }

  private commitSelecionado(): Commit | undefined {
    return this.visiveis()[this.selecionado()]?.commit;
  }

  protected async diffCompleto(): Promise<void> {
    const d = this.detalhe();
    const a = d?.arquivos[this.arquivoSel()];
    if (!d || !a) return;
    const [antes, depois] = await Promise.all([
      d.pais[0] && a.letra !== 'A' ? this.git.conteudo(d.pais[0], a.de ?? a.relativo) : Promise.resolve(''),
      a.letra === 'D' ? Promise.resolve('') : this.git.conteudo(d.hash, a.relativo),
    ]);
    this.diffs.abrir({
      titulo: `${a.relativo} · ${d.hash.slice(0, 7)} ${this.titulo(d.mensagem)}`,
      antes,
      depois,
      rotuloAntes: d.pais[0] ? `pai ${d.pais[0].slice(0, 7)}` : 'vazio',
      rotuloDepois: d.hash.slice(0, 7),
      caminho: a.relativo,
    });
  }

  private async checkoutDoCommit(): Promise<void> {
    const c = this.commitSelecionado();
    if (!c) return;
    const locais = c.refs.filter((r) => r.tipo === 'local' || r.tipo === 'head').map((r) => r.nome);
    const opcoes = [
      ...locais.map((n) => ({ rotulo: `checkout ${n}`, detalhe: 'branch', valor: n })),
      { rotulo: `checkout ${c.hash.slice(0, 7)}`, detalhe: 'HEAD destacado (sem branch)', valor: c.hash },
    ];
    const alvo = opcoes.length === 1 && locais.length === 1 ? locais[0] : await this.escolha.escolherUm('CHECKOUT', opcoes);
    if (alvo) await this.git.checkout(alvo);
  }

  private async cherryPick(): Promise<void> {
    const c = this.commitSelecionado();
    if (!c) return;
    const ok = await this.confirmar(`CHERRY-PICK ${c.hash.slice(0, 7)}?`, `aplica "${c.assunto}" em ${this.git.estado()?.branch ?? 'HEAD'}`);
    if (ok) await this.git.cherryPick(c.hash);
  }

  protected async reverter(): Promise<void> {
    const c = this.commitSelecionado();
    if (!c) return;
    const ok = await this.confirmar(`REVERTER ${c.hash.slice(0, 7)}?`, `cria um commit que desfaz "${c.assunto}"`);
    if (ok) await this.git.reverter(c.hash);
  }

  protected async novaBranch(ponto?: string): Promise<void> {
    const nome = await this.escolha.perguntar('NOVA BRANCH', {
      placeholder: 'feature/nome-da-branch',
      dica: ponto ? `a partir de ${ponto.slice(0, 7)}` : `a partir de ${this.git.estado()?.branch ?? 'HEAD'}`,
    });
    if (nome) await this.git.criarBranch(nome.replace(/\s+/g, '-'), ponto);
  }

  protected async ativarBranch(item: ItemDeBranch): Promise<void> {
    switch (item.tipo) {
      case 'local':
        if (!item.atual) await this.git.checkout(item.nome);
        break;
      case 'remoto': {
        const s = new Set(this.remotosAbertos());
        if (s.has(item.nome)) s.delete(item.nome);
        else s.add(item.nome);
        this.remotosAbertos.set(s);
        break;
      }
      case 'remota': {
        const existe = this.branches()?.locais.some((l) => l.nome === item.nome);
        if (existe) await this.git.checkout(item.nome);
        else await this.git.checkoutRemota(item.remoto, item.nome);
        break;
      }
      case 'tag':
        if (await this.confirmar(`CHECKOUT ${item.nome}?`, 'fica com HEAD destacado (sem branch)')) await this.git.checkout(item.nome);
        break;
      case 'stash': {
        const acao = await this.escolha.escolherUm(`STASH: ${item.mensagem}`, [
          { rotulo: 'Aplicar e remover (pop)', valor: 'pop' as const },
          { rotulo: 'Aplicar e manter', valor: 'apply' as const },
          { rotulo: 'Apagar', valor: 'drop' as const },
        ]);
        if (acao === 'drop') await this.git.apagarStash(item.ref);
        else if (acao) await this.git.aplicarStash(item.ref, acao === 'pop');
        break;
      }
      case 'prateleira':
        await this.devolverDaPrateleira(item);
        break;
    }
  }

  private async mergeDe(item: Extract<ItemDeBranch, { tipo: 'local' | 'remota' }>): Promise<void> {
    const nome = item.tipo === 'remota' ? `${item.remoto}/${item.nome}` : item.nome;
    const atual = this.git.estado()?.branch ?? 'HEAD';
    if (await this.confirmar(`MERGE ${nome} → ${atual}?`, 'conflitos abrem o merge em três colunas')) await this.git.merge(nome);
  }

  /** Devolve da prateleira: escolhe os arquivos (todos marcados) e se mantém a cópia. */
  private async devolverDaPrateleira(item: Extract<ItemDeBranch, { tipo: 'prateleira' }>): Promise<void> {
    const guardado = this.prateleira.itens().find((p) => p.id === item.id);
    if (!guardado) return;
    const arquivos = await this.escolha.escolher(
      `DEVOLVER: ${guardado.nome}`,
      guardado.arquivos.map((a) => ({ rotulo: a.relativo.split('/').pop() ?? a.relativo, detalhe: `+${a.mais} −${a.menos}  ${a.relativo}`, valor: a.relativo, marcada: true })),
      { multipla: true, dica: `guardado ${dataCurta(guardado.data / 1000)}${guardado.branch ? ' em ' + guardado.branch : ''} · os marcados voltam e saem da prateleira` },
    );
    if (arquivos?.length) await this.prateleira.devolver(guardado.id, arquivos);
  }

  private async renomearPrateleira(item: Extract<ItemDeBranch, { tipo: 'prateleira' }>): Promise<void> {
    const nome = await this.escolha.perguntar('RENOMEAR NA PRATELEIRA', { valor: item.nome });
    if (nome) await this.prateleira.renomear(item.id, nome);
  }

  private async apagar(item: Extract<ItemDeBranch, { tipo: 'local' | 'stash' | 'prateleira' }>): Promise<void> {
    if (item.tipo === 'prateleira') {
      if (await this.confirmar('APAGAR DA PRATELEIRA?', `${item.nome}: as mudanças guardadas se perdem`)) await this.prateleira.apagar(item.id);
      return;
    }
    if (item.tipo === 'stash') {
      if (await this.confirmar('APAGAR O STASH?', item.mensagem)) await this.git.apagarStash(item.ref);
      return;
    }
    if (item.atual) {
      this.mensagens.erro('não dá para apagar a branch atual');
      return;
    }
    if (await this.confirmar(`APAGAR ${item.nome}?`, 'só a local; a remota continua')) await this.git.apagarBranch(item.nome);
  }

  protected resolverConflitos(): void {
    this.layout.tela.set('merge');
  }

  private async confirmar(titulo: string, detalhe: string): Promise<boolean> {
    const r = await this.escolha.escolherUm(titulo, [
      { rotulo: 'Sim', detalhe, valor: true },
      { rotulo: 'Cancelar', valor: false },
    ]);
    return r === true;
  }
}

/** Letra de status → classe de cor (usada também pela árvore e pelo commit). */
export function corDaLetra(l: LetraGit): string {
  return l === 'A' || l === '?' ? 'sucesso' : l === 'D' || l === 'C' ? 'erro' : l === 'R' ? 'destaque' : 'aviso';
}
