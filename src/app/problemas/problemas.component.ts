import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { EditorService } from '../editor/editor.service';
import { LayoutService } from '../layout/layout.service';
import { ArquivoComProblemas, FiltroDeProblemas, Problema, ProblemasService } from './problemas.service';

type Linha = { chave: string; arquivo: ArquivoComProblemas; problema: Problema | null };

/**
 * Painel de problemas (mockup 45), Alt+3.
 * Teclado: j/k andam, ⏎ vai até a linha (ou abre/fecha o arquivo), . abre as ações rápidas,
 * f troca o filtro, esc volta ao editor.
 */
@Component({
  selector: 'sd-problemas',
  template: `
    <section class="painel problemas" aria-label="Problemas">
      <div class="painel-faixa">
        <span class="rotulo">PROBLEMAS</span>
        <span class="erro-texto">✕ {{ p.erros() }}</span>
        <span class="aviso-texto">▲ {{ p.avisos() }}</span>
        <span class="espaco"></span>
        <span class="mdv-modos" role="group" aria-label="Filtro">
          @for (f of filtros; track f.id) {
            <button [class.sel]="p.filtro() === f.id" [attr.aria-pressed]="p.filtro() === f.id" (click)="filtrar(f.id)">{{ f.rotulo }}</button>
          }
        </span>
        <kbd>Alt+3</kbd>
      </div>
      <div #lista class="problemas-lista" role="listbox" tabindex="0" (keydown)="teclar($event)">
        @for (l of linhas(); track l.chave; let n = $index) {
          @if (l.problema; as x) {
            <div class="problema" role="option" [class.sel]="n === indice()" [attr.aria-selected]="n === indice()" [title]="x.mensagem" (click)="indice.set(n); ativar(l)">
              <span [class]="x.erro ? 'erro-texto' : 'aviso-texto'">{{ x.erro ? '✕' : '▲' }}</span>
              <span class="mensagem">{{ x.mensagem }}</span>
              <span class="posicao suave">{{ x.linha }}:{{ x.coluna }}</span>
            </div>
          } @else {
            <div class="problema arquivo" role="option" [class.sel]="n === indice()" [attr.aria-selected]="n === indice()" (click)="indice.set(n); ativar(l)">
              <span class="suave">{{ fechados().has(l.arquivo.uri) ? '▸' : '▾' }}</span>
              <b>{{ l.arquivo.nome }}</b>
              <span class="suave mensagem">{{ l.arquivo.pasta }}</span>
              <span class="posicao suave">{{ l.arquivo.problemas.length }}</span>
            </div>
          }
        } @empty {
          <p class="suave problemas-vazio">Nenhum erro ou aviso{{ p.filtro() === 'atual' ? ' neste arquivo' : '' }}.</p>
        }
      </div>
      <div class="problemas-rodape suave">
        <span><span class="destaque-texto">j k</span> andar</span><span><span class="destaque-texto">⏎</span> ir até a linha</span>
        <span><span class="destaque-texto">.</span> ações rápidas</span><span><span class="destaque-texto">f</span> filtro</span>
        <span class="espaco"></span><span><span class="destaque-texto">F8 / Shift+F8</span> próximo e anterior</span>
      </div>
    </section>
  `,
})
export class ProblemasComponent {
  protected readonly p = inject(ProblemasService);
  private readonly editor = inject(EditorService);
  private readonly layout = inject(LayoutService);
  private readonly lista = viewChild.required<ElementRef<HTMLDivElement>>('lista');

  protected readonly filtros: { id: FiltroDeProblemas; rotulo: string }[] = [
    { id: 'tudo', rotulo: 'tudo' },
    { id: 'erros', rotulo: 'só erros' },
    { id: 'atual', rotulo: 'arquivo atual' },
  ];
  protected readonly indice = signal(0);
  protected readonly fechados = signal<ReadonlySet<string>>(new Set());

  protected readonly linhas = computed<Linha[]>(() =>
    this.p.arquivos().flatMap((arquivo) => [
      { chave: arquivo.uri, arquivo, problema: null },
      ...(this.fechados().has(arquivo.uri) ? [] : arquivo.problemas.map((problema, i) => ({ chave: `${arquivo.uri}#${i}`, arquivo, problema }))),
    ]),
  );

  constructor() {
    // Abrir o painel pelo teclado já deixa o primeiro problema marcado.
    effect(() => {
      const pedido = this.layout.pedidoDeFoco();
      if (pedido?.id !== 'problemas') return;
      untracked(() => {
        const primeiro = this.linhas().findIndex((l) => l.problema);
        if (primeiro >= 0 && !this.linhas()[this.indice()]?.problema) this.indice.set(primeiro);
        queueMicrotask(() => this.lista().nativeElement.focus());
      });
    });
    effect(() => {
      const n = this.linhas().length;
      untracked(() => this.indice.set(Math.min(this.indice(), Math.max(0, n - 1))));
    });
  }

  protected filtrar(f: FiltroDeProblemas): void {
    this.p.filtro.set(f);
    this.indice.set(0);
  }

  protected ativar(l: Linha): void {
    if (l.problema) return void this.p.ir(l.problema);
    const n = new Set(this.fechados());
    if (!n.delete(l.arquivo.uri)) n.add(l.arquivo.uri);
    this.fechados.set(n);
  }

  protected teclar(e: KeyboardEvent): void {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const linhas = this.linhas();
    const atual = linhas[this.indice()];
    const mover = (d: number) => {
      this.indice.set(Math.max(0, Math.min(linhas.length - 1, this.indice() + d)));
      setTimeout(() => this.lista().nativeElement.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }));
    };
    if (e.key === 'j' || e.key === 'ArrowDown') mover(1);
    else if (e.key === 'k' || e.key === 'ArrowUp') mover(-1);
    else if (e.key === 'Enter' && atual) this.ativar(atual);
    else if (e.key === '.' && atual?.problema) {
      void this.p.ir(atual.problema).then(() => setTimeout(() => this.editor.instancia?.trigger('problemas', 'editor.action.quickFix', null), 100));
    } else if (e.key === 'f') this.filtrar(this.filtros[(this.filtros.findIndex((x) => x.id === this.p.filtro()) + 1) % this.filtros.length].id);
    else if (e.key === 'Escape') this.editor.focar();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
}
