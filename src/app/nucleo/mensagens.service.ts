import { Injectable, signal } from '@angular/core';

export interface Mensagem {
  texto: string;
  erro: boolean;
}

export interface Alerta {
  id: number;
  texto: string;
}

/**
 * Mensagens curtas: a linha de comando do rodapé (como no vim) para o que aconteceu, e o toast de
 * alerta para o que NÃO aconteceu (clicou ou apertou algo que não tinha o que fazer).
 */
@Injectable({ providedIn: 'root' })
export class MensagensService {
  readonly atual = signal<Mensagem | null>(null);
  /** Toasts de alerta na tela (os mais novos por último). */
  readonly alertas = signal<Alerta[]>([]);
  private temporizador: ReturnType<typeof setTimeout> | undefined;
  private proximo = 1;

  mostrar(texto: string): void {
    this.definir({ texto, erro: false });
  }

  erro(texto: string): void {
    this.definir({ texto, erro: true });
  }

  /** Um toast pequeno de alerta: a ação não fez nada (e por quê). Some sozinho. */
  alerta(texto: string): void {
    const atuais = this.alertas();
    if (atuais.some((a) => a.texto === texto)) return; // o mesmo aviso não se repete empilhado
    const id = this.proximo++;
    this.alertas.set([...atuais, { id, texto }].slice(-3));
    setTimeout(() => this.fecharAlerta(id), 4500);
  }

  fecharAlerta(id: number): void {
    this.alertas.update((l) => l.filter((a) => a.id !== id));
  }

  private definir(m: Mensagem): void {
    this.atual.set(m);
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.atual.set(null), m.erro ? 8000 : 4000);
  }
}
