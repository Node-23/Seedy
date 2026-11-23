import { AnexosService } from '../ia/anexos.service';
import { Component, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { TodoService } from './todo.service';
import { Card, COR, ICONE, Ligacao } from './todo';

/**
 * Painel do TODO por cima das telas (mockup 20, Alt+6): novo card, cards abertos com as
 * ligações, os feitos embaixo e o que `l` vai ligar ao card. Tudo pelo teclado.
 */
@Component({
  selector: 'sd-todo-painel',
  template: `
    <section class="painel todo-painel" aria-label="TODO" (keydown)="teclar($event)">
      <div class="painel-faixa">
        <span class="rotulo">TODO</span><span class="suave">{{ t.abertos().length }} {{ t.abertos().length === 1 ? 'aberto' : 'abertos' }} · {{ t.feitos().length }} {{ t.feitos().length === 1 ? 'feito' : 'feitos' }}</span>
        <span class="espaco"></span><span class="suave">.seedy/todo.md</span><kbd>Alt+6</kbd>
      </div>

      <div class="todo-novo">
        <label class="todo-campo"><span class="destaque-texto">+</span><input #novo type="text" spellcheck="false" placeholder="novo card…" (keydown)="teclarNovo($event)" /><kbd>o</kbd></label>
      </div>

      <div #lista class="todo-lista" tabindex="0">
        @for (c of t.abertos(); track c.id) {
          <div class="todo-card" [attr.data-id]="c.id" [class.selecionado]="c.id === t.atual()?.id" (click)="t.selecionado.set(c.id)" (contextmenu)="menuIa($event, c)">
            @if (editando() === c.id) {
              <input #titulo class="todo-editar" type="text" spellcheck="false" [value]="c.titulo" (keydown)="teclarEdicao($event, c)" />
              <textarea #nota class="todo-editar" rows="2" spellcheck="false" placeholder="nota (ctrl+⏎ salva)" [value]="c.nota" (keydown)="teclarEdicao($event, c)"></textarea>
            } @else {
              <div class="todo-titulo"><span class="todo-caixa" (click)="$event.stopPropagation(); t.alternarFeito(c)"></span><b>{{ c.titulo }}</b></div>
              @if (c.nota) { <div class="todo-nota">{{ c.nota }}</div> }
            }
            @if (c.ligacoes.length) {
              <div class="todo-chips">
                @for (l of c.ligacoes; track $index) {
                  <span class="todo-chip" [title]="l.alvo" (click)="$event.stopPropagation(); t.abrirLigacao(l)">
                    @if (c.id === t.atual()?.id && $index < 9) {<span class="suave">{{ $index + 1 }}</span>}
                    <span [class]="cor(l)">{{ icone(l) }}</span>{{ l.rotulo }}
                    <span class="todo-chip-x" title="desligar" (click)="$event.stopPropagation(); t.desligar(c, l)">×</span>
                  </span>
                }
              </div>
            }
          </div>
        } @empty {
          <div class="debug-vazio suave">nenhum card aberto · <span class="destaque-texto">o</span> cria um</div>
        }

        @if (t.feitos().length) {
          <div class="entender-grupo todo-grupo">FEITOS · {{ t.feitos().length }}</div>
          @for (c of t.feitos(); track c.id) {
            <div class="todo-feito" [attr.data-id]="c.id" [class.selecionado]="c.id === t.atual()?.id" (click)="t.selecionado.set(c.id)" (contextmenu)="menuIa($event, c)">
              <span class="todo-caixa feita" (click)="$event.stopPropagation(); t.alternarFeito(c)">✓</span><span class="suave">{{ c.titulo }}</span>
            </div>
          }
        }
      </div>

      <div class="todo-ligar">
        <span class="rotulo">LIGAR AO CARD</span><br />
        @if (t.emFoco(); as f) {
          <span class="destaque-texto">l</span> liga o que está aberto: <span [class]="cor(f)">{{ icone(f) }}</span> {{ f.rotulo }}
        } @else {
          <span class="suave">abra um arquivo, regra, bloco, caminho ou container para ligar com <span class="destaque-texto">l</span></span>
        }
      </div>
      <div class="suave todo-dica">
        j k · <span class="destaque-texto">x</span> feito · <span class="destaque-texto">⏎</span> abre · <span class="destaque-texto">e</span> edita · <span class="destaque-texto">l</span> liga · <span class="destaque-texto">dd</span> apaga · esc
      </div>
    </section>
  `,
})
export class TodoPainelComponent {
  protected readonly t = inject(TodoService);
  private readonly anexos = inject(AnexosService);

  protected menuIa(e: MouseEvent, c: Card): void {
    this.t.selecionado.set(c.id);
    this.anexos.abrirMenu(e, () => this.anexos.doCard(c));
  }

  private readonly elNovo = viewChild.required<ElementRef<HTMLInputElement>>('novo');
  private readonly elLista = viewChild.required<ElementRef<HTMLElement>>('lista');
  private readonly elTitulo = viewChild<ElementRef<HTMLInputElement>>('titulo');
  private readonly elNota = viewChild<ElementRef<HTMLTextAreaElement>>('nota');
  protected readonly editando = signal<number | null>(null);
  private esperandoD = false;

  constructor() {
    queueMicrotask(() => this.elLista().nativeElement.focus());
    effect(() => {
      const id = this.t.atual()?.id;
      untracked(() => setTimeout(() => this.elLista()?.nativeElement.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' })));
    });
  }

  protected icone(l: Ligacao): string {
    return ICONE[l.tipo];
  }

  protected cor(l: Ligacao): string {
    return COR[l.tipo];
  }

  protected teclar(e: KeyboardEvent): void {
    const alvo = e.target as HTMLElement;
    if (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const feito = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    const c = this.t.atual();
    const ordem = this.t.ordem();
    const i = c ? ordem.indexOf(c) : -1;
    if (e.key !== 'd') this.esperandoD = false;
    switch (e.key) {
      case 'Escape':
        feito();
        this.t.fechar();
        return;
      case 'j':
      case 'ArrowDown':
        feito();
        if (ordem[i + 1]) this.t.selecionado.set(ordem[i + 1].id);
        return;
      case 'k':
      case 'ArrowUp':
        feito();
        if (i > 0) this.t.selecionado.set(ordem[i - 1].id);
        return;
      case 'o':
        feito();
        this.elNovo().nativeElement.focus();
        return;
      case 'x':
        feito();
        if (c) void this.t.alternarFeito(c);
        return;
      case 'l':
        feito();
        void this.t.ligarEmFoco();
        return;
      case 'e':
        feito();
        if (c && !c.feito) this.editar(c);
        return;
      case 'u':
        feito();
        if (c?.ligacoes.length) void this.t.desligar(c, c.ligacoes.at(-1)!);
        return;
      case 'd':
        feito();
        if (this.esperandoD && c) void this.t.apagar(c);
        this.esperandoD = !this.esperandoD;
        return;
      case 'Enter':
        feito();
        if (c?.ligacoes[0]) void this.t.abrirLigacao(c.ligacoes[0]);
        return;
    }
    if (/^[1-9]$/.test(e.key) && c?.ligacoes[Number(e.key) - 1]) {
      feito();
      void this.t.abrirLigacao(c.ligacoes[Number(e.key) - 1]);
    }
  }

  protected teclarNovo(e: KeyboardEvent): void {
    const campo = e.target as HTMLInputElement;
    if (e.key === 'Enter') {
      e.preventDefault();
      void this.t.criar(campo.value);
      campo.value = '';
      this.elLista().nativeElement.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      campo.value = '';
      this.elLista().nativeElement.focus();
    }
  }

  private editar(c: Card): void {
    this.editando.set(c.id);
    setTimeout(() => this.elTitulo()?.nativeElement.focus());
  }

  protected teclarEdicao(e: KeyboardEvent, c: Card): void {
    const naNota = (e.target as HTMLElement).tagName === 'TEXTAREA';
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.editando.set(null);
      this.elLista().nativeElement.focus();
    } else if (e.key === 'Enter' && (!naNota || e.ctrlKey)) {
      e.preventDefault();
      const titulo = this.elTitulo()?.nativeElement.value.trim() || c.titulo;
      const nota = this.elNota()?.nativeElement.value ?? c.nota;
      this.editando.set(null);
      void this.t.atualizar(c.id, { titulo, nota });
      this.elLista().nativeElement.focus();
    } else if (e.key === 'Tab' && !naNota) {
      e.preventDefault();
      this.elNota()?.nativeElement.focus();
    }
  }
}
