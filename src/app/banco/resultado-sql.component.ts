import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { BancoService } from './banco.service';
import { EditorService } from '../editor/editor.service';
import { MensagensService } from '../nucleo/mensagens.service';

const NUMERICO = /^(int|integer|bigint|smallint|tinyint|mediumint|int2|int4|int8|numeric|decimal|number|float|float4|float8|double|real|money|serial|bigserial)/i;

/**
 * Resultado da consulta do .sql ativo (mockup 03): grade somente leitura. Teclado na
 * grade: j/k/h/l andam, y copia a célula, Y copia a linha, esc volta ao editor.
 */
@Component({
  selector: 'sd-resultado-sql',
  template: `
    <section class="painel resultado-sql" aria-label="Resultado da consulta">
      <div class="painel-faixa">
        <span class="rotulo">RESULTADO</span>
        @if (estado(); as e) {
          @if (e.executando) { <span class="destaque-texto">executando…</span> }
          @else if (e.resultado; as r) {
            @if (r.colunas.length) {
              <span class="forte">{{ r.linhas.length }}{{ r.cortado ? '+' : '' }} {{ r.linhas.length === 1 ? 'linha' : 'linhas' }} · {{ r.ms }} ms</span>
              @if (r.cortado) { <span class="suave">(mostrando as primeiras {{ r.linhas.length }}; exportar csv traz tudo)</span> }
            } @else { <span class="forte">{{ r.ms }} ms</span> }
          }
        }
        <span class="espaco"></span>
        <button class="botao" (click)="banco.exportarCsv()">exportar csv</button>
        <button class="botao" (click)="banco.historico()">histórico</button>
      </div>

      <div class="resultado-corpo" tabindex="0" (keydown)="teclar($event)" aria-label="Grade de resultado">
        @if (estado(); as e) {
          @if (e.erro) {
            <div class="resultado-erro">{{ e.erro }}</div>
          } @else if (e.resultado; as r) {
            @if (r.colunas.length) {
              <table class="grade-sql">
                <thead>
                  <tr>
                    <th class="num">#</th>
                    @for (c of r.colunas; track $index) {
                      <th [class.numero]="numerica()[$index]">{{ c.nome }} @if (c.tipo) { <span class="tipo-coluna">{{ c.tipo }}</span> }</th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (linha of r.linhas; track $index; let i = $index) {
                    <tr [class.selecionada]="i === sel().linha" (click)="sel.set({ linha: i, coluna: sel().coluna })">
                      <td class="num">{{ i + 1 }}</td>
                      @for (v of linha; track $index; let j = $index) {
                        <td [class.numero]="numerica()[j]" [class.nulo]="v === null"
                            [class.celula-atual]="i === sel().linha && j === sel().coluna"
                            (click)="sel.set({ linha: i, coluna: j })">{{ v === null ? 'null' : v }}</td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
              @if (!r.linhas.length) { <div class="resultado-vazio suave">nenhuma linha</div> }
            } @else {
              <div class="resultado-vazio">
                <span class="git-mais">✓</span>
                {{ r.afetadas === null ? 'executado' : r.afetadas + (r.afetadas === 1 ? ' linha alterada' : ' linhas alteradas') }}
              </div>
            }
          }
        } @else {
          <div class="resultado-vazio suave">
            <kbd>ctrl ⏎</kbd> executa a instrução sob o cursor (ou a seleção) · <kbd>␣ d</kbd> conexões
          </div>
        }
      </div>
      <div class="resultado-rodape suave">🔒 grade somente leitura — alterações só por SQL</div>
    </section>
  `,
})
export class ResultadoSqlComponent {
  protected readonly banco = inject(BancoService);
  private readonly editor = inject(EditorService);
  private readonly mensagens = inject(MensagensService);

  protected readonly estado = this.banco.resultadoAtivo;
  protected readonly sel = signal({ linha: 0, coluna: 0 });
  protected readonly numerica = computed(() => (this.estado()?.resultado?.colunas ?? []).map((c) => NUMERICO.test(c.tipo)));

  constructor() {
    // Resultado novo: seleção volta ao começo.
    effect(() => {
      this.estado()?.resultado;
      untracked(() => this.sel.set({ linha: 0, coluna: 0 }));
    });
  }

  protected teclar(e: KeyboardEvent): void {
    const r = this.estado()?.resultado;
    if (e.key === 'Escape') {
      this.editor.focar();
      e.preventDefault();
      return;
    }
    if (!r?.colunas.length || e.ctrlKey || e.altKey || e.metaKey) return;
    const { linha, coluna } = this.sel();
    const ir = (l: number, c: number) => {
      const nl = Math.max(0, Math.min(r.linhas.length - 1, l));
      const nc = Math.max(0, Math.min(r.colunas.length - 1, c));
      this.sel.set({ linha: nl, coluna: nc });
      queueMicrotask(() => document.querySelector('.grade-sql .celula-atual')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    };
    switch (e.key) {
      case 'j':
      case 'ArrowDown':
        ir(linha + 1, coluna);
        break;
      case 'k':
      case 'ArrowUp':
        ir(linha - 1, coluna);
        break;
      case 'l':
      case 'ArrowRight':
        ir(linha, coluna + 1);
        break;
      case 'h':
      case 'ArrowLeft':
        ir(linha, coluna - 1);
        break;
      case 'g':
        ir(0, coluna);
        break;
      case 'G':
        ir(r.linhas.length - 1, coluna);
        break;
      case 'y':
        void this.copiar(r.linhas[linha]?.[coluna] ?? 'null', 'célula copiada');
        break;
      case 'Y':
        void this.copiar((r.linhas[linha] ?? []).map((v) => v ?? '').join('\t'), 'linha copiada');
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  private async copiar(texto: string, aviso: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(texto);
      this.mensagens.mostrar(aviso);
    } catch {
      this.mensagens.erro('não consegui copiar');
    }
  }
}
