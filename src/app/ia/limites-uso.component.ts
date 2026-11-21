import { Component, inject } from '@angular/core';
import { LimitesService } from './limites.service';

/** O indicador de uso do Claude na barra de status: janela de 5 horas e semana (clique abre os detalhes). */
@Component({
  selector: 'sd-limites-uso',
  template: `
    @if (l.visivel()) {
      <button class="segmento com-divisa-esq limites-uso" (click)="l.aberto.set(!l.aberto())" title="Uso da assinatura do Claude (clique para detalhes)">
        <span class="suave">✦</span>
        @if (l.janelaDe5h(); as j) {
          <span class="suave">5h</span><span class="mini-barra" [attr.data-nivel]="j.nivel"><i [style.width.%]="j.pct ?? 100"></i></span><b [attr.data-nivel]="j.nivel">{{ j.rotulo }}</b>
        }
        @if (l.semana(); as s) {
          <span class="suave">· sem</span><span class="mini-barra" [attr.data-nivel]="s.nivel"><i [style.width.%]="s.pct ?? 100"></i></span><b [attr.data-nivel]="s.nivel">{{ s.rotulo }}</b>
        }
      </button>
      @if (l.aberto()) {
        <div class="painel-limites" role="dialog" aria-label="Uso do Claude">
          <div class="rotulo">USO DO CLAUDE · ASSINATURA</div>
          @for (item of [{ nome: 'janela de 5 horas', j: l.janelaDe5h() }, { nome: 'semana', j: l.semana() }]; track item.nome) {
            @if (item.j; as j) {
              <div class="limite-linha"><span>{{ item.nome }}</span><b [attr.data-nivel]="j.nivel">{{ j.pct !== null ? j.rotulo : j.nivel === 'ok' ? 'dentro do limite' : j.nivel === 'aviso' ? 'perto do limite' : 'no limite' }}</b></div>
              @if (j.pct !== null) { <div class="mini-barra grande" [attr.data-nivel]="j.nivel"><i [style.width.%]="j.pct"></i></div> }
              <div class="suave limite-sub">{{ j.renova }}</div>
            }
          }
          <div class="suave limite-nota">Lido do Claude Code depois de cada resposta da IA (visto às {{ visto() }}). Com chave da API não há limite por janela, então o indicador só aparece no modo assinatura.</div>
        </div>
      }
    }
  `,
})
export class LimitesUsoComponent {
  protected readonly l = inject(LimitesService);

  protected visto(): string {
    const d = (this.l.janelaDe5h() ?? this.l.semana())?.vistoEm;
    return d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '—';
  }
}
