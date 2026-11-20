import { computed, inject, Injectable, signal } from '@angular/core';
import { GitService } from './git.service';

/** Estado do merge em três colunas (mockup 05), compartilhado com a statusline e o vim. */
@Injectable({ providedIn: 'root' })
export class MergeService {
  private readonly git = inject(GitService);

  /** Conflitos ainda sem resolução no arquivo aberto no merge. */
  readonly restantes = signal(0);
  /** Índice do arquivo (entre os em conflito no início do merge). */
  readonly arquivoAtual = signal(0);
  readonly totalDeArquivos = signal(0);
  /** De onde vêm as mudanças "deles" (a branch do merge, ou o commit do cherry-pick). */
  readonly deles = signal('');
  /** Conflitos que não vêm de merge/cherry-pick (ex.: devolver da prateleira): o nome do outro lado. */
  readonly origemDeles = signal<string | null>(null);

  readonly temConflitos = computed(() => this.git.conflitos().length > 0);

  /** Ações que o componente registra (o vim e os atalhos chamam por aqui). */
  acoes: {
    proximo(passo: 1 | -1): void;
    pegar(lado: 'seu' | 'deles'): void;
    gravar(): Promise<void>;
  } | null = null;
}
