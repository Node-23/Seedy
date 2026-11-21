import { Component, ElementRef, HostListener, inject } from '@angular/core';
import { LimitesService } from './limites.service';

/** O indicador de uso do Claude na barra de status: janela de 5 horas e semana (clique abre os detalhes). */
@Component({
  selector: 'sd-limites-uso',
  template: `
    @if (l.visivel()) {
      <button class="segmento com-divisa-esq limites-uso" (click)="l.aberto.set(!l.aberto())" title="Uso da assinatura do Claude (clique para detalhes)">
        <span class="suave">✦</span>
        <span class="suave">5h</span>
        @if (l.janelaDe5h(); as j) { <span class="mini-barra" [attr.data-nivel]="j.nivel"><i [style.width.%]="j.pct ?? 100"></i></span><b [attr.data-nivel]="j.nivel">{{ j.rotulo }}</b> }
        @else { <span class="mini-barra"><i style="width: 0"></i></span><b class="suave">—</b> }
        <span class="suave">· sem</span>
        @if (l.semana(); as s) { <span class="mini-barra" [attr.data-nivel]="s.nivel"><i [style.width.%]="s.pct ?? 100"></i></span><b [attr.data-nivel]="s.nivel">{{ s.rotulo }}</b> }
        @else { <span class="mini-barra"><i style="width: 0"></i></span><b class="suave">—</b> }
      </button>
      @if (l.aberto()) {
        <div class="painel-limites" role="dialog" aria-label="Uso do Claude">
          <div class="rotulo">USO DO CLAUDE · ASSINATURA</div>
          @for (item of [{ nome: 'janela de 5 horas', j: l.janelaDe5h() }, { nome: 'semana', j: l.semana() }]; track item.nome) {
            <div class="limite-linha"><span>{{ item.nome }}</span>
              @if (item.j; as j) { <b [attr.data-nivel]="j.nivel">{{ j.pct !== null ? j.rotulo : j.nivel === 'ok' ? 'dentro do limite' : j.nivel === 'aviso' ? 'perto do limite' : 'no limite' }}</b> }
              @else { <b class="suave">sem dado ainda</b> }
            </div>
            @if (item.j; as j) {
              @if (j.pct !== null) { <div class="mini-barra grande" [attr.data-nivel]="j.nivel"><i [style.width.%]="j.pct"></i></div> }
              <div class="suave limite-sub">{{ j.renova }}</div>
            } @else {
              <div class="suave limite-sub">o Claude Code ainda não informou esta janela</div>
            }
          }
          @if (l.erroDeUso(); as erro) { <div class="limite-erro erro-texto">não consegui ler o uso da conta: {{ erro }}</div> }
          <div class="suave limite-nota">Lido da sua conta pelo login do Claude Code (a cada 5 minutos e ao abrir este painel; visto às {{ visto() }}) e do aviso que ele manda depois de cada resposta. O Seedy só lê o token para pedir o uso: não guarda nem mostra. Com chave da API não há limite por janela, então o indicador só aparece no modo assinatura.</div>
        </div>
      }
    }
  `,
})
export class LimitesUsoComponent {
  protected readonly l = inject(LimitesService);
  private readonly el = inject(ElementRef<HTMLElement>);

  protected visto(): string {
    const d = (this.l.janelaDe5h() ?? this.l.semana())?.vistoEm;
    return d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '—';
  }

  /** Clicar fora do indicador e do painel fecha o painel. */
  @HostListener('document:pointerdown', ['$event'])
  protected aoClicarFora(e: PointerEvent): void {
    if (this.l.aberto() && !(this.el.nativeElement as HTMLElement).contains(e.target as Node)) this.l.aberto.set(false);
  }

  @HostListener('document:keydown.escape')
  protected aoEscape(): void {
    this.l.aberto.set(false);
  }
}
