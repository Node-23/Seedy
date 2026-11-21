import { Component, inject } from '@angular/core';
import { BarraTopoComponent } from './barra/barra-topo.component';
import { BarraStatusComponent } from './barra/barra-status.component';
import { MenuLiderComponent } from './barra/menu-lider.component';
import { ArvoreComponent } from './arquivos/arvore.component';
import { EditorComponent } from './editor/editor.component';
import { EditorService } from './editor/editor.service';
import { TerminalComponent } from './terminal/terminal.component';
import { BuscaComponent } from './busca/busca.component';
import { BuscaService } from './busca/busca.service';
import { BuscaProjetoComponent } from './busca/busca-projeto.component';
import { BuscaProjetoService } from './busca/busca-projeto.service';
import { EscolhaComponent } from './escolha/escolha.component';
import { GitComponent } from './git/git.component';
import { DiffComponent } from './git/diff.component';
import { CommitComponent } from './git/commit.component';
import { GithubFormComponent } from './git/github-form.component';
import { MergeComponent } from './git/merge.component';
import { GitService } from './git/git.service';
import { MargemGitService } from './git/margem.service';
import { GithubService } from './git/github.service';
import { CommitService } from './git/commit.service';
import { EscolhaService } from './escolha/escolha.service';
import { LayoutService, Regiao } from './layout/layout.service';
import { MensagensService } from './nucleo/mensagens.service';
import { ProjetoService } from './nucleo/projeto.service';
import { TemaService } from './tema/tema';
import { AtalhosService } from './teclado/atalhos.service';
import { JdtlsService } from './java/jdtls.service';
import { ConexoesComponent } from './banco/conexoes.component';
import { ResultadoSqlComponent } from './banco/resultado-sql.component';
import { PerfilBancoComponent } from './banco/perfil-banco.component';
import { BancoService } from './banco/banco.service';
import { ServidorComponent } from './servidor/servidor.component';
import { PerfilServidorComponent } from './servidor/perfil-servidor.component';
import { ServidorService } from './servidor/servidor.service';
import { DepuradorService } from './servidor/depurador.service';
import { IaComponent } from './ia/ia.component';
import { RevisaoComponent } from './ia/revisao.component';
import { RevisaoService } from './ia/revisao.service';
import { McpService } from './ia/mcp.service';
import { TelaDebugComponent } from './depuracao/tela-debug.component';
import { NovoProjetoComponent } from './novo-projeto/novo-projeto.component';
import { NovoProjetoService } from './novo-projeto/novo-projeto.service';
import { ExecucaoService } from './execucao/execucao.service';
import { ScriptsComponent } from './web/scripts.component';
import { WebLspService } from './web/web-lsp.service';
import { TelaContainersComponent } from './containers/tela-containers.component';
import { ContainersPainelComponent } from './containers/containers-painel.component';
import { TelaEntenderComponent } from './entender/tela-entender.component';
import { EntenderService } from './entender/entender.service';

@Component({
  selector: 'sd-raiz',
  imports: [
    BarraTopoComponent, BarraStatusComponent, MenuLiderComponent, ArvoreComponent, EditorComponent, TerminalComponent,
    BuscaComponent, BuscaProjetoComponent, EscolhaComponent, GitComponent, DiffComponent, CommitComponent,
    GithubFormComponent, MergeComponent, ConexoesComponent, ResultadoSqlComponent, PerfilBancoComponent,
    ServidorComponent, PerfilServidorComponent, IaComponent, RevisaoComponent, TelaDebugComponent, NovoProjetoComponent, ScriptsComponent, TelaContainersComponent, ContainersPainelComponent, TelaEntenderComponent,
  ],
  template: `
    <div class="seedy">
      <sd-barra-topo />

      <div class="regiao-principal" [class.esmaecida]="busca.aberta() || buscaProjeto.aberta() || !!escolha.pedido() || commit.aberta() || !!banco.editando() || !!servidor.editando() || revisao.aberta() || novoProjeto.aberta()">
      <div class="area-principal" [class.oculto]="layout.tela() !== 'editor'">
        @if (layout.disposicao().visiveis.arquivos) {
          <div class="regiao-esquerda" [style.width.px]="layout.disposicao().larguraEsquerda">
            <sd-arvore />
          </div>
          <div class="divisor vertical" role="separator" aria-orientation="vertical" (pointerdown)="arrastar($event, 'esquerda')"></div>
        }

        <div class="coluna-central">
          <div class="regiao-editor">
            <sd-editor [painel]="0" />
            @if (editor.divisao()) {
              <div class="divisor vertical fixo" aria-hidden="true"></div>
              <sd-editor [painel]="1" />
            }
          </div>
          @if (banco.ehSql()) { <sd-resultado-sql /> }
          <div class="divisor horizontal" role="separator" aria-orientation="horizontal"
               [class.oculto]="!inferiorVisivel()" (pointerdown)="arrastar($event, 'inferior')"></div>
          <div class="regiao-inferior" [class.oculto]="!inferiorVisivel()"
               [style.height.px]="layout.disposicao().alturaInferior">
            <!-- O terminal fica vivo (só escondido) enquanto o painel do servidor aparece. -->
            <sd-terminal [class.oculto]="!layout.disposicao().visiveis.terminal" />
            @if (layout.disposicao().visiveis.servidor) { <sd-servidor /> }
            @if (layout.disposicao().visiveis.scripts) { <sd-scripts /> }
            @if (layout.disposicao().visiveis.containers) { <sd-containers-painel /> }
          </div>
        </div>

        @if (layout.disposicao().visiveis.conexoes) {
          <div class="divisor vertical fixo" aria-hidden="true"></div>
          <div class="regiao-direita estreita"><sd-conexoes /></div>
        } @else if (layout.disposicao().visiveis.ia) {
          <div class="divisor vertical fixo" aria-hidden="true"></div>
          <div class="regiao-direita"><sd-ia /></div>
        }

      </div>

      @if (layout.tela() === 'git') { <sd-git class="tela-cheia" /> }
      @if (layout.tela() === 'merge') { <sd-merge class="tela-cheia" /> }
      @if (layout.tela() === 'debug') { <sd-tela-debug class="tela-cheia" /> }
      @if (layout.tela() === 'containers') { <sd-tela-containers class="tela-cheia" /> }
      @if (layout.tela() === 'entender') { <sd-tela-entender class="tela-cheia" /> }
      <sd-diff />
      <sd-busca />
      <sd-busca-projeto />
      <sd-commit />
      <sd-github-form />
      <sd-perfil-banco />
      <sd-perfil-servidor />
      <sd-revisao />
      <sd-novo-projeto />
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
  protected readonly editor = inject(EditorService);
  protected readonly busca = inject(BuscaService);
  protected readonly buscaProjeto = inject(BuscaProjetoService);
  protected readonly escolha = inject(EscolhaService);
  protected readonly commit = inject(CommitService);
  protected readonly banco = inject(BancoService);
  protected readonly servidor = inject(ServidorService);
  protected readonly revisao = inject(RevisaoService);
  protected readonly novoProjeto = inject(NovoProjetoService);

  protected inferiorVisivel(): boolean {
    const v = this.layout.disposicao().visiveis;
    return v.terminal || v.servidor || v.scripts || v.containers;
  }

  constructor() {
    inject(AtalhosService).iniciar();
    inject(JdtlsService); // liga o jdtls quando o projeto é de Java
    inject(GitService); // acompanha o repositório do projeto
    inject(MargemGitService); // marcas de alteração na margem do editor
    inject(DepuradorService); // breakpoints e o depurador anexa quando o servidor sobe em debug
    inject(McpService); // o Claude Code (MCP) usa as ferramentas do Seedy
    inject(ExecucaoService); // RUN/DEBUG: acha as classes main quando o jdtls fica pronto
    inject(WebLspService); // projeto web: TypeScript, Angular, ESLint e Prettier
    inject(EntenderService); // Fase 9: arquitetura, regras e o "acompanhar método" (ctrl+.)
    void inject(GithubService).iniciar();
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
