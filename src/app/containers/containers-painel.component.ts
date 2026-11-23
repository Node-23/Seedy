import { Component, computed, effect, ElementRef, inject, untracked, viewChild } from '@angular/core';
import { DockerService } from './docker.service';
import { LayoutService } from '../layout/layout.service';
import { EditorService } from '../editor/editor.service';

const NIVEL = { erro: 'ERROR', aviso: 'WARN ', info: 'INFO ', debug: 'DEBUG' } as const;

/**
 * Painel de containers embaixo do editor (mockup 16, Alt+8): a lista com o que cada um usa
 * e os logs do escolhido. Alt+Shift+8 abre o mapa em tela cheia.
 */
@Component({
  selector: 'sd-containers-painel',
  template: `
    <section class="painel scripts" aria-label="Containers">
      <div class="servidor-faixa">
        <span class="rotulo">CONTAINERS</span>
        @if (d.composeDoProjeto(); as c) { <span class="suave">compose {{ c }}</span> }
        @if (d.versao()) {
          <span class="git-mais">● {{ d.rodando().length }} rodando</span>
          <span class="suave">· {{ d.containers().length - d.rodando().length }} parado{{ d.containers().length - d.rodando().length === 1 ? '' : 's' }}</span>
        } @else {
          <span class="erro-texto">{{ d.erro() ?? 'procurando o Docker…' }}</span>
        }
        @if (d.ocupado(); as o) { <span class="aviso-texto">{{ o }}…</span> }
        <span class="espaco"></span>
        <button class="botao" (click)="d.compose('up')">▲ up <kbd>u</kbd></button>
        @if (d.atual(); as c) {
          <button class="botao" [class.perigo]="c.estado === 'running'" (click)="d.iniciarOuParar(c.nome)">{{ c.estado === 'running' ? '■ parar' : '▶ iniciar' }} <kbd>s</kbd></button>
          <button class="botao" (click)="d.abrirTerminal(c.nome)">&gt;_ terminal <kbd>t</kbd></button>
        }
        <button class="botao" (click)="layout.tela.set('containers')">◇ mapa <kbd>Alt+Shift+8</kbd></button>
        <kbd>Alt+8</kbd>
      </div>
      <div class="scripts-corpo docker-painel-corpo">
        <div #lista class="scripts-lista" tabindex="0" role="listbox" aria-label="Containers" (keydown)="teclar($event)">
          @for (c of d.ordenados(); track c.id) {
            <div class="script-item" role="option" [class.selecionado]="c.nome === d.atual()?.nome" (click)="d.escolher(c.nome)" (dblclick)="d.iniciarOuParar(c.nome)">
              <span [class.git-mais]="c.estado === 'running'" [class.suave]="c.estado !== 'running'">{{ c.estado === 'running' ? '●' : '○' }}</span>
              <span [class.forte]="c.nome === d.atual()?.nome" [class.suave]="c.estado !== 'running'">{{ c.composeServico ?? c.nome }}</span>
              <span class="suave script-comando">{{ resumo(c.nome) }}</span>
            </div>
          } @empty {
            <div class="suave script-vazio">{{ d.versao() ? 'nenhum container' : 'o Docker não respondeu' }}</div>
          }
        </div>
        <div #logs class="servidor-log scripts-saida" tabindex="0" role="log" aria-label="Logs do container">
          @if (d.atual(); as c) { <div class="log-linha seedy">logs de {{ c.composeServico ?? c.nome }}{{ d.seguindo() ? ' · seguindo' : '' }}</div> }
          @for (l of linhas(); track l.n) {
            <div class="log-linha" [attr.data-nivel]="l.nivel">
              <span class="log-hora">{{ l.hora ?? '' }}</span>@if (l.nivel && !l.pilha) {<span class="log-nivel">{{ nivel(l.nivel) }}</span>}<span>{{ l.mensagem }}</span>
            </div>
          }
        </div>
      </div>
    </section>
  `,
})
export class ContainersPainelComponent {
  protected readonly d = inject(DockerService);
  protected readonly layout = inject(LayoutService);
  private readonly editor = inject(EditorService);
  private readonly elLista = viewChild.required<ElementRef<HTMLElement>>('lista');
  private readonly elLogs = viewChild.required<ElementRef<HTMLElement>>('logs');

  protected readonly linhas = computed(() => {
    const nome = this.d.atual()?.nome;
    return nome ? (this.d.logs().get(nome) ?? []).slice(-600) : [];
  });

  constructor() {
    effect(() => {
      const pedido = this.layout.pedidoDeFoco();
      if (pedido?.id === 'containers') untracked(() => queueMicrotask(() => this.elLista().nativeElement.focus()));
    });
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

  /** ":8080 · → postgres" (portas no host e de quem depende). */
  protected resumo(nome: string): string {
    const c = this.d.containers().find((x) => x.nome === nome);
    if (!c) return '';
    if (c.estado !== 'running') return 'parado';
    const portas = c.portas.filter((p) => p.host).map((p) => `:${p.host}`).slice(0, 2).join(' ');
    const usa = [...new Set(this.d.conexoes().filter((x) => x.de === nome && x.tipo !== 'porta').map((x) => this.d.containers().find((o) => o.nome === x.para)?.composeServico ?? x.para))];
    const perfil = this.d.perfisPorContainer().get(nome);
    return [portas, usa.length ? `→ ${usa.join(', ')}` : '', perfil ? `◆ ${perfil}` : ''].filter(Boolean).join(' · ') || c.imagem.split('/').pop()!;
  }

  protected nivel(n: keyof typeof NIVEL): string {
    return NIVEL[n];
  }

  protected teclar(e: KeyboardEvent): void {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const lista = this.d.ordenados();
    const i = Math.max(0, lista.findIndex((c) => c.nome === this.d.atual()?.nome));
    switch (e.key) {
      case 'j':
      case 'ArrowDown':
        this.d.escolher(lista[Math.min(lista.length - 1, i + 1)]?.nome);
        break;
      case 'k':
      case 'ArrowUp':
        this.d.escolher(lista[Math.max(0, i - 1)]?.nome);
        break;
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
        this.d.ligarAoBanco();
        break;
      case 'u':
        void this.d.compose('up');
        break;
      case 'Enter':
      case 'm':
        this.layout.tela.set('containers');
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
