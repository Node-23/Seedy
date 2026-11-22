import { AnexosService } from '../ia/anexos.service';
import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { NOMES_DO_TIPO, SIGLA_DO_TIPO, TestesService, FiltroDeTipo } from './testes.service';
import { EntenderService } from '../entender/entender.service';
import { TesteInfo, TipoDeTeste } from '../nucleo/ponte';

const TIPOS: FiltroDeTipo[] = ['todos', 'unitario', 'integracao', 'api', 'e2e'];

/**
 * Tela de testes em tela cheia (␣ E): a árvore de testes (unitários, integração, API e e2e), o
 * detalhe do que falhou, a saída do comando e o resumo das regras de negócio cobertas.
 */
@Component({
  selector: 'sd-tela-testes',
  template: `
    <div class="testes-tela" tabindex="0" #raiz (keydown)="teclar($event)">
      <div class="debug-faixa testes-topo">
        <span class="aba-titulo">⚗ Testes</span>
        <button class="botao destaque" [disabled]="!!t.rodando()" (click)="t.rodar(filtroAtivo())">▶ rodar tudo <kbd>r</kbd></button>
        <button class="botao" [disabled]="!!t.rodando()" (click)="t.rodarFalhas()">▶ só as que falharam <kbd>f</kbd></button>
        <button class="botao" [disabled]="!!t.rodando()" (click)="rodarClasseDoCursor()">▶ a classe do cursor <kbd>c</kbd></button>
        <button class="botao" [disabled]="!t.rodando()" (click)="t.parar()">◼ parar</button>
        <button class="botao" [disabled]="!t.totais().falhou" (click)="anexos.anexarFalhasDosTestes()" title="manda todos os testes que falharam para o chat da IA">✦ falhas para a IA <kbd>i</kbd></button>
        <span class="espaco"></span>
        @if (t.rodando()) { <span class="aviso-texto">rodando… {{ t.comandoAtual() }}</span> }
        @else {
          <span class="testes-totais"><span class="sucesso-texto">✓ {{ t.totais().ok }}</span> <span class="erro-texto">✗ {{ t.totais().falhou }}</span>
            @if (t.totais().ignorado) { <span class="suave">○ {{ t.totais().ignorado }} ignorados</span> }
            @if (t.totais().semResultado) { <span class="suave">{{ t.totais().semResultado }} sem resultado</span> }
            <span class="suave">· {{ t.totais().todos }} testes@if (t.ultimaExecucao(); as u) { · {{ u.segundos.toFixed(1) }} s · {{ quando(u.em) }} }</span></span>
        }
      </div>

      <div class="testes-grade">
        <section class="painel testes-arvore" aria-label="Testes">
          <div class="painel-faixa"><span class="rotulo">TESTES</span><span class="espaco"></span>
            <button class="entender-chip" [class.ligado]="t.filtroEstado() === 'todos'" (click)="t.filtroEstado.set('todos')">todos</button>
            <button class="entender-chip" [class.ligado]="t.filtroEstado() === 'falhas'" (click)="t.filtroEstado.set('falhas')">falhas <kbd>x</kbd></button>
            <button class="entender-chip" [class.ligado]="t.filtroEstado() === 'ignorados'" (click)="t.filtroEstado.set('ignorados')">ignorados</button>
          </div>
          <div class="testes-tipos">
            @for (f of tipos; track f) {
              <button class="entender-chip" [class.ligado]="t.filtroTipo() === f" (click)="t.filtroTipo.set(f)">{{ nomeDoFiltro(f) }} {{ contagem(f) }}@if (falhasDe(f); as n) { <span class="erro-texto">✗{{ n }}</span> }</button>
            }
          </div>
          <div class="testes-lista" role="tree">
            @for (l of t.linhas(); track l.chave; let i = $index) {
              @switch (l.tipo) {
                @case ('modulo') {
                  <div class="testes-linha modulo" [class.sel]="i === sel()" (click)="sel.set(i)"><span class="suave">▾</span><b>{{ l.nome }}</b><span class="testes-direita suave">{{ l.total }} testes</span></div>
                }
                @case ('classe') {
                  <div class="testes-linha classe" [class.sel]="i === sel()" [id]="'tst-' + i" (click)="sel.set(i); t.alternarClasse(l.chave)">
                    <span class="suave">{{ l.aberta ? '▾' : '▸' }}</span>{{ icone(l.estado) }}<span>{{ l.nome }}</span><span class="testes-direita suave">{{ l.segundos ? l.segundos.toFixed(1) + ' s' : '' }}</span>
                  </div>
                }
                @case ('teste') {
                  <div class="testes-linha teste" (contextmenu)="menuIa($event, l.teste, i)" [class.sel]="i === sel()" [id]="'tst-' + i" (click)="sel.set(i); t.selecionado.set(l.teste.id)" (dblclick)="t.rodarTeste(l.teste)">
                    {{ icone(l.estado) }}<span [class.erro-texto]="l.estado === 'falhou'">{{ l.teste.metodo }}</span>
                    @if (l.teste.esperaErro) { <span class="aviso-texto" title="cenário de erro">⚠</span> }
                    <span class="testes-direita"><span class="tipo-teste" [attr.data-tipo]="l.teste.tipo">{{ sigla(l.teste.tipo) }}</span><span class="suave">{{ l.segundos ? ms(l.segundos) : '' }}</span></span>
                  </div>
                }
              }
            }
            @if (!t.linhas().length) { <p class="suave testes-vazio">{{ t.lendoCodigo() ? 'lendo o código do projeto para achar os testes…' : t.testes().length ? 'nenhum teste com esse filtro' : 'nenhum teste encontrado neste projeto' }}</p> }
          </div>
          <div class="suave testes-rodape-lista">unitário: <b>surefire</b> · integração: <b>failsafe</b> (*IT) · e2e: script do package.json · <span class="aviso-texto">⚠</span> cenário de erro</div>
        </section>

        <section class="painel testes-detalhe" aria-label="Detalhe do teste">
          @if (t.atual(); as a) {
            <div class="painel-faixa"><span class="rotulo">{{ a.classe.toUpperCase() }}.{{ a.metodo }}</span><span class="espaco"></span>
              @if (t.atualResultado(); as r) { <span [class]="r.estado === 'falhou' ? 'erro-texto' : r.estado === 'ok' ? 'sucesso-texto' : 'suave'">{{ r.estado === 'falhou' ? 'falhou' : r.estado === 'ok' ? 'passou' : 'ignorado' }} · {{ ms(r.segundos) }}</span> }
              @else { <span class="suave">sem resultado</span> }
            </div>
            <div class="testes-detalhe-corpo">
              @if (t.atualResultado(); as r) {
                @if (r.estado === 'falhou') {
                  <div class="erro-texto">{{ r.mensagem || 'falhou' }}</div>
                  @if (r.detalhe) { <pre class="testes-pilha suave">{{ pilha(r.detalhe) }}</pre> }
                }
              }
              @if (trecho().length) {
                <div class="testes-trecho">
                  @for (l of trecho(); track l.n) { <span class="testes-trecho-linha" [class.falha]="l.falha"><span class="n" [class.erro-texto]="l.falha">{{ l.n }}</span>{{ l.texto }}</span> }
                </div>
              }
              <div class="suave testes-secao">{{ a.tipo === 'unitario' ? 'TESTE UNITÁRIO' : a.tipo === 'integracao' ? 'TESTE DE INTEGRAÇÃO' : a.tipo === 'api' ? 'TESTE DE API' : 'TESTE E2E' }}{{ a.esperaErro ? ' · CONFERE UM ERRO' : ' · CAMINHO FELIZ' }}</div>
              @if (regrasDoAtual().length) {
                <div class="suave testes-secao">REGRAS QUE ESTE TESTE COBRE</div>
                <div class="testes-regras">@for (r of regrasDoAtual(); track r.chave) { <span class="entender-chip"><span class="aviso-texto">⚑</span> {{ r.rotulo }}</span> }</div>
              }
            </div>
            <span class="espaco-v"></span>
            <div class="docker-acoes testes-acoes">
              <button class="botao" [disabled]="!!t.rodando()" (click)="t.rodarTeste(a)">▶ rodar este <kbd>⏎</kbd></button>
              <button class="botao" (click)="t.abrirNoCodigo(a)">⇢ abrir no código <kbd>o</kbd></button>
              <button class="botao" [disabled]="t.atualResultado()?.estado !== 'falhou'" (click)="t.explicarFalha(a)"><span class="destaque-texto">✦</span> explicar a falha <kbd>a</kbd></button>
            </div>
          } @else {
            <div class="painel-faixa"><span class="rotulo">DETALHE</span></div>
            <div class="debug-vazio suave">escolha um teste na lista</div>
          }
        </section>

        <section class="painel testes-regras-resumo" aria-label="Regras de negócio">
          <div class="painel-faixa"><span class="rotulo">REGRAS DE NEGÓCIO</span><span class="espaco"></span><kbd>␣ A 2</kbd></div>
          @if (resumo(); as r) {
            <div class="testes-resumo">
              <div class="testes-grande"><b class="destaque-texto">{{ r.comTeste }}</b><span class="suave">de {{ r.regras }} regras com teste ({{ r.regras ? ((r.comTeste / r.regras) * 100).toFixed(0) : 0 }}%)</span></div>
              <div class="barra-cobertura"><i [style.width.%]="r.regras ? (r.comTeste / r.regras) * 100 : 0"></i></div>
              <div class="suave">cenários de erro: <b class="aviso-texto">{{ r.errosCobertos }} de {{ r.errosTotal }}</b> com teste</div>
              <div class="kv-linha"><span class="sucesso-texto k">✓ {{ r.passando }}</span><span>passando</span></div>
              <div class="kv-linha"><span class="erro-texto k">✗ {{ r.falhando }}</span><span>com teste falhando</span></div>
              <div class="kv-linha"><span class="aviso-texto k">○ {{ r.semTeste }}</span><span>sem nenhum teste</span></div>
              <button class="botao" (click)="verRegrasSemTeste()">ver regras sem teste <kbd>g</kbd></button>
            </div>
          }
        </section>

        <section class="painel testes-saida" aria-label="Saída">
          <div class="painel-faixa"><span class="rotulo">SAÍDA</span><span class="suave testes-comando">{{ t.comandoAtual() }}</span></div>
          <div #saida class="testes-saida-linhas">
            @for (l of t.saida(); track $index) { <span class="testes-saida-linha" [class.erro-texto]="l.includes('ERROR') || l.includes('FAIL')">{{ l }}</span> }
            @if (!t.saida().length) { <span class="suave testes-saida-linha">rode os testes (r) para ver a saída aqui</span> }
          </div>
        </section>
      </div>
    </div>
  `,
})
export class TelaTestesComponent {
  protected readonly t = inject(TestesService);
  protected readonly anexos = inject(AnexosService);

  protected menuIa(e: MouseEvent, teste: TesteInfo, i: number): void {
    this.sel.set(i);
    this.t.selecionado.set(teste.id);
    this.anexos.abrirMenu(e, () => this.anexos.doTeste(teste));
  }

  private readonly entender = inject(EntenderService);
  private readonly raiz = viewChild.required<ElementRef<HTMLDivElement>>('raiz');
  private readonly saidaEl = viewChild<ElementRef<HTMLElement>>('saida');

  protected readonly tipos = TIPOS;
  protected readonly sel = signal(0);
  protected readonly trecho = signal<{ n: number; texto: string; falha: boolean }[]>([]);
  protected readonly resumo = computed(() => (this.entender.analise() ? this.t.resumoDaCobertura() : null));
  protected readonly regrasDoAtual = computed(() => {
    const a = this.t.atual();
    return a ? this.t.regrasDoTeste(a) : [];
  });

  constructor() {
    queueMicrotask(() => this.raiz().nativeElement.focus());
    // A linha selecionada manda no detalhe.
    effect(() => {
      const l = this.t.linhas()[this.sel()];
      if (l?.tipo === 'teste') untracked(() => this.t.selecionado.set(l.teste.id));
    });
    effect(() => {
      const a = this.t.atual();
      this.t.resultados();
      untracked(() => {
        this.trecho.set([]);
        if (a && this.t.estadoDe(a) === 'falhou') void this.t.trechoDaFalha(a).then((l) => this.trecho.set(l));
      });
    });
    effect(() => {
      this.t.saida();
      queueMicrotask(() => {
        const el = this.saidaEl()?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      });
    });
  }

  protected filtroAtivo(): FiltroDeTipo {
    return this.t.filtroTipo();
  }

  protected nomeDoFiltro(f: FiltroDeTipo): string {
    return f === 'todos' ? 'todos' : NOMES_DO_TIPO[f];
  }

  protected contagem(f: FiltroDeTipo): number {
    return this.t.totais()[f];
  }

  protected falhasDe(f: FiltroDeTipo): number {
    return f === 'todos' ? this.t.totais().falhou : this.t.totais().falhasPorTipo[f];
  }

  protected sigla(tipo: TipoDeTeste): string {
    return SIGLA_DO_TIPO[tipo];
  }

  protected icone(e: string): string {
    return e === 'ok' ? '✓' : e === 'falhou' ? '✗' : e === 'ignorado' ? '○' : e === 'parcial' ? '◐' : '·';
  }

  protected ms(s: number): string {
    return s >= 1 ? `${s.toFixed(1).replace('.', ',')} s` : `${Math.round(s * 1000)} ms`;
  }

  protected quando(d: Date): string {
    const min = Math.round((Date.now() - d.getTime()) / 60000);
    return min < 1 ? 'agora' : `há ${min} min`;
  }

  /** O stack trace sem as linhas do JUnit/Maven (o que importa é o código do projeto). */
  protected pilha(d: string): string {
    const linhas = d.split('\n').filter((l) => !/at (org\.junit|org\.apache|java\.base|jdk\.internal|org\.opentest4j|org\.mockito|org\.springframework\.test)/.test(l.trim()));
    return linhas.slice(0, 8).join('\n');
  }

  protected verRegrasSemTeste(): void {
    this.t.fechar();
    void this.entender.abrir('regras');
    this.entender.filtroCobertura.set('sem');
  }

  protected rodarClasseDoCursor(): void {
    const l = this.t.linhas()[this.sel()];
    const classe = l?.tipo === 'classe' ? l.nome : l?.tipo === 'teste' ? l.teste.classe : null;
    if (classe) void this.t.rodarClasse(classe);
  }

  protected teclar(e: KeyboardEvent): void {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const linhas = this.t.linhas();
    const atual = linhas[this.sel()];
    const mover = (d: number) => {
      this.sel.set(Math.max(0, Math.min(linhas.length - 1, this.sel() + d)));
      this.raiz().nativeElement.querySelector(`#tst-${this.sel()}`)?.scrollIntoView({ block: 'nearest' });
    };
    switch (e.key) {
      case 'Escape': this.t.fechar(); break;
      case 'j': case 'ArrowDown': mover(1); break;
      case 'k': case 'ArrowUp': mover(-1); break;
      case 'Enter':
        if (atual?.tipo === 'teste') void this.t.rodarTeste(atual.teste);
        else if (atual?.tipo === 'classe') this.t.alternarClasse(atual.chave);
        break;
      case 'l': case 'ArrowRight': if (atual?.tipo === 'classe' && !atual.aberta) this.t.alternarClasse(atual.chave); break;
      case 'h': case 'ArrowLeft': if (atual?.tipo === 'classe' && atual.aberta) this.t.alternarClasse(atual.chave); break;
      case 'r': void this.t.rodar(this.t.filtroTipo()); break;
      case 'f': void this.t.rodarFalhas(); break;
      case 'c': this.rodarClasseDoCursor(); break;
      case 'x': this.t.filtroEstado.set(this.t.filtroEstado() === 'falhas' ? 'todos' : 'falhas'); this.sel.set(0); break;
      case 't': this.t.filtroTipo.set(TIPOS[(TIPOS.indexOf(this.t.filtroTipo()) + 1) % TIPOS.length]); this.sel.set(0); break;
      case 'o': this.t.abrirNoCodigo(); break;
      case 'a': void this.t.explicarFalha(); break;
      case 'i': this.anexos.anexarFalhasDosTestes(); break;
      case 'g': this.verRegrasSemTeste(); break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
  }
}

export type { TesteInfo };
