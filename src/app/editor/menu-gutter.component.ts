import { Component, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { MenuGutterService } from './menu-gutter.service';

/** O menu do botão direito na margem do editor (bookmark e breakpoint da linha). */
@Component({
  selector: 'sd-menu-gutter',
  template: `
    @if (g.aberto(); as m) {
      <div #menu class="menu-gutter" role="menu" tabindex="-1" [style.left.px]="m.x" [style.top.px]="m.y"
           (keydown)="teclar($event)" (focusout)="aoPerderFoco($event)" (contextmenu)="$event.preventDefault()">
        <div class="menu-gutter-titulo suave">LINHA {{ m.linha }}</div>
        @for (item of g.itens(); track item.id; let i = $index) {
          <button class="menu-gutter-item" role="menuitem" [class.sel]="i === sel()" [disabled]="item.desabilitado"
                  (mouseenter)="sel.set(i)" (click)="g.escolher(item.id)">
            <span [class]="item.id === 'bookmark' ? 'marca-bookmark' : 'marca-breakpoint'">{{ item.id === 'bookmark' ? '▮' : '●' }}</span>
            <span>{{ item.rotulo }}</span>
            <span class="espaco"></span>
            <kbd>{{ item.dica }}</kbd>
          </button>
        }
      </div>
    }
  `,
})
export class MenuGutterComponent {
  protected readonly g = inject(MenuGutterService);
  private readonly menu = viewChild<ElementRef<HTMLElement>>('menu');
  protected readonly sel = signal(0);

  constructor() {
    effect(() => {
      if (!this.g.aberto()) return;
      untracked(() =>
        setTimeout(() => {
          const el = this.menu()?.nativeElement;
          if (!el) return;
          this.sel.set(0);
          // Não sai da janela (o menu abre no ponteiro).
          const r = el.getBoundingClientRect();
          if (r.right > window.innerWidth - 8) el.style.left = `${window.innerWidth - r.width - 8}px`;
          if (r.bottom > window.innerHeight - 8) el.style.top = `${window.innerHeight - r.height - 8}px`;
          el.focus();
        }),
      );
    });
  }

  protected teclar(e: KeyboardEvent): void {
    const itens = this.g.itens();
    const habilitado = (i: number) => !itens[i]?.desabilitado;
    const mover = (d: number) => {
      let i = this.sel();
      for (let n = 0; n < itens.length; n++) {
        i = (i + d + itens.length) % itens.length;
        if (habilitado(i)) return this.sel.set(i);
      }
    };
    if (e.key === 'Escape') this.g.fechar();
    else if (e.key === 'j' || e.key === 'ArrowDown') mover(1);
    else if (e.key === 'k' || e.key === 'ArrowUp') mover(-1);
    else if (e.key === 'Enter' && habilitado(this.sel())) void this.g.escolher(itens[this.sel()].id);
    else if (e.key === 'b') void this.g.escolher('bookmark');
    else if (e.key === 'p' && habilitado(1)) void this.g.escolher('breakpoint');
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  /** Clicar fora fecha. */
  protected aoPerderFoco(e: FocusEvent): void {
    const el = this.menu()?.nativeElement;
    if (el && !el.contains(e.relatedTarget as Node | null)) this.g.aberto.set(null);
  }
}
