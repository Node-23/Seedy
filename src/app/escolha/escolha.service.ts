import { Injectable, signal } from '@angular/core';

export interface OpcaoDeEscolha<T> {
  rotulo: string;
  detalhe?: string;
  valor: T;
  /** Já vem marcada (escolha múltipla). */
  marcada?: boolean;
}

export interface PedidoDeEscolha {
  titulo: string;
  opcoes: OpcaoDeEscolha<unknown>[];
  multipla: boolean;
  /** Texto curto embaixo (ex.: o que acontece ao confirmar). */
  dica?: string;
  resolver: (valores: unknown[] | null) => void;
}

/**
 * Janela de escolha, reaproveitada por quem precisa perguntar algo ao usuário
 * (qual JDK, quais campos entram no construtor...). Tudo pelo teclado.
 */
@Injectable({ providedIn: 'root' })
export class EscolhaService {
  readonly pedido = signal<PedidoDeEscolha | null>(null);

  /** Resolve com os valores escolhidos, ou null se o usuário cancelar (esc). */
  escolher<T>(titulo: string, opcoes: OpcaoDeEscolha<T>[], config: { multipla?: boolean; dica?: string } = {}): Promise<T[] | null> {
    this.pedido()?.resolver(null);
    return new Promise((resolver) => {
      this.pedido.set({
        titulo,
        opcoes: opcoes as OpcaoDeEscolha<unknown>[],
        multipla: !!config.multipla,
        dica: config.dica,
        resolver: (v) => resolver(v as T[] | null),
      });
    });
  }

  /** Atalho para escolha de um item só. */
  async escolherUm<T>(titulo: string, opcoes: OpcaoDeEscolha<T>[], dica?: string): Promise<T | null> {
    const r = await this.escolher(titulo, opcoes, { dica });
    return r?.[0] ?? null;
  }

  responder(valores: unknown[] | null): void {
    const p = this.pedido();
    this.pedido.set(null);
    p?.resolver(valores);
  }
}
