import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { Recente, RecentesService, TipoDeProjeto } from './recentes.service';
import { ProjetoService } from '../nucleo/projeto.service';
import { NovoProjetoService } from '../novo-projeto/novo-projeto.service';
import { GithubService } from '../git/github.service';
import { haQuanto } from '../git/tempo';
import { nomeBase, noApp, ponte } from '../nucleo/ponte';
import { CAMINHO_DO_LOGO, VIEWBOX_DO_LOGO } from '../marca/logo';
import { SinoComponent } from '../notificacoes/sino.component';

const CHAVE_CARTAO = 'seedy.inicio.semPasseio';

/** A cor da sigla e da etiqueta de cada tipo de projeto (variáveis do tema). */
const COR_DO_TIPO: Record<TipoDeProjeto, string> = {
  'Spring Boot': '--destaque',
  'Java · Maven': '--aviso',
  'Java · Gradle': '--aviso',
  'React · Vite': '--rosa',
  React: '--rosa',
  'Angular · Tauri': '--sucesso',
  Tauri: '--sucesso',
  Angular: '--sucesso',
  Node: '--sucesso',
  pasta: '--texto-suave',
};

const PASSOS = [
  { titulo: 'Tudo pelo teclado', texto: 'Ctrl+Shift+Espaço abre o menu com todas as ações e seus atalhos. Ctrl+P busca arquivos, Ctrl+Shift+F busca no projeto e Ctrl+1 a 9 trocam de arquivo.' },
  { titulo: 'A IA ao lado', texto: 'Alt+A abre a IA em qualquer tela: ela lê o projeto, usa as ferramentas do Seedy e você revisa as alterações antes de aceitar.' },
  { titulo: 'O servidor de aplicação', texto: 'Shift+F10 roda e Shift+F9 depura (WildFly, Tomcat, Spring, main ou script). Em projeto Spring, Alt+Shift+E mostra os endpoints.' },
];

/** Tela de início (mockup 30): aparece quando não há projeto aberto. */
@Component({
  selector: 'sd-inicio',
  imports: [SinoComponent],
  host: { '(window:keydown)': 'teclar($event)' },
  template: `
    <div class="inicio">
      <div class="inicio-topo" data-tauri-drag-region>
        <span data-tauri-drag-region>Seedy</span>
        <div class="inicio-direita">
          <sd-sino />
          <div class="janela">
            <button aria-label="Minimizar" (click)="janela.minimizar()">–</button>
            <button aria-label="Maximizar" (click)="janela.maximizar()">□</button>
            <button aria-label="Fechar" (click)="janela.fechar()">×</button>
          </div>
        </div>
      </div>

      <main class="painel inicio-painel">
        <div class="inicio-marca">
          <img src="marca/icone.png" alt="">
          <div><b>Seedy</b><span class="suave">{{ versao() ? 'versão ' + versao() : '' }}</span></div>
        </div>
        <p class="inicio-sub suave">Crie um projeto do zero, abra uma pasta ou clone um repositório.</p>

        <div class="inicio-acoes">
          <button class="inicio-acao" (click)="novo()">
            <span class="inicio-icone"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></span>
            <span><b>Novo projeto</b><small class="suave">Spring, Maven,<br>Angular e React</small></span><kbd>n</kbd>
          </button>
          <button class="inicio-acao" (click)="abrirPasta()">
            <span class="inicio-icone"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18V6a1 1 0 0 1 1-1h5l2 2.5h9a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/></svg></span>
            <span><b>Abrir pasta</b><small class="suave">um projeto que já<br>está no computador</small></span><kbd>o</kbd>
          </button>
          <button class="inicio-acao" (click)="clonar()">
            <span class="inicio-icone"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7" cy="6" r="2.2"/><circle cx="7" cy="18" r="2.2"/><circle cx="17" cy="8" r="2.2"/><path d="M7 8.2v7.6M17 10.2c0 3.6-5 3.2-10 5.6"/></svg></span>
            <span><b>Clonar repositório</b><small class="suave">do GitHub ou por<br>um endereço git</small></span><kbd>c</kbd>
          </button>
        </div>

        <div class="inicio-titulo">
          <span class="rotulo">PROJETOS RECENTES</span>
          <label class="inicio-busca">
            <input #busca spellcheck="false" autocomplete="off" aria-label="Buscar projeto" placeholder="/ buscar projeto…"
                   [value]="filtro()" (input)="filtrar($any($event.target).value)">
            <kbd>/</kbd>
          </label>
        </div>

        <ul class="inicio-lista" role="listbox" aria-label="Projetos recentes">
          @for (r of visiveis(); track r.caminho; let i = $index) {
            <li class="inicio-projeto" role="option" [class.selecionado]="i === indice()" [attr.aria-selected]="i === indice()"
                [style]="'--cor: var(' + cor(r.tipo) + ')'" (mousemove)="indice.set(i)" (click)="abrir(r)">
              <span class="inicio-sigla" aria-hidden="true">{{ sigla(r) }}</span>
              <span class="inicio-nome"><b>{{ nome(r) }}@if (i === 0 && !filtro()) { <span class="inicio-continuar">continuar</span> }</b><small class="suave">{{ r.caminho }}</small></span>
              <span><span class="inicio-tag">{{ r.tipo }}</span></span>
              <span class="suave inicio-branch">{{ branches()[r.caminho] ? '⎇ ' + branches()[r.caminho] : '' }}</span>
              <span class="suave">{{ quando(r) }}</span>
              <span class="inicio-numero">@if (i < 9) { <kbd>{{ i + 1 }}</kbd> }</span>
            </li>
          } @empty {
            <li class="inicio-vazio suave">{{ filtro() ? 'nenhum projeto com esse nome' : 'os projetos que você abrir aparecem aqui' }}</li>
          }
        </ul>
        @if (visiveis().length) { <div class="inicio-dica suave"><kbd>1–9</kbd> abrir direto <kbd>↑↓</kbd> escolher <kbd>⏎</kbd> abrir <kbd>del</kbd> tirar da lista</div> }

        @if (cartao()) {
          <div class="inicio-cartao">
            <svg class="inicio-fita" width="190" viewBox="0 0 190 100" preserveAspectRatio="none" aria-hidden="true"><path d="M60 100 L190 22 L190 62 L128 100 Z"/><path class="clara" d="M118 0 C122 26 146 46 190 54 L190 0 Z"/></svg>
            <svg class="inicio-broto" [attr.viewBox]="viewBoxDoLogo" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" [attr.d]="logo"/></svg>
            <div class="inicio-cartao-texto"><b>Primeira vez por aqui?</b><div class="suave">Um passeio de 2 minutos pelos atalhos, a IA e o servidor de aplicação.</div></div>
            <button class="botao destaque" (click)="passo.set(0)">começar o passeio <kbd>t</kbd></button>
            <button class="botao" (click)="fecharCartao()">fechar <kbd>x</kbd></button>
          </div>
        }
      </main>

      @if (passo() !== null) {
        <div class="busca escolha" role="dialog" aria-label="Passeio pelo Seedy">
          <div class="painel-faixa"><span class="rotulo">PASSEIO</span><span class="suave">{{ passo()! + 1 }} de {{ passos.length }}</span></div>
          <div class="inicio-passo"><b class="destaque-texto">{{ passos[passo()!].titulo }}</b><p>{{ passos[passo()!].texto }}</p></div>
          <div class="busca-dicas">
            <span><span class="tecla">←→</span> andar</span>
            <span><span class="tecla">⏎</span> {{ passo()! + 1 < passos.length ? 'próximo' : 'concluir' }}</span>
            <span><span class="tecla">esc</span> sair</span>
          </div>
        </div>
      }
    </div>
  `,
})
export class InicioComponent {
  private readonly recentes = inject(RecentesService);
  private readonly projeto = inject(ProjetoService);
  private readonly novoProjeto = inject(NovoProjetoService);
  private readonly github = inject(GithubService);
  private readonly campo = viewChild.required<ElementRef<HTMLInputElement>>('busca');

  protected readonly janela = ponte.janela;
  protected readonly logo = CAMINHO_DO_LOGO;
  protected readonly viewBoxDoLogo = VIEWBOX_DO_LOGO;
  protected readonly passos = PASSOS;

  protected readonly versao = signal('');
  protected readonly filtro = signal('');
  protected readonly indice = signal(0);
  protected readonly branches = signal<Record<string, string | null>>({});
  protected readonly cartao = signal(!localStorage.getItem(CHAVE_CARTAO));
  protected readonly passo = signal<number | null>(null);

  protected readonly visiveis = computed(() => {
    const f = this.filtro().trim().toLowerCase();
    const lista = this.recentes.lista();
    return f ? lista.filter((r) => r.caminho.toLowerCase().includes(f)) : lista;
  });

  constructor() {
    if (noApp()) void ponte.atualizacao.versao().then((v) => this.versao.set(v)).catch(() => {});
    // A branch é lida na hora (uma guardada envelheceria).
    effect(() => {
      const lista = this.recentes.lista();
      untracked(() => {
        for (const r of lista) {
          void ponte.branchAtual(r.caminho).then((b) => this.branches.update((m) => ({ ...m, [r.caminho]: b })));
        }
      });
    });
  }

  protected nome(r: Recente): string {
    return nomeBase(r.caminho);
  }

  /** Duas letras: as iniciais das palavras do nome, ou o começo dele. */
  protected sigla(r: Recente): string {
    const nome = nomeBase(r.caminho);
    const palavras = nome.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[-_. ]+/).filter(Boolean);
    return (palavras.length > 1 ? palavras[0][0] + palavras[1][0] : nome.slice(0, 2)).toUpperCase();
  }

  protected cor(tipo: TipoDeProjeto): string {
    return COR_DO_TIPO[tipo] ?? '--texto-suave';
  }

  protected quando(r: Recente): string {
    return haQuanto(r.quando / 1000);
  }

  protected filtrar(texto: string): void {
    this.filtro.set(texto);
    this.indice.set(0);
  }

  protected novo(): void {
    void this.novoProjeto.abrir();
  }

  protected abrirPasta(): void {
    void this.projeto.escolher();
  }

  protected clonar(): void {
    void this.github.clonarDeOndeQuiser();
  }

  protected abrir(r: Recente): void {
    void this.projeto.abrir(r.caminho);
  }

  protected fecharCartao(): void {
    this.cartao.set(false);
    localStorage.setItem(CHAVE_CARTAO, '1');
  }

  /** Letras soltas valem aqui; com um popup, o menu de atalhos ou outro campo em foco, não. */
  protected teclar(e: KeyboardEvent): void {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.passo() !== null) return this.teclarNoPasseio(e);
    if (document.querySelector('[role="dialog"]')) return;
    const alvo = e.target as HTMLElement | null;
    const naBusca = alvo === this.campo().nativeElement;
    if (!naBusca && alvo?.closest('input, textarea, select')) return;

    const total = this.visiveis().length;
    if (e.key === 'ArrowDown' || (!naBusca && e.key === 'j')) this.indice.set(total ? (this.indice() + 1) % total : 0);
    else if (e.key === 'ArrowUp' || (!naBusca && e.key === 'k')) this.indice.set(total ? (this.indice() + total - 1) % total : 0);
    else if (e.key === 'Enter') {
      if (!naBusca && alvo?.closest('button')) return; // o botão em foco faz o dele
      const r = this.visiveis()[this.indice()];
      if (r) this.abrir(r);
    } else if (naBusca) {
      if (e.key !== 'Escape') return;
      this.filtrar('');
      this.campo().nativeElement.blur();
    } else if (e.key === 'Delete') {
      const r = this.visiveis()[this.indice()];
      if (r) this.recentes.esquecer(r.caminho);
      this.indice.set(Math.max(0, Math.min(this.indice(), this.visiveis().length - 1)));
    } else if (/^[1-9]$/.test(e.key)) {
      const r = this.visiveis()[Number(e.key) - 1];
      if (!r) return;
      this.abrir(r);
    } else if (e.key === '/') this.campo().nativeElement.focus();
    else if (e.key === 'n') this.novo();
    else if (e.key === 'o') this.abrirPasta();
    else if (e.key === 'c') this.clonar();
    else if (e.key === 't' && this.cartao()) this.passo.set(0);
    else if (e.key === 'x' && this.cartao()) this.fecharCartao();
    else return;
    e.preventDefault();
  }

  private teclarNoPasseio(e: KeyboardEvent): void {
    const i = this.passo()!;
    if (e.key === 'Escape') this.passo.set(null);
    else if (e.key === 'ArrowLeft') this.passo.set(Math.max(0, i - 1));
    else if (e.key === 'ArrowRight') this.passo.set(Math.min(PASSOS.length - 1, i + 1));
    else if (e.key === 'Enter') {
      if (i + 1 < PASSOS.length) this.passo.set(i + 1);
      else {
        this.passo.set(null);
        this.fecharCartao();
      }
    } else return;
    e.preventDefault();
  }
}
