import { computed, inject, Injectable, signal } from '@angular/core';
import { Mudancas, nomeBase, ponte } from './ponte';
import { MensagensService } from './mensagens.service';

const CHAVE_ULTIMO = 'seedy.ultimoProjeto';

/** O projeto (pasta) aberto no momento. */
@Injectable({ providedIn: 'root' })
export class ProjetoService {
  private readonly mensagens = inject(MensagensService);

  readonly raiz = signal<string | null>(null);
  readonly nome = computed(() => (this.raiz() ? nomeBase(this.raiz()!) : null));
  readonly branch = signal<string | null>(null);
  /** Muda a cada recarga, para a árvore de arquivos saber que deve reler. */
  readonly versao = signal(0);
  /** Vira true quando a pasta inicial já foi resolvida (o terminal espera isso para abrir no lugar certo). */
  readonly pronto = signal(false);
  /** Último lote de mudanças no disco feitas fora do editor (o editor e o jdtls reagem). */
  readonly mudancas = signal<Mudancas | null>(null);

  async iniciar(): Promise<void> {
    await ponte.aoAlterarArquivos((m) => this.aoMudarNoDisco(m));
    const daLinhaDeComando = await ponte.pastaInicial();
    const ultimo = localStorage.getItem(CHAVE_ULTIMO);
    const pasta = daLinhaDeComando ?? ultimo;
    try {
      if (pasta) await this.abrir(pasta);
    } finally {
      this.pronto.set(true);
    }
  }

  async escolher(): Promise<void> {
    const pasta = await ponte.escolherPasta();
    if (pasta) await this.abrir(pasta);
  }

  async abrir(pasta: string): Promise<void> {
    try {
      await ponte.lerPasta(pasta);
    } catch {
      this.mensagens.erro(`não consegui abrir ${pasta}`);
      localStorage.removeItem(CHAVE_ULTIMO);
      return;
    }
    this.raiz.set(pasta);
    localStorage.setItem(CHAVE_ULTIMO, pasta);
    void ponte.observarProjeto(pasta).catch((e) => this.mensagens.erro(String(e)));
    await this.atualizarBranch();
    this.versao.update((v) => v + 1);
  }

  async atualizarBranch(): Promise<void> {
    const raiz = this.raiz();
    this.branch.set(raiz ? await ponte.branchAtual(raiz) : null);
  }

  /** Arquivo criado/removido: árvore e índice da busca se refazem; HEAD mudou: branch nova. */
  private aoMudarNoDisco(m: Mudancas): void {
    if (m.criados.length || m.removidos.length) this.versao.update((v) => v + 1);
    if (m.git) void this.atualizarBranch();
    this.mudancas.set(m);
  }

  recarregar(): void {
    this.versao.update((v) => v + 1);
    void this.atualizarBranch();
  }
}
