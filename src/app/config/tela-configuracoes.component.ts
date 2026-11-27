import { Component, computed, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { ACORDES_NATIVOS, ACORDES_PADRAO, AtalhosService, rotuloDoAcorde } from '../teclado/atalhos.service';
import { AtualizacaoService } from '../atualizacao/atualizacao.service';
import { ConfigService } from './config.service';
import { ConfiguracoesService, AbaConfig } from './configuracoes.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { ponte } from '../nucleo/ponte';
import { EditorService } from '../editor/editor.service';
import { TemaService } from '../tema/tema';

interface LinhaAtalho { id: string; rotulo: string; tecla: string; padrao: string; trocada: boolean; fixo: boolean; desligado: boolean }
interface LinhaEditor { chave: string; rotulo: string; dica: string; tipo: 'bool' | 'num' | 'texto' }

const MODELOS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2'];
const ABAS: AbaConfig[] = ['atalhos', 'ia', 'editor', 'sobre'];
const NOVIDADES = 'https://github.com/Node-23/Seedy/releases';
const LINHAS_EDITOR: LinhaEditor[] = [
  { chave: 'inicio.abrirUltimoProjeto', rotulo: 'abrir o último projeto ao iniciar', dica: 'pula a tela de início', tipo: 'bool' },
  { chave: 'editor.formatarAoSalvar', rotulo: 'formatar ao salvar', dica: 'Prettier, google-java-format…', tipo: 'bool' },
  { chave: 'editor.minimapa', rotulo: 'minimapa', dica: '', tipo: 'bool' },
  { chave: 'editor.numerosRelativos', rotulo: 'números de linha relativos', dica: 'bom para o modo vim (5j, 3dd)', tipo: 'bool' },
  { chave: 'editor.quebraDeLinha', rotulo: 'quebra de linha', dica: 'linhas longas continuam na linha de baixo', tipo: 'bool' },
  { chave: 'editor.espacos', rotulo: 'espaços no lugar de tab', dica: '', tipo: 'bool' },
  { chave: 'editor.tabulacao', rotulo: 'tamanho da tabulação', dica: 'vazio = detecta pelo arquivo', tipo: 'num' },
  { chave: 'terminal.shell', rotulo: 'shell do terminal', dica: 'vazio = o padrão do sistema (ex.: cmd.exe, /bin/zsh)', tipo: 'texto' },
];

/**
 * Configurações em tela cheia (Ctrl+,, mockup 21): Atalhos (1), IA (2), Editor e terminal (3),
 * Sobre (4, mockup 32).
 * Tudo grava no seedy.json global, o mesmo arquivo que dá para editar à mão (tecla e).
 */
@Component({
  selector: 'sd-tela-configuracoes',
  template: `
    <div class="config-tela" tabindex="0" #raiz (keydown)="teclar($event)">
      <div class="janela-tela">
        <div class="painel-faixa"><span class="rotulo">CONFIGURAÇÕES</span><span class="suave">{{ nomeDaAba() }}</span><span class="espaco"></span>@if (c.aba() !== 'sobre' && atualizacao.versao()) { <span class="suave" title="versão do Seedy">Seedy {{ atualizacao.versao() }}@if (atualizacao.disponivel(); as nova) { · <span class="sucesso-texto">⬆ {{ nova.versao }} disponível</span> }</span> }<kbd>esc</kbd></div>
        <div class="config-corpo">
          <nav class="config-nav">
            <button [class.ativa]="c.aba() === 'atalhos'" (click)="c.aba.set('atalhos')"><span class="destaque-texto">⌨</span> Atalhos <kbd>1</kbd></button>
            <button [class.ativa]="c.aba() === 'ia'" (click)="c.aba.set('ia')"><span class="destaque-texto">✦</span> IA <kbd>2</kbd></button>
            <button [class.ativa]="c.aba() === 'editor'" (click)="c.aba.set('editor')"><span class="destaque-texto">≡</span> Editor e terminal <kbd>3</kbd></button>
            <button [class.ativa]="c.aba() === 'sobre'" (click)="c.aba.set('sobre')"><span class="destaque-texto">◈</span> Sobre <kbd>4</kbd></button>
            <span class="espaco"></span>
            <span class="suave config-nota">tab troca de aba<br />grava no seedy.json<br /><span class="destaque-texto">e</span> abre o arquivo</span>
          </nav>

          @switch (c.aba()) {
            @case ('atalhos') {
              <section class="config-aba">
                <div class="config-filtro"><span class="destaque-texto">/</span>
                  <input #filtro type="text" spellcheck="false" placeholder="filtrar ação ou tecla…" [value]="filtro_()" (input)="filtro_.set(valor($event)); selecionado.set(0)" (keydown)="aoFiltrar($event)" /></div>
                <div class="config-cabeca suave"><span class="acao">AÇÃO</span><span class="espaco">PADRÃO</span><span>ATALHO</span></div>
                <div class="config-lista" role="listbox">
                  @for (l of linhas(); track l.id; let i = $index) {
                    <div class="config-linha" role="option" [class.sel]="i === selecionado()" [id]="'cfg-' + i" (click)="selecionado.set(i); capturar()">
                      <span class="acao">{{ l.rotulo }}</span>
                      <span class="espaco suave">@if (l.trocada) { {{ l.padrao || '—' }} }</span>
                      <kbd class="tecla-lider" [class.trocada]="l.trocada">{{ l.tecla || '—' }}</kbd>
                      @if (l.fixo) { <span class="suave" title="este atalho é fixo no Seedy">fixo</span> } @else if (l.desligado) { <span class="suave">desligado</span> }
                    </div>
                  }
                  @if (!linhas().length) { <p class="suave config-vazio">nenhuma ação com “{{ filtro_() }}”</p> }
                </div>
                @if (capturando(); as l) {
                  <div class="config-captura">
                    <span class="rotulo">REATRIBUINDO · {{ l.rotulo.toUpperCase() }}</span><br />
                    aperte o novo atalho (ex.: <kbd>Alt+9</kbd>, <kbd>Ctrl+Shift+F</kbd>)…
                    @if (conflito()) { <span class="aviso-texto">{{ conflito() }}</span> }<br />
                    <span class="suave">esc cancela · use Ctrl, Alt ou Shift com uma tecla (sem Ctrl+Alt: é o AltGr do teclado) · F1 a F12 valem sozinhas</span>
                  </div>
                }
                <div class="config-rodape suave">j k · <span class="destaque-texto">⏎</span> trocar o atalho · <span class="destaque-texto">x</span> desligar · <span class="destaque-texto">r</span> volta ao padrão · <span class="destaque-texto">/</span> filtrar · {{ totalTrocadas() }} {{ totalTrocadas() === 1 ? 'trocada' : 'trocadas' }}</div>
              </section>
            }
            @case ('ia') {
              <section class="config-aba config-ia">
                <div class="rotulo">COMO O SEEDY FALA COM O CLAUDE</div>
                <div class="config-opcao" [class.on]="modo() === 'assinatura'" (click)="escolherModo('assinatura')">
                  <div class="config-opcao-t"><span class="config-radio"></span><b>Assinatura do Claude (Pro/Max)</b><span class="config-tag sucesso-texto">usa o Claude Code já logado</span><span class="espaco"></span><kbd>1</kbd></div>
                  <div class="suave">O Seedy chama o <span class="destaque-texto">claude</span> instalado na sua máquina; ele usa a sua conta. O Seedy não vê nem guarda senha ou token. O uso conta no limite da assinatura. Nesse modo a IA conversa e escreve, mas não edita arquivos sozinha (isso só com a chave da API).</div>
                  <div class="config-estado">
                    @if (claude() === undefined) { <span class="suave">procurando o claude…</span> }
                    @else if (claude()) { <span class="sucesso-texto">✓</span> <span>Claude Code {{ claude() }} encontrado</span> <span class="suave">· se pedir login, rode <b>claude</b> no terminal e use /login</span> }
                    @else { <span class="erro-texto">✗</span> <span>não achei o <b>claude</b> (nem no PATH, nem nas pastas de instalação)</span> <span class="suave">· instale o Claude Code e faça login</span> }
                  </div>
                </div>
                <div class="config-opcao" [class.on]="modo() === 'chave'" (click)="escolherModo('chave')">
                  <div class="config-opcao-t"><span class="config-radio"></span><b>Chave da API (Anthropic Console)</b><span class="config-tag suave">paga por uso</span><span class="espaco"></span><kbd>2</kbd></div>
                  <div class="config-campo">
                    <span class="suave">sk-ant-</span>
                    <input #chave type="password" spellcheck="false" autocomplete="off" [placeholder]="temChave() ? '•••••••••••••••• (salva; cole outra para trocar)' : 'cole a chave aqui e aperte ⏎'" (keydown)="aoChave($event)" (click)="$event.stopPropagation()" />
                  </div>
                  <div class="config-estado suave">
                    <span>{{ temChave() ? '✓ chave salva' : 'sem chave' }} · fica só nesta máquina (ia.chave na pasta do Seedy) · ou ANTHROPIC_API_KEY</span>
                    <span class="espaco"></span>
                    <button class="botao" (click)="$event.stopPropagation(); testar()">testar <kbd>t</kbd></button>
                    <button class="botao" (click)="$event.stopPropagation(); esquecer()">esquecer <kbd>x</kbd></button>
                  </div>
                </div>
                <div class="config-modelo"><span class="suave">modelo</span>
                  <input #modelo type="text" list="modelos-ia" spellcheck="false" [value]="config.atual().ia.modelo" (keydown)="aoModelo($event)" (change)="salvarModelo(valor($event))" />
                  <datalist id="modelos-ia">@for (m of modelos; track m) { <option [value]="m"></option> }</datalist>
                  <span class="suave">vale para o chat, o merge e as regras · <kbd>m</kbd> edita</span></div>
                @if (resultado(); as r) { <div class="config-resultado" [class.erro-texto]="!r.ok">{{ r.ok ? '✓ ' : '✗ ' }}{{ r.texto }}</div> }
                <span class="espaco"></span>
                <div class="config-rodape suave"><span class="destaque-texto">1</span> assinatura · <span class="destaque-texto">2</span> chave · <span class="destaque-texto">k</span> colar chave · <span class="destaque-texto">t</span> testar · <span class="destaque-texto">x</span> esquecer · <span class="destaque-texto">m</span> modelo</div>
              </section>
            }
            @case ('editor') {
              <section class="config-aba">
                <div class="config-lista">
                  @for (l of linhasEditor; track l.chave; let i = $index) {
                    <div class="config-linha" [class.sel]="i === selEditor()" (click)="selEditor.set(i); ativarEditor()">
                      <span class="acao">{{ l.rotulo }}</span>
                      <span class="espaco suave" [title]="l.dica">{{ l.dica }}</span>
                      @if (l.tipo === 'bool') { <kbd class="tecla-lider" [class.trocada]="valorEditor(l) === true">{{ valorEditor(l) ? 'ligado' : 'desligado' }}</kbd> }
                      @else { <input class="config-entrada" type="text" spellcheck="false" [id]="'ed-' + i" [value]="valorEditor(l) ?? ''" [placeholder]="l.tipo === 'num' ? 'auto' : 'padrão'" (keydown)="aoEntradaEditor($event, l)" (click)="$event.stopPropagation()" /> }
                    </div>
                  }
                </div>
                <span class="espaco"></span>
                <div class="config-rodape suave">j k · <span class="destaque-texto">⏎</span> liga/desliga ou edita · <span class="destaque-texto">e</span> abre o seedy.json · vale na hora</div>
              </section>
            }
            @case ('sobre') {
              <section class="config-aba config-sobre">
                <div class="sobre-cartao">
                  <svg class="sobre-fita" width="260" viewBox="0 0 190 100" preserveAspectRatio="none" aria-hidden="true"><path d="M60 100 L190 22 L190 62 L128 100 Z"/><path class="clara" d="M118 0 C122 26 146 46 190 54 L190 0 Z"/></svg>
                  <img src="marca/icone.png" alt="">
                  <div><b>Seedy</b><span class="suave">{{ atualizacao.versao() ? 'versão ' + atualizacao.versao() : 'modo navegador' }}</span><span class="suave">IDE para Java, Angular e React · Windows e Linux</span></div>
                </div>
                <div class="sobre-linha"><div>Atualização<small [class.sucesso-texto]="atualizacao.disponivel()" [class.suave]="!atualizacao.disponivel()">{{ estadoDaAtualizacao() }}</small></div>
                  <button class="botao" (click)="atualizacao.verificar(true)">procurar agora <kbd>u</kbd></button></div>
                <div class="sobre-linha"><div>Novidades<small class="suave">as notas das versões publicadas</small></div>
                  <button class="botao" (click)="abrirNovidades()">abrir no GitHub <kbd>g</kbd></button></div>
                <div class="sobre-linha"><div>Arquivos do Seedy<small class="suave">seedy.json e tema.json deste computador</small></div>
                  <button class="botao" (click)="abrirTema()">abrir o tema <kbd>c</kbd></button></div>
                <span class="espaco"></span>
                <div class="config-rodape suave"><span class="destaque-texto">u</span> procurar atualização · <span class="destaque-texto">g</span> novidades · <span class="destaque-texto">c</span> tema · <span class="destaque-texto">e</span> seedy.json</div>
              </section>
            }
          }
        </div>
      </div>
    </div>
  `,
})
export class TelaConfiguracoesComponent {
  protected readonly c = inject(ConfiguracoesService);
  protected readonly config = inject(ConfigService);
  protected readonly atualizacao = inject(AtualizacaoService);
  private readonly atalhos = inject(AtalhosService);
  private readonly mensagens = inject(MensagensService);
  private readonly editor = inject(EditorService);
  private readonly tema = inject(TemaService);
  private readonly raiz = viewChild.required<ElementRef<HTMLDivElement>>('raiz');
  private readonly campoFiltro = viewChild<ElementRef<HTMLInputElement>>('filtro');
  private readonly campoChave = viewChild<ElementRef<HTMLInputElement>>('chave');
  private readonly campoModelo = viewChild<ElementRef<HTMLInputElement>>('modelo');

  protected readonly modelos = MODELOS;
  protected readonly linhasEditor = LINHAS_EDITOR;
  protected readonly filtro_ = signal('');
  protected readonly selecionado = signal(0);
  protected readonly selEditor = signal(0);
  protected readonly capturandoId = signal<string | null>(null);
  protected readonly conflito = signal('');
  /** undefined = ainda procurando; null = não instalado. */
  protected readonly claude = signal<string | null | undefined>(undefined);
  protected readonly temChave = signal(false);
  protected readonly resultado = signal<{ ok: boolean; texto: string } | null>(null);
  protected readonly modo = computed(() => (this.config.atual().ia.modo === 'assinatura' ? 'assinatura' : 'chave'));

  protected readonly nomeDaAba = computed(() => ({ atalhos: 'Atalhos', ia: 'IA', editor: 'Editor e terminal', sobre: 'Sobre' })[this.c.aba()]);

  /** Relógio do "procurada há N min". */
  private readonly agora = signal(Date.now());
  protected readonly estadoDaAtualizacao = computed(() => {
    const u = this.atualizacao;
    const nova = u.disponivel();
    if (u.procurando()) return 'procurando…';
    if (nova) return `⬆ a versão ${nova.versao} está disponível`;
    const quando = u.procuradaEm();
    if (!quando) return 'ainda não procurei desde que o Seedy abriu';
    const min = Math.max(0, Math.floor((this.agora() - quando) / 60_000));
    const ha = min < 1 ? 'agora há pouco' : min < 60 ? `há ${min} min` : `há ${Math.floor(min / 60)} h`;
    return `você está na versão mais nova · procurada ${ha}`;
  });

  private readonly todas = computed<LinhaAtalho[]>(() => {
    const teclas = this.config.atual().atalhos.teclas ?? {};
    return this.atalhos.acoes.map((a) => {
      const fixo = !!ACORDES_NATIVOS[a.id] && !ACORDES_PADRAO[a.id];
      const padrao = fixo ? rotuloDoAcorde(ACORDES_NATIVOS[a.id]) : ACORDES_PADRAO[a.id] ? rotuloDoAcorde(ACORDES_PADRAO[a.id]) : '';
      const desligado = !fixo && a.id in teclas && (teclas[a.id] === null || teclas[a.id] === '');
      const tecla = this.atalhos.rotuloDoAtalho(a.id) ?? '';
      return { id: a.id, rotulo: a.rotulo, tecla, padrao, trocada: !fixo && tecla !== padrao, fixo, desligado };
    });
  });
  protected readonly linhas = computed(() => {
    const f = this.filtro_().trim().toLowerCase();
    return f ? this.todas().filter((l) => l.rotulo.toLowerCase().includes(f) || l.tecla.toLowerCase() === f || l.id.includes(f)) : this.todas();
  });
  protected readonly totalTrocadas = computed(() => this.todas().filter((l) => l.trocada).length);
  protected readonly capturando = computed(() => this.todas().find((l) => l.id === this.capturandoId()) ?? null);

  constructor() {
    queueMicrotask(() => this.raiz().nativeElement.focus());
    const relogio = setInterval(() => this.agora.set(Date.now()), 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(relogio));
    void ponte.ia.claudeEstado().then((v) => this.claude.set(v)).catch(() => this.claude.set(null));
    void this.atualizarChave();
  }

  private async atualizarChave(): Promise<void> {
    this.temChave.set(await ponte.ia.temChaveDaApi().catch(() => false));
  }

  protected valor(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected abrirArquivo(): void {
    const caminho = this.config.caminho();
    if (!caminho) return this.mensagens.alerta('o seedy.json só existe dentro do app');
    this.c.fechar();
    void this.editor.abrir(caminho);
  }

  // ---------- sobre ----------

  protected abrirNovidades(): void {
    void ponte.abrirLink(NOVIDADES).catch((e) => this.mensagens.erro(String(e)));
  }

  protected abrirTema(): void {
    const caminho = this.tema.caminho();
    if (!caminho) return this.mensagens.alerta('o tema.json só existe dentro do app');
    this.c.fechar();
    void this.editor.abrir(caminho);
  }

  private teclarSobre(e: KeyboardEvent): void {
    if (e.key === 'u') void this.atualizacao.verificar(true);
    else if (e.key === 'g') this.abrirNovidades();
    else if (e.key === 'c') this.abrirTema();
    else return;
    e.preventDefault();
  }

  // ---------- teclado geral ----------

  protected teclar(e: KeyboardEvent): void {
    if ((e.target as HTMLElement).tagName === 'INPUT') return; // os campos tratam as próprias teclas
    if (this.capturandoId()) return this.aoCapturar(e);
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const aba = this.c.aba();
    if (e.key === 'Escape') this.c.fechar();
    else if (e.key === 'e') this.abrirArquivo();
    else if (e.key === 'Tab') this.c.aba.set(ABAS[(ABAS.indexOf(aba) + (e.shiftKey ? ABAS.length - 1 : 1)) % ABAS.length]);
    else if (e.key === '3' || e.key === '4' || (e.key === '1' && aba !== 'ia') || (e.key === '2' && aba !== 'ia')) this.c.aba.set(ABAS[Number(e.key) - 1]);
    else if (aba === 'atalhos') return this.teclarAtalhos(e);
    else if (aba === 'ia') return this.teclarIa(e);
    else if (aba === 'editor') return this.teclarEditor(e);
    else return this.teclarSobre(e);
    e.preventDefault();
  }

  // ---------- atalhos ----------

  private teclarAtalhos(e: KeyboardEvent): void {
    const n = this.linhas().length;
    const mover = (d: number) => {
      this.selecionado.set(Math.max(0, Math.min(n - 1, this.selecionado() + d)));
      this.raiz().nativeElement.querySelector(`#cfg-${this.selecionado()}`)?.scrollIntoView({ block: 'nearest' });
    };
    if (e.key === 'j' || e.key === 'ArrowDown') mover(1);
    else if (e.key === 'k' || e.key === 'ArrowUp') mover(-1);
    else if (e.key === 'Enter') this.capturar();
    else if (e.key === 'r') void this.trocarTecla(this.linhas()[this.selecionado()]?.id, undefined);
    else if (e.key === 'x') void this.trocarTecla(this.linhas()[this.selecionado()]?.id, null);
    else if (e.key === '/') this.campoFiltro()?.nativeElement.focus();
    else return;
    e.preventDefault();
  }

  protected aoFiltrar(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      this.raiz().nativeElement.focus();
    }
  }

  protected capturar(): void {
    const l = this.linhas()[this.selecionado()];
    if (!l) return;
    if (l.fixo) return void this.mensagens.alerta('este atalho é fixo no Seedy; só os atalhos diretos podem ser trocados');
    this.conflito.set('');
    this.capturandoId.set(l.id);
    this.raiz().nativeElement.focus();
  }

  private aoCapturar(e: KeyboardEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') return this.capturandoId.set(null);
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
    const acorde = this.atalhos.acordeDe(e);
    if (!acorde) return this.conflito.set('essa tecla não entra em atalhos');
    const id = this.capturandoId()!;
    if (e.ctrlKey && e.altKey) return this.conflito.set('Ctrl+Alt é o AltGr do teclado ABNT2: use Alt, Ctrl ou Shift');
    if (!/(^|\+)(ctrl|alt)(\+|$)/.test(acorde) && !/^f\d+$/.test(acorde.split('+').pop()!)) return this.conflito.set('use Ctrl ou Alt junto (ou uma tecla F)');
    const dono = this.atalhos.donoDoAcorde(acorde, id);
    if (dono) return this.conflito.set(`${rotuloDoAcorde(acorde)} já é “${dono}”`);
    this.capturandoId.set(null);
    void this.trocarTecla(id, acorde);
  }

  /** acorde: troca; undefined: volta ao padrão; null: desliga o atalho direto. */
  private async trocarTecla(id: string | undefined, acorde: string | null | undefined): Promise<void> {
    if (!id || ACORDES_NATIVOS[id] && !ACORDES_PADRAO[id]) return;
    const atalhos = this.config.atual().atalhos;
    const teclas = { ...(atalhos.teclas ?? {}) };
    if (acorde === undefined) delete teclas[id];
    else teclas[id] = acorde;
    await this.config.gravar({ atalhos: { ...atalhos, teclas } });
  }

  // ---------- IA ----------

  private teclarIa(e: KeyboardEvent): void {
    switch (e.key) {
      case '1': void this.escolherModo('assinatura'); break;
      case '2': void this.escolherModo('chave'); break;
      case 'k': this.campoChave()?.nativeElement.focus(); break;
      case 't': void this.testar(); break;
      case 'x': void this.esquecer(); break;
      case 'm': this.campoModelo()?.nativeElement.focus(); break;
      default:
        return;
    }
    e.preventDefault();
  }

  protected async escolherModo(m: 'chave' | 'assinatura'): Promise<void> {
    this.resultado.set(null);
    await this.config.gravar({ ia: { ...this.config.atual().ia, modo: m } });
  }

  protected async aoChave(e: KeyboardEvent): Promise<void> {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLInputElement).value = '';
      this.raiz().nativeElement.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const campo = e.target as HTMLInputElement;
      const valor = campo.value.trim();
      if (!valor) return;
      try {
        await ponte.ia.definirChave(valor);
        campo.value = '';
        await this.atualizarChave();
        await this.escolherModo('chave');
        this.resultado.set({ ok: true, texto: 'chave salva; aperte t para testar' });
        this.raiz().nativeElement.focus();
      } catch (erro) {
        this.resultado.set({ ok: false, texto: String(erro) });
      }
    }
  }

  protected aoModelo(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Enter') void this.salvarModelo((e.target as HTMLInputElement).value);
      this.raiz().nativeElement.focus();
    }
  }

  protected async salvarModelo(m: string): Promise<void> {
    const modelo = m.trim();
    if (!modelo || modelo === this.config.atual().ia.modelo) return;
    await this.config.gravar({ ia: { ...this.config.atual().ia, modelo } });
  }

  protected async esquecer(): Promise<void> {
    try {
      await ponte.ia.esquecerChave();
      await this.atualizarChave();
      this.resultado.set({ ok: true, texto: 'chave apagada deste computador' });
    } catch (e) {
      this.resultado.set({ ok: false, texto: String(e) });
    }
  }

  /** Um pedido mínimo pelo modo escolhido: mostra se a chave (ou o login do Claude Code) funciona. */
  protected async testar(): Promise<void> {
    this.resultado.set({ ok: true, texto: 'testando…' });
    let resposta = '';
    try {
      await ponte.ia.mensagem(
        { model: this.config.atual().ia.modelo, max_tokens: 16, messages: [{ role: 'user', content: 'Responda só: ok' }] },
        (dados) => {
          try {
            const ev = JSON.parse(dados);
            if (ev.type === 'content_block_delta' && ev.delta?.text) resposta += ev.delta.text;
          } catch {
            /* evento que não importa */
          }
        },
      );
      this.resultado.set({ ok: true, texto: `${this.modo() === 'assinatura' ? 'o Claude Code' : 'a API'} respondeu${resposta ? ': ' + resposta.trim().slice(0, 40) : ''}` });
    } catch (e) {
      this.resultado.set({ ok: false, texto: String(e) });
    }
  }

  // ---------- editor e terminal ----------

  protected valorEditor(l: LinhaEditor): boolean | string | number | null {
    const [grupo, campo] = l.chave.split('.');
    return (this.config.atual() as unknown as Record<string, Record<string, boolean | string | number | null>>)[grupo]?.[campo] ?? null;
  }

  private teclarEditor(e: KeyboardEvent): void {
    const n = this.linhasEditor.length;
    if (e.key === 'j' || e.key === 'ArrowDown') this.selEditor.set(Math.min(n - 1, this.selEditor() + 1));
    else if (e.key === 'k' || e.key === 'ArrowUp') this.selEditor.set(Math.max(0, this.selEditor() - 1));
    else if (e.key === 'Enter') this.ativarEditor();
    else return;
    e.preventDefault();
  }

  protected ativarEditor(): void {
    const l = this.linhasEditor[this.selEditor()];
    if (l.tipo === 'bool') void this.gravarEditor(l, !this.valorEditor(l));
    else queueMicrotask(() => (this.raiz().nativeElement.querySelector(`#ed-${this.selEditor()}`) as HTMLInputElement | null)?.focus());
  }

  protected aoEntradaEditor(e: KeyboardEvent, l: LinhaEditor): void {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    const campo = e.target as HTMLInputElement;
    if (e.key === 'Enter') {
      const t = campo.value.trim();
      if (l.tipo === 'num') {
        const n = Number(t);
        if (t && (!Number.isInteger(n) || n < 1 || n > 16)) return void this.mensagens.erro('a tabulação é um número de 1 a 16');
        void this.gravarEditor(l, t ? n : null);
      } else void this.gravarEditor(l, t || null);
    } else campo.value = String(this.valorEditor(l) ?? '');
    this.raiz().nativeElement.focus();
  }

  private async gravarEditor(l: LinhaEditor, valor: boolean | string | number | null): Promise<void> {
    const [grupo, campo] = l.chave.split('.');
    const atual = this.config.atual() as unknown as Record<string, Record<string, unknown>>;
    await this.config.gravar({ [grupo]: { ...atual[grupo], [campo]: valor } });
  }
}
