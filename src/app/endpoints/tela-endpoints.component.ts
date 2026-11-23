import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { AnexosService } from '../ia/anexos.service';
import { EndpointInfo, EndpointsService, VERBOS } from './endpoints.service';

/**
 * Tela de endpoints do Spring (Alt+Shift+E, mockup 28): a lista por controller, o detalhe do que o Seedy leu
 * do código (parâmetros, corpo, acesso, testes que passam pelo endpoint) e o painel de chamada.
 */
@Component({
  selector: 'sd-tela-endpoints',
  template: `
    <div class="testes-tela" tabindex="0" #raiz (keydown)="teclar($event)">
      <div class="debug-faixa testes-topo">
        <span class="aba-titulo">🌐 Endpoints</span>
        <button class="botao destaque" [disabled]="!s.atual()" (click)="s.abrirNoCodigo()">⇢ abrir no código <kbd>⏎</kbd></button>
        <button class="botao" [disabled]="!s.atual() || s.chamando()" (click)="s.chamar()">▶ chamar <kbd>c</kbd></button>
        <button class="botao" [disabled]="!s.atual()" (click)="s.copiarCurl()">⧉ copiar curl <kbd>y</kbd></button>
        <button class="botao" (click)="s.abrirSwagger()">📖 Swagger <kbd>w</kbd></button>
        <button class="botao" (click)="s.abrirActuator()">♥ Actuator <kbd>a</kbd></button>
        <button class="botao" [disabled]="!s.endpointDeLogin()" (click)="s.alternarLogin()" [title]="s.sessao() ? 'sair da sessão (os cookies/token somem)' : 'entrar uma vez: as chamadas protegidas usam o login'">
          @if (s.sessao(); as ss) { <span class="sucesso-texto">🔑 {{ ss.usuario }}</span> · sair } @else { 🔑 entrar }<kbd>L</kbd>
        </button>
        <span class="espaco"></span>
        <span class="testes-totais">
          @if (s.noAr()) { <span class="sucesso-texto">● :{{ s.porta() }} no ar</span> } @else { <span class="suave">○ :{{ s.porta() }} parado</span> }
          <span class="suave">{{ s.contagem().todos }} em {{ s.contagem().controllers }} controllers</span>
        </span>
      </div>

      <div class="endpoints-grade">
        <section class="painel endpoints-lista" aria-label="Endpoints">
          <div class="painel-faixa"><span class="rotulo">ENDPOINTS</span><span class="espaco"></span>
            <input #campoBusca class="endpoints-busca" type="text" spellcheck="false" placeholder="/ buscar caminho…" [value]="s.busca()" (input)="s.busca.set(valor($event))" (keydown)="aoDigitarBusca($event)" />
          </div>
          <div class="testes-tipos">
            <button class="entender-chip" [class.ligado]="s.filtroVerbo() === 'todos'" (click)="s.filtroVerbo.set('todos')">todos {{ s.contagem().todos }}</button>
            @for (v of verbos; track v) {
              @if (s.contagem().porVerbo[v]) { <button class="entender-chip" [class.ligado]="s.filtroVerbo() === v" (click)="s.filtroVerbo.set(v)">{{ v }} {{ s.contagem().porVerbo[v] }}</button> }
            }
            <button class="entender-chip" [class.ligado]="s.soProtegidos()" (click)="s.soProtegidos.set(!s.soProtegidos())"><span class="aviso-texto">🔒</span> protegidos {{ s.contagem().protegidos }} <kbd>p</kbd></button>
          </div>
          <div class="testes-lista" role="tree">
            @for (l of s.linhas(); track l.chave; let i = $index) {
              @if (l.tipo === 'grupo') {
                <div class="endpoint-grupo" [class.sel]="i === sel()" [id]="'epl-' + i" (click)="sel.set(i); s.alternarGrupo(l.chave)">
                  <span class="suave">{{ l.aberto ? '▾' : '▸' }}</span><b>{{ l.controller.nome }}</b><span class="suave">{{ l.controller.rota }}</span><span class="testes-direita">{{ l.total }}</span>
                </div>
              } @else {
                <div class="endpoint-linha" [class.sel]="i === sel()" [id]="'epl-' + i" (click)="escolher(i)" (dblclick)="s.abrirNoCodigo(l.e)">
                  <span class="verbo" [attr.data-verbo]="l.e.verbo">{{ l.e.verbo }}</span><span [class.negrito]="i === sel()">{{ s.urlRelativa(l.e) }}</span>
                  <span class="testes-direita">
                    @if (l.e.http.acesso) { <span class="aviso-texto" [title]="l.e.http.acesso">🔒</span> }
                    @if (nTestes(l.e); as n) { <span [class.erro-texto]="falhando(l.e)" [class.sucesso-texto]="!falhando(l.e)">{{ falhando(l.e) ? '✗' : '✓' }} {{ n }} {{ n === 1 ? 'teste' : 'testes' }}</span> }
                    @else { <span class="suave">sem teste</span> }
                  </span>
                </div>
              }
            } @empty {
              <div class="testes-vazio suave">{{ vazio() }}</div>
            }
          </div>
          <div class="testes-rodape-lista suave"><span class="aviso-texto">🔒</span> exige login · <span class="sucesso-texto">✓</span> testes que passam por ele · <span class="destaque-texto">h l</span> fecha/abre</div>
        </section>

        <section class="painel endpoints-detalhe" aria-label="Detalhe">
          @if (s.atual(); as e) {
            <div class="painel-faixa"><span class="verbo" [attr.data-verbo]="e.verbo">{{ e.verbo }}</span><b>{{ s.urlRelativa(e) }}</b><span class="espaco"></span>
              @if (e.http.acesso) { <span class="endpoint-tag aviso-texto" [title]="e.http.acesso">🔒 {{ e.http.acesso }}</span> }
              @if (e.http.status) { <span class="endpoint-tag sucesso-texto">{{ e.http.status }}</span> }
            </div>
            <div class="testes-detalhe-corpo endpoints-colunas">
              <div>
                <div class="kv-linha"><span class="k suave">método</span><span class="destaque-texto">{{ e.controller.nome }}.{{ e.metodo.nome }}(…)</span></div>
                <div class="kv-linha"><span class="k suave">arquivo</span><span>{{ e.controller.relativo.split('/').pop() }}:{{ e.metodo.linha }}</span></div>
                @if (e.http.consome) { <div class="kv-linha"><span class="k suave">consome</span><span>{{ e.http.consome }}</span></div> }
                @if (e.http.retorno) { <div class="kv-linha"><span class="k suave">devolve</span><span>{{ e.http.retorno }}</span></div> }
                <div class="rotulo testes-secao">PARÂMETROS</div>
                @for (p of e.http.params ?? []; track $index) {
                  <div class="kv-linha"><span class="k rosa-texto">{{ rotuloDe(p.origem) }}</span><span>{{ p.nome }} <span class="suave">{{ p.tipo }}{{ p.padrao ? ' = ' + p.padrao : p.obrigatorio ? '' : ' (opcional)' }}</span></span></div>
                } @empty { <div class="suave">nenhum</div> }
                @if (e.http.acesso) {
                  <div class="rotulo testes-secao">ACESSO</div>
                  <div class="kv-linha"><span class="aviso-texto">🔒</span><span>{{ e.http.acesso }}</span></div>
                }
              </div>
              <div>
                @if (e.http.corpo?.length) {
                  <div class="rotulo">CORPO DA REQUISIÇÃO</div>
                  <div class="testes-trecho">
                    <span class="testes-trecho-linha"><span class="suave">{{ '{' }}</span></span>
                    @for (c of e.http.corpo; track c.nome) {
                      <span class="testes-trecho-linha">  <span class="destaque-texto">"{{ c.nome }}"</span>: <span class="aviso-texto">{{ c.tipo }}</span> @if (obrigatorio(c.restricoes)) { <span class="erro-texto">*</span> } @if (extras(c.restricoes); as x) { <span class="suave"> {{ x }}</span> }</span>
                    }
                    <span class="testes-trecho-linha"><span class="suave">{{ '}' }}</span> @if (temObrigatorio(e)) { <span class="suave">  * obrigatório</span> }</span>
                  </div>
                }
                <div class="rotulo" [class.testes-secao]="e.http.corpo?.length">TESTES QUE PASSAM POR ESTE ENDPOINT</div>
                @for (t of s.testesDe(e); track t.id) {
                  <div class="kv-linha"><span [class.sucesso-texto]="s.estadoDoTeste(t) === 'ok'" [class.erro-texto]="s.estadoDoTeste(t) === 'falhou'" [class.suave]="s.estadoDoTeste(t) !== 'ok' && s.estadoDoTeste(t) !== 'falhou'">{{ s.estadoDoTeste(t) === 'ok' ? '✓' : s.estadoDoTeste(t) === 'falhou' ? '✗' : '·' }}</span><span>{{ t.classe }}.{{ t.metodo }}</span></div>
                } @empty { <div class="suave">nenhum (⚠ sem cobertura)</div> }
              </div>
            </div>
            <div class="testes-acoes">
              <button class="botao destaque" (click)="s.abrirNoCodigo()">⇢ abrir no código <kbd>⏎</kbd></button>
              <button class="botao" [disabled]="s.chamando()" (click)="s.chamar()">▶ chamar agora <kbd>c</kbd></button>
              <button class="botao" (click)="s.copiarCurl()">⧉ copiar curl <kbd>y</kbd></button>
              <button class="botao" (click)="anexos.adicionar(anexos.doEndpoint(e))"><span class="destaque-texto">✦</span> mandar para a IA <kbd>i</kbd></button>
            </div>
          } @else {
            <div class="testes-vazio suave">{{ vazio() }}</div>
          }
        </section>

        <section class="painel endpoints-chamada" aria-label="Chamar">
          <div class="painel-faixa"><span class="rotulo">CHAMAR · {{ s.base() }}</span><span class="espaco"></span>
            @if (s.chamando()) { <span class="aviso-texto">chamando…</span> }
            @else if (s.resposta(); as r) { <span class="endpoint-tag" [class.sucesso-texto]="r.status < 400" [class.erro-texto]="r.status >= 400">{{ r.status }} · {{ r.ms }} ms</span> }
            @if (s.sessao(); as ss) { <span class="sucesso-texto">🔑 {{ ss.usuario }}</span> }
            <span class="suave">editar <kbd>e</kbd> · enviar <kbd>⌃⏎</kbd></span>
          </div>
          <div class="endpoints-chamada-corpo">
            <textarea #campoPedido class="endpoints-pedido" spellcheck="false" [value]="s.pedido()" (input)="s.pedido.set(valor($event))" (keydown)="aoDigitarPedido($event)" placeholder="escolha um endpoint"></textarea>
            <div class="endpoints-resposta">
              @if (s.erroDaChamada(); as erro) { <span class="erro-texto">{{ erro }}</span> }
              @else if (s.resposta(); as r) { <pre class="testes-pilha">{{ s.corpoDaResposta(r) || '(sem corpo)' }}</pre> }
              @else { <span class="suave">a resposta aparece aqui. O token vem do .env: use {{ '{{NOME}}' }} no pedido.</span> }
            </div>
          </div>
        </section>
      </div>
    </div>
  `,
})
export class TelaEndpointsComponent {
  protected readonly s = inject(EndpointsService);
  protected readonly anexos = inject(AnexosService);
  protected readonly verbos = VERBOS;
  protected readonly sel = signal(0);
  private readonly raiz = viewChild.required<ElementRef<HTMLElement>>('raiz');
  private readonly campoBusca = viewChild<ElementRef<HTMLInputElement>>('campoBusca');
  private readonly campoPedido = viewChild<ElementRef<HTMLTextAreaElement>>('campoPedido');

  protected readonly vazio = computed(() =>
    this.s.todos().length ? 'nenhum endpoint com esse filtro' : 'nenhum endpoint achado: o Seedy lê @RestController e @Controller (ainda analisando?)',
  );

  constructor() {
    queueMicrotask(() => this.raiz().nativeElement.focus());
    // A linha selecionada manda no detalhe.
    effect(() => {
      const l = this.s.linhas()[this.sel()];
      if (l?.tipo === 'endpoint') untracked(() => this.s.selecionado.set(l.e.id));
    });
    // A lista mudou (filtro, grupo fechado): mantém o cursor no endpoint escolhido.
    effect(() => {
      const linhas = this.s.linhas();
      untracked(() => {
        const i = linhas.findIndex((l) => l.chave === this.s.selecionado());
        if (i >= 0) this.sel.set(i);
        else if (this.sel() >= linhas.length) this.sel.set(Math.max(0, linhas.length - 1));
      });
    });
  }

  protected valor(e: Event): string {
    return (e.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  protected escolher(i: number): void {
    this.sel.set(i);
    const l = this.s.linhas()[i];
    if (l?.tipo === 'endpoint') this.s.selecionado.set(l.e.id);
  }

  protected nTestes(e: EndpointInfo): number {
    return this.s.testesDe(e).length;
  }

  protected falhando(e: EndpointInfo): boolean {
    return this.s.testesDe(e).some((t) => this.s.estadoDoTeste(t) === 'falhou');
  }

  protected rotuloDe(origem: string): string {
    return { body: '@RequestBody', query: '@RequestParam', path: '@PathVariable', header: '@RequestHeader', cookie: '@CookieValue', principal: '@AuthPrincipal' }[origem] ?? origem;
  }

  protected obrigatorio(r: string[]): boolean {
    return r.some((x) => /^(NotNull|NotBlank|NotEmpty)\b/.test(x));
  }

  protected extras(r: string[]): string {
    return r.filter((x) => !/^(NotNull|NotBlank|NotEmpty)\b/.test(x)).map((x) => `@${x}`).join(' ');
  }

  protected temObrigatorio(e: EndpointInfo): boolean {
    return !!e.http.corpo?.some((c) => this.obrigatorio(c.restricoes));
  }

  private voltar(): void {
    this.raiz().nativeElement.focus();
  }

  protected aoDigitarBusca(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Enter') {
      if (e.key === 'Escape') this.s.busca.set('');
      this.sel.set(0);
      this.voltar();
      e.preventDefault();
    }
    e.stopPropagation();
  }

  protected aoDigitarPedido(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.voltar();
      e.preventDefault();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      void this.s.chamar();
      this.voltar();
      e.preventDefault();
    }
    e.stopPropagation();
  }

  protected teclar(e: KeyboardEvent): void {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const linhas = this.s.linhas();
    const atual = linhas[this.sel()];
    const mover = (d: number) => {
      this.sel.set(Math.max(0, Math.min(linhas.length - 1, this.sel() + d)));
      this.raiz().nativeElement.querySelector(`#epl-${this.sel()}`)?.scrollIntoView({ block: 'nearest' });
    };
    switch (e.key) {
      case 'Escape': this.s.fechar(); break;
      case 'j': case 'ArrowDown': mover(1); break;
      case 'k': case 'ArrowUp': mover(-1); break;
      case 'Enter':
        if (atual?.tipo === 'grupo') this.s.alternarGrupo(atual.chave);
        else this.s.abrirNoCodigo();
        break;
      case 'l': case 'ArrowRight': if (atual?.tipo === 'grupo' && !atual.aberto) this.s.alternarGrupo(atual.chave); break;
      case 'h': case 'ArrowLeft': if (atual?.tipo === 'grupo' && atual.aberto) this.s.alternarGrupo(atual.chave); break;
      case 'c': void this.s.chamar(); break;
      case 'y': void this.s.copiarCurl(); break;
      case 'w': this.s.abrirSwagger(); break;
      case 'a': this.s.abrirActuator(); break;
      case 'L': void this.s.alternarLogin(); break;
      case 'i': case 't': if (this.s.atual()) this.anexos.adicionar(this.anexos.doEndpoint(this.s.atual()!)); break;
      case 'p': this.s.soProtegidos.set(!this.s.soProtegidos()); break;
      case 'v': this.s.proximoVerbo(); break;
      case 'e': this.campoPedido()?.nativeElement.focus(); break;
      case '/': this.campoBusca()?.nativeElement.focus(); break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
  }
}
