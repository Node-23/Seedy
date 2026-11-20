import { Component, effect, ElementRef, inject, viewChild } from '@angular/core';
import { DiffService } from './diff.service';
import { monaco } from '../editor/monaco';
import { EditorService } from '../editor/editor.service';
import { TemaService } from '../tema/tema';

/**
 * Diff completo, lado a lado, com o editor de diff do Monaco (no tema do Seedy).
 * Teclado: ]c / n próxima mudança, [c / N anterior, esc fecha.
 */
@Component({
  selector: 'sd-diff',
  template: `
    @if (servico.atual(); as d) {
      <section class="painel diff-tela" role="dialog" [attr.aria-label]="'Diff de ' + d.caminho" (keydown)="teclar($event)">
        <div class="painel-faixa">
          <span class="rotulo">DIFF</span>
          <span class="diff-titulo">{{ d.titulo }}</span>
          <span class="espaco"></span>
          <span class="suave">]c próxima · [c anterior · esc fecha</span>
        </div>
        <div class="diff-lados suave">
          <span class="git-menos">− {{ d.rotuloAntes }}</span>
          <span class="git-mais">+ {{ d.rotuloDepois }}</span>
        </div>
        <div #hospedeiro class="diff-monaco"></div>
      </section>
    }
  `,
})
export class DiffComponent {
  protected readonly servico = inject(DiffService);
  private readonly editor = inject(EditorService);
  private readonly tema = inject(TemaService);
  private readonly hospedeiro = viewChild<ElementRef<HTMLDivElement>>('hospedeiro');

  private diffEditor: monaco.editor.IStandaloneDiffEditor | null = null;
  private modelos: monaco.editor.ITextModel[] = [];
  private teclaAnterior = '';

  constructor() {
    effect(() => {
      const pedido = this.servico.atual();
      const host = this.hospedeiro();
      this.limpar();
      if (!pedido || !host) return;
      const f = this.tema.tema().fontes.codigo;
      this.diffEditor = monaco.editor.createDiffEditor(host.nativeElement, {
        theme: 'seedy',
        readOnly: true,
        automaticLayout: true,
        renderSideBySide: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderOverviewRuler: false,
        fontFamily: `"${f.familia}", ${this.tema.tema().fontes.reserva}`,
        fontSize: f.tamanho,
        lineHeight: f.alturaLinha,
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
      });
      const linguagem = this.editor.linguagemDe(pedido.caminho);
      this.modelos = [monaco.editor.createModel(pedido.antes, linguagem), monaco.editor.createModel(pedido.depois, linguagem)];
      this.diffEditor.setModel({ original: this.modelos[0], modified: this.modelos[1] });
      queueMicrotask(() => {
        this.diffEditor?.getModifiedEditor().focus();
        // Começa na primeira mudança.
        setTimeout(() => this.diffEditor?.goToDiff('next'), 150);
      });
    });
  }

  protected teclar(e: KeyboardEvent): void {
    const combo = this.teclaAnterior + e.key;
    this.teclaAnterior = '';
    if (e.key === 'Escape') {
      this.fechar();
    } else if (combo === ']c' || e.key === 'n' || e.key === 'F7') {
      this.diffEditor?.goToDiff('next');
    } else if (combo === '[c' || e.key === 'N') {
      this.diffEditor?.goToDiff('previous');
    } else if (e.key === ']' || e.key === '[') {
      this.teclaAnterior = e.key;
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  private fechar(): void {
    this.servico.fechar();
  }

  private limpar(): void {
    this.diffEditor?.dispose();
    this.diffEditor = null;
    for (const m of this.modelos) m.dispose();
    this.modelos = [];
  }
}
