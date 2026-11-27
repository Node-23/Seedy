import { Component, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { MensagensService, Notificacao } from '../nucleo/mensagens.service';
import { ICONE_DA_NOTIFICACAO } from '../nucleo/toasts.component';
import { AtalhosService } from '../teclado/atalhos.service';
import { hora } from './relatorio';

/**
 * As notificações desde que o Seedy abriu (mockup 36), aberta pelo sino ou por Alt+Shift+H.
 * Teclado: ↑↓ escolher, ⏎ abrir, x apagar, l limpar tudo, esc fechar.
 */
@Component({
  selector: 'sd-notificacoes',
  template: `
    @if (m.listaAberta()) {
      <div class="veu transparente" (mousedown)="m.fecharLista()"></div>
      <div #caixa class="painel notificacoes" role="dialog" aria-label="Notificações" tabindex="-1" (keydown)="teclar($event)">
        <div class="painel-faixa">
          <span class="rotulo">NOTIFICAÇÕES</span>
          <span class="suave">desde que o Seedy abriu</span>
          <span class="espaco"></span>
          @if (atalhos.rotuloDoAtalho('notificacoes'); as a) { <kbd>{{ a }}</kbd> }
        </div>
        <ul role="listbox" aria-label="Notificações">
          @for (n of m.historico(); track n.id; let i = $index) {
            <li [class]="'notificacao ' + n.tipo + (i === indice() ? ' selecionado' : '')" role="option"
                [attr.aria-selected]="i === indice()" (mousemove)="indice.set(i)" (click)="m.abrir(n)">
              <i aria-hidden="true">{{ icones[n.tipo] }}</i>
              <span class="notificacao-texto"><b>{{ n.titulo }}</b><small class="suave">{{ detalhe(n) }}</small></span>
              @if (i === indice()) { <kbd>⏎</kbd> }
            </li>
          } @empty {
            <li class="notificacao-vazia suave">nada por aqui</li>
          }
        </ul>
        <div class="busca-dicas">
          <span><span class="tecla">↑↓</span> escolher</span>
          <span><span class="tecla">⏎</span> abrir</span>
          <span><span class="tecla">x</span> apagar</span>
          <span><span class="tecla">l</span> limpar tudo</span>
          <span><span class="tecla">esc</span> fechar</span>
        </div>
      </div>
    }
  `,
})
export class ListaDeNotificacoesComponent {
  protected readonly m = inject(MensagensService);
  protected readonly atalhos = inject(AtalhosService);
  protected readonly icones = ICONE_DA_NOTIFICACAO;
  protected readonly indice = signal(0);
  private readonly caixa = viewChild<ElementRef<HTMLElement>>('caixa');
  private focoAnterior: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const caixa = this.caixa();
      untracked(() => {
        if (!caixa) {
          // Fechada para abrir uma notificação: o foco vai para o popup, não volta atrás.
          if (!this.m.aberta()) this.focoAnterior?.focus();
          this.focoAnterior = null;
          return;
        }
        this.focoAnterior = document.activeElement as HTMLElement | null;
        this.indice.set(0);
        caixa.nativeElement.focus();
      });
    });
  }

  protected detalhe(n: Notificacao): string {
    const partes = [hora(n.quando)];
    if (n.doSeedy) partes.push('erro do Seedy', n.enviada ? 'e-mail aberto' : 'não enviado');
    else if (n.tipo === 'erro') partes.push('erro do projeto');
    return partes.join(' · ');
  }

  protected teclar(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const lista = this.m.historico();
    const i = Math.min(this.indice(), lista.length - 1);
    if (e.key === 'Escape') this.m.fecharLista();
    else if (e.key === 'ArrowDown' || e.key === 'j') this.indice.set(lista.length ? (i + 1) % lista.length : 0);
    else if (e.key === 'ArrowUp' || e.key === 'k') this.indice.set(lista.length ? (i + lista.length - 1) % lista.length : 0);
    else if (e.key === 'Enter') {
      if (lista[i]) this.m.abrir(lista[i]);
    } else if (e.key === 'x' || e.key === 'Delete') {
      if (lista[i]) this.m.apagar(lista[i].id);
      this.indice.set(Math.max(0, Math.min(i, lista.length - 2)));
    } else if (e.key === 'l') this.m.limpar();
    else return;
    e.preventDefault();
    e.stopPropagation();
    queueMicrotask(() => this.caixa()?.nativeElement.querySelector('li.selecionado')?.scrollIntoView({ block: 'nearest' }));
  }
}
