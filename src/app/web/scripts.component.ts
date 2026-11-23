import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { ScriptsService, ID_INSTALAR } from './scripts.service';
import { ExecucaoService } from '../execucao/execucao.service';
import { LayoutService } from '../layout/layout.service';
import { EditorService } from '../editor/editor.service';
import { ProjetoService } from '../nucleo/projeto.service';

/** Pedaço de uma linha de saída: texto ou referência a arquivo (`src/app/x.ts:3:10`). */
type Parte = { texto: string; arquivo?: { caminho: string; linha: number; coluna: number } };
const REF = /((?:[\w@.-]+[\\/])*[\w.-]+\.(?:ts|tsx|js|jsx|mjs|html|scss|css|json)):(\d+)(?::(\d+))?/g;

/**
 * Painel de scripts do package.json (mockup 13, Alt+Shift+J): à esquerda os scripts, à direita a
 * saída do escolhido. ⏎ roda, x para, o abre no navegador, d depura, i npm install.
 */
@Component({
  selector: 'sd-scripts',
  template: `
    <section class="painel scripts" aria-label="Scripts do package.json">
      <div class="servidor-faixa">
        <span class="rotulo">SCRIPTS</span><span class="suave">package.json</span>
        @if (s.atual(); as e) {
          <span class="servidor-estado" [attr.data-fase]="e.fase === 'rodando' ? 'rodando' : 'parado'"><span class="ponto"></span>{{ nomeVisivel(e.nome) }} · {{ estado(e) }}</span>
        }
        <span class="espaco"></span>
        @if (s.atual(); as e) {
          <span class="chip-log erro">ERROR {{ e.erros }}</span>
          <span class="chip-log">WARN {{ e.avisos }}</span>
          @if (e.url) { <button class="botao" (click)="s.abrirNoNavegador(e.nome)">↗ abrir no navegador <kbd>o</kbd></button> }
        }
        @if (escolhido(); as nome) {
          @if (nome !== instalarId) { <button class="botao" (click)="exec.depurarScript(nome)" title="abre o navegador com o depurador (shift+F9)">debug <kbd>d</kbd></button> }
          @if (s.execucoes().get(nome)?.fase === 'rodando') {
            <button class="botao perigo" (click)="s.parar(nome)">■ parar <kbd>x</kbd></button>
          } @else {
            <button class="botao destaque" (click)="s.rodar(nome)">▶ rodar <kbd>⏎</kbd></button>
          }
        }
        <kbd>Alt+Shift+J</kbd>
      </div>
      <div class="scripts-corpo">
        <div #lista class="scripts-lista" tabindex="0" role="listbox" aria-label="Scripts" (keydown)="teclar($event)">
          @for (sc of s.scripts(); track sc.nome; let i = $index) {
            <div class="script-item" role="option" [class.selecionado]="escolhido() === sc.nome" (click)="escolher(sc.nome)" (dblclick)="s.rodar(sc.nome)">
              <span [class]="classeDoPonto(sc.nome)">{{ ponto(sc.nome) }}</span>
              <span class="forte">{{ sc.nome }}</span>
              <span class="suave script-comando">{{ sc.comando }}</span>
            </div>
          } @empty {
            <div class="suave script-vazio">sem scripts no package.json</div>
          }
          <div class="script-item" [class.selecionado]="escolhido() === instalarId" (click)="escolher(instalarId)">
            <span [class]="classeDoPonto(instalarId)">{{ ponto(instalarId) }}</span><span class="suave">npm install</span>
          </div>
          <div class="suave script-dica">j k · ⏎ roda · x para</div>
        </div>
        <div #saida class="servidor-log scripts-saida" tabindex="0" role="log" aria-label="Saída do script" (keydown)="teclar($event)">
          @for (l of linhas(); track l.n) {
            <div class="log-linha" [attr.data-nivel]="l.nivel" [class.seedy]="l.seedy">
              @for (p of partes(l.texto); track $index) {
                @if (p.arquivo; as a) { <a class="log-frame" (click)="abrir(a)">{{ p.texto }}</a> } @else { <span>{{ p.texto }}</span> }
              }
            </div>
          } @empty {
            <div class="suave">{{ escolhido() ? 'ainda não rodou · ⏎ roda' : 'escolha um script' }}</div>
          }
        </div>
      </div>
    </section>
  `,
})
export class ScriptsComponent {
  protected readonly s = inject(ScriptsService);
  protected readonly exec = inject(ExecucaoService);
  private readonly layout = inject(LayoutService);
  private readonly editor = inject(EditorService);
  private readonly projeto = inject(ProjetoService);
  private readonly elLista = viewChild.required<ElementRef<HTMLElement>>('lista');
  private readonly elSaida = viewChild.required<ElementRef<HTMLElement>>('saida');
  protected readonly instalarId = ID_INSTALAR;

  protected readonly escolhido = computed(() => this.s.selecionado() ?? this.s.scripts()[0]?.nome ?? null);
  protected readonly linhas = computed(() => {
    const nome = this.escolhido();
    return nome ? (this.s.execucoes().get(nome)?.linhas ?? []).slice(-1500) : [];
  });

  constructor() {
    effect(() => {
      const pedido = this.layout.pedidoDeFoco();
      if (pedido?.id === 'scripts') untracked(() => queueMicrotask(() => this.elLista().nativeElement.focus()));
    });
    effect(() => {
      this.linhas();
      untracked(() =>
        queueMicrotask(() => {
          const el = this.elSaida()?.nativeElement;
          if (el) el.scrollTop = el.scrollHeight;
        }),
      );
    });
  }

  protected escolher(nome: string): void {
    this.s.selecionado.set(nome);
  }

  protected nomeVisivel(nome: string): string {
    return nome === ID_INSTALAR ? 'npm install' : nome;
  }

  protected estado(e: { fase: string; url: string | null; codigo: number | null }): string {
    if (e.fase === 'rodando') return e.url ? `rodando · ${e.url.replace(/^https?:\/\/[^:/]+/, '').replace(/\/$/, '') || e.url}` : 'rodando';
    return e.codigo ? `falhou (código ${e.codigo})` : 'parado';
  }

  protected ponto(nome: string): string {
    const e = this.s.execucoes().get(nome);
    return e?.fase === 'rodando' ? '●' : e?.codigo ? '✕' : '○';
  }

  protected classeDoPonto(nome: string): string {
    const e = this.s.execucoes().get(nome);
    return e?.fase === 'rodando' ? 'git-mais' : e?.codigo ? 'erro-texto' : 'suave';
  }

  /** Quebra a linha em texto e referências clicáveis a arquivos do projeto. */
  protected partes(texto: string): Parte[] {
    const saida: Parte[] = [];
    let ultimo = 0;
    for (const m of texto.matchAll(REF)) {
      if (m.index! > ultimo) saida.push({ texto: texto.slice(ultimo, m.index) });
      saida.push({ texto: m[0], arquivo: { caminho: m[1], linha: Number(m[2]), coluna: Number(m[3] ?? 1) } });
      ultimo = m.index! + m[0].length;
    }
    if (ultimo < texto.length) saida.push({ texto: texto.slice(ultimo) });
    return saida;
  }

  protected abrir(a: { caminho: string; linha: number; coluna: number }): void {
    const raiz = this.projeto.raiz();
    if (!raiz) return;
    const absoluto = /^([a-zA-Z]:|\/)/.test(a.caminho) ? a.caminho : `${raiz.replace(/[\\/]+$/, '')}${raiz.includes('\\') ? '\\' : '/'}${a.caminho.replace(/[\\/]/g, raiz.includes('\\') ? '\\' : '/')}`;
    void this.editor.abrir(absoluto, a.linha, a.coluna).then(() => this.editor.focar());
  }

  protected teclar(e: KeyboardEvent): void {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const nomes = [...this.s.scripts().map((x) => x.nome), ID_INSTALAR];
    const i = Math.max(0, nomes.indexOf(this.escolhido() ?? ''));
    const nome = this.escolhido();
    switch (e.key) {
      case 'j':
      case 'ArrowDown':
        this.s.selecionado.set(nomes[Math.min(nomes.length - 1, i + 1)]);
        break;
      case 'k':
      case 'ArrowUp':
        this.s.selecionado.set(nomes[Math.max(0, i - 1)]);
        break;
      case 'Enter':
        if (nome) void this.s.rodar(nome);
        break;
      case 'x':
        if (nome) void this.s.parar(nome);
        break;
      case 'o':
        void this.s.abrirNoNavegador(nome);
        break;
      case 'd':
        if (nome && nome !== ID_INSTALAR) void this.exec.depurarScript(nome);
        break;
      case 'i':
        void this.s.instalar();
        break;
      case 'c':
        this.s.limpar(nome);
        break;
      case 'Escape':
        this.editor.focar();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }
}
