import { Injectable, signal } from '@angular/core';

export interface Mensagem {
  texto: string;
  erro: boolean;
}

/** Mensagens curtas que aparecem na linha de comando, no rodapé (como no vim). */
@Injectable({ providedIn: 'root' })
export class MensagensService {
  readonly atual = signal<Mensagem | null>(null);
  private temporizador: ReturnType<typeof setTimeout> | undefined;

  mostrar(texto: string): void {
    this.definir({ texto, erro: false });
  }

  erro(texto: string): void {
    this.definir({ texto, erro: true });
  }

  private definir(m: Mensagem): void {
    this.atual.set(m);
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.atual.set(null), m.erro ? 8000 : 4000);
  }
}
