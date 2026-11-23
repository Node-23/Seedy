import { computed, inject, Injectable, signal } from '@angular/core';
import { BookmarksService } from './bookmarks.service';
import { EditorService } from './editor.service';
import { aceitaBreakpoint, DepuradorService } from '../servidor/depurador.service';

export interface ItemDoMenuGutter {
  id: 'bookmark' | 'breakpoint';
  rotulo: string;
  dica: string;
  ativo: boolean;
  desabilitado: boolean;
}

/**
 * Menu do botão direito na margem do editor, ao lado do número da linha:
 * adicionar/remover bookmark e adicionar/remover breakpoint daquela linha.
 */
@Injectable({ providedIn: 'root' })
export class MenuGutterService {
  private readonly bookmarks = inject(BookmarksService);
  private readonly depurador = inject(DepuradorService);
  private readonly editor = inject(EditorService);

  readonly aberto = signal<{ x: number; y: number; linha: number; caminho: string } | null>(null);

  readonly itens = computed<ItemDoMenuGutter[]>(() => {
    const m = this.aberto();
    if (!m) return [];
    const rel = this.bookmarks.relativo(m.caminho);
    const temBookmark = this.bookmarks.marcas().some((x) => x.caminho === rel && x.linha === m.linha);
    const temBreakpoint = (this.depurador.breakpoints().get(m.caminho) ?? []).includes(m.linha);
    return [
      { id: 'bookmark', rotulo: temBookmark ? 'remover bookmark' : 'adicionar bookmark', dica: 'Ctrl+F2', ativo: temBookmark, desabilitado: false },
      { id: 'breakpoint', rotulo: temBreakpoint ? 'remover breakpoint' : 'adicionar breakpoint', dica: 'ctrl F8', ativo: temBreakpoint, desabilitado: !aceitaBreakpoint(m.caminho) },
    ];
  });

  abrir(x: number, y: number, linha: number, caminho: string): void {
    this.aberto.set({ x, y, linha, caminho });
  }

  fechar(): void {
    this.aberto.set(null);
    queueMicrotask(() => this.editor.focar());
  }

  async escolher(id: ItemDoMenuGutter['id']): Promise<void> {
    const m = this.aberto();
    if (!m) return;
    this.aberto.set(null);
    if (id === 'bookmark') await this.bookmarks.alternar(m.linha, m.caminho);
    else if (aceitaBreakpoint(m.caminho)) this.depurador.alternar(m.caminho, m.linha);
    queueMicrotask(() => this.editor.focar());
  }
}
