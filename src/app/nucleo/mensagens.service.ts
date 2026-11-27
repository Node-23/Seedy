import { computed, Injectable, signal } from '@angular/core';

export type TipoDeNotificacao = 'info' | 'aviso' | 'erro';

export interface Notificacao {
  id: number;
  tipo: TipoDeNotificacao;
  /** Primeira linha, encurtada. */
  titulo: string;
  /** O texto inteiro (pilha e saída, quando houver). */
  completo: string;
  quando: Date;
  /** Falha do próprio Seedy: o popup oferece enviar para análise. */
  doSeedy: boolean;
  vista: boolean;
  /** O e-mail com o relatório já foi aberto. */
  enviada: boolean;
}

/** Quanto cada toast fica na tela; erro fica até ser fechado ou aberto. */
const DURACAO: Record<TipoDeNotificacao, number | null> = { info: 4000, aviso: 6000, erro: null };
const NA_TELA = 4;
const NO_HISTORICO = 100;
const TITULO = 160;

/**
 * Tudo que o Seedy tem a dizer vira um toast (mockup 34) e fica no histórico do sino (mockup 36)
 * até o Seedy fechar. Clicar abre o texto inteiro (mockup 35).
 */
@Injectable({ providedIn: 'root' })
export class MensagensService {
  /** As mais novas primeiro. */
  readonly historico = signal<Notificacao[]>([]);
  private readonly naTela = signal<number[]>([]);
  readonly toasts = computed(() => {
    const todas = this.historico();
    return this.naTela()
      .map((id) => todas.find((n) => n.id === id))
      .filter((n): n is Notificacao => !!n);
  });
  /** Avisos e erros que ninguém abriu (o número no sino). */
  readonly naoVistas = computed(() => this.historico().filter((n) => !n.vista && n.tipo !== 'info').length);
  /** A notificação aberta no popup. */
  readonly aberta = signal<Notificacao | null>(null);
  readonly listaAberta = signal(false);

  private readonly temporizadores = new Map<number, ReturnType<typeof setTimeout>>();
  private proximo = 1;

  /** Aconteceu. */
  mostrar(texto: string): void {
    this.registrar('info', texto);
  }

  /** NÃO aconteceu: clicou ou apertou algo que não tinha o que fazer. */
  alerta(texto: string): void {
    this.registrar('aviso', texto);
  }

  /** Erro do projeto ou de uso (push recusado, arquivo inválido...). */
  erro(texto: string): void {
    this.registrar('erro', texto);
  }

  /** Falha do próprio Seedy, que vale a pena mandar para análise. */
  falha(titulo: string, causa?: unknown): void {
    const detalhe = causa === undefined ? '' : causa instanceof Error ? causa.stack || `${causa.name}: ${causa.message}` : String(causa);
    this.registrar('erro', detalhe ? `${titulo}\n${detalhe}` : titulo, true);
  }

  fecharToast(id: number): void {
    clearTimeout(this.temporizadores.get(id));
    this.temporizadores.delete(id);
    this.naTela.update((l) => l.filter((i) => i !== id));
  }

  abrir(n: Notificacao): void {
    this.fecharToast(n.id);
    this.alterar(n.id, { vista: true });
    this.listaAberta.set(false);
    this.aberta.set({ ...n, vista: true });
  }

  fecharPopup(): void {
    this.aberta.set(null);
  }

  alternarLista(): void {
    if (this.listaAberta()) return this.fecharLista();
    this.aberta.set(null);
    this.listaAberta.set(true);
  }

  /** Quem fechou a lista já viu o que havia nela. */
  fecharLista(): void {
    this.listaAberta.set(false);
    this.historico.update((l) => l.map((n) => (n.vista ? n : { ...n, vista: true })));
  }

  marcarEnviada(id: number): void {
    this.alterar(id, { enviada: true });
  }

  apagar(id: number): void {
    this.fecharToast(id);
    this.historico.update((l) => l.filter((n) => n.id !== id));
  }

  limpar(): void {
    for (const id of this.naTela()) this.fecharToast(id);
    this.historico.set([]);
  }

  private alterar(id: number, parte: Partial<Notificacao>): void {
    this.historico.update((l) => l.map((n) => (n.id === id ? { ...n, ...parte } : n)));
  }

  private registrar(tipo: TipoDeNotificacao, texto: string, doSeedy = false): void {
    const completo = texto.trim();
    if (!completo) return;
    const linha = completo.split('\n')[0].trim();
    const titulo = linha.length > TITULO ? `${linha.slice(0, TITULO)}…` : linha;
    // O mesmo texto de novo não empilha: sobe para o topo com a hora nova.
    const repetida = this.historico().find((n) => n.tipo === tipo && n.completo === completo);
    const id = repetida?.id ?? this.proximo++;
    const nova: Notificacao = { id, tipo, titulo, completo, doSeedy, quando: new Date(), vista: false, enviada: repetida?.enviada ?? false };
    this.historico.update((l) => [nova, ...l.filter((n) => n.id !== id)].slice(0, NO_HISTORICO));

    this.fecharToast(id);
    for (const velho of this.naTela().slice(0, -(NA_TELA - 1))) this.fecharToast(velho);
    this.naTela.update((l) => [...l, id]);
    const duracao = DURACAO[tipo];
    if (duracao) this.temporizadores.set(id, setTimeout(() => this.fecharToast(id), duracao));
  }
}
