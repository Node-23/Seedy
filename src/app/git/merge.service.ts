import { computed, inject, Injectable, signal } from '@angular/core';
import { GitService } from './git.service';

/** Um conflito do arquivo aberto no merge, como a IA o vê. */
export interface ConflitoParaIA {
  /** 1, 2, 3... na ordem do arquivo (o mesmo número da caixa "conflito N de M"). */
  numero: number;
  resolvido: boolean;
  /** Linha do resultado onde a resolução entra. */
  linha: number;
  base: string[];
  seu: string[];
  deles: string[];
}

/** O arquivo em merge, para montar a conversa com a IA. */
export interface ContextoDoMerge {
  arquivo: string;
  linguagem: string;
  nomeSeu: string;
  nomeDeles: string;
  /** O resultado como está agora (o que será gravado), sem os conflitos abertos. */
  resultado: string[];
  conflitos: ConflitoParaIA[];
  /** Conflito aberto mais perto do cursor (o que o usuário está olhando). */
  atual: number | null;
}

/** Estado do merge em três colunas (mockup 05), compartilhado com a statusline, o vim e a IA. */
@Injectable({ providedIn: 'root' })
export class MergeService {
  private readonly git = inject(GitService);

  /** Conflitos ainda sem resolução no arquivo aberto no merge. */
  readonly restantes = signal(0);
  /** Índice do arquivo (entre os em conflito no início do merge). */
  readonly arquivoAtual = signal(0);
  readonly totalDeArquivos = signal(0);
  /** Caminho relativo do arquivo aberto no merge. */
  readonly arquivo = signal<string | null>(null);
  /** De onde vêm as mudanças "deles" (a branch do merge, ou o commit do cherry-pick). */
  readonly deles = signal('');
  /** Conflitos que não vêm de merge/cherry-pick (ex.: devolver da prateleira): o nome do outro lado. */
  readonly origemDeles = signal<string | null>(null);
  /** Proposta da IA mostrada no lugar da caixa do conflito (prévia, ainda não aplicada). */
  readonly previa = signal<{ conflito: number; linhas: string[] } | null>(null);

  readonly temConflitos = computed(() => this.git.conflitos().length > 0);

  /** Ações que o componente registra (o vim, os atalhos e a IA chamam por aqui). */
  acoes: {
    proximo(passo: 1 | -1): void;
    pegar(lado: 'seu' | 'deles'): void;
    gravar(): Promise<void>;
    contexto(): ContextoDoMerge | null;
    /** Troca o conflito pelas linhas da IA; false se ele já foi resolvido. */
    aplicarIA(conflito: number, linhas: string[]): boolean;
    focarResultado(): void;
  } | null = null;
}
