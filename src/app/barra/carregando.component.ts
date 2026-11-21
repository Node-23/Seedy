import { Component, inject } from '@angular/core';
import { CarregamentoService } from '../nucleo/carregamento.service';

/** A barra de loading da barra de status: o que está carregando agora (e quantas coisas mais). */
@Component({
  selector: 'sd-carregando',
  template: `
    @if (c.cargas(); as lista) {
      @if (lista.length) {
        <span class="segmento com-divisa-esq carregando" role="status" [title]="titulo()">
          <span class="carregando-barra" aria-hidden="true"><i></i></span>
          <span>{{ lista[0].rotulo }}…</span>
          @if (lista.length > 1) { <span class="suave">+{{ lista.length - 1 }}</span> }
        </span>
      }
    }
  `,
})
export class CarregandoComponent {
  protected readonly c = inject(CarregamentoService);

  protected titulo(): string {
    return this.c.cargas().map((x) => `${x.rotulo}: ${x.detalhe}`).join('\n');
  }
}
