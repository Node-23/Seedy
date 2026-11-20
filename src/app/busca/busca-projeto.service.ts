import { inject, Injectable, signal } from '@angular/core';
import { EditorService } from '../editor/editor.service';
import { OpcoesTexto } from './texto';

const CHAVE_OPCOES = 'seedy.buscaProjeto';

interface Opcoes extends Required<OpcoesTexto> {
  diferenciar: boolean;
}

const PADRAO: Opcoes = { diferenciar: false, palavra: false, regex: false, mascara: '' };

/**
 * Buscar no projeto (Ctrl+Shift+F), como o "Find in Files" do IntelliJ:
 * a consulta e as opções (maiúsculas, palavra inteira, regex, máscara)
 * ficam guardadas entre uma abertura e outra.
 */
@Injectable({ providedIn: 'root' })
export class BuscaProjetoService {
  private readonly editor = inject(EditorService);

  readonly aberta = signal(false);
  readonly consulta = signal('');
  readonly opcoes = signal<Opcoes>(this.carregar());
  /** Muda a cada abertura, para o componente selecionar o texto do campo. */
  readonly aberturas = signal(0);

  private focoAnterior: HTMLElement | null = null;

  /** Abre já com o texto selecionado no editor, se houver (uma linha só). */
  abrir(): void {
    if (!this.aberta()) this.focoAnterior = document.activeElement as HTMLElement | null;
    const selecionado = this.selecaoDoEditor();
    if (selecionado) this.consulta.set(selecionado);
    this.aberta.set(true);
    this.aberturas.update((n) => n + 1);
  }

  fechar(devolverFoco = true): void {
    this.aberta.set(false);
    const anterior = this.focoAnterior;
    this.focoAnterior = null;
    if (!devolverFoco) return;
    const valido = anterior && anterior !== document.body && anterior.isConnected;
    queueMicrotask(() => (valido ? anterior.focus() : this.editor.focar()));
  }

  alternar(opcao: 'diferenciar' | 'palavra' | 'regex'): void {
    this.mudar({ [opcao]: !this.opcoes()[opcao] });
  }

  mudar(parcial: Partial<Opcoes>): void {
    this.opcoes.update((o) => ({ ...o, ...parcial }));
    try {
      localStorage.setItem(CHAVE_OPCOES, JSON.stringify(this.opcoes()));
    } catch {
      /* sem armazenamento: as opções só valem nesta sessão */
    }
  }

  private selecaoDoEditor(): string {
    const instancia = this.editor.instancia;
    const sel = instancia?.getSelection();
    const modelo = instancia?.getModel();
    if (!sel || !modelo || sel.isEmpty() || sel.startLineNumber !== sel.endLineNumber) return '';
    return modelo.getValueInRange(sel);
  }

  private carregar(): Opcoes {
    try {
      return { ...PADRAO, ...JSON.parse(localStorage.getItem(CHAVE_OPCOES) ?? '{}') };
    } catch {
      return PADRAO;
    }
  }
}
