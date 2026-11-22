import { Component, computed, inject } from '@angular/core';
import { EditorService } from '../editor/editor.service';
import { ProjetoService } from '../nucleo/projeto.service';
import { BuscaService } from '../busca/busca.service';
import { BuscaProjetoService } from '../busca/busca-projeto.service';
import { CarregandoComponent } from './carregando.component';
import { LimitesUsoComponent } from '../ia/limites-uso.component';
import { AtualizacaoComponent } from '../atualizacao/atualizacao.component';
import { JdtlsService } from '../java/jdtls.service';
import { GitService } from '../git/git.service';
import { LayoutService } from '../layout/layout.service';
import { MergeService } from '../git/merge.service';
import { BancoService, NOME_DO_AMBIENTE } from '../banco/banco.service';
import { ServidorService } from '../servidor/servidor.service';
import { DepuradorService } from '../servidor/depurador.service';
import { WebLspService } from '../web/web-lsp.service';
import { ScriptsService } from '../web/scripts.service';
import { DockerService } from '../containers/docker.service';
import { IaService } from '../ia/ia.service';
import { RevisaoService } from '../ia/revisao.service';
import { McpService } from '../ia/mcp.service';
import { IaMergeService } from '../ia/ia-merge.service';
import { EntenderService } from '../entender/entender.service';
import { TodoService } from '../todo/todo.service';

const NOMES_MODO: Record<string, string> = {
  normal: 'NORMAL',
  insert: 'INSERIR',
  visual: 'VISUAL',
  replace: 'SUBSTITUIR',
};

/** Statusline no estilo lualine: modo, branch, arquivo, linguagem e posição. */
@Component({
  selector: 'sd-barra-status',
  imports: [LimitesUsoComponent, CarregandoComponent, AtualizacaoComponent],
  template: `
    <footer class="barra-status">
      <span class="segmento modo" [attr.data-modo]="modoDaTela()">{{ rotuloDoModo() }}</span>
      @if (projeto.branch()) {
        <span class="segmento com-divisa">{{ projeto.branch() }}@if (git.estado(); as g) {@if (g.aFrente || naTelaGit()) { <span class="suave">↑{{ g.aFrente }}</span>}@if (g.atras || naTelaGit()) { <span class="suave">↓{{ g.atras }}</span>}}</span>
      }
      @if (layout.tela() === 'merge') {
        <span class="segmento dicas-merge">
          <span><span class="tecla">]c</span> próximo</span> <span><span class="tecla">[c</span> anterior</span>
          <span><span class="tecla">dp</span> pegar o seu</span> <span><span class="tecla">do</span> pegar o deles</span>
          <span><span class="tecla">:w</span> concluir merge</span>
          <span><span class="tecla">␣ a</span> IA</span>
        </span>
        <span class="espaco"></span>
        @if (ia.pensando()) {
          <span class="segmento com-divisa-esq destaque-texto">✦ IA pensando…</span>
        } @else if (ia.pendente(); as p) {
          <span class="segmento com-divisa-esq destaque-texto">✦ IA propôs · conflito {{ p.conflito }}</span>
        }
        <span class="segmento com-divisa-esq" [class.conflitos-restantes]="merge.restantes() > 0">
          {{ merge.restantes() }} {{ merge.restantes() === 1 ? 'conflito restante' : 'conflitos restantes' }}
        </span>
        <span class="segmento com-divisa-esq suave">{{ merge.arquivoAtual() + 1 }} de {{ merge.totalDeArquivos() }} {{ merge.totalDeArquivos() === 1 ? 'arquivo' : 'arquivos' }}</span>
      } @else if (layout.tela() === 'entender') {
        <span class="segmento dicas-merge">
          @switch (entender.aba()) {
            @case ('arquitetura') {
              <span><span class="tecla">h j k l</span> blocos</span> <span><span class="tecla">tab</span> métodos</span> <span><span class="tecla">⏎</span> abre</span>
              <span><span class="tecla">c</span> caminho do método</span> <span><span class="tecla">2</span> regras</span> <span><span class="tecla">esc</span> editor</span>
            }
            @case ('regras') {
              <span><span class="tecla">j k</span> regras</span> <span><span class="tecla">⏎</span> abre o código</span> <span><span class="tecla">e</span> edita</span> <span><span class="tecla">v</span> revisada</span>
              <span><span class="tecla">c</span> caminho</span> <span><span class="tecla">a</span> atualiza com IA</span> <span><span class="tecla">esc</span> editor</span>
            }
            @case ('caminho') {
              <span><span class="tecla">h l</span> anda</span> <span><span class="tecla">j k</span> ramos</span> <span><span class="tecla">⏎</span> abre</span>
              <span><span class="tecla">+</span> mais níveis</span> <span><span class="tecla">a</span> IA explica</span> <span><span class="tecla">esc</span> editor</span>
            }
          }
        </span>
        <span class="espaco"></span>
        @if (entender.analisadaEm(); as em) { <span class="segmento com-divisa-esq suave">análise de {{ hhmm(em) }}</span> }
      } @else if (layout.tela() === 'containers') {
        <span class="segmento dicas-merge">
          <span><span class="tecla">s</span> inicia/para</span> <span><span class="tecla">l</span> logs</span> <span><span class="tecla">t</span> terminal</span>
          <span><span class="tecla">b</span> ligar ao banco</span> <span><span class="tecla">m</span> mapa</span> <span><span class="tecla">esc</span> editor</span>
        </span>
        <span class="espaco"></span>
        @if (docker.versao()) { <span class="segmento com-divisa-esq git-mais">● {{ docker.rodando().length }} rodando</span> }
        @if (docker.composeDoProjeto(); as c) { <span class="segmento com-divisa-esq suave">compose {{ c }}</span> }
      } @else if (layout.tela() === 'debug') {
        <span class="segmento dicas-merge">
          <span><span class="tecla">F9</span> continuar</span> <span><span class="tecla">F8</span> passar</span>
          <span><span class="tecla">F7</span> entrar</span> <span><span class="tecla">ctrl+F8</span> breakpoint</span>
          <span><span class="tecla">alt F8</span> avaliar</span> <span><span class="tecla">esc</span> editor</span>
        </span>
        <span class="espaco"></span>
        @if (depurador.sessao()?.semDebug === false) { <span class="segmento com-divisa-esq git-mais">↻ hot reload</span> }
        @if (depurador.sessao(); as s) { <span class="segmento com-divisa-esq suave">{{ s.nome }}@if (s.porta) { · :{{ s.porta }}}</span> }
        @if (depurador.localAtual(); as l) { <span class="segmento com-divisa-esq posicao">{{ l.linha }}</span> }
      } @else if (naTelaGit()) {
        <span class="espaco"></span>
        @if (git.ocupado(); as o) { <span class="segmento com-divisa-esq git-ocupado">{{ o }}…</span> }
        @if (git.remoto(); as r) { <span class="segmento com-divisa-esq">{{ r.nome }} · {{ r.host }}</span> }
        <span class="segmento com-divisa-esq suave">{{ git.totalDeCommits() }} commits</span>
      } @else if (buscando()) {
        <span class="espaco"></span>
        <span class="segmento com-divisa-esq">
          @if (busca.indexando() && !busca.indice()) { indexando… } @else { índice: {{ busca.totalIndice().toLocaleString('pt-BR') }} itens ✓ }
        </span>
        <sd-carregando />
        @if (jdtls.estado().fase !== 'inativo') {
          <span class="segmento com-divisa-esq jdtls" [attr.data-fase]="jdtls.estado().fase">{{ textoJdtls() }}</span>
        }
      } @else {
      @if (buffer(); as b) {
        <span class="segmento">{{ caminhoRelativo() }}@if (editor.sujo(b)) {<span class="sujo">[+]</span>}</span>
      }
      <span class="espaco"></span>
      <sd-carregando />
      @if (jdtls.estado().fase !== 'inativo') {
        <span class="segmento com-divisa-esq jdtls" [attr.data-fase]="jdtls.estado().fase" [title]="tituloJdtls()">{{ textoJdtls() }}</span>
      }
      @if (docker.visivel() && docker.versao()) {
        <span class="segmento com-divisa-esq servidor-status" data-fase="rodando">● docker {{ docker.rodando().length }}</span>
      }
      @for (e of scripts.rodando(); track e.nome) {
        <span class="segmento com-divisa-esq servidor-status" data-fase="rodando">● npm {{ e.nome === '__install__' ? 'install' : e.nome }}{{ portaDe(e.url) }}</span>
      }
      @if (web.ativo() && web.fase() !== 'inativo') {
        <span class="segmento com-divisa-esq" [title]="web.detalhe()">{{ textoWeb() }}</span>
        @if (web.web()?.prettier) { <span class="segmento com-divisa-esq suave">prettier ao salvar</span> }
      }
      @for (e of servidor.rodando(); track e.perfilId) {
        <span class="segmento com-divisa-esq servidor-status" [attr.data-fase]="e.fase">● {{ servidor.perfil(e.perfilId)?.tipo === 'tomcat' ? 'tomcat' : 'jboss' }} :{{ servidor.perfil(e.perfilId)?.portaHttp }}</span>
        @if (e.info?.portaDebug) {
          <span class="segmento com-divisa-esq" [class.destaque-texto]="depurador.ativo()">debug :{{ e.info?.portaDebug }}@if (depurador.pausado()) { <span class="aviso-texto"> · pausado</span> }</span>
        }
      }
      @if (textoDaIa(); as t) { <span class="segmento com-divisa-esq destaque-texto">{{ t }}</span> }
      @if (banco.perfilAtivo(); as p) {
        <span class="segmento com-divisa-esq ambiente-banco" [attr.data-ambiente]="p.ambiente">{{ nomeDoAmbiente(p.ambiente).toUpperCase() }}</span>
        <span class="segmento com-divisa-esq">{{ p.tipo }}@if (!banco.sessaoAtiva()) { <span class="suave"> · desconectado</span> }</span>
        @if (banco.sessaoAtiva()?.tunel) { <span class="segmento com-divisa-esq">ssh ✓</span> }
      }
      @if (buffer(); as b) {
        <span class="segmento com-divisa-esq suave">UTF-8 · {{ fimDeLinha() }} · {{ b.modelo.getLanguageId() }}</span>
        <span class="segmento com-divisa-esq posicao">{{ editor.cursor().linha }}:{{ editor.cursor().coluna }}</span>
      } @else {
        <span class="segmento com-divisa-esq suave">seedy</span>
      }
      }
      @if (layout.tela() !== 'editor') { <sd-carregando /> }
      <sd-atualizacao />
      <sd-limites-uso />
    </footer>
  `,
})
export class BarraStatusComponent {
  protected readonly editor = inject(EditorService);
  protected readonly projeto = inject(ProjetoService);
  protected readonly busca = inject(BuscaService);
  private readonly buscaProjeto = inject(BuscaProjetoService);
  protected readonly jdtls = inject(JdtlsService);
  protected readonly textoJdtls = computed(() => {
    const e = this.jdtls.estado();
    return e.fase === 'pronto' ? 'jdtls ✓' : e.fase === 'erro' || e.fase === 'sem-java' ? `jdtls ✗ ${e.detalhe ?? ''}` : `jdtls ${e.detalhe ?? '…'}`;
  });
  protected readonly tituloJdtls = computed(() => {
    const fase = this.jdtls.estado().fase;
    return fase === 'erro' ? 'O jdtls parou ou deu erro: ␣ l reinicia' : fase === 'navegador' ? 'O jdtls só roda dentro do app (npm run dev)' : 'Eclipse JDT Language Server';
  });
  protected readonly git = inject(GitService);
  protected readonly layout = inject(LayoutService);
  protected readonly merge = inject(MergeService);
  protected readonly ia = inject(IaMergeService);
  protected readonly banco = inject(BancoService);
  protected readonly servidor = inject(ServidorService);
  protected readonly depurador = inject(DepuradorService);
  protected readonly web = inject(WebLspService);
  protected readonly scripts = inject(ScriptsService);
  protected readonly docker = inject(DockerService);
  protected readonly entender = inject(EntenderService);
  protected readonly todo = inject(TodoService);

  protected hhmm(d: Date): string {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  protected readonly iaGeral = inject(IaService);
  protected readonly revisao = inject(RevisaoService);
  protected readonly mcp = inject(McpService);

  /** O que a IA está fazendo, para o segmento da statusline (mockup 06). */
  protected textoDaIa(): string | null {
    if (this.iaGeral.pensando()) return '✦ IA trabalhando…';
    if (this.revisao.pendentes()) return `✦ IA aguardando você (␣ y)`;
    const m = this.mcp.ultima();
    if (m && Date.now() - m.quando < 60_000) return `✦ Claude Code: ${m.rotulo}`;
    return null;
  }

  /** "ts ✓ · angular ✓ · eslint 1" (mockup 13). */
  protected textoWeb(): string {
    const f = this.web.fase();
    if (f === 'sem-node') return 'web: sem Node';
    if (f === 'instalando') return 'web: instalando…';
    if (f === 'erro') return 'web: erro';
    const s = this.web.servidores();
    const partes = [`ts ${s.ts?.pronto ? '✓' : '…'}`];
    if (this.web.web()?.angular) partes.push(`angular ${s.angular?.pronto ? '✓' : '…'}`);
    if (this.web.web()?.eslint) partes.push(`eslint ${s.eslint?.pronto ? (this.web.avisosEslint() || '✓') : '…'}`);
    return partes.join(' · ');
  }

  protected portaDe(url: string | null): string {
    const m = url ? /:(\d+)/.exec(url.replace(/^https?:\/\//, '')) : null;
    return m ? ` :${m[1]}` : '';
  }

  protected nomeDoAmbiente(a: string): string {
    return NOME_DO_AMBIENTE[a] ?? a;
  }
  protected readonly naTelaGit = computed(() => this.layout.tela() === 'git');
  protected readonly modoDaTela = computed(() =>
    this.todo.aberto() ? 'todo' : this.layout.tela() === 'git' ? 'git' : this.layout.tela() === 'merge' ? 'merge' : this.layout.tela() === 'debug' ? 'debug' : this.layout.tela() === 'containers' ? 'docker' : this.layout.tela() === 'entender' ? 'entender' : this.layout.tela() === 'config' ? 'entender' : this.layout.tela() === 'testes' ? 'testes' : this.layout.tela() === 'endpoints' ? 'testes' : this.buscando() ? 'busca' : this.editor.modo(),
  );
  protected readonly rotuloDoModo = computed(() =>
    this.todo.aberto() ? 'TODO' : this.layout.tela() === 'git' ? 'GIT' : this.layout.tela() === 'merge' ? 'MERGE' : this.layout.tela() === 'debug' ? 'DEBUG' : this.layout.tela() === 'containers' ? 'DOCKER' : this.layout.tela() === 'entender' ? this.entender.aba().toUpperCase() : this.layout.tela() === 'config' ? 'CONFIG' : this.layout.tela() === 'testes' ? 'TESTES' : this.layout.tela() === 'endpoints' ? 'ENDPOINTS' : this.buscando() ? 'BUSCA' : this.nomeModo(),
  );
  protected readonly buscando = computed(() => this.busca.aberta() || this.buscaProjeto.aberta());

  protected readonly buffer = this.editor.bufferAtivo;
  protected readonly nomeModo = computed(() => NOMES_MODO[this.editor.modo()] ?? this.editor.modo().toUpperCase());
  protected readonly caminhoRelativo = computed(() => {
    const b = this.buffer();
    const raiz = this.projeto.raiz();
    if (!b) return '';
    if (b.somenteLeitura) return `${b.descricao ?? b.nome} (somente leitura)`;
    return raiz && b.caminho.startsWith(raiz) ? b.caminho.slice(raiz.length + 1).replace(/\\/g, '/') : b.caminho;
  });
  protected readonly fimDeLinha = computed(() => {
    this.editor.edicoes();
    return this.buffer()?.modelo.getEOL() === '\r\n' ? 'CRLF' : 'LF';
  });
}
