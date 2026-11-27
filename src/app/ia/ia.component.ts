import { CAMINHO_DO_LOGO, VIEWBOX_DO_LOGO } from '../marca/logo';
import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { IaService } from './ia.service';
import { RevisaoService } from './revisao.service';
import { MarkdownComponent } from './markdown.component';
import { AutomaticoService } from './automatico.service';
import { AnexosService } from './anexos.service';
import { McpService } from './mcp.service';
import { trechos } from './trechos';
import { EditorService } from '../editor/editor.service';
import { ServidorService } from '../servidor/servidor.service';
import { BancoService } from '../banco/banco.service';
import { LayoutService } from '../layout/layout.service';
import { nomeBase } from '../nucleo/ponte';

/**
 * Painel de IA (mockup 06, Alt+A): a conversa opera a IDE pelas ferramentas; propostas de
 * edição viram cartões de diff (⏎ aplica, esc recusa). Com o campo vazio, ⏎ aplica a
 * proposta pendente; ctrl+l começa outra conversa.
 */
const EXEMPLOS = ['explique este arquivo', 'por que o servidor deu erro?', 'escreva testes para esta classe', 'revise o que mudei antes do commit'];

@Component({
  selector: 'sd-ia',
  imports: [MarkdownComponent],
  template: `
    <section class="painel ia-painel" aria-label="Assistente de IA">
      <div class="painel-faixa">
        <span class="rotulo destaque-texto">✦ IA</span>
        <span class="espaco"></span>
        <label class="ia-automatico" [class.ligado]="auto.ligado()" title="Modo automático: a IA aplica edições e roda comandos sem pedir confirmação (Alt+Shift+Y). O que ela muda fica em Alt+Y para revisar.">
          <input type="checkbox" [checked]="auto.ligado()" (change)="auto.definir($any($event.target).checked)" /> automático
        </label>
        <button class="botao-icone ia-mcp" title="copiar o comando que liga o Claude Code (terminal) às ferramentas do Seedy" (click)="mcp.copiarComandoDoClaudeCode()">MCP</button>
        <kbd>Alt+A</kbd>
      </div>

      <div #lista class="ia-conversa" aria-live="polite">
        @for (item of ia.itens(); track $index) {
          @switch (item.tipo) {
            @case ('usuario') {
              <div class="ia-usuario" [class.editando]="ia.editando() === $index">
                @if (!ia.pensando()) { <button class="ia-editar" type="button" title="editar e reenviar (a conversa volta a este ponto)" aria-label="Editar a mensagem" (click)="editar($index)">✎</button> }
                {{ item.texto }}
                @if (item.imagens?.length) {
                  <div class="ia-usuario-imagens">@for (m of item.imagens; track $index) { <img [src]="m" alt="imagem enviada" /> }</div>
                }
                @if (item.anexos?.length) {
                  <div class="ia-usuario-anexos">@for (a of item.anexos; track $index) { <span>{{ a }}</span> }</div>
                }
              </div>
            }
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
          <!-- Sem conversa (mockup 33): ↑↓ no campo escolhem um exemplo e ⏎ leva o texto para ele. -->
          <div class="ia-inicio">
            <svg class="ia-inicio-broto" [attr.viewBox]="viewBoxDoLogo" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" [attr.d]="logo"/></svg>
            <b>O que vamos fazer?</b>
            <p class="suave">Eu leio o código e o log, testo a aplicação e consulto o banco.</p>
            <ul role="listbox" aria-label="Exemplos de pedido">
              @for (x of exemplos; track x; let i = $index) {
                <li role="option" [class.sel]="i === exemplo()" [attr.aria-selected]="i === exemplo()" (click)="usarExemplo(i)">
                  <span>{{ x }}</span>@if (i === exemplo()) { <kbd>⏎</kbd> }
                </li>
              }
            </ul>
            <p class="suave"><kbd>↑↓</kbd> escolher <kbd>⏎</kbd> levar para o campo</p>
            <p class="suave ia-inicio-fim">Mudanças de código chegam como diff, para você aplicar ou recusar.</p>
          </div>
        }
        @if (ia.pensando()) { <div class="ia-pensando destaque-texto">✦ trabalhando…</div> }
      </div>

      <div class="ia-pe">
        @if (anexos.lista().length || anexos.imagens().length) {
          <div class="ia-anexos-titulo">mandado para esta conversa · vai junto da próxima mensagem</div>
          <div class="ia-contexto ia-anexos">
            @for (i of anexos.imagens(); track i.id) {
              <span class="ia-chip ia-anexo ia-anexo-imagem" [title]="i.nome"><img [src]="i.miniatura" alt="" /> {{ i.nome }} · {{ tamanho(i.bytes) }}
                <button class="ia-anexo-x" [attr.aria-label]="'Tirar ' + i.nome" (click)="anexos.removerImagem(i.id)">✕</button></span>
            }
            @for (a of anexos.lista(); track a.id) {
              <span class="ia-chip ia-anexo" [title]="a.texto">{{ a.icone }} {{ a.rotulo }}
                <button class="ia-anexo-x" [attr.aria-label]="'Tirar ' + a.rotulo" (click)="anexos.remover(a.id)">✕</button></span>
            }
          </div>
        }
        @if (ia.editando() !== null) {
          <div class="ia-editando-aviso">✎ editando a mensagem: <span class="destaque-texto">⏎</span> reenvia (a conversa volta a este ponto; o que já mudou nos arquivos continua) · <span class="destaque-texto">esc</span> cancela</div>
        }
        <div class="ia-contexto">
          @for (c of contexto(); track c) { <span class="ia-chip ia-chip-suave">&#64;{{ c }}</span> }
        </div>
        <label class="ia-campo ia-campo-grande" (dragover)="$event.preventDefault()" (drop)="soltar($event)">
          <input #campo type="text" spellcheck="false" aria-label="Mensagem para a IA" (paste)="colar($event)"
                 [placeholder]="ia.pendente() ? '⏎ aplica · esc recusa · ou escreva…' : 'peça algo ou cole uma imagem…'"
                 [value]="texto()" (input)="texto.set($any($event.target).value)" (keydown)="teclar($event)" />
          <button class="ia-imagem" aria-label="Anexar imagem" title="anexar imagem (ou cole com ctrl+v)" (click)="escolherImagem.click()">🖼</button>
          <input #escolherImagem type="file" hidden multiple accept="image/png,image/jpeg,image/gif,image/webp" (change)="escolhidas($event)" />
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
  protected readonly anexos = inject(AnexosService);
  private readonly editor = inject(EditorService);
  private readonly servidor = inject(ServidorService);
  private readonly banco = inject(BancoService);
  private readonly layout = inject(LayoutService);
  private readonly campo = viewChild<ElementRef<HTMLInputElement>>('campo');
  private readonly lista = viewChild<ElementRef<HTMLElement>>('lista');
  /** O rascunho mora no serviço: a conversa pode trocar de tela (a IA aparece em todas) sem perder o que foi escrito. */
  protected readonly texto = this.ia.rascunho;
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

  protected readonly exemplos = EXEMPLOS;
  protected readonly exemplo = signal(0);
  protected readonly logo = CAMINHO_DO_LOGO;
  protected readonly viewBoxDoLogo = VIEWBOX_DO_LOGO;

  /** Põe o exemplo no campo, sem enviar: dá para completar antes. */
  protected usarExemplo(indice: number): void {
    this.exemplo.set(indice);
    this.texto.set(EXEMPLOS[indice]);
    queueMicrotask(() => this.campo()?.nativeElement.focus());
  }

  protected nome(caminho: string): string {
    return nomeBase(caminho);
  }

  /** ✎ numa mensagem enviada (ou ↑ com o campo vazio): o texto volta ao campo para editar e reenviar. */
  protected editar(indice: number): void {
    const t = this.ia.iniciarEdicao(indice);
    if (t === null) return;
    this.texto.set(t);
    queueMicrotask(() => this.campo()?.nativeElement.focus());
  }

  protected teclar(e: KeyboardEvent): void {
    const pendente = this.ia.pendente();
    const semConversa = !this.ia.itens().length && !this.texto() && !this.anexos.imagens().length;
    if (semConversa && !e.shiftKey && ['ArrowUp', 'ArrowDown', 'Enter'].includes(e.key)) {
      if (e.key === 'Enter') this.usarExemplo(this.exemplo());
      else this.exemplo.set((this.exemplo() + (e.key === 'ArrowDown' ? 1 : EXEMPLOS.length - 1)) % EXEMPLOS.length);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key === 'ArrowUp' && !this.texto() && !this.ia.pensando() && !e.shiftKey) {
      const ultima = this.ia.itens().map((i, n) => (i.tipo === 'usuario' ? n : -1)).filter((n) => n >= 0).pop();
      if (ultima !== undefined) {
        this.editar(ultima);
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (e.key === 'Escape' && this.ia.editando() !== null) {
      this.ia.cancelarEdicao();
      this.texto.set('');
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      if (this.texto().trim() || this.anexos.imagens().length) void this.enviar();
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

  protected tamanho(bytes: number): string {
    return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  /** ctrl+v com imagem na área de transferência: anexa em vez de colar texto. */
  protected colar(e: ClipboardEvent): void {
    const arquivos = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (!arquivos.length) return;
    e.preventDefault();
    for (const f of arquivos) void this.anexos.adicionarImagem(f, f.name && f.name !== 'image.png' ? f.name : `print-${this.anexos.imagens().length + 1}.png`);
  }

  protected soltar(e: DragEvent): void {
    const arquivos = Array.from(e.dataTransfer?.files ?? []);
    if (!arquivos.length) return;
    e.preventDefault();
    for (const f of arquivos) void this.anexos.adicionarImagem(f, f.name);
  }

  protected escolhidas(e: Event): void {
    const input = e.target as HTMLInputElement;
    for (const f of Array.from(input.files ?? [])) void this.anexos.adicionarImagem(f, f.name);
    input.value = '';
    this.campo()?.nativeElement.focus();
  }

  protected async enviar(): Promise<void> {
    const t = this.texto();
    if (this.ia.comando(t)) return void this.texto.set('');
    if ((!t.trim() && !this.anexos.imagens().length) || this.ia.pensando()) return;
    this.texto.set('');
    await this.ia.enviar(t);
    this.campo()?.nativeElement.focus();
  }
}
