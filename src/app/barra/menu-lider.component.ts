import { Component, inject } from '@angular/core';
import { AtalhosService } from '../teclado/atalhos.service';

/** Menu da tecla líder (␣), no estilo which-key. */
@Component({
  selector: 'sd-menu-lider',
  template: `
    @if (atalhos.liderAberto()) {
      <div class="menu-lider" role="dialog" aria-label="Atalhos do líder">
        <div class="menu-lider-topo">
          <span class="rotulo destaque">ATALHOS</span>
          <span class="suave">letra aqui, ou o atalho à direita · esc fecha</span>
        </div>
        <div class="menu-lider-grade">
          @for (acao of atalhos.acoes; track acao.id) {
            @if (acao.tecla) {
            <button class="menu-lider-item" [class.indisponivel]="!acao.disponivel" (click)="atalhos.executar(acao)">
              <span class="tecla">{{ acao.tecla === ' ' ? '␣' : acao.tecla }}</span>
              <span>{{ acao.rotulo }}</span>
              @if (atalhos.rotuloDoAtalho(acao.id); as r) { <kbd class="menu-lider-atalho">{{ r }}</kbd> }
              @if (!acao.disponivel) { <span class="em-breve">em breve</span> }
            </button>
            }
          }
        </div>
      </div>
    }
  `,
})
export class MenuLiderComponent {
  protected readonly atalhos = inject(AtalhosService);
}
