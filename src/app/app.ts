import { Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { BarraTopoComponent } from './barra/barra-topo.component';
import { BarraStatusComponent } from './barra/barra-status.component';
import { MenuLiderComponent } from './barra/menu-lider.component';
import { VimAjudaComponent } from './vim/vim-ajuda.component';
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
import { IdPainel, LayoutService, NOME_DA_REGIAO, PAINEIS, Regiao } from './layout/layout.service';
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
import { TelaTestesComponent } from './testes/tela-testes.component';
import { TelaEndpointsComponent } from './endpoints/tela-endpoints.component';
import { LoginEndpointsComponent } from './endpoints/login-endpoints.component';
import { EndpointsService } from './endpoints/endpoints.service';
import { TestesService } from './testes/testes.service';
import { TelaConfiguracoesComponent } from './config/tela-configuracoes.component';
import { BookmarksService } from './editor/bookmarks.service';
import { MenuRegraComponent } from './testes/menu-regra.component';
import { ToastsComponent } from './nucleo/toasts.component';
import { ErroComponent } from './notificacoes/erro.component';
import { ListaDeNotificacoesComponent } from './notificacoes/lista.component';
import { CompletarService } from './completar/completar.service';
import { PerguntaDoCompletarComponent } from './completar/pergunta.component';
import { resumoDoPanico } from './notificacoes/relatorio';
import { ponte } from './nucleo/ponte';
import { MenuGutterComponent } from './editor/menu-gutter.component';
import { MenuAnexoComponent } from './ia/menu-anexo.component';
import { DivisoresService } from './layout/divisores.service';
import { TelaEntenderComponent } from './entender/tela-entender.component';
import { EntenderService } from './entender/entender.service';
import { BarraIconesComponent } from './todo/barra-icones.component';
import { TodoPainelComponent } from './todo/todo-painel.component';
import { TodoService } from './todo/todo.service';
import { ConfigService } from './config/config.service';
import { InicioComponent } from './inicio/inicio.component';
import { AberturaService } from './inicio/abertura';
import { OpcoesExecucaoComponent } from './execucao/opcoes-execucao.component';

@Component({
  selector: 'sd-raiz',
  imports: [PerguntaDoCompletarComponent, 
    NgTemplateOutlet, BarraTopoComponent, BarraStatusComponent, MenuLiderComponent, VimAjudaComponent, ArvoreComponent, EditorComponent, TerminalComponent,
    BuscaComponent, BuscaProjetoComponent, EscolhaComponent, GitComponent, DiffComponent, CommitComponent,
    GithubFormComponent, MergeComponent, ConexoesComponent, ResultadoSqlComponent, PerfilBancoComponent,
    ServidorComponent, PerfilServidorComponent, IaComponent, RevisaoComponent, TelaDebugComponent, NovoProjetoComponent, ScriptsComponent, TelaContainersComponent, ContainersPainelComponent, TelaEntenderComponent, TelaConfiguracoesComponent, TelaTestesComponent, TelaEndpointsComponent, LoginEndpointsComponent, MenuGutterComponent, MenuAnexoComponent, MenuRegraComponent, ToastsComponent, ErroComponent, ListaDeNotificacoesComponent, BarraIconesComponent, TodoPainelComponent, OpcoesExecucaoComponent, InicioComponent,
  ],
  template: `
    <div class="seedy" [class.so-inicio]="semProjeto()">
      <!-- Sem projeto: a tela de início toma o lugar das barras e do editor (mockup 30). -->
      @if (!semProjeto()) { <sd-barra-topo /> }

      <div class="regiao-principal" [class.esmaecida]="busca.aberta() || buscaProjeto.aberta() || !!escolha.pedido() || commit.aberta() || !!banco.editando() || !!servidor.editando() || revisao.aberta() || novoProjeto.aberta() || !!execucao.editandoOpcoes()">
      @if (semProjeto()) { <sd-inicio /> } @else { <sd-barra-icones /> }
      <!-- Painel de cada região (o terminal fica vivo, só escondido, na região dele). -->
      <ng-template #painel let-regiao>
        @if (layout.terminalEm(regiao)) { <sd-terminal [class.oculto]="!layout.disposicao().visiveis.terminal" /> }
        @switch (layout.ativoEm(regiao)) {
          @case ('arquivos') { <sd-arvore /> }
          @case ('conexoes') { <sd-conexoes /> }
          @case ('servidor') { <sd-servidor /> }
          @case ('scripts') { <sd-scripts /> }
          @case ('containers') { <sd-containers-painel /> }
          @case ('ia') { @if (layout.tela() === 'editor' || layout.tela() === 'merge') { <sd-ia /> } }
        }
      </ng-template>

      <div #area class="area-principal" [class.oculto]="layout.tela() !== 'editor' || semProjeto()">
        <div class="regiao-esquerda" [class.oculto]="!layout.ativos().esquerda" [style.width.px]="layout.tamanho('esquerda')" (pointerdown)="pegarPainel($event, 'esquerda')">
          <ng-container *ngTemplateOutlet="painel; context: { $implicit: 'esquerda' }" />
        </div>
        <div class="divisor vertical" role="separator" aria-orientation="vertical" [class.oculto]="!layout.ativos().esquerda" (pointerdown)="arrastar($event, 'esquerda')"></div>

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
               [class.oculto]="!layout.ativos().inferior" (pointerdown)="arrastar($event, 'inferior')"></div>
          <div class="regiao-inferior" [class.oculto]="!layout.ativos().inferior" [style.height.px]="layout.tamanho('inferior')" (pointerdown)="pegarPainel($event, 'inferior')">
            <ng-container *ngTemplateOutlet="painel; context: { $implicit: 'inferior' }" />
          </div>
        </div>

        <div class="divisor vertical" role="separator" aria-orientation="vertical" [class.oculto]="!layout.ativos().direita" (pointerdown)="arrastar($event, 'direita')"></div>
        <div class="regiao-direita" [class.oculto]="!layout.ativos().direita" [style.width.px]="layout.tamanho('direita')" (pointerdown)="pegarPainel($event, 'direita')">
          <ng-container *ngTemplateOutlet="painel; context: { $implicit: 'direita' }" />
        </div>

        @if (arrastandoPainel(); as a) {
          <!-- Arrastando um painel pela faixa: solte numa das três regiões. -->
          <div class="layout-alvos" aria-hidden="true">
            <div class="layout-alvo esquerda" [class.sobre]="a.alvo === 'esquerda'"><span>{{ a.titulo }} à esquerda</span></div>
            <div class="layout-alvo inferior" [class.sobre]="a.alvo === 'inferior'"><span>{{ a.titulo }} embaixo</span></div>
            <div class="layout-alvo direita" [class.sobre]="a.alvo === 'direita'"><span>{{ a.titulo }} à direita</span></div>
          </div>
        }
      </div>

      @if (layout.tela() === 'git') { <sd-git class="tela-cheia" /> }
      @if (layout.tela() === 'merge') { <sd-merge class="tela-cheia" /> }
      @if (layout.tela() === 'debug') { <sd-tela-debug class="tela-cheia" /> }
      @if (layout.tela() === 'containers') { <sd-tela-containers class="tela-cheia" /> }
      @if (layout.tela() === 'entender') { <sd-tela-entender class="tela-cheia" /> }
      @if (layout.tela() === 'config') { <sd-tela-configuracoes class="tela-cheia" /> }
      @if (layout.tela() === 'testes') { <sd-tela-testes class="tela-cheia" /> }
      @if (layout.tela() === 'endpoints') { <sd-tela-endpoints class="tela-cheia" /> }
      @if (layout.tela() !== 'editor' && layout.tela() !== 'merge' && layout.disposicao().visiveis.ia) {
        <!-- A IA acompanha todas as telas cheias, do lado direito. -->
        <div class="divisor vertical" role="separator" aria-orientation="vertical" (pointerdown)="arrastarIa($event)"></div>
        <div class="regiao-direita ia-lateral" [style.width.px]="layout.larguraDoPainel('ia')"><sd-ia /></div>
      }
      <sd-diff />
      <sd-menu-gutter />
      <sd-menu-regra />
      <sd-menu-anexo />
      <sd-busca />
      <sd-busca-projeto />
      <sd-commit />
      <sd-github-form />
      <sd-perfil-banco />
      <sd-perfil-servidor />
      <sd-opcoes-execucao />
      <sd-revisao />
      <sd-novo-projeto />
      <sd-escolha />
      <sd-login-endpoints />
      @if (todo.aberto()) { <sd-todo-painel /> }
      </div>

      @if (!semProjeto()) { <sd-barra-status /> }
      <!-- Avisos: fora da região principal, para valerem por cima de qualquer janela aberta. -->
      <sd-completar-pergunta />
      <sd-notificacoes />
      <sd-erro />
      <sd-toasts />

      <sd-menu-lider />
      <sd-vim-ajuda />
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
  protected readonly todo = inject(TodoService);
  protected readonly execucao = inject(ExecucaoService);

  private readonly area = viewChild.required<ElementRef<HTMLElement>>('area');
  protected readonly arrastandoPainel = signal<{ id: IdPainel; titulo: string; alvo: Regiao | null } | null>(null);

  private readonly projeto = inject(ProjetoService);
  /** Sem pasta aberta, na tela do editor: mostra a tela de início. */
  protected readonly semProjeto = computed(() => this.projeto.pronto() && !this.projeto.raiz() && this.layout.tela() === 'editor');

  constructor() {
    inject(AtalhosService).iniciar();
    inject(JdtlsService); // liga o jdtls quando o projeto é de Java
    inject(GitService); // acompanha o repositório do projeto
    inject(MargemGitService); // marcas de alteração na margem do editor
    inject(DepuradorService); // breakpoints e o depurador anexa quando o servidor sobe em debug
    inject(McpService); // o Claude Code (MCP) usa as ferramentas do Seedy
    inject(ExecucaoService); // RUN/DEBUG: acha as classes main quando o jdtls fica pronto
    inject(WebLspService); // projeto web: TypeScript, Angular, ESLint e Prettier
    inject(TestesService); // testes: tela (Alt+Shift+T) e a cobertura das regras
    inject(EndpointsService); // endpoints do Spring: tela (Alt+Shift+E), só em projeto Spring Boot
    inject(BookmarksService); // bookmarks no código (Ctrl+F2, Alt+2)
    inject(DivisoresService); // arrastar o vão entre painéis em qualquer tela cheia
    inject(EntenderService); // Fase 9: arquitetura, regras e o "acompanhar método" (ctrl+.)
    void inject(GithubService).iniciar();
    void inject(TemaService).iniciar();
    void inject(ConfigService).iniciar();
    void this.projeto.iniciar();
    // O núcleo avisa quando algo quebra nele (pânico no Rust).
    void ponte.aoFalhar((detalhe) => this.mensagens.falha(`o núcleo do Seedy falhou: ${resumoDoPanico(detalhe)}`, detalhe));
    // E se o pânico derrubou o app, o aviso fica para esta abertura.
    void ponte.falhaAnterior().then((f) => {
      if (!f) return;
      const quando = new Date(f.quando).toLocaleString('pt-BR');
      this.mensagens.falha(
        `o Seedy fechou com um erro: ${resumoDoPanico(f.detalhe)}`,
        `No Seedy ${f.versao}, em ${quando}.\n${f.detalhe}`,
      );
    });
    // Antes do acompanhamento da abertura: a janela já aparece no tamanho certo.
    effect(() => {
      // Enquanto o projeto não está pronto não se sabe qual das duas é.
      if (!this.projeto.pronto()) return;
      // O novo projeto não cabe no cartão: enquanto está aberto, a janela volta ao tamanho de trabalho.
      void ponte.janela.inicio(this.semProjeto() && !this.novoProjeto.aberta());
    });
    inject(CompletarService).iniciar(); // texto fantasma enquanto digita
    inject(AberturaService).acompanhar();
  }

  /**
   * Arrastar a faixa de título de um painel: depois de uns pixels aparecem as três regiões;
   * soltar numa delas muda o painel de lugar (Alt+Shift+L faz o mesmo pelo teclado).
   */
  protected pegarPainel(inicio: PointerEvent, regiao: Regiao): void {
    const alvo = inicio.target as HTMLElement;
    if (inicio.button !== 0 || !alvo.closest('.painel-faixa') || alvo.closest('button, input, textarea, select, a, kbd, [role="tab"], .aba-terminal')) return;
    const id = this.layout.ativos()[regiao];
    if (!id) return;
    const titulo = PAINEIS.find((p) => p.id === id)!.titulo;
    let comecou = false;
    const mover = (e: PointerEvent) => {
      if (!comecou && Math.hypot(e.clientX - inicio.clientX, e.clientY - inicio.clientY) < 8) return;
      if (!comecou) {
        comecou = true;
        document.body.classList.add('arrastando-painel');
      }
      const r = this.area().nativeElement.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      const sobre: Regiao | null = x < 0.22 ? 'esquerda' : x > 0.78 ? 'direita' : y > 0.62 ? 'inferior' : null;
      this.arrastandoPainel.set({ id, titulo, alvo: sobre });
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      document.body.classList.remove('arrastando-painel');
      const a = this.arrastandoPainel();
      this.arrastandoPainel.set(null);
      if (a?.alvo && a.alvo !== regiao) {
        this.layout.mover(a.id, a.alvo);
        this.mensagens.mostrar(`${a.titulo} ${NOME_DA_REGIAO[a.alvo]}`);
      }
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  }

  /** O divisor da IA ao lado das telas cheias. */
  protected arrastarIa(inicio: PointerEvent): void {
    inicio.preventDefault();
    const base = this.layout.larguraDoPainel('ia');
    const mover = (e: PointerEvent) => this.layout.redimensionarPainel('ia', base - (e.clientX - inicio.clientX));
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      document.body.classList.remove('arrastando');
    };
    document.body.classList.add('arrastando');
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  }

  /** Arrastar o divisor redimensiona o painel da região. */
  protected arrastar(inicio: PointerEvent, regiao: Regiao): void {
    inicio.preventDefault();
    const base = this.layout.tamanho(regiao);
    const mover = (e: PointerEvent) =>
      this.layout.redimensionar(
        regiao,
        regiao === 'esquerda' ? base + (e.clientX - inicio.clientX) : regiao === 'direita' ? base - (e.clientX - inicio.clientX) : base - (e.clientY - inicio.clientY),
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
