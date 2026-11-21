import { inject, Injectable, signal } from '@angular/core';
import { EditorService } from '../editor/editor.service';
import { LayoutService } from '../layout/layout.service';

export type AbaConfig = 'atalhos' | 'ia' | 'editor';

/** Tela de configurações (␣ ,): atalhos do líder, IA (assinatura ou chave) e editor/terminal. */
@Injectable({ providedIn: 'root' })
export class ConfiguracoesService {
  private readonly layout = inject(LayoutService);
  private readonly editor = inject(EditorService);

  readonly aba = signal<AbaConfig>('atalhos');

  abrir(aba?: AbaConfig): void {
    if (aba) this.aba.set(aba);
    this.layout.tela.set('config');
  }

  alternar(): void {
    if (this.layout.tela() === 'config') this.fechar();
    else this.abrir();
  }

  fechar(): void {
    this.layout.tela.set('editor');
    queueMicrotask(() => this.editor.focar());
  }
}
