import { Component, effect, ElementRef, inject, untracked, viewChild } from '@angular/core';
import { AnexosService } from './anexos.service';

/** O menu do botão direito com um item só: "✦ Mandar para a IA" (container, teste, card, bloco...). */
@Component({
  selector: 'sd-menu-anexo',
  template: `
    @if (a.menu(); as m) {
      <div #menu class="menu-gutter" role="menu" tabindex="-1" [style.left.px]="m.x" [style.top.px]="m.y"
           (keydown)="teclar($event)" (focusout)="aoPerderFoco($event)" (contextmenu)="$event.preventDefault()">
        <button class="menu-gutter-item sel" role="menuitem" (click)="mandar()">
          <span class="destaque-texto">✦</span>
          <span>Mandar para a IA</span>
          <span class="espaco"></span>
          <kbd>⌃⇧A</kbd>
        </button>
      </div>
    }
  `,
})
export class MenuAnexoComponent {
  protected readonly a = inject(AnexosService);
  private readonly menu = viewChild<ElementRef<HTMLElement>>('menu');

  constructor() {
    effect(() => {
      if (!this.a.menu()) return;
      untracked(() =>
        setTimeout(() => {
          const el = this.menu()?.nativeElement;
          if (!el) return;
          const r = el.getBoundingClientRect();
          if (r.right > window.innerWidth - 8) el.style.left = `${window.innerWidth - r.width - 8}px`;
          if (r.bottom > window.innerHeight - 8) el.style.top = `${window.innerHeight - r.height - 8}px`;
          el.focus();
        }),
      );
    });
  }

  protected mandar(): void {
    const m = this.a.menu();
    this.a.fecharMenu();
    if (m) this.a.adicionar(m.anexo());
  }

  protected teclar(e: KeyboardEvent): void {
    if (e.key === 'Escape') this.a.fecharMenu();
    else if (e.key === 'Enter' || e.key === 'a') this.mandar();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  protected aoPerderFoco(e: FocusEvent): void {
    const el = this.menu()?.nativeElement;
    if (el && !el.contains(e.relatedTarget as Node | null)) this.a.fecharMenu();
  }
}
