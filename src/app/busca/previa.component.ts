import { Component, effect, ElementRef, input, viewChild } from '@angular/core';
import { Previa } from './previa';

/** Código da prévia das buscas: números de linha, sintaxe e a linha em destaque. */
@Component({
  selector: 'sd-previa',
  template: `
    <div #codigo class="busca-previa-codigo">
      @for (l of previa().linhas; track l.numero) {
        <div class="linha-previa" [class.alvo]="l.alvo">
          <span class="numero">{{ l.numero }}</span>
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
        caixa.scrollLeft = marca ? Math.max(0, marca.offsetLeft - caixa.clientWidth / 2) : 0;
      });
    });
  }
}
