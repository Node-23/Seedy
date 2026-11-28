/**
 * Cliente JSON-RPC mínimo para LSP. Não sabe nada de Java nem de Monaco:
 * só numera pedidos, casa respostas e distribui notificações.
 * O transporte (núcleo em Rust ↔ stdio do jdtls) chega por `receber` / `enviar`.
 */
type Manipulador = (params: any) => unknown;

interface Pendente {
  resolver: (valor: any) => void;
  rejeitar: (erro: Error) => void;
}

export class ErroLsp extends Error {
  constructor(
    readonly codigo: number,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroLsp';
    // No começo da pilha: o Monaco reembrulha o erro e só o texto da pilha sobrevive.
    this.stack = `ErroLsp: ${mensagem}
${this.stack ?? ''}`;
  }
}

/** Pedido que o servidor largou porque foi cancelado ou o texto mudou (acontece o tempo todo ao digitar). */
const CODIGOS_DE_CANCELAMENTO = [-32800, -32801, -32802];

/**
 * O erro de uma resposta. Cancelamento vira o "Canceled" que o Monaco reconhece e engole: sem isso
 * ele aparecia como falha do Seedy.
 */
export function erroDaResposta(codigo: number, mensagem: string): Error {
  if (!CODIGOS_DE_CANCELAMENTO.includes(codigo) && !/has been cancell?ed|document changed|content modified/i.test(mensagem)) return new ErroLsp(codigo, mensagem);
  const cancelado = new Error('Canceled');
  cancelado.name = 'Canceled';
  return cancelado;
}

export class ClienteLsp {
  private proximoId = 1;
  private readonly pendentes = new Map<number, Pendente>();
  private readonly notificacoes = new Map<string, Manipulador[]>();
  private readonly pedidos = new Map<string, Manipulador>();
  private encerrado = false;

  constructor(private readonly enviar: (texto: string) => Promise<void>) {}

  pedir<T = any>(metodo: string, params?: unknown, cancelamento?: { onCancellationRequested(fn: () => void): unknown }): Promise<T> {
    if (this.encerrado) return Promise.reject(new Error('jdtls parado'));
    const id = this.proximoId++;
    return new Promise<T>((resolver, rejeitar) => {
      this.pendentes.set(id, { resolver, rejeitar });
      cancelamento?.onCancellationRequested(() => {
        if (this.pendentes.has(id)) this.notificar('$/cancelRequest', { id });
      });
      this.enviar(JSON.stringify({ jsonrpc: '2.0', id, method: metodo, params })).catch((e) => {
        this.pendentes.delete(id);
        rejeitar(new Error(String(e)));
      });
    });
  }

  notificar(metodo: string, params?: unknown): void {
    if (this.encerrado) return;
    void this.enviar(JSON.stringify({ jsonrpc: '2.0', method: metodo, params })).catch(() => {});
  }

  aoNotificar(metodo: string, fn: Manipulador): void {
    this.notificacoes.set(metodo, [...(this.notificacoes.get(metodo) ?? []), fn]);
  }

  /** Pedidos que o servidor faz ao cliente (workspace/applyEdit, workspace/configuration...). */
  aoPedir(metodo: string, fn: Manipulador): void {
    this.pedidos.set(metodo, fn);
  }

  receber(texto: string): void {
    let msg: any;
    try {
      msg = JSON.parse(texto);
    } catch {
      return;
    }
    if (msg.id !== undefined && msg.method === undefined) {
      const p = this.pendentes.get(msg.id);
      if (!p) return;
      this.pendentes.delete(msg.id);
      if (msg.error) p.rejeitar(erroDaResposta(msg.error.code, String(msg.error.message)));
      else p.resolver(msg.result ?? null);
    } else if (msg.id !== undefined) {
      void this.responder(msg.id, msg.method, msg.params);
    } else if (msg.method) {
      for (const fn of this.notificacoes.get(msg.method) ?? []) fn(msg.params);
    }
  }

  /** O processo morreu: rejeita o que estava esperando resposta. */
  encerrar(): void {
    this.encerrado = true;
    for (const p of this.pendentes.values()) p.rejeitar(new Error('jdtls parado'));
    this.pendentes.clear();
  }

  private async responder(id: number | string, metodo: string, params: unknown): Promise<void> {
    const fn = this.pedidos.get(metodo);
    let resposta: object;
    try {
      resposta = { result: fn ? ((await fn(params)) ?? null) : null };
    } catch (e) {
      resposta = { error: { code: -32603, message: String(e) } };
    }
    if (!this.encerrado) void this.enviar(JSON.stringify({ jsonrpc: '2.0', id, ...resposta })).catch(() => {});
  }
}
