import { Component, inject } from '@angular/core';
import { MensagensService } from '../nucleo/mensagens.service';
import { AtalhosService } from '../teclado/atalhos.service';

/** O sino da barra de cima (e da tela de início), com o número do que ninguém viu. */
@Component({
  selector: 'sd-sino',
  template: `
    <button class="botao-quadrado sino" [class.ativo]="m.listaAberta()" aria-label="Notificações" [title]="titulo()"
            (click)="m.alternarLista()">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/></svg>
      @if (m.naoVistas(); as n) { <b>{{ n > 99 ? '99+' : n }}</b> }
    </button>
  `,
})
export class SinoComponent {
  protected readonly m = inject(MensagensService);
  private readonly atalhos = inject(AtalhosService);

  protected titulo(): string {
    const atalho = this.atalhos.rotuloDoAtalho('notificacoes');
    return atalho ? `Notificações (${atalho})` : 'Notificações';
  }
}
