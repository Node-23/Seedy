import { Component, inject } from '@angular/core';
import { BarraTopoComponent } from './barra/barra-topo.component';
import { BarraStatusComponent } from './barra/barra-status.component';
import { MenuLiderComponent } from './barra/menu-lider.component';
import { ArvoreComponent } from './arquivos/arvore.component';
import { EditorComponent } from './editor/editor.component';
import { TerminalComponent } from './terminal/terminal.component';
import { BuscaComponent } from './busca/busca.component';
import { BuscaService } from './busca/busca.service';
import { BuscaProjetoComponent } from './busca/busca-projeto.component';
import { BuscaProjetoService } from './busca/busca-projeto.service';
import { EscolhaComponent } from './escolha/escolha.component';
import { EscolhaService } from './escolha/escolha.service';
import { LayoutService, Regiao } from './layout/layout.service';
import { MensagensService } from './nucleo/mensagens.service';
import { ProjetoService } from './nucleo/projeto.service';
import { TemaService } from './tema/tema';
import { AtalhosService } from './teclado/atalhos.service';
import { JdtlsService } from './java/jdtls.service';

@Component({
  selector: 'sd-raiz',
  imports: [
    BarraTopoComponent, BarraStatusComponent, MenuLiderComponent, ArvoreComponent, EditorComponent, TerminalComponent,
    BuscaComponent, BuscaProjetoComponent, EscolhaComponent,
  ],
  template: `
    <div class="seedy">
      <sd-barra-topo />

      <div class="area-principal" [class.esmaecida]="busca.aberta() || buscaProjeto.aberta() || !!escolha.pedido()">
        @if (layout.disposicao().visiveis.arquivos) {
          <div class="regiao-esquerda" [style.width.px]="layout.disposicao().larguraEsquerda">
            <sd-arvore />
          </div>
          <div class="divisor vertical" role="separator" aria-orientation="vertical" (pointerdown)="arrastar($event, 'esquerda')"></div>
        }

        <div class="coluna-central">
          <sd-editor class="regiao-editor" />
          <div class="divisor horizontal" role="separator" aria-orientation="horizontal"
               [class.oculto]="!layout.disposicao().visiveis.terminal" (pointerdown)="arrastar($event, 'inferior')"></div>
          <div class="regiao-inferior" [class.oculto]="!layout.disposicao().visiveis.terminal"
               [style.height.px]="layout.disposicao().alturaInferior">
            <sd-terminal />
          </div>
        </div>

        <sd-busca />
        <sd-busca-projeto />
        <sd-escolha />
      </div>

      <sd-barra-status />
      <div class="linha-de-comando">
        <div id="vim-linha-de-comando" class="vim-linha"></div>
        @if (mensagens.atual(); as m) {
          <span class="mensagem" [class.erro]="m.erro">{{ m.texto }}</span>
        }
      </div>

      <sd-menu-lider />
    </div>
  `,
})
export class App {
  protected readonly layout = inject(LayoutService);
  protected readonly mensagens = inject(MensagensService);
  protected readonly busca = inject(BuscaService);
  protected readonly buscaProjeto = inject(BuscaProjetoService);
  protected readonly escolha = inject(EscolhaService);

  constructor() {
    inject(AtalhosService).iniciar();
    inject(JdtlsService); // liga o jdtls quando o projeto é de Java
    void inject(TemaService).iniciar();
    void inject(ProjetoService).iniciar();
  }

  /** Arrastar o divisor redimensiona a região (largura dos arquivos / altura do terminal). */
  protected arrastar(inicio: PointerEvent, regiao: Regiao): void {
    inicio.preventDefault();
    const d = this.layout.disposicao();
    const base = regiao === 'esquerda' ? d.larguraEsquerda : d.alturaInferior;
    const mover = (e: PointerEvent) =>
      this.layout.redimensionar(
        regiao,
        regiao === 'esquerda' ? base + (e.clientX - inicio.clientX) : base - (e.clientY - inicio.clientY),
      );
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      document.body.classList.remove('arrastando');
    };
    document.body.classList.add('arrastando');
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  }
}
