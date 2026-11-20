import { Component, effect, ElementRef, input, viewChild } from '@angular/core';
import { Previa } from './previa';

/** Código da prévia das buscas: números de linha, sintaxe e a linha em destaque. */
@Component({
  selector: 'sd-previa',
  template: `
    <div #codigo class="busca-previa-codigo">
      @for (l of previa().linhas; track $index) {
        <div class="linha-previa" [class.alvo]="l.alvo && !l.tipo" [class.sai]="l.tipo === 'sai'" [class.entra]="l.tipo === 'entra'">
          <span class="numero">{{ l.tipo === 'sai' ? '−' : l.tipo === 'entra' ? '+' : l.numero }}</span>
          <span class="codigo">@for (s of l.pedacos; track $index) {<span [class]="s.classe">{{ s.texto }}</span>}</span>
        </div>
      }
    </div>
  `,
  host: { class: 'previa' },
})
export class PreviaComponent {
  readonly previa = input.required<Previa>();
  private readonly codigo = viewChild.required<ElementRef<HTMLDivElement>>('codigo');

  constructor() {
    // Linhas longas: rola para o trecho encontrado ficar visível.
    effect(() => {
      this.previa();
      queueMicrotask(() => {
        const caixa = this.codigo().nativeElement;
        const marca = caixa.querySelector<HTMLElement>('.alvo .casado');
        if (!marca) {
          caixa.scrollLeft = 0;
          return;
        }
        // Só rola se o trecho encontrado não couber na largura visível.
        const inicio = marca.getBoundingClientRect().left - caixa.getBoundingClientRect().left + caixa.scrollLeft;
        const fim = inicio + marca.getBoundingClientRect().width;
        caixa.scrollLeft = fim > caixa.clientWidth - 24 ? Math.max(0, inicio - caixa.clientWidth / 2) : 0;
      });
    });
  }
}
