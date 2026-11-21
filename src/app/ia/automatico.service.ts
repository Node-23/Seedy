import { computed, inject, Injectable } from '@angular/core';
import { ConfigService } from '../config/config.service';
import { MensagensService } from '../nucleo/mensagens.service';

/**
 * Modo automático da IA: ela aplica as edições e roda os comandos sem pedir confirmação a cada
 * passo. Fica em `ia.automatico` no seedy.json; o que a IA muda continua na lista de revisão (␣ y).
 */
@Injectable({ providedIn: 'root' })
export class AutomaticoService {
  private readonly config = inject(ConfigService);
  private readonly mensagens = inject(MensagensService);

  readonly ligado = computed(() => this.config.atual().ia.automatico === true);

  async definir(ligar: boolean): Promise<void> {
    await this.config.gravar({ ia: { ...this.config.atual().ia, automatico: ligar } });
    this.mensagens.mostrar(ligar ? 'IA no modo automático: edições e comandos sem confirmação (␣ y revisa o que ela mudou)' : 'IA volta a pedir confirmação a cada edição e comando');
  }

  alternar(): Promise<void> {
    return this.definir(!this.ligado());
  }
}
