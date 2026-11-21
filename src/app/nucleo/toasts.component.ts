import { Component, inject } from '@angular/core';
import { MensagensService } from './mensagens.service';

/** Os toasts de alerta (canto inferior direito, acima da barra de status). */
@Component({
  selector: 'sd-toasts',
  template: `
    <div class="toasts" aria-live="polite">
      @for (a of m.alertas(); track a.id) {
        <div class="toast-alerta" role="alert" (click)="m.fecharAlerta(a.id)" title="clique para fechar">
          <span class="aviso-texto toast-icone">⚠</span><span>{{ a.texto }}</span>
        </div>
      }
    </div>
  `,
})
export class ToastsComponent {
  protected readonly m = inject(MensagensService);
}
