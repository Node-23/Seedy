import { Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { IdPainel, LayoutService, Tela } from '../layout/layout.service';
import { EntenderService } from '../entender/entender.service';
import { EditorService } from '../editor/editor.service';
import { BuscaService } from '../busca/busca.service';
import { ScriptsService } from '../web/scripts.service';
import { DockerService } from '../containers/docker.service';
import { TodoService } from './todo.service';
import { TestesService } from '../testes/testes.service';
import { BookmarksService } from '../editor/bookmarks.service';
import { ConfigService } from '../config/config.service';
import { ConfiguracoesService } from '../config/configuracoes.service';

/**
 * Barra fina de ícones à esquerda (mockup 20): tudo que abre uma janela, um painel ou uma
 * tela fica aqui (a barra de cima ficou com o projeto, os buffers, o RUN/DEBUG e as ações
 * da tela atual). Cada botão mostra o atalho do teclado no título.
 */
@Component({
  selector: 'sd-barra-icones',
  template: `
    <nav #barra class="barra-icones" [class.reordenando]="arrastando() !== null" aria-label="Janelas e painéis">
      <button class="icone-lateral" data-id="arquivos" [style.order]="o('arquivos')" (pointerdown)="arrastar($event, 'arquivos')" [class.ativo]="noEditor() && layout.disposicao().visiveis.arquivos" title="Arquivos (␣ e)" (click)="painel('arquivos')">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /></svg>
      </button>
      <button class="icone-lateral" data-id="buscar" [style.order]="o('buscar')" (pointerdown)="arrastar($event, 'buscar')" [class.ativo]="busca.aberta()" title="Buscar arquivo (ctrl+p) · no projeto: ctrl+shift+f" (click)="buscar()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      </button>
      <button class="icone-lateral" data-id="git" [style.order]="o('git')" (pointerdown)="arrastar($event, 'git')" [class.ativo]="layout.tela() === 'git' || layout.tela() === 'merge'" title="Git (␣ g)" (click)="tela('git')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="6" cy="5" r="2.5" /><circle cx="6" cy="19" r="2.5" /><circle cx="18" cy="8" r="2.5" /><path d="M6 7.5v9M18 10.5v1a4 4 0 0 1-4 4H8.5" /></svg>
      </button>
      <button class="icone-lateral" data-id="todo" [style.order]="o('todo')" (pointerdown)="arrastar($event, 'todo')" [class.ativo]="todo.aberto()" title="TODO (␣ T)" (click)="todo.alternar()">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4" /><path d="M8 12.5l2.8 2.8L16.5 9" /></svg>
        @if (abertos(); as n) { <span class="icone-contador">{{ n }}</span> }
      </button>

      <button class="icone-lateral" data-id="bookmarks" [style.order]="o('bookmarks')" (pointerdown)="arrastar($event, 'bookmarks')" title="Bookmarks (␣ B lista · ␣ M marca a linha)" (click)="bookmarks.listar()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4.5L6 21z" /></svg>
        @if (bookmarks.marcas().length; as n) { <span class="icone-contador">{{ n }}</span> }
      </button>

      <span class="icone-divisa" data-id="divisa" [style.order]="o('divisa')" aria-hidden="true"></span>

      <button class="icone-lateral" data-id="terminal" [style.order]="o('terminal')" (pointerdown)="arrastar($event, 'terminal')" [class.ativo]="noEditor() && layout.disposicao().visiveis.terminal" title="Terminal (alt f12)" (click)="painel('terminal')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7l5 5-5 5M12 18h7" /></svg>
      </button>
      <button class="icone-lateral" data-id="servidor" [style.order]="o('servidor')" (pointerdown)="arrastar($event, 'servidor')" [class.ativo]="noEditor() && layout.disposicao().visiveis.servidor" title="Servidor (␣ j)" (click)="painel('servidor')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="4" width="16" height="7" rx="2" /><rect x="4" y="13" width="16" height="7" rx="2" /><path d="M8 7.5h.01M8 16.5h.01" /></svg>
      </button>
      @if (scripts.scripts().length) {
        <button class="icone-lateral" data-id="scripts" [style.order]="o('scripts')" (pointerdown)="arrastar($event, 'scripts')" [class.ativo]="noEditor() && layout.disposicao().visiveis.scripts" title="Scripts do package.json (␣ p)" (click)="painel('scripts')">
          <span class="icone-texto">{{ '{}' }}</span>
        </button>
      }
      <button class="icone-lateral" data-id="banco" [style.order]="o('banco')" (pointerdown)="arrastar($event, 'banco')" [class.ativo]="noEditor() && layout.disposicao().visiveis.conexoes" title="Banco de dados (␣ d)" (click)="painel('conexoes')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" /></svg>
      </button>
      <button class="icone-lateral" data-id="containers" [style.order]="o('containers')" (pointerdown)="arrastar($event, 'containers')" [class.ativo]="layout.tela() === 'containers' || (noEditor() && layout.disposicao().visiveis.containers)" title="Containers (␣ D tela · ␣ h painel)" (click)="tela('containers')">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></svg>
        @if (docker.rodando().length; as n) { <span class="icone-contador ok">{{ n }}</span> }
      </button>
      <button class="icone-lateral" data-id="debug" [style.order]="o('debug')" (pointerdown)="arrastar($event, 'debug')" [class.ativo]="layout.tela() === 'debug'" title="Tela de debug (␣ x)" (click)="tela('debug')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="7" y="7" width="10" height="13" rx="5" /><path d="M12 7V4M9 4.5l1.5 2.5M15 4.5l-1.5 2.5M7 12H3.5M20.5 12H17M7 16.5l-3 2M17 16.5l3 2M12 11v9" /></svg>
      </button>
      <button class="icone-lateral" data-id="testes" [style.order]="o('testes')" (pointerdown)="arrastar($event, 'testes')" [class.ativo]="layout.tela() === 'testes'" title="Testes (␣ E)" (click)="testes.alternar()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6M10 3v6.2L4.6 18.5A2 2 0 0 0 6.3 21.5h11.4a2 2 0 0 0 1.7-3L14 9.2V3" /><path d="M7.5 15h9" /></svg>
        @if (testes.totais().falhou; as n) { <span class="icone-contador erro">{{ n }}</span> }
      </button>
      <button class="icone-lateral" data-id="entender" [style.order]="o('entender')" (pointerdown)="arrastar($event, 'entender')" [class.ativo]="layout.tela() === 'entender'" title="Entender o sistema (␣ A)" (click)="entender.alternar()">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="7" height="6" rx="1.5" /><rect x="14" y="4" width="7" height="6" rx="1.5" /><rect x="8.5" y="15" width="7" height="6" rx="1.5" /><path d="M6.5 10v2.5h11V10M12 12.5V15" /></svg>
      </button>

      <span class="espaco-v" [style.order]="1000"></span>
      <button class="icone-lateral ia" [style.order]="1001" [class.ativo]="noEditor() && layout.disposicao().visiveis.ia" title="IA (␣ a)" (click)="painel('ia')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" /></svg>
      </button>
      <button class="icone-lateral" [style.order]="1002" [class.ativo]="layout.tela() === 'config'" title="Configurações (␣ ,)" (click)="configuracoes.alternar()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
      </button>
    </nav>
  `,
})
export class BarraIconesComponent {
  protected readonly layout = inject(LayoutService);
  protected readonly todo = inject(TodoService);
  protected readonly entender = inject(EntenderService);
  protected readonly busca = inject(BuscaService);
  protected readonly scripts = inject(ScriptsService);
  protected readonly docker = inject(DockerService);
  protected readonly configuracoes = inject(ConfiguracoesService);
  protected readonly bookmarks = inject(BookmarksService);
  protected readonly testes = inject(TestesService);
  private readonly editor = inject(EditorService);
  private readonly config = inject(ConfigService);
  private readonly barra = viewChild.required<ElementRef<HTMLElement>>('barra');
  /** Botão sendo arrastado (para reorganizar a barra). */
  protected readonly arrastando = signal<string | null>(null);
  /** Ordem durante o arrasto (a barra se reorganiza ao vivo). */
  private readonly provisoria = signal<string[] | null>(null);
  private readonly ordem = computed(() => this.provisoria() ?? ordemCompleta(this.config.atual().barra?.ordem));
  protected readonly abertos = computed(() => this.todo.abertos().length);
  protected readonly noEditor = computed(() => this.layout.tela() === 'editor');

  /** Painel do editor: abre/fecha; vindo de outra tela, volta ao editor com ele aberto. */
  protected painel(id: IdPainel): void {
    if (!this.noEditor()) {
      this.layout.tela.set('editor');
      this.layout.mostrar(id);
      return;
    }
    this.layout.alternar(id);
    if (!this.layout.visivel(id)) queueMicrotask(() => this.editor.focar());
  }

  /** Tela cheia: abre; se já está nela, volta ao editor. */
  protected tela(t: Tela): void {
    const voltar = this.layout.tela() === t || (t === 'git' && this.layout.tela() === 'merge');
    this.layout.tela.set(voltar ? 'editor' : t);
    if (voltar) queueMicrotask(() => this.editor.focar());
  }

  protected buscar(): void {
    if (this.busca.aberta()) this.busca.fechar(false);
    else this.busca.abrir('arquivos');
  }

  /** `order` do flex: a posição do botão na barra (a ordem vem do seedy.json, `barra.ordem`). */
  protected o(id: string): number {
    return this.ordem().indexOf(id) * 10;
  }

  /** Arrastar um botão pela barra reorganiza (a ordem fica guardada no seedy.json). */
  protected arrastar(inicio: PointerEvent, id: string): void {
    if (inicio.button !== 0) return;
    const y0 = inicio.clientY;
    let movendo = false;
    const mover = (e: PointerEvent) => {
      if (!movendo) {
        if (Math.abs(e.clientY - y0) < 6) return;
        movendo = true;
        this.arrastando.set(id);
        document.body.classList.add('arrastando');
      }
      const outros = this.ordem().filter((x) => x !== id);
      const centros = outros.map((x) => {
        const el = this.barra().nativeElement.querySelector<HTMLElement>(`[data-id="${x}"]`);
        const r = el?.getBoundingClientRect();
        return r ? r.top + r.height / 2 : Infinity;
      });
      const pos = centros.findIndex((c) => e.clientY < c);
      const novo = [...outros];
      novo.splice(pos < 0 ? outros.length : pos, 0, id);
      if (novo.join() !== this.ordem().join()) this.provisoria.set(novo);
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      document.body.classList.remove('arrastando');
      if (!movendo) return;
      // O clique que vem depois do arrasto não pode acionar o botão.
      const calar = (c: Event) => {
        c.stopPropagation();
        c.preventDefault();
      };
      window.addEventListener('click', calar, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', calar, { capture: true }), 0);
      const ordem = this.provisoria();
      this.arrastando.set(null);
      if (ordem) void this.config.gravar({ barra: { ...(this.config.atual().barra ?? {}), ordem } }).then(() => this.provisoria.set(null));
      else this.provisoria.set(null);
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  }
}

/** Ordem de fábrica (o debug logo abaixo dos arquivos). */
export const ORDEM_PADRAO = ['arquivos', 'debug', 'buscar', 'git', 'todo', 'bookmarks', 'divisa', 'terminal', 'servidor', 'scripts', 'banco', 'containers', 'entender', 'testes'];

/** A ordem do seedy.json; botões que ela não cita (de versões novas) entram nas suas posições de fábrica. */
function ordemCompleta(salva: string[] | undefined): string[] {
  const lista = (salva ?? []).filter((x, i, a) => ORDEM_PADRAO.includes(x) && a.indexOf(x) === i);
  const saida = [...lista];
  ORDEM_PADRAO.forEach((x, i) => {
    if (!saida.includes(x)) saida.splice(Math.min(i, saida.length), 0, x);
  });
  return saida;
}
