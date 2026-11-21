import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { IaService } from './ia.service';
import { RevisaoService } from './revisao.service';
import { MarkdownComponent } from './markdown.component';
import { AutomaticoService } from './automatico.service';
import { McpService } from './mcp.service';
import { trechos } from './trechos';
import { EditorService } from '../editor/editor.service';
import { ServidorService } from '../servidor/servidor.service';
import { BancoService } from '../banco/banco.service';
import { LayoutService } from '../layout/layout.service';
import { nomeBase } from '../nucleo/ponte';

/**
 * Painel de IA (mockup 06, ␣ a): a conversa opera a IDE pelas ferramentas; propostas de
 * edição viram cartões de diff (⏎ aplica, esc recusa). Com o campo vazio, ⏎ aplica a
 * proposta pendente; ctrl+l começa outra conversa.
 */
@Component({
  selector: 'sd-ia',
  imports: [MarkdownComponent],
  template: `
    <section class="painel ia-painel" aria-label="Assistente de IA">
      <div class="painel-faixa">
        <span class="rotulo destaque-texto">✦ IA</span>
        <span class="espaco"></span>
        <label class="ia-automatico" [class.ligado]="auto.ligado()" title="Modo automático: a IA aplica edições e roda comandos sem pedir confirmação (␣ Y). O que ela muda fica em ␣ y para revisar.">
          <input type="checkbox" [checked]="auto.ligado()" (change)="auto.definir($any($event.target).checked)" /> automático
        </label>
        <button class="botao-icone ia-mcp" title="copiar o comando que liga o Claude Code (terminal) às ferramentas do Seedy" (click)="mcp.copiarComandoDoClaudeCode()">MCP</button>
        <kbd>␣ a</kbd>
      </div>

      <div #lista class="ia-conversa" aria-live="polite">
        @for (item of ia.itens(); track $index) {
          @switch (item.tipo) {
            @case ('usuario') { <div class="ia-usuario">{{ item.texto }}</div> }
            @case ('texto') { @if (item.texto) { <div class="ia-texto"><sd-markdown [texto]="item.texto" /></div> } }
            @case ('ferramentas') {
              <div class="ia-ferramentas">
                @for (p of item.passos; track $index) {
                  <div class="ia-passo">
                    <span [class.git-mais]="p.ok === true" [class.git-menos]="p.ok === false" [class.suave]="p.ok === null">{{ p.ok === null ? '…' : p.ok ? '✓' : '✕' }}</span>
                    <span class="destaque-texto ia-passo-nome">{{ p.rotulo }}</span>
                    <span class="suave">{{ p.detalhe }}</span>
                  </div>
                }
              </div>
            }
            @case ('proposta') {
              @if (alteracao(item.alteracao); as a) {
                <div class="ia-proposta" [attr.data-estado]="a.estado">
                  <div class="ia-proposta-titulo">
                    <span>{{ nome(a.caminho) }}</span>
                    <span class="espaco"></span>
                    <span class="git-mais">+{{ diff(a.id).mais }}</span> <span class="git-menos">−{{ diff(a.id).menos }}</span>
                  </div>
                  <div class="ia-proposta-codigo">
                    @for (l of diff(a.id).linhas; track $index) {
                      <div class="git-diff-linha" [attr.data-tipo]="l.tipo === 'corte' ? 'contexto' : l.tipo">
                        <span class="git-diff-sinal">{{ l.tipo === 'mais' ? '+' : l.tipo === 'menos' ? '−' : '' }}</span><span [class.suave]="l.tipo === 'corte'">{{ l.texto }}</span>
                      </div>
                    }
                  </div>
                  @if (a.estado === 'pendente') {
                    <div class="ia-proposta-acoes">
                      <button class="botao destaque" (click)="revisao.aceitar(a.id)">aplicar <kbd>⏎</kbd></button>
                      <button class="botao" (click)="revisao.recusar(a.id)">recusar <kbd>esc</kbd></button>
                      <button class="botao" (click)="revisao.verDiff(a.id)">ver no editor</button>
                    </div>
                  } @else {
                    <div class="ia-proposta-acoes suave">{{ a.estado === 'aceita' ? '✓ aplicada' : 'recusada' }}</div>
                  }
                </div>
              }
            }
            @case ('erro') { <div class="ia-erro">{{ item.texto }}</div> }
          }
        } @empty {
          <div class="ia-vazio suave">
            Peça o que quiser no projeto: "sobe o servidor e reproduz o erro do armazenamento", "por que esse JSP dá 500?",
            "quantas bancas a feira 3 tem no Homolog?". A IA abre o código, lê o log, testa a aplicação e consulta o banco;
            mudanças de código chegam como diff para você aplicar ou recusar.
          </div>
        }
        @if (ia.pensando()) { <div class="ia-pensando destaque-texto">✦ trabalhando…</div> }
      </div>

      <div class="ia-pe">
        <div class="ia-contexto">
          @for (c of contexto(); track c) { <span class="ia-chip">&#64;{{ c }}</span> }
        </div>
        <label class="ia-campo ia-campo-grande">
          <input #campo type="text" spellcheck="false" aria-label="Mensagem para a IA"
                 [placeholder]="ia.pendente() ? '⏎ aplica · esc recusa · ou escreva…' : 'peça uma alteração ou pergunte… (/clear zera a conversa)'"
                 [value]="texto()" (input)="texto.set($any($event.target).value)" (keydown)="teclar($event)" />
          <button class="ia-enviar" aria-label="Enviar" [disabled]="ia.pensando()" (click)="enviar()">→</button>
        </label>
      </div>
    </section>
  `,
})
export class IaComponent {
  protected readonly ia = inject(IaService);
  protected readonly revisao = inject(RevisaoService);
  protected readonly mcp = inject(McpService);
  protected readonly auto = inject(AutomaticoService);
  private readonly editor = inject(EditorService);
  private readonly servidor = inject(ServidorService);
  private readonly banco = inject(BancoService);
  private readonly layout = inject(LayoutService);
  private readonly campo = viewChild<ElementRef<HTMLInputElement>>('campo');
  private readonly lista = viewChild<ElementRef<HTMLElement>>('lista');
  protected readonly texto = signal('');
  private readonly diffs = new Map<string, ReturnType<typeof trechos>>();

  /** Chips do que a IA está vendo agora (arquivo ativo, log do servidor, banco do .sql). */
  protected readonly contexto = computed(() => {
    const c: string[] = [];
    const b = this.editor.bufferAtivo();
    if (b) c.push(b.nome);
    if (this.servidor.execucaoAtual()?.fase === 'rodando') c.push('log');
    const p = this.banco.perfilAtivo();
    if (p) c.push(p.nome);
    return c;
  });

  constructor() {
    effect(() => {
      const pedido = this.layout.pedidoDeFoco();
      if (pedido?.id === 'ia') untracked(() => queueMicrotask(() => this.campo()?.nativeElement.focus()));
    });
    effect(() => {
      this.ia.itens();
      this.ia.pensando();
      queueMicrotask(() => {
        const l = this.lista()?.nativeElement;
        if (l) l.scrollTop = l.scrollHeight;
      });
    });
  }

  protected alteracao(id: number) {
    return this.revisao.alteracoes().find((a) => a.id === id) ?? null;
  }

  protected diff(id: number): ReturnType<typeof trechos> {
    const a = this.alteracao(id);
    if (!a) return { linhas: [], mais: 0, menos: 0 };
    const chave = `${id}`;
    let d = this.diffs.get(chave);
    if (!d) {
      d = trechos(a.antes, a.depois, 1, 40);
      this.diffs.set(chave, d);
    }
    return d;
  }

  protected nome(caminho: string): string {
    return nomeBase(caminho);
  }

  protected teclar(e: KeyboardEvent): void {
    const pendente = this.ia.pendente();
    if (e.key === 'Enter' && !e.shiftKey) {
      if (this.texto().trim()) void this.enviar();
      else if (pendente) void this.revisao.aceitar(pendente.id);
    } else if (e.key === 'Escape') {
      if (pendente) void this.revisao.recusar(pendente.id);
      else this.editor.focar();
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyL') {
      this.ia.reiniciar();
    } else {
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  protected async enviar(): Promise<void> {
    const t = this.texto();
    if (this.ia.comando(t)) return void this.texto.set('');
    if (!t.trim() || this.ia.pensando()) return;
    this.texto.set('');
    await this.ia.enviar(t);
    this.campo()?.nativeElement.focus();
  }
}
