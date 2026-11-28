import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { EditorService } from '../editor/editor.service';
import { GitService } from '../git/git.service';
import { JdtlsService } from '../java/jdtls.service';
import { LayoutService } from '../layout/layout.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { ponte } from '../nucleo/ponte';
import { ProjetoService } from '../nucleo/projeto.service';

/** Como cada operação do Git aparece na lista; as que não mexem nos arquivos ficam de fora. */
const ANTES_DO_GIT: Record<string, string> = {
  pull: 'antes do pull',
  commit: 'antes do commit',
  checkout: 'antes do checkout',
  merge: 'antes do merge',
  stash: 'antes do stash',
  restore: 'antes de descartar',
  clean: 'antes de descartar',
  'cherry-pick': 'antes do cherry-pick',
  revert: 'antes do revert',
  rebase: 'antes do rebase',
};

/** Acima disso é uma troca de branch ou um build: não vale guardar um a um. */
const MUDANCAS_DE_UMA_VEZ = 50;

/** O que está pedindo a tela de histórico (local ou do Git). */
export interface AlvoDoHistorico {
  caminho: string;
  /** Linhas selecionadas (histórico do Git de um trecho). */
  linhas: { de: number; ate: number } | null;
}

/**
 * Guarda cópias dos arquivos nos momentos em que se pode perder trabalho (salvar, mudança por
 * fora, operações do Git, propostas da IA, refatorações, apagar) e abre as telas de histórico.
 */
@Injectable({ providedIn: 'root' })
export class HistoricoService {
  private readonly editor = inject(EditorService);
  private readonly git = inject(GitService);
  private readonly jdtls = inject(JdtlsService);
  private readonly layout = inject(LayoutService);
  private readonly mensagens = inject(MensagensService);
  private readonly projeto = inject(ProjetoService);

  readonly alvo = signal<AlvoDoHistorico | null>(null);
  private ligado = false;

  /** Liga as capturas (uma vez, na abertura do app). */
  iniciar(): void {
    if (this.ligado) return;
    this.ligado = true;
    this.editor.antesDeSalvar((b) => this.guardar(b.caminho, 'antes de salvar'));
    this.editor.aoSalvar((b) => void this.guardar(b.caminho, 'salvo', b.modelo.getValue()));
    this.editor.aoRecarregar((b, antes, depois) => {
      void this.guardar(b.caminho, 'antes de mudar por fora', antes).then(() => this.guardar(b.caminho, 'mudou fora do Seedy', depois));
    });
    this.editor.antesDeRefatorar((caminho, conteudo) => void this.guardar(caminho, 'antes de uma mudança automática', conteudo));
    this.jdtls.antesDeEditar.push((caminho, conteudo) => void this.guardar(caminho, 'antes de uma mudança automática', conteudo));
    this.git.antesDeOperar.push(async (args) => {
      const motivo = ANTES_DO_GIT[args[0]];
      if (!motivo) return;
      for (const a of this.git.alterados().filter((x) => x.letra !== 'D').slice(0, 200)) await this.guardar(a.caminho, motivo);
    });
  }

  constructor() {
    // Arquivos que mudaram sem o Seedy ter gravado (terminal, outro programa, Claude Code).
    effect(() => {
      const m = this.projeto.mudancas();
      if (!m) return;
      untracked(() => {
        const caminhos = [...new Set([...m.alterados, ...m.criados])];
        if (caminhos.length > MUDANCAS_DE_UMA_VEZ) return;
        for (const c of caminhos) void this.guardar(c, 'mudou fora do Seedy');
      });
    });
  }

  /** As gravações vão uma atrás da outra, na ordem em que foram pedidas. */
  private fila: Promise<void> = Promise.resolve();

  /** Sem `conteudo`, o núcleo lê do disco. Falhar aqui nunca atrapalha quem chamou. */
  guardar(caminho: string, motivo: string, conteudo: string | null = null): Promise<void> {
    const raiz = this.projeto.raiz();
    if (!raiz || caminho.includes('://')) return this.fila;
    return (this.fila = this.fila.then(() =>
      ponte.historico.guardar(raiz, caminho, motivo, conteudo).catch((e) => console.warn(`histórico local: ${e}`)),
    ));
  }

  /** Quando o que já foi pedido estiver gravado. */
  gravado(): Promise<void> {
    return this.fila;
  }

  abrirLocal(caminho = this.editor.ativo()): void {
    if (!this.projeto.raiz()) return;
    this.alvo.set(caminho && !caminho.includes('://') ? { caminho, linhas: null } : null);
    this.layout.tela.set('historico');
  }

  abrirNoGit(caminho = this.editor.ativo()): void {
    if (!caminho || caminho.includes('://')) return this.mensagens.alerta('abra um arquivo do projeto primeiro');
    if (!this.git.relativo(caminho)) return this.mensagens.alerta('o arquivo não está num repositório Git');
    // Com várias linhas selecionadas no editor, o histórico é o do trecho.
    const s = caminho === this.editor.ativo() && this.layout.tela() === 'editor' ? this.editor.instancia?.getSelection() : null;
    const ate = s ? (s.endColumn === 1 && s.endLineNumber > s.startLineNumber ? s.endLineNumber - 1 : s.endLineNumber) : 0;
    this.alvo.set({ caminho, linhas: s && !s.isEmpty() ? { de: s.startLineNumber, ate } : null });
    this.layout.tela.set('historico-git');
  }

  fechar(): void {
    this.layout.tela.set('editor');
    queueMicrotask(() => this.editor.focar());
  }
}
