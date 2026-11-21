import { inject, Injectable, signal } from '@angular/core';
import { GitService } from './git.service';
import { MensagensService } from '../nucleo/mensagens.service';

/** Janela de commit (Ctrl+K), como a do IntelliJ. */
@Injectable({ providedIn: 'root' })
export class CommitService {
  private readonly git = inject(GitService);
  private readonly mensagens = inject(MensagensService);

  readonly aberta = signal(false);
  private focoAnterior: HTMLElement | null = null;

  async abrir(): Promise<void> {
    if (!this.git.ehRepositorio()) {
      this.mensagens.alerta('este projeto não é um repositório git');
      return;
    }
    await this.git.atualizar();
    if (!this.git.alterados().length) {
      this.mensagens.alerta('nada para commitar: não há alterações');
      return;
    }
    if (!this.aberta()) this.focoAnterior = document.activeElement as HTMLElement | null;
    this.aberta.set(true);
  }

  fechar(): void {
    this.aberta.set(false);
    const anterior = this.focoAnterior;
    this.focoAnterior = null;
    if (anterior?.isConnected && anterior !== document.body) queueMicrotask(() => anterior.focus());
  }
}
