import { Component, computed, inject } from '@angular/core';
import { EditorService } from '../editor/editor.service';
import { ProjetoService } from '../nucleo/projeto.service';
import { BuscaService } from '../busca/busca.service';
import { BuscaProjetoService } from '../busca/busca-projeto.service';
import { JdtlsService } from '../java/jdtls.service';

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
      <span class="segmento modo" [attr.data-modo]="buscando() ? 'busca' : editor.modo()">{{ buscando() ? 'BUSCA' : nomeModo() }}</span>
      @if (projeto.branch()) {
        <span class="segmento com-divisa">{{ projeto.branch() }}</span>
      }
      @if (buscando()) {
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
