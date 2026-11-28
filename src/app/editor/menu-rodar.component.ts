import { Component, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { RodarMargemService } from './rodar-margem.service';

/** O menu do ▶ na margem (mockup 46). Teclado: j/k ou ↑↓, ⏎ escolhe, c classe, t tela, esc fecha. */
@Component({
  selector: 'sd-menu-rodar',
  template: `
    @if (r.menu(); as m) {
      <div #menu class="menu-gutter menu-rodar" role="menu" tabindex="-1" [style.left.px]="m.x" [style.top.px]="m.y"
           (keydown)="teclar($event)" (focusout)="aoPerderFoco($event)" (contextmenu)="$event.preventDefault()">
        <div class="menu-gutter-titulo suave">{{ m.alvo.metodo ?? m.alvo.classe }}</div>
        @for (item of r.itens(); track item.id; let i = $index) {
          <button class="menu-gutter-item" role="menuitem" [class.sel]="i === sel()" (mouseenter)="sel.set(i)" (click)="r.escolher(item.id)">
            <span class="menu-arvore-marca suave">{{ item.marca }}</span>
            <span>{{ item.rotulo }}</span>
            <span class="espaco"></span>
            <kbd>{{ item.dica }}</kbd>
          </button>
        }
      </div>
    }
  `,
})
export class MenuRodarComponent {
  protected readonly r = inject(RodarMargemService);
  private readonly menu = viewChild<ElementRef<HTMLElement>>('menu');
  protected readonly sel = signal(0);

  constructor() {
    effect(() => {
      if (!this.r.menu()) return;
      untracked(() =>
        setTimeout(() => {
          const el = this.menu()?.nativeElement;
          if (!el) return;
          this.sel.set(0);
          const caixa = el.getBoundingClientRect();
          if (caixa.right > window.innerWidth - 8) el.style.left = `${window.innerWidth - caixa.width - 8}px`;
          if (caixa.bottom > window.innerHeight - 8) el.style.top = `${window.innerHeight - caixa.height - 8}px`;
          el.focus();
        }),
      );
    });
  }

  protected teclar(e: KeyboardEvent): void {
    const itens = this.r.itens();
    const mover = (d: number) => this.sel.set((this.sel() + d + itens.length) % itens.length);
    const tem = (id: string) => itens.some((i) => i.id === id);
    if (e.key === 'Escape') this.r.fechar();
    else if (e.key === 'j' || e.key === 'ArrowDown') mover(1);
    else if (e.key === 'k' || e.key === 'ArrowUp') mover(-1);
    else if (e.key === 'Enter') void this.r.escolher(itens[this.sel()].id);
    else if (e.key === 'c' && tem('classe')) void this.r.escolher('classe');
    else if (e.key === 't' && tem('tela')) void this.r.escolher('tela');
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  protected aoPerderFoco(e: FocusEvent): void {
    const el = this.menu()?.nativeElement;
    if (el && !el.contains(e.relatedTarget as Node | null)) this.r.menu.set(null);
  }
}
