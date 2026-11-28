import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { EditorService } from '../editor/editor.service';
import { ProjetoService } from '../nucleo/projeto.service';

const CHAVE = 'seedy.recentes-arquivos:';
const MAXIMO = 30;

/**
 * Os últimos arquivos vistos no projeto (Ctrl+E, mockup 44), o mais novo primeiro. Ficam guardados
 * por projeto; código de biblioteca (jdt://) só enquanto o buffer existe.
 */
@Injectable({ providedIn: 'root' })
export class RecentesDeArquivosService {
  private readonly editor = inject(EditorService);
  private readonly projeto = inject(ProjetoService);

  readonly lista = signal<string[]>([]);
  readonly aberto = signal(false);

  constructor() {
    effect(() => {
      const raiz = this.projeto.raiz();
      untracked(() => this.lista.set(raiz ? ler(raiz) : []));
    });
    effect(() => {
      const ativo = this.editor.ativo();
      untracked(() => ativo && this.gravar([ativo, ...this.lista().filter((c) => c !== ativo)].slice(0, MAXIMO)));
    });
  }

  abrir(): void {
    if (!this.projeto.raiz()) return;
    this.aberto.set(true);
  }

  fechar(): void {
    this.aberto.set(false);
    queueMicrotask(() => this.editor.focar());
  }

  tirar(caminho: string): void {
    this.gravar(this.lista().filter((c) => c !== caminho));
  }

  private gravar(lista: string[]): void {
    this.lista.set(lista);
    const raiz = this.projeto.raiz();
    if (!raiz) return;
    try {
      localStorage.setItem(CHAVE + raiz, JSON.stringify(lista.filter((c) => !c.includes('://'))));
    } catch {
      // sem localStorage: vale só enquanto o Seedy está aberto
    }
  }
}

function ler(raiz: string): string[] {
  try {
    const lista = JSON.parse(localStorage.getItem(CHAVE + raiz) ?? '[]');
    return Array.isArray(lista) ? lista.filter((c) => typeof c === 'string') : [];
  } catch {
    return [];
  }
}
