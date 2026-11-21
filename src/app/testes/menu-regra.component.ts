import { Component, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { TestesDaRegraService } from './testes-da-regra.service';

/** Menu do botão direito num card de regra: testes (ir, rodar, criar), código, caminho e edição. */
@Component({
  selector: 'sd-menu-regra',
  template: `
    @if (s.menu(); as m) {
      <div #menu class="menu-gutter menu-regra" role="menu" tabindex="-1" [style.left.px]="m.x" [style.top.px]="m.y"
           (keydown)="teclar($event)" (focusout)="aoPerderFoco($event)" (contextmenu)="$event.preventDefault()">
        <div class="menu-gutter-titulo suave">{{ m.regra.id }} · {{ estado() }}</div>
        @for (item of s.itensDoMenu(); track $index; let i = $index) {
          @if (item.separador) { <div class="menu-regra-separador"></div> }
          <button class="menu-gutter-item" role="menuitem" [class.sel]="i === sel()" [disabled]="item.desabilitado"
                  (mouseenter)="sel.set(i)" (click)="s.executar(item.id)">
            <span [class]="classeDoIcone(item.id)">{{ item.icone }}</span>
            <span>{{ item.rotulo }}</span>
            <span class="espaco"></span>
            @if (item.dica) { <span class="suave menu-regra-dica">{{ item.dica }}</span> }
            @if (item.tecla && item.tecla !== item.dica) { <kbd>{{ item.tecla }}</kbd> }
          </button>
        }
      </div>
    }
  `,
})
export class MenuRegraComponent {
  protected readonly s = inject(TestesDaRegraService);
  private readonly menu = viewChild<ElementRef<HTMLElement>>('menu');
  protected readonly sel = signal(0);

  constructor() {
    effect(() => {
      if (!this.s.menu()) return;
      untracked(() =>
        setTimeout(() => {
          const el = this.menu()?.nativeElement;
          if (!el) return;
          this.sel.set(0);
          const r = el.getBoundingClientRect();
          if (r.right > window.innerWidth - 8) el.style.left = `${window.innerWidth - r.width - 8}px`;
          if (r.bottom > window.innerHeight - 8) el.style.top = `${window.innerHeight - r.height - 8}px`;
          el.focus();
        }),
      );
    });
  }

  protected estado(): string {
    const m = this.s.menu();
    const c = m ? this.s.cobertura(m.regra) : null;
    return !c || c.estado === 'sem' ? 'SEM TESTE' : c.estado === 'falhando' ? 'TESTE FALHANDO' : c.estado === 'so-feliz' ? 'SÓ O CAMINHO FELIZ' : 'COM TESTE';
  }

  protected classeDoIcone(id: string): string {
    return id === 'cenarios' ? 'aviso-texto' : id === 'ia' || id === 'manual' || id === 'ir' || id === 'rodar' || id === 'codigo' || id === 'caminho' ? 'destaque-texto' : '';
  }

  protected teclar(e: KeyboardEvent): void {
    const itens = this.s.itensDoMenu();
    const ok = (i: number) => !itens[i]?.desabilitado;
    const mover = (d: number) => {
      let i = this.sel();
      for (let n = 0; n < itens.length; n++) {
        i = (i + d + itens.length) % itens.length;
        if (ok(i)) return this.sel.set(i);
      }
    };
    if (e.key === 'Escape') this.s.fecharMenu();
    else if (e.key === 'j' || e.key === 'ArrowDown') mover(1);
    else if (e.key === 'k' || e.key === 'ArrowUp') mover(-1);
    else if (e.key === 'Enter' && ok(this.sel())) void this.s.executar(itens[this.sel()].id);
    else {
      const i = itens.findIndex((x) => x.tecla && x.tecla === e.key && !x.desabilitado);
      if (i < 0) return;
      void this.s.executar(itens[i].id);
    }
    e.preventDefault();
    e.stopPropagation();
  }

  protected aoPerderFoco(e: FocusEvent): void {
    const el = this.menu()?.nativeElement;
    if (el && !el.contains(e.relatedTarget as Node | null)) this.s.fecharMenu();
  }
}
