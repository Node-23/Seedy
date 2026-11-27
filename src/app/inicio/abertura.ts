import { inject, Injectable } from '@angular/core';
import { ProjetoService } from '../nucleo/projeto.service';
import { BuscaService } from '../busca/busca.service';
import { JdtlsService } from '../java/jdtls.service';
import { noApp, ponte } from '../nucleo/ponte';

/** A janela de carregamento não pisca: fica no mínimo isto... */
const MINIMO = 1200;
/** ...e não segura o Seedy além disto (um jdtls lento continua carregando já na tela principal). */
const MAXIMO = 9000;

/** Conta à janela de carregamento o que está abrindo e, no fim, troca pela janela principal. */
@Injectable({ providedIn: 'root' })
export class AberturaService {
  private readonly projeto = inject(ProjetoService);
  private readonly busca = inject(BuscaService);
  private readonly jdtls = inject(JdtlsService);

  acompanhar(): void {
    if (!noApp()) return;
    const inicio = performance.now();
    let ultima = '';
    // Intervalo, e não requestAnimationFrame: a janela principal ainda está escondida.
    const relogio = setInterval(() => {
      const passou = performance.now() - inicio;
      const passo = this.passo();
      if (passou >= MAXIMO || (!passo && passou >= MINIMO)) {
        clearInterval(relogio);
        void ponte.carregamento.pronto();
        return;
      }
      const [texto, percentual] = passo ?? ['pronto', 100];
      const chave = `${texto}|${this.projeto.nome()}`;
      // No primeiro segundo repete: a splash pode ainda não ter carregado.
      if (chave === ultima && passou > 1000) return;
      ultima = chave;
      void ponte.carregamento.etapa(texto, this.projeto.nome(), percentual);
    }, 100);
  }

  /** O que ainda falta (texto e quanto da barra); null = pode abrir. */
  private passo(): [string, number] | null {
    if (!this.projeto.pronto()) return ['abrindo o projeto…', 25];
    if (!this.projeto.raiz()) return null;
    if (!this.busca.indice()) return ['lendo os arquivos…', 55];
    if (!this.jdtls.ehJava()) return null;
    const fase = this.jdtls.estado().fase;
    return fase === 'inativo' || fase === 'iniciando' ? ['iniciando o jdtls…', 80] : null;
  }
}
