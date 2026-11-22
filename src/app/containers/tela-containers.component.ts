import { AnexosService } from '../ia/anexos.service';
import { ContainerDocker } from '../nucleo/ponte';
import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { DockerService, HOST } from './docker.service';
import { caminho, desenhar, LARGURA_NO } from './mapa';
import { LayoutService } from '../layout/layout.service';
import { EditorService } from '../editor/editor.service';
import { ponte } from '../nucleo/ponte';

type Parte = 'lista' | 'mapa' | 'logs';
const COR = { depends: 'var(--texto)', trafego: 'var(--destaque)', config: 'var(--aviso)', porta: 'var(--rosa)' } as const;
const NIVEL = { erro: 'ERROR', aviso: 'WARN ', info: 'INFO ', debug: 'DEBUG' } as const;

/**
 * Containers em tela cheia (mockup 15, ␣ D): lista à esquerda, mapa das conexões no meio,
 * detalhe do escolhido à direita e logs ao vivo embaixo.
 */
@Component({
  selector: 'sd-tela-containers',
  template: `
    <div class="docker-tela" (keydown)="teclar($event)">
      <div class="docker-faixa">
        <span class="forte">Docker</span>
        @if (d.versao(); as v) {
          <span class="suave">{{ v }}</span>
          <span class="git-mais">● {{ d.rodando().length }} rodando</span>
          <span class="suave">○ {{ d.containers().length - d.rodando().length }} parado{{ d.containers().length - d.rodando().length === 1 ? '' : 's' }} · {{ d.redes().length }} {{ d.redes().length === 1 ? 'rede' : 'redes' }}@if (d.composeDoProjeto(); as c) { · compose <span class="texto">{{ c }}</span>}</span>
        } @else {
          <span class="erro-texto">{{ d.erro() ?? 'procurando o Docker…' }}</span>
        }
        @if (d.ocupado(); as o) { <span class="aviso-texto">{{ o }}…</span> }
        <span class="espaco"></span>
        <span class="docker-legenda"><svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" stroke="var(--texto)" stroke-width="2" /></svg>depends_on</span>
        <span class="docker-legenda"><svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" stroke="var(--destaque)" stroke-width="2.5" stroke-dasharray="6 4" /></svg>tráfego agora</span>
        <span class="docker-legenda"><svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" stroke="var(--aviso)" stroke-width="2" stroke-dasharray="2 4" /></svg>pela configuração</span>
        <span class="docker-legenda"><svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" stroke="var(--rosa)" stroke-width="2" /></svg>porta no host</span>
      </div>

      <div class="docker-grade">
        <section class="painel docker-lista" aria-label="Containers">
          <div class="painel-faixa"><span class="rotulo">CONTAINERS</span><span class="espaco"></span><kbd>␣ D</kbd></div>
          <div #lista class="debug-lista" tabindex="0" role="listbox" aria-label="Containers" (focus)="parte.set('lista')" (keydown)="teclarLista($event)">
            @for (g of d.grupos(); track g.titulo) {
              <div class="docker-grupo">{{ g.titulo }}</div>
              @for (c of g.containers; track c.id) {
                <div class="docker-item" role="option" [class.selecionado]="c.nome === d.atual()?.nome" (click)="d.escolher(c.nome)" (dblclick)="d.iniciarOuParar(c.nome)" (contextmenu)="menuIa($event, c)">
                  <span [class.git-mais]="c.estado === 'running'" [class.suave]="c.estado !== 'running'">{{ c.estado === 'running' ? '●' : '○' }}</span>
                  <span [class.forte]="c.nome === d.atual()?.nome" [class.suave]="c.estado !== 'running'">{{ c.composeServico ?? c.nome }}</span>
                  <span class="suave docker-img">{{ resumo(c) }}</span>
                </div>
              }
            } @empty {
              <div class="debug-vazio suave">{{ d.versao() ? 'nenhum container' : 'o Docker não respondeu' }}</div>
            }
          </div>
          <div class="suave docker-dica">j k · ⏎ detalhe · <span class="destaque-texto">s</span> inicia/para · <span class="destaque-texto">R</span> reinicia<br /><span class="destaque-texto">l</span> logs · <span class="destaque-texto">t</span> terminal · <span class="destaque-texto">b</span> ligar ao banco</div>
        </section>

        <section class="painel docker-mapa" aria-label="Mapa das conexões">
          <div class="painel-faixa">
            <span class="rotulo">MAPA</span><span class="suave">conexões entre os containers</span><span class="espaco"></span>
            @if (d.trafegoEm(); as t) { <span class="suave">tráfego medido há {{ segundos(t) }} s</span> }
            <button class="entender-chip" [class.ligado]="todasAsSetas()" (click)="todasAsSetas.set(!todasAsSetas())" title="mostrar todas as setas (a)">{{ todasAsSetas() ? 'todas as setas' : 'setas do selecionado' }} <kbd>a</kbd></button>
            @if (!todasAsSetas() && ocultas() > 0) { <span class="suave">{{ ocultas() }} ocultas</span> }
            <kbd>m</kbd>
          </div>
          <div #mapa class="docker-area" tabindex="0" (focus)="parte.set('mapa')" (keydown)="teclarMapa($event)">
            <div class="docker-conteudo" [style.width.px]="desenho().largura" [style.height.px]="desenho().altura" [style.transform]="'scale(' + zoom() + ')'">
              @for (r of desenho().redes; track r.nome) {
                <div class="docker-rede" [style.left.px]="r.x" [style.top.px]="r.y" [style.width.px]="r.largura" [style.height.px]="r.altura"><span>REDE {{ r.nome.toUpperCase() }}</span></div>
              }
              <svg class="docker-setas" [attr.width]="desenho().largura" [attr.height]="desenho().altura" aria-hidden="true">
                <defs>
                  @for (t of tipos; track t) {
                    <marker [attr.id]="'seta-' + t" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" [attr.fill]="cor(t)" /></marker>
                  }
                </defs>
                @for (s of setas(); track $index) {
                  <path [attr.d]="s.d" fill="none" [attr.stroke]="cor(s.tipo)" [attr.stroke-width]="s.tipo === 'trafego' ? 2.5 : 2"
                        [attr.stroke-dasharray]="s.tipo === 'trafego' ? '6 4' : s.tipo === 'config' ? '2 4' : null" [attr.marker-end]="'url(#seta-' + s.tipo + ')'"
                        [class.docker-seta-fraca]="s.fraca" />
                  @if (s.rotulo) { <text [attr.x]="s.rx" [attr.y]="s.ry" [attr.fill]="cor(s.tipo)" class="docker-rotulo" text-anchor="middle">{{ s.rotulo }}</text> }
                }
              </svg>
              @if (desenho().host; as h) {
                <div class="docker-no host" [style.left.px]="h.x" [style.top.px]="h.y">
                  <b class="rosa-texto">host</b><br /><span class="suave">localhost</span><br /><span class="rosa-texto docker-mini">{{ portasDoHost() }}</span>
                  @if (seedyUsa(); as s) { <br /><span class="suave docker-mini">Seedy usa {{ s }}</span> }
                </div>
              }
              @for (n of desenho().nos; track n.nome) {
                @if (container(n.nome); as c) {
                  <div class="docker-no" [style.left.px]="n.x" [style.top.px]="n.y" [class.selecionado]="c.nome === d.atual()?.nome" [class.parado]="c.estado !== 'running'" [title]="c.nome + '\n' + c.imagem" (click)="d.escolher(c.nome)" (contextmenu)="menuIa($event, c)">
                    <div class="docker-no-nome"><b>{{ c.composeServico ?? c.nome }}</b> <span [class.git-mais]="c.estado === 'running'" [class.suave]="c.estado !== 'running'">{{ c.estado === 'running' ? '●' : '○ parado' }}</span></div>
                    <div class="suave docker-no-imagem">{{ c.imagem }}</div>
                    <div>
                      @if (portaHost(c); as p) { <span class="rosa-texto docker-mini">host {{ p }}</span> }
                      @if (d.perfisPorContainer().get(c.nome); as perfil) { <span class="destaque-texto docker-mini"> ◆ {{ perfil }}</span> }
                    </div>
                  </div>
                }
              }
            </div>
            <div class="suave docker-dica-mapa">h j k l move · ⏎ abre · <span class="destaque-texto">+</span>/<span class="destaque-texto">−</span> zoom · <span class="destaque-texto">0</span> encaixa</div>
          </div>
        </section>

        <section class="painel docker-detalhe" aria-label="Detalhe do container">
          @if (d.atual(); as c) {
            <div class="painel-faixa">
              <span class="rotulo">{{ (c.composeServico ?? c.nome).toUpperCase() }}</span>
              <span [class.git-mais]="c.estado === 'running'" [class.suave]="c.estado !== 'running'">{{ c.estado === 'running' ? '● rodando' + desde(c.iniciado) : '○ ' + c.estado }}</span>
              <span class="espaco"></span><kbd>⏎</kbd>
            </div>
            <div class="docker-kv">
              <div><span class="k">container</span><span>{{ c.nome }}</span></div>
              <div><span class="k">imagem</span><span>{{ c.imagem }}</span></div>
              <div><span class="k">portas</span><span>@for (p of c.portas; track $index) {<span [class.rosa-texto]="p.host">{{ p.host ? p.host + ' → ' : '' }}{{ p.container }}</span>{{ $last ? '' : ' · ' }}} @empty {<span class="suave">nenhuma</span>}</span></div>
              <div><span class="k">redes</span><span>{{ nomesDasRedes(c) }}</span></div>
              @if (alvos(c.nome, 'depends'); as l) { <div><span class="k">depende de</span><span>{{ l }} <span class="suave">(depends_on)</span></span></div> }
              @if (alvos(c.nome, 'trafego'); as l) { <div><span class="k">fala com</span><span class="destaque-texto">{{ l }}</span></div> }
              @if (alvos(c.nome, 'config'); as l) { <div><span class="k">configurado</span><span class="aviso-texto">{{ l }}</span></div> }
              @if (chamadoPor(c.nome); as l) { <div><span class="k">chamado por</span><span>{{ l }}</span></div> }
              @if (d.uso().get(c.nome); as u) { <div><span class="k">uso</span><span>{{ u.cpu }} · {{ u.memoria }}</span></div> }
              <div class="ambiente"><span class="k">ambiente</span><span class="suave">@for (e of ambiente(c); track $index) {{{ e }}<br />}</span></div>
            </div>
            <div class="docker-acoes">
              <button class="botao" [class.perigo]="c.estado === 'running'" (click)="d.iniciarOuParar(c.nome)">{{ c.estado === 'running' ? '■ parar' : '▶ iniciar' }} <kbd>s</kbd></button>
              <button class="botao" (click)="d.reiniciar(c.nome)">↻ reiniciar <kbd>R</kbd></button>
              <button class="botao" (click)="d.abrirTerminal(c.nome)">&gt;_ terminal <kbd>t</kbd></button>
              @if (ehBanco(c.imagem)) { <button class="botao" (click)="d.ligarAoBanco(c.nome)">◆ ligar ao banco <kbd>b</kbd></button> }
              @if (portaHttp(c); as p) { <button class="botao" (click)="abrirNoNavegador(p)">↗ abrir :{{ p }}</button> }
            </div>
          } @else {
            <div class="painel-faixa"><span class="rotulo">DETALHE</span></div>
            <div class="debug-vazio suave">escolha um container</div>
          }
        </section>

        <section class="painel docker-logs" aria-label="Logs">
          <div class="painel-faixa">
            <span class="rotulo">LOGS</span><span class="suave">{{ d.atual()?.composeServico ?? d.atual()?.nome ?? '' }}{{ d.seguindo() ? ' · seguindo' : '' }}</span>
            <span class="espaco"></span>
            <span class="chip-log erro">ERROR {{ contagem().erros }}</span>
            <span class="chip-log">WARN {{ contagem().avisos }}</span>
            <label class="docker-filtro"><span class="destaque-texto">/</span><input #filtro type="text" spellcheck="false" placeholder="filtrar" [value]="filtroTexto()" (input)="filtroTexto.set($any($event.target).value)" (keydown)="teclarFiltro($event)" /></label>
            <kbd>l</kbd>
          </div>
          <div #logs class="debug-log" tabindex="0" role="log" (focus)="parte.set('logs')">
            @for (l of linhas(); track l.n) {
              <div class="log-linha" [attr.data-nivel]="l.nivel" [class.pilha]="l.pilha">
                @if (l.pilha || !l.nivel) { <span class="log-hora">{{ l.hora ?? '' }}</span><span>{{ l.mensagem }}</span> }
                @else { <span class="log-hora">{{ l.hora ?? '' }}</span><span class="log-nivel">{{ nivel(l.nivel) }}</span><span>{{ l.mensagem }}</span> }
              </div>
            } @empty {
              <div class="debug-vazio suave">{{ d.atual()?.estado === 'running' ? 'sem saída ainda' : 'o container está parado' }}</div>
            }
          </div>
        </section>
      </div>
    </div>
  `,
})
export class TelaContainersComponent {
  protected readonly d = inject(DockerService);
  private readonly anexos = inject(AnexosService);

  protected menuIa(e: MouseEvent, c: ContainerDocker): void {
    this.d.escolher(c.nome);
    this.anexos.abrirMenu(e, () => this.anexos.doContainer(c));
  }

  private readonly layout = inject(LayoutService);
  private readonly editor = inject(EditorService);
  private readonly elLista = viewChild.required<ElementRef<HTMLElement>>('lista');
  private readonly elMapa = viewChild.required<ElementRef<HTMLElement>>('mapa');
  private readonly elLogs = viewChild.required<ElementRef<HTMLElement>>('logs');
  private readonly elFiltro = viewChild.required<ElementRef<HTMLInputElement>>('filtro');

  protected readonly tipos = ['depends', 'trafego', 'config', 'porta'] as const;
  protected readonly parte = signal<Parte>('lista');
  protected readonly zoom = signal(1);
  protected readonly filtroTexto = signal('');
  private readonly agora = signal(Date.now());

  /** No mapa: os que rodam e os parados do compose do projeto. */
  private readonly noMapa = computed(() => this.d.containers().filter((c) => c.estado === 'running' || (c.composeProjeto && c.composeProjeto === this.d.composeDoProjeto())));
  protected readonly desenho = computed(() => desenhar(this.noMapa(), this.d.conexoes().filter((x) => this.noMapa().some((c) => c.nome === x.para))));

  protected readonly setas = computed(() => {
    const pos = new Map(this.desenho().nos.map((n) => [n.nome, n]));
    const host = this.desenho().host;
    const selecionado = this.d.atual()?.nome;
    const desvios = { depends: -7, trafego: 5, config: -16, porta: 0 } as const;
    const todas = this.todasAsSetas();
    const usados: number[] = [];
    return this.d.conexoes().flatMap((x) => {
      const doSelecionado = !!selecionado && (x.de === selecionado || x.para === selecionado);
      // Só as setas do container selecionado (com todas elas, o mapa vira um novelo); `a` mostra todas.
      if (!todas && !doSelecionado) return [];
      const de = x.de === HOST ? host : pos.get(x.de);
      const para = pos.get(x.para);
      if (!de || !para) return [];
      const largura = x.de === HOST ? 122 : LARGURA_NO;
      const c = caminho(de, para, desvios[x.tipo], largura);
      // Porta: o rótulo fica perto do host; tráfego e configuração mostram o rótulo; depends_on não.
      const rotulo = x.tipo === 'depends' || x.tipo === 'porta' || !doSelecionado ? '' : x.rotulo;
      // Rótulos que cairiam um em cima do outro descem um pouco.
      if (rotulo) {
        while (usados.some((y) => Math.abs(y - c.ry) < 14)) c.ry += 14;
        usados.push(c.ry);
      }
      return [{ ...c, tipo: x.tipo, rotulo, fraca: !!selecionado && !doSelecionado }];
    });
  });

  protected readonly todasAsSetas = signal(false);
  /** Quantas conexões existem e não estão desenhadas (as dos outros containers). */
  protected readonly ocultas = computed(() => {
    const sel = this.d.atual()?.nome;
    return this.d.conexoes().filter((x) => !sel || (x.de !== sel && x.para !== sel)).length;
  });

  protected readonly linhas = computed(() => {
    const nome = this.d.atual()?.nome;
    const f = this.filtroTexto().trim().toLowerCase();
    const todas = nome ? (this.d.logs().get(nome) ?? []) : [];
    return (f ? todas.filter((l) => l.texto.toLowerCase().includes(f)) : todas).slice(-800);
  });
  protected readonly contagem = computed(() => {
    const nome = this.d.atual()?.nome;
    const todas = nome ? (this.d.logs().get(nome) ?? []) : [];
    return { erros: todas.filter((l) => !l.pilha && l.nivel === 'erro').length, avisos: todas.filter((l) => !l.pilha && l.nivel === 'aviso').length };
  });

  constructor() {
    const t = setInterval(() => this.agora.set(Date.now()), 1000);
    effect((limpar) => limpar(() => clearInterval(t)));
    queueMicrotask(() => this.elLista()?.nativeElement.focus());
    effect(() => {
      this.linhas();
      untracked(() =>
        queueMicrotask(() => {
          const el = this.elLogs()?.nativeElement;
          if (el) el.scrollTop = el.scrollHeight;
        }),
      );
    });
  }

  // ---------- textos ----------

  protected container(nome: string) {
    return this.d.containers().find((c) => c.nome === nome) ?? null;
  }

  protected cor(t: keyof typeof COR): string {
    return COR[t];
  }

  protected resumo(c: { estado: string; imagem: string; portas: { host: number | null }[] }): string {
    const porta = c.portas.find((p) => p.host)?.host;
    if (c.estado !== 'running') return c.estado === 'exited' ? 'parado' : c.estado;
    return `${c.imagem.split('/').pop()}${porta ? ` · :${porta}` : ''}`;
  }

  protected portaHost(c: { portas: { host: number | null }[] }): string {
    return c.portas.filter((p) => p.host).map((p) => `:${p.host}`).slice(0, 3).join(' ');
  }

  protected portasDoHost(): string {
    return [...new Set(this.noMapa().flatMap((c) => (c.estado === 'running' ? c.portas : [])).filter((p) => p.host).map((p) => `:${p.host}`))].slice(0, 6).join(' ');
  }

  protected seedyUsa(): string {
    const lista = this.noMapa().filter((c) => this.d.perfisPorContainer().has(c.nome)).flatMap((c) => c.portas.filter((p) => p.host).map((p) => `:${p.host}`));
    return [...new Set(lista)].join(' ');
  }

  protected nomesDasRedes(c: { redes: { nome: string }[] }): string {
    return c.redes.map((r) => r.nome).join(', ') || '—';
  }

  protected alvos(nome: string, tipo: 'depends' | 'trafego' | 'config'): string {
    const xs = this.d.conexoes().filter((x) => x.de === nome && x.tipo === tipo);
    const nomeDe = (n: string) => this.container(n)?.composeServico ?? n;
    if (tipo === 'trafego') return xs.map((x) => `${nomeDe(x.para)} · ${x.rotulo}`).join(', ');
    if (tipo === 'config') return xs.map((x) => `${nomeDe(x.para)} (${x.rotulo})`).join(', ');
    return xs.map((x) => nomeDe(x.para)).join(', ');
  }

  protected chamadoPor(nome: string): string {
    const de = new Set(this.d.conexoes().filter((x) => x.para === nome && x.de !== HOST && x.tipo !== 'porta').map((x) => this.container(x.de)?.composeServico ?? x.de));
    return [...de].join(', ');
  }

  protected ambiente(c: { ambiente: string[] }): string[] {
    return c.ambiente.filter((e) => !/^(PATH|HOME|HOSTNAME|TERM|LANG|LC_ALL|PGDATA|JAVA_HOME|DOCKER_\w+|GPG_KEYS?|GOSU_\w+|\w+_(VERSION|MAJOR|SHA256|SHA1|DOWNLOAD_\w+))=/.test(e)).map((e) => this.d.ambienteVisivel(e));
  }

  protected desde(iniciado: string): string {
    const t = Date.parse(iniciado);
    if (!t) return '';
    const s = Math.max(0, (this.agora() - t) / 1000);
    return s < 90 ? ` há ${Math.round(s)} s` : s < 5400 ? ` há ${Math.round(s / 60)} min` : s < 172800 ? ` há ${Math.round(s / 3600)} h` : ` há ${Math.round(s / 86400)} dias`;
  }

  protected segundos(t: number): number {
    return Math.max(0, Math.round((this.agora() - t) / 1000));
  }

  protected ehBanco(imagem: string): boolean {
    return /postgres|postgis|timescale|mysql|mariadb|percona/i.test(imagem);
  }

  protected portaHttp(c: { portas: { container: number; host: number | null }[]; imagem: string }): number | null {
    if (this.ehBanco(c.imagem)) return null;
    return c.portas.find((p) => p.host && ![5432, 3306, 6379, 27017, 5672, 9092].includes(p.container))?.host ?? null;
  }

  protected nivel(n: keyof typeof NIVEL): string {
    return NIVEL[n];
  }

  protected abrirNoNavegador(porta: number): void {
    void ponte.servidor.abrirUrl(`http://localhost:${porta}`);
  }

  // ---------- teclado ----------

  protected teclar(e: KeyboardEvent): void {
    const alvo = e.target as HTMLElement;
    if (alvo.tagName === 'INPUT' || e.ctrlKey || e.altKey || e.metaKey) return;
    const c = this.d.atual();
    switch (e.key) {
      case 's':
        void this.d.iniciarOuParar();
        break;
      case 'R':
        void this.d.reiniciar();
        break;
      case 't':
        this.d.abrirTerminal();
        break;
      case 'b':
        if (c) this.d.ligarAoBanco(c.nome);
        break;
      case 'l':
        this.parte.set('logs');
        this.elLogs().nativeElement.focus();
        break;
      case 'm':
        this.parte.set('mapa');
        this.elMapa().nativeElement.focus();
        break;
      case 'u':
        void this.d.compose('up');
        break;
      case 'r':
        void this.d.atualizar(true);
        break;
      case '/':
        this.elFiltro().nativeElement.focus();
        break;
      case 'Escape':
        this.layout.tela.set('editor');
        this.editor.focar();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  protected teclarLista(e: KeyboardEvent): void {
    const lista = this.d.ordenados();
    const i = Math.max(0, lista.findIndex((c) => c.nome === this.d.atual()?.nome));
    if (e.key === 'j' || e.key === 'ArrowDown') this.d.escolher(lista[Math.min(lista.length - 1, i + 1)]?.nome);
    else if (e.key === 'k' || e.key === 'ArrowUp') this.d.escolher(lista[Math.max(0, i - 1)]?.nome);
    else if (e.key === 'Enter') this.elMapa().nativeElement.focus();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  /** h j k l: vai ao nó mais próximo naquela direção. */
  protected teclarMapa(e: KeyboardEvent): void {
    const dirs: Record<string, [number, number]> = { h: [-1, 0], ArrowLeft: [-1, 0], l: [1, 0], ArrowRight: [1, 0], k: [0, -1], ArrowUp: [0, -1], j: [0, 1], ArrowDown: [0, 1] };
    if (dirs[e.key]) {
      const [dx, dy] = dirs[e.key];
      const nos = this.desenho().nos;
      const atual = nos.find((n) => n.nome === this.d.atual()?.nome) ?? nos[0];
      if (atual) {
        const candidatos = nos
          .filter((n) => n !== atual && (dx ? Math.sign(n.x - atual.x) === dx : Math.sign(n.y - atual.y) === dy))
          .map((n) => ({ n, dist: Math.abs(n.x - atual.x) * (dx ? 1 : 3) + Math.abs(n.y - atual.y) * (dy ? 1 : 3) }))
          .sort((a, b) => a.dist - b.dist);
        if (candidatos[0]) this.d.escolher(candidatos[0].n.nome);
      }
    } else if (e.key === '+' || e.key === '=') this.zoom.update((z) => Math.min(2, z + 0.1));
    else if (e.key === '-') this.zoom.update((z) => Math.max(0.4, z - 0.1));
    else if (e.key === '0') this.encaixar();
    else if (e.key === 'a') this.todasAsSetas.set(!this.todasAsSetas());
    else if (e.key === 'Enter') this.elLista().nativeElement.focus();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  private encaixar(): void {
    const el = this.elMapa().nativeElement;
    const d = this.desenho();
    this.zoom.set(Math.max(0.4, Math.min(1, (el.clientWidth - 20) / d.largura, (el.clientHeight - 30) / d.altura)));
  }

  protected teclarFiltro(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Enter') {
      if (e.key === 'Escape') this.filtroTexto.set('');
      this.elLogs().nativeElement.focus();
      e.preventDefault();
    }
    e.stopPropagation();
  }
}
