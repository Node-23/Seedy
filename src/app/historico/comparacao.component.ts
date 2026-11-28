import { Component, effect, ElementRef, inject, input, OnDestroy, viewChild } from '@angular/core';
import { EditorService } from '../editor/editor.service';
import { monaco } from '../editor/monaco';
import { TemaService } from '../tema/tema';

/** O "antes e depois" lado a lado das telas de histórico, com o editor de diff do Monaco. */
@Component({
  selector: 'sd-comparacao',
  template: `<div #hospedeiro class="comparacao-monaco"></div>`,
})
export class ComparacaoComponent implements OnDestroy {
  readonly antes = input.required<string>();
  readonly depois = input.required<string>();
  /** Para escolher a linguagem (cores). */
  readonly caminho = input.required<string>();
  /** Quando o texto é um trecho: o número da primeira linha de cada lado. */
  readonly linhaAntes = input(1);
  readonly linhaDepois = input(1);

  private readonly editor = inject(EditorService);
  private readonly tema = inject(TemaService);
  private readonly hospedeiro = viewChild.required<ElementRef<HTMLDivElement>>('hospedeiro');
  private diff: monaco.editor.IStandaloneDiffEditor | null = null;
  private modelos: monaco.editor.ITextModel[] = [];

  constructor() {
    effect(() => {
      const antes = this.antes();
      const depois = this.depois();
      const linguagem = this.editor.linguagemDe(this.caminho());
      const f = this.tema.tema().fontes.codigo;
      this.diff ??= monaco.editor.createDiffEditor(this.hospedeiro().nativeElement, {
        theme: 'seedy',
        readOnly: true,
        automaticLayout: true,
        renderSideBySide: true,
        useInlineViewWhenSpaceIsLimited: false,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderOverviewRuler: false,
        fontFamily: `"${f.familia}", ${this.tema.tema().fontes.reserva}`,
        fontSize: f.tamanho,
        lineHeight: f.alturaLinha,
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
      });
      const velhos = this.modelos;
      this.modelos = [monaco.editor.createModel(antes, linguagem), monaco.editor.createModel(depois, linguagem)];
      this.diff.setModel({ original: this.modelos[0], modified: this.modelos[1] });
      velhos.forEach((m) => m.dispose());
      const de = (primeira: number) => (n: number) => String(n + primeira - 1);
      this.diff.getOriginalEditor().updateOptions({ lineNumbers: de(this.linhaAntes()) });
      this.diff.getModifiedEditor().updateOptions({ lineNumbers: de(this.linhaDepois()) });
      // Começa na primeira mudança, sem tirar o foco da lista.
      const primeira = this.diff.onDidUpdateDiff(() => {
        primeira.dispose();
        const m = this.diff?.getLineChanges()?.[0];
        if (m) this.diff!.getModifiedEditor().revealLineInCenter(Math.max(1, m.modifiedStartLineNumber));
        if (m) this.diff!.getModifiedEditor().setPosition({ lineNumber: Math.max(1, m.modifiedStartLineNumber), column: 1 });
      });
    });
  }

  mudanca(passo: 1 | -1): void {
    this.diff?.goToDiff(passo > 0 ? 'next' : 'previous');
  }

  /**
   * O texto "depois" com a mudança sob o cursor do lado direito (ou a mais perto) desfeita,
   * ou null se não há mudança.
   */
  semAMudancaAtual(): string | null {
    const mudancas = this.diff?.getLineChanges();
    if (!mudancas?.length) return null;
    const linha = this.diff!.getModifiedEditor().getPosition()?.lineNumber ?? 1;
    const distancia = (m: monaco.editor.ILineChange) => {
      const fim = Math.max(m.modifiedEndLineNumber, m.modifiedStartLineNumber);
      return linha < m.modifiedStartLineNumber ? m.modifiedStartLineNumber - linha : linha > fim ? linha - fim : 0;
    };
    const m = [...mudancas].sort((a, b) => distancia(a) - distancia(b))[0];
    const antes = this.antes().split('\n');
    const depois = this.depois().split('\n');
    // No Monaco, fim 0 quer dizer "nenhuma linha deste lado" (o começo é a linha de antes do ponto).
    const velhas = m.originalEndLineNumber ? antes.slice(m.originalStartLineNumber - 1, m.originalEndLineNumber) : [];
    const de = m.modifiedEndLineNumber ? m.modifiedStartLineNumber - 1 : m.modifiedStartLineNumber;
    const quantas = m.modifiedEndLineNumber ? m.modifiedEndLineNumber - m.modifiedStartLineNumber + 1 : 0;
    depois.splice(de, quantas, ...velhas);
    return depois.join('\n');
  }

  ngOnDestroy(): void {
    this.diff?.dispose();
    this.modelos.forEach((m) => m.dispose());
  }
}
