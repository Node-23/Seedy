import { Component, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { ConfiguracoesService } from '../config/configuracoes.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { ponte } from '../nucleo/ponte';
import { CompletarService, ModoDeCompletar } from './completar.service';

/**
 * A pergunta do completar (mockup 38): local, API ou não usar.
 * Teclado: l / a / n escolhem, ⏎ confirma, esc = não usar.
 */
@Component({
  selector: 'sd-completar-pergunta',
  template: `
    @if (c.perguntando()) {
      <div class="veu"></div>
      <div #caixa class="painel completar-pergunta" role="dialog" aria-label="Completar código" tabindex="-1" (keydown)="teclar($event)">
        <div class="painel-faixa"><span class="rotulo">COMPLETAR CÓDIGO</span><span class="suave">muda depois quando quiser</span><span class="espaco"></span><kbd>esc</kbd></div>
        <div class="completar-corpo">
          <div class="completar-titulo"><b>Quer sugestões de código enquanto digita?</b><span class="suave">O completar do jdtls continua funcionando em qualquer escolha.</span></div>
          <div class="config-opcao" [class.on]="escolha() === 'local'" (click)="escolha.set('local')">
            <div class="config-opcao-t"><span class="config-radio"></span><b>Local, no seu computador</b><span class="config-tag sucesso-texto">grátis · o código não sai daqui</span><span class="espaco"></span><kbd>l</kbd></div>
            <div class="suave">baixa uma vez ~1 GB (modelo Qwen2.5-Coder 1.5B e llama.cpp) · ligado, ocupa cerca de 1 GB da placa de vídeo (ou da memória)<br>sugere bem linhas e blocos curtos</div>
          </div>
          <div class="config-opcao" [class.on]="escolha() === 'api'" (click)="escolha.set('api')">
            <div class="config-opcao-t"><span class="config-radio"></span><b>API da Anthropic (Haiku)</b><span class="config-tag suave">paga por uso · precisa de uma chave da API</span><span class="espaco"></span><kbd>a</kbd></div>
            <div class="suave">nada para baixar · envia o trecho em volta do cursor · cerca de US$ 4 por mês em uso diário (estimativa)<br>a assinatura Pro/Max do Claude não vale aqui</div>
          </div>
          <div class="config-opcao" [class.on]="escolha() === 'desligado'" (click)="escolha.set('desligado')">
            <div class="config-opcao-t"><span class="config-radio"></span><b>Não usar</b><span class="config-tag suave">nada é baixado nem enviado</span><span class="espaco"></span><kbd>n</kbd></div>
            <div class="suave">dá para ligar depois quando quiser</div>
          </div>
        </div>
        <div class="completar-acoes">
          <span class="suave">muda depois em Ctrl+, ou Alt+Shift+C<br>o download segue em segundo plano</span>
          <span class="espaco"></span>
          <button class="botao" (click)="responder('desligado')">não usar <kbd>esc</kbd></button>
          <button class="botao destaque" (click)="responder(escolha())">{{ rotulo() }} <kbd>⏎</kbd></button>
        </div>
      </div>
    }
  `,
})
export class PerguntaDoCompletarComponent {
  protected readonly c = inject(CompletarService);
  private readonly configuracoes = inject(ConfiguracoesService);
  private readonly mensagens = inject(MensagensService);
  private readonly caixa = viewChild<ElementRef<HTMLElement>>('caixa');
  private focoAnterior: HTMLElement | null = null;

  protected readonly escolha = signal<ModoDeCompletar>('local');

  protected rotulo(): string {
    return { local: 'baixar e ligar', api: 'usar a API', desligado: 'não usar' }[this.escolha()];
  }

  constructor() {
    effect(() => {
      const caixa = this.caixa();
      untracked(() => {
        if (!caixa) {
          this.focoAnterior?.focus();
          this.focoAnterior = null;
          return;
        }
        this.focoAnterior = document.activeElement as HTMLElement | null;
        this.escolha.set('local');
        // Depois do que mais tenta pegar o foco na abertura.
        setTimeout(() => caixa.nativeElement.focus(), 50);
      });
    });
  }

  protected async responder(modo: ModoDeCompletar): Promise<void> {
    const semChave = modo === 'api' && !(await ponte.ia.temChaveDaApi().catch(() => false));
    void this.c.escolher(modo);
    if (!semChave) return;
    this.mensagens.alerta('cole a chave da API na aba IA (c, depois k)');
    this.configuracoes.abrir('ia');
  }

  protected teclar(e: KeyboardEvent): void {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'l') this.escolha.set('local');
    else if (e.key === 'a') this.escolha.set('api');
    else if (e.key === 'n') this.escolha.set('desligado');
    else if (e.key === 'Enter') void this.responder(this.escolha());
    else if (e.key === 'Escape') void this.responder('desligado');
    else if (e.key !== 'Tab') return;
    e.preventDefault();
    e.stopPropagation();
  }
}
