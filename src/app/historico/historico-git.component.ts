import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { DiffService } from '../git/diff.service';
import { GitService } from '../git/git.service';
import { dataCurta } from '../git/tempo';
import { EditorService } from '../editor/editor.service';
import { LayoutService } from '../layout/layout.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { ponte } from '../nucleo/ponte';
import { ComparacaoComponent } from './comparacao.component';
import { HistoricoService } from './historico.service';
import { CommitDoArquivo, FORMATO, lerLogDoArquivo, lerLogDoTrecho } from './log-do-arquivo';

const LIMITE = 200;

/**
 * Histórico no Git de um arquivo ou trecho (mockup 48). Teclado: j/k escolhem o commit,
 * / filtra, ⏎ mostra o commit na tela do Git, d compara com o atual, y copia o hash,
 * t alterna arquivo todo / trecho, ]c / [c andam nas mudanças, esc sai.
 */
@Component({
  selector: 'sd-historico-git',
  imports: [ComparacaoComponent],
  template: `
    <section class="painel historico" aria-label="Histórico no Git">
      <div class="painel-faixa">
        <span class="rotulo">HISTÓRICO NO GIT</span>
        <span>{{ nome() }}</span>
        @if (trecho(); as t) { <span class="suave">linhas {{ t.de }} a {{ t.ate }}</span> }
        <span class="espaco"></span>
        <span class="mdv-modos" role="group" aria-label="Quanto do arquivo">
          <button [class.sel]="!trecho()" [attr.aria-pressed]="!trecho()" (click)="soTrecho.set(false)">arquivo todo</button>
          <button [class.sel]="!!trecho()" [attr.aria-pressed]="!!trecho()" [disabled]="!historico.alvo()?.linhas" (click)="soTrecho.set(true)">trecho selecionado</button>
        </span>
        <kbd>Alt+Shift+F</kbd><kbd>esc</kbd>
      </div>
      <div class="historico-corpo">
        <div class="historico-lado">
          <input #campo class="novo-arquivo-nome historico-filtro" placeholder="filtrar por mensagem ou autor…" aria-label="Filtrar" spellcheck="false"
                 [value]="filtro()" (input)="filtro.set(campo.value); indice.set(0)" (keydown)="teclarNoFiltro($event)">
          <div #lista class="historico-lista" role="listbox" tabindex="0" (keydown)="teclar($event)">
            @for (c of visiveis(); track c.hash; let n = $index) {
              <div class="historico-item" role="option" [class.sel]="n === indice()" [attr.aria-selected]="n === indice()" (click)="indice.set(n)" (dblclick)="verCommit()">
                <span class="quando suave">{{ data(c.data) }}</span>
                <span class="texto">
                  @for (r of c.refs; track r) { <span class="historico-ref">{{ r }}</span> }{{ c.assunto }}
                  <small class="suave">{{ c.hash.slice(0, 7) }} · {{ c.autor === eu() ? 'você' : c.autor }}</small>
                </span>
                <span class="contas"><span class="git-mais">+{{ c.mais }}</span> <span class="git-menos">−{{ c.menos }}</span></span>
              </div>
            } @empty {
              <p class="suave historico-vazio">{{ carregando() ? 'lendo o histórico…' : erro() || (filtro() ? 'nenhum commit com isso' : 'este arquivo ainda não foi commitado') }}</p>
            }
          </div>
          <div class="historico-nota suave">
            {{ visiveis().length }} {{ visiveis().length === 1 ? 'commit mexeu' : 'commits mexeram' }} {{ trecho() ? 'neste trecho' : 'neste arquivo' }}
            @if (trecho() && sujo()) { <br>as linhas são as do último commit: o arquivo tem alterações }
          </div>
        </div>
        <div class="historico-diff">
          @if (conteudos(); as d) {
            <div class="historico-lados suave">
              <span><span class="git-menos">−</span> antes de {{ d.curto }}</span>
              <span><span class="git-mais">+</span> {{ d.curto }}</span>
            </div>
            <sd-comparacao [antes]="d.antes" [depois]="d.depois" [caminho]="d.caminho" [linhaAntes]="d.linhaAntes" [linhaDepois]="d.linhaDepois" />
          } @else {
            <p class="suave historico-vazio"></p>
          }
          <div class="historico-pe suave">
            <span><span class="destaque-texto">j k</span> commits</span><span><span class="destaque-texto">/</span> filtrar</span>
            <span class="espaco"></span>
            <button class="botao" [disabled]="!atual()" (click)="copiarHash()">copiar o hash <kbd>y</kbd></button>
            <button class="botao" [disabled]="!atual()" (click)="compararComOAtual()">comparar com o atual <kbd>d</kbd></button>
            <button class="botao destaque" [disabled]="!atual()" (click)="verCommit()">ver o commit <kbd>⏎</kbd></button>
          </div>
        </div>
      </div>
    </section>
  `,
})
export class HistoricoGitComponent {
  protected readonly historico = inject(HistoricoService);
  private readonly git = inject(GitService);
  private readonly editor = inject(EditorService);
  private readonly layout = inject(LayoutService);
  private readonly mensagens = inject(MensagensService);
  private readonly diff = inject(DiffService);
  private readonly lista = viewChild.required<ElementRef<HTMLDivElement>>('lista');
  private readonly campo = viewChild.required<ElementRef<HTMLInputElement>>('campo');
  private readonly comparacao = viewChild(ComparacaoComponent);

  protected readonly soTrecho = signal(true);
  protected readonly filtro = signal('');
  protected readonly indice = signal(0);
  protected readonly carregando = signal(true);
  protected readonly erro = signal('');
  protected readonly eu = signal('');
  private readonly commits = signal<CommitDoArquivo[]>([]);
  protected readonly conteudos = signal<{ antes: string; depois: string; caminho: string; curto: string; linhaAntes: number; linhaDepois: number } | null>(null);
  private teclaAnterior = '';

  protected readonly data = dataCurta;
  protected readonly trecho = computed(() => (this.soTrecho() ? (this.historico.alvo()?.linhas ?? null) : null));
  private readonly relativo = computed(() => this.git.relativo(this.historico.alvo()?.caminho ?? '') ?? '');
  protected readonly nome = computed(() => this.relativo().slice(this.relativo().lastIndexOf('/') + 1));
  protected readonly sujo = computed(() => !!this.git.letraDe(this.historico.alvo()?.caminho ?? ''));

  protected readonly visiveis = computed(() => {
    const q = this.filtro().trim().toLowerCase();
    return this.commits().filter((c) => !q || c.assunto.toLowerCase().includes(q) || c.autor.toLowerCase().includes(q) || c.hash.startsWith(q));
  });
  protected readonly atual = computed(() => this.visiveis()[this.indice()] ?? null);

  constructor() {
    void this.git.rodar(['config', 'user.name']).then((n) => this.eu.set(n.trim()), () => undefined);
    effect((aoLimpar) => {
      const rel = this.relativo();
      const trecho = this.trecho();
      let valido = true;
      aoLimpar(() => (valido = false));
      if (!rel) return;
      untracked(() => {
        this.carregando.set(true);
        this.erro.set('');
        const args = trecho
          ? ['log', `-n${LIMITE}`, `--format=${FORMATO}`, `-L${trecho.de},${trecho.ate}:${rel}`]
          : ['log', `-n${LIMITE}`, '--follow', '-M', '--numstat', `--format=${FORMATO}`, '--', rel];
        void this.git.rodar(args).then(
          (saida) => valido && this.mostrar(trecho ? lerLogDoTrecho(saida, rel) : lerLogDoArquivo(saida, rel)),
          (e) => {
            if (!valido) return;
            this.erro.set(String(e instanceof Error ? e.message : e));
            this.mostrar([]);
          },
        );
      });
    });
    effect((aoLimpar) => {
      const c = this.atual();
      let valido = true;
      aoLimpar(() => (valido = false));
      if (!c) return void this.conteudos.set(null);
      untracked(() => void this.ler(c).then((d) => valido && this.conteudos.set(d)));
    });
  }

  private mostrar(commits: CommitDoArquivo[]): void {
    this.commits.set(commits);
    this.indice.set(0);
    this.carregando.set(false);
    setTimeout(() => this.lista().nativeElement.focus());
  }

  private async ler(c: CommitDoArquivo) {
    const base = { caminho: this.historico.alvo()!.caminho, curto: c.hash.slice(0, 7), linhaAntes: c.linhaAntes ?? 1, linhaDepois: c.linhaDepois ?? 1 };
    if (c.antes !== undefined) return { ...base, antes: c.antes, depois: c.depois! };
    const [antes, depois] = await Promise.all([this.git.conteudo(`${c.hash}^`, c.caminhoAntes), this.git.conteudo(c.hash, c.caminho)]);
    return { ...base, antes, depois };
  }

  protected verCommit(): void {
    const c = this.atual();
    if (!c) return;
    this.git.irParaCommit.set(c.hash);
    this.layout.tela.set('git');
  }

  protected async compararComOAtual(): Promise<void> {
    const c = this.atual();
    const caminho = this.historico.alvo()?.caminho;
    if (!c || !caminho) return;
    const antes = await this.git.conteudo(c.hash, c.caminho);
    const buffer = this.editor.bufferDe(caminho);
    const depois = buffer ? buffer.modelo.getValue() : await ponte.lerArquivo(caminho).catch(() => '');
    const semCr = (t: string) => t.replace(/\r\n/g, '\n');
    this.diff.abrir({ titulo: `${this.nome()} · ${c.hash.slice(0, 7)} e o atual`, antes: semCr(antes), depois: semCr(depois), rotuloAntes: c.hash.slice(0, 7), rotuloDepois: 'agora', caminho });
  }

  protected async copiarHash(): Promise<void> {
    const c = this.atual();
    if (!c) return;
    try {
      await navigator.clipboard.writeText(c.hash);
      this.mensagens.mostrar(`copiado: ${c.hash.slice(0, 7)}`);
    } catch {
      this.mensagens.alerta('não consegui copiar');
    }
  }

  private mover(d: number): void {
    this.indice.set(Math.max(0, Math.min(this.visiveis().length - 1, this.indice() + d)));
    setTimeout(() => this.lista().nativeElement.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }));
  }

  protected teclarNoFiltro(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') this.mover(1);
    else if (e.key === 'ArrowUp') this.mover(-1);
    else if (e.key === 'Enter' || e.key === 'Escape') {
      if (e.key === 'Escape') this.filtro.set('');
      this.lista().nativeElement.focus();
    } else return void e.stopPropagation();
    e.preventDefault();
    e.stopPropagation();
  }

  protected teclar(e: KeyboardEvent): void {
    if (e.ctrlKey || e.altKey || e.metaKey || e.key === 'Shift') return;
    const combo = this.teclaAnterior + e.key;
    this.teclaAnterior = '';
    if (e.key === 'j' || e.key === 'ArrowDown') this.mover(1);
    else if (e.key === 'k' || e.key === 'ArrowUp') this.mover(-1);
    else if (combo === ']c') this.comparacao()?.mudanca(1);
    else if (combo === '[c') this.comparacao()?.mudanca(-1);
    else if (e.key === ']' || e.key === '[') this.teclaAnterior = e.key;
    else if (e.key === '/') this.campo().nativeElement.focus();
    else if (e.key === 'Enter') this.verCommit();
    else if (e.key === 'd') void this.compararComOAtual();
    else if (e.key === 'y') void this.copiarHash();
    else if (e.key === 't' && this.historico.alvo()?.linhas) this.soTrecho.update((v) => !v);
    else if (e.key === 'Escape') this.historico.fechar();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
}
