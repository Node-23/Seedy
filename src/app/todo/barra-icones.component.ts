import { Component, computed, inject } from '@angular/core';
import { LayoutService } from '../layout/layout.service';
import { EntenderService } from '../entender/entender.service';
import { EditorService } from '../editor/editor.service';
import { TodoService } from './todo.service';

/** Barra fina de ícones à esquerda (mockup 20): arquivos, TODO e entender o sistema. */
@Component({
  selector: 'sd-barra-icones',
  template: `
    <nav class="barra-icones" aria-label="Painéis">
      <button class="icone-lateral" [class.ativo]="layout.tela() === 'editor' && layout.disposicao().visiveis.arquivos" title="Arquivos (␣ e)" (click)="arquivos()">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /></svg>
      </button>
      <button class="icone-lateral" [class.ativo]="todo.aberto()" title="TODO (␣ T)" (click)="todo.alternar()">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4" /><path d="M8 12.5l2.8 2.8L16.5 9" /></svg>
        @if (abertos(); as n) { <span class="icone-contador">{{ n }}</span> }
      </button>
      <button class="icone-lateral" [class.ativo]="layout.tela() === 'entender'" title="Entender o sistema (␣ A)" (click)="entender.alternar()">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="7" height="6" rx="1.5" /><rect x="14" y="4" width="7" height="6" rx="1.5" /><rect x="8.5" y="15" width="7" height="6" rx="1.5" /><path d="M6.5 10v2.5h11V10M12 12.5V15" /></svg>
      </button>
    </nav>
  `,
})
export class BarraIconesComponent {
  protected readonly layout = inject(LayoutService);
  protected readonly todo = inject(TodoService);
  protected readonly entender = inject(EntenderService);
  private readonly editor = inject(EditorService);
  protected readonly abertos = computed(() => this.todo.abertos().length);

  protected arquivos(): void {
    if (this.layout.tela() !== 'editor') {
      this.layout.tela.set('editor');
      this.layout.mostrar('arquivos');
      return;
    }
    this.layout.alternar('arquivos');
    if (!this.layout.visivel('arquivos')) queueMicrotask(() => this.editor.focar());
  }
}
