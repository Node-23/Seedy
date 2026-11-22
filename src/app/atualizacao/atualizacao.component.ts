import { Component, computed, effect, ElementRef, inject, untracked, viewChild } from '@angular/core';
import { AtualizacaoService } from './atualizacao.service';

/** O aviso "⬆ 0.5.6 disponível" na barra de status (␣ U) e o quadro com as notas e o botão de instalar. */
@Component({
  selector: 'sd-atualizacao',
  template: `
    @if (u.disponivel(); as a) {
      <button class="segmento com-divisa-esq atualizacao-aviso" (click)="u.aberto.set(!u.aberto())" [title]="'Seedy ' + a.versao + ' disponível (␣ U)'">⬆ {{ a.versao }} disponível <kbd>␣ U</kbd></button>
      @if (u.aberto()) {
        <div #quadro class="painel-atualizacao" role="dialog" aria-label="Atualização do Seedy" tabindex="-1" (keydown)="teclar($event)">
          <div class="atualizacao-topo"><span class="rotulo destaque-texto">Seedy {{ a.versao }}</span>
            <div class="suave">você está na {{ a.atual }}@if (a.tamanho) { · {{ mb(a.tamanho) }} MB }</div></div>
          <div class="atualizacao-notas">
            @for (n of notas(); track $index) { <div>• {{ n }}</div> } @empty { <div class="suave">sem notas nesta release</div> }
            @if (!a.automatica) { <div class="aviso-texto atualizacao-nota">este Seedy não se atualiza sozinho (portátil ou pacote do sistema): baixe pela página da release</div> }
            @else if (!a.confere) { <div class="aviso-texto atualizacao-nota">a release não publicou o SHA256SUMS.txt: por segurança, baixe pela página</div> }
            @else { <div class="suave atualizacao-nota">o instalador não é assinado: o Windows pode avisar na primeira vez</div> }
            @if (u.erro(); as e) { <div class="erro-texto atualizacao-nota">{{ e }}</div> }
          </div>
          @if (u.baixando()) {
            <div class="atualizacao-barra"><i [style.width.%]="percentual()"></i></div>
            <div class="suave atualizacao-nota">{{ u.progresso() ? 'baixando… ' + percentual() + '%' : 'conferindo a release…' }} (o Seedy fecha e abre sozinho)</div>
          } @else {
            <div class="atualizacao-acoes">
              <button class="botao" (click)="u.fechar()">depois <kbd>esc</kbd></button>
              <button class="botao" (click)="u.verNotas()">ver notas</button>
              <button class="botao destaque" (click)="u.instalar()">{{ a.automatica && a.confere ? 'instalar e reiniciar' : 'abrir a página' }} <kbd>⏎</kbd></button>
            </div>
          }
        </div>
      }
    }
  `,
})
export class AtualizacaoComponent {
  protected readonly u = inject(AtualizacaoService);
  private readonly quadro = viewChild<ElementRef<HTMLElement>>('quadro');

  /** Os itens das notas da release (linhas de lista do Markdown), sem a formatação. */
  protected readonly notas = computed(() =>
    (this.u.disponivel()?.notas ?? '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^[-*•]\s+/.test(l))
      .map((l) => l.replace(/^[-*•]\s+/, '').replace(/[*_`]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'))
      .slice(0, 10),
  );

  constructor() {
    effect(() => {
      if (!this.u.aberto()) return;
      untracked(() => setTimeout(() => this.quadro()?.nativeElement.focus()));
    });
  }

  protected mb(bytes: number): string {
    return (bytes / 1048576).toFixed(0);
  }

  protected percentual(): number {
    const p = this.u.progresso();
    return p && p.total ? Math.min(100, Math.round((p.lido / p.total) * 100)) : 0;
  }

  protected teclar(e: KeyboardEvent): void {
    if (e.key === 'Escape') this.u.fechar();
    else if (e.key === 'Enter') void this.u.instalar();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
}
