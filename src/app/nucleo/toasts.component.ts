import { Component, inject } from '@angular/core';
import { AtalhosService } from '../teclado/atalhos.service';
import { MensagensService, Notificacao } from './mensagens.service';

export const ICONE_DA_NOTIFICACAO = { info: '✓', aviso: '⚠', erro: '✗' } as const;

/** Os toasts (mockup 34): canto inferior direito, acima da barra de status. */
@Component({
  selector: 'sd-toasts',
  template: `
    <div class="toasts" aria-live="polite">
      @for (n of m.toasts(); track n.id) {
        <div class="toast" [class]="'toast ' + n.tipo" [attr.role]="n.tipo === 'erro' ? 'alert' : 'status'" (click)="m.abrir(n)" title="clique para ver">
          <i aria-hidden="true">{{ icones[n.tipo] }}</i>
          <span class="toast-texto">
            <b>{{ n.titulo }}</b>
            @if (dica(n); as d) { <small>{{ d }}</small> }
          </span>
          <button class="toast-fechar" aria-label="Fechar aviso" (click)="fechar($event, n)">×</button>
        </div>
      }
    </div>
  `,
})
export class ToastsComponent {
  protected readonly m = inject(MensagensService);
  private readonly atalhos = inject(AtalhosService);
  protected readonly icones = ICONE_DA_NOTIFICACAO;

  protected dica(n: Notificacao): string {
    if (n.tipo === 'info') return '';
    if (n.tipo === 'aviso') return 'clique para ver';
    const atalho = this.atalhos.rotuloDoAtalho('notificacoes');
    const base = n.doSeedy ? 'erro do Seedy · clique para ver e enviar' : 'clique para ver';
    return atalho ? `${base} · ${atalho}` : base;
  }

  protected fechar(e: Event, n: Notificacao): void {
    e.stopPropagation();
    this.m.fecharToast(n.id);
  }
}
