import { ErrorHandler, inject, Injectable, Injector } from '@angular/core';
import { MensagensService } from '../nucleo/mensagens.service';

/** Ruído conhecido do Monaco e do navegador: não é falha. */
const RUIDO = /^(Canceled|ResizeObserver loop)|: Canceled$/;

/** Exceção que ninguém tratou é falha do Seedy: vira toast e pode ser enviada para análise. */
@Injectable()
export class ErrosDoSeedy implements ErrorHandler {
  private readonly injetor = inject(Injector);

  handleError(erro: unknown): void {
    console.error(erro);
    try {
      const nome = (erro as Error | null)?.name;
      const texto = erro instanceof Error ? erro.message || erro.name : String(erro);
      if (nome === 'Canceled' || RUIDO.test(texto)) return;
      // Erro que o servidor de linguagem devolveu (jdtls, TypeScript): fica no console, não é falha do Seedy.
      if (nome === 'ErroLsp' || /ErroLsp/.test(`${texto} ${(erro as Error | null)?.stack ?? ''}`)) return;
      this.injetor.get(MensagensService).falha(`erro inesperado: ${texto.split('\n')[0].slice(0, 120)}`, erro);
    } catch (outro) {
      console.error(outro);
    }
  }
}
