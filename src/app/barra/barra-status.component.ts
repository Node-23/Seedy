import { Component, computed, inject } from '@angular/core';
import { EditorService } from '../editor/editor.service';
import { ProjetoService } from '../nucleo/projeto.service';
import { BuscaService } from '../busca/busca.service';
import { BuscaProjetoService } from '../busca/busca-projeto.service';

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
      } @else {
      @if (buffer(); as b) {
        <span class="segmento">{{ caminhoRelativo() }}@if (editor.sujo(b)) {<span class="sujo">[+]</span>}</span>
      }
      <span class="espaco"></span>
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
  protected readonly buscando = computed(() => this.busca.aberta() || this.buscaProjeto.aberta());

  protected readonly buffer = this.editor.bufferAtivo;
  protected readonly nomeModo = computed(() => NOMES_MODO[this.editor.modo()] ?? this.editor.modo().toUpperCase());
  protected readonly caminhoRelativo = computed(() => {
    const b = this.buffer();
    const raiz = this.projeto.raiz();
    if (!b) return '';
    return raiz && b.caminho.startsWith(raiz) ? b.caminho.slice(raiz.length + 1).replace(/\\/g, '/') : b.caminho;
  });
  protected readonly fimDeLinha = computed(() => {
    this.editor.edicoes();
    return this.buffer()?.modelo.getEOL() === '\r\n' ? 'CRLF' : 'LF';
  });
}
