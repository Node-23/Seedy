import { Injectable, signal } from '@angular/core';

export interface PedidoDeDiff {
  titulo: string;
  antes: string;
  depois: string;
  rotuloAntes: string;
  rotuloDepois: string;
  /** Caminho do arquivo, para escolher a linguagem (cores). */
  caminho: string;
}

/** Diff lado a lado (editor de diff do Monaco), aberto por cima da tela atual. */
@Injectable({ providedIn: 'root' })
export class DiffService {
  readonly atual = signal<PedidoDeDiff | null>(null);

  abrir(pedido: PedidoDeDiff): void {
    this.atual.set(pedido);
  }

  fechar(): void {
    this.atual.set(null);
  }
}
