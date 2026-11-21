import { Injectable, signal } from '@angular/core';

/** Pedido de aba nova no terminal integrado rodando um comando (ex.: shell num container). */
export interface PedidoDeTerminal {
  titulo: string;
  comando: string[];
  n: number;
}

/** Outros módulos pedem abas ao terminal por aqui (o componente observa e abre). */
@Injectable({ providedIn: 'root' })
export class TerminalService {
  readonly pedido = signal<PedidoDeTerminal | null>(null);

  abrir(titulo: string, comando: string[]): void {
    this.pedido.set({ titulo, comando, n: (this.pedido()?.n ?? 0) + 1 });
  }
}
