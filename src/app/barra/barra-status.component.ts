import { Component, computed, inject } from '@angular/core';
import { EditorService } from '../editor/editor.service';
import { ProjetoService } from '../nucleo/projeto.service';
import { BuscaService } from '../busca/busca.service';
import { BuscaProjetoService } from '../busca/busca-projeto.service';
import { JdtlsService } from '../java/jdtls.service';
import { GitService } from '../git/git.service';
import { LayoutService } from '../layout/layout.service';
import { MergeService } from '../git/merge.service';
import { IaMergeService } from '../ia/ia-merge.service';

const NOMES_MODO: Record<string, string> = {
  normal: 'NORMAL',
  insert: 'INSERIR',
  visual: 'VISUAL',
  replace: 'SUBSTITUIR',
};

/** Statusline no estilo lualine: modo, branch, arquivo, linguagem e posição. */
@Component({
  selector: 'sd-barra-status',
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
        @if (jdtls.estado().fase !== 'inativo') {
          <span class="segmento com-divisa-esq jdtls" [attr.data-fase]="jdtls.estado().fase">{{ textoJdtls() }}</span>
        }
      } @else {
      @if (buffer(); as b) {
        <span class="segmento">{{ caminhoRelativo() }}@if (editor.sujo(b)) {<span class="sujo">[+]</span>}</span>
      }
      <span class="espaco"></span>
      @if (jdtls.estado().fase !== 'inativo') {
        <span class="segmento com-divisa-esq jdtls" [attr.data-fase]="jdtls.estado().fase" [title]="tituloJdtls()">{{ textoJdtls() }}</span>
      }
      @if (buffer(); as b) {
        <span class="segmento com-divisa-esq suave">UTF-8 · {{ fimDeLinha() }} · {{ b.modelo.getLanguageId() }}</span>
        <span class="segmento com-divisa-esq posicao">{{ editor.cursor().linha }}:{{ editor.cursor().coluna }}</span>
      } @else {
        <span class="segmento com-divisa-esq suave">seedy</span>
      }
      }
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
  protected readonly naTelaGit = computed(() => this.layout.tela() === 'git');
  protected readonly modoDaTela = computed(() =>
    this.layout.tela() === 'git' ? 'git' : this.layout.tela() === 'merge' ? 'merge' : this.buscando() ? 'busca' : this.editor.modo(),
  );
  protected readonly rotuloDoModo = computed(() =>
    this.layout.tela() === 'git' ? 'GIT' : this.layout.tela() === 'merge' ? 'MERGE' : this.buscando() ? 'BUSCA' : this.nomeModo(),
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
