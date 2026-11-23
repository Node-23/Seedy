import { Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { MarkdownComponent } from './markdown.component';
import { IaMergeService, ItemDoChat } from './ia-merge.service';
import { MergeService } from '../git/merge.service';
import { diffDeLinhas } from '../git/diff';

interface LinhaDaProposta {
  tipo: 'mais' | 'menos' | 'igual';
  texto: string;
}

/**
 * Chat da IA ao lado do merge em três colunas (mockup 10). ⏎ manda a mensagem (com o
 * campo vazio, aplica a proposta), esc recusa, ctrl+r pede outra; Alt+A abre e fecha.
 */
@Component({
  selector: 'sd-merge-ia',
  imports: [MarkdownComponent],
  template: `
    <section class="painel merge-ia" aria-label="Conversar com a IA sobre o conflito">
      <div class="painel-faixa">
        <span class="rotulo destaque-texto">✦ IA</span>
        @if (conflitoAtual(); as n) { <span class="suave">· conflito {{ n }} de {{ totalDeConflitos() }}</span> }
        <span class="espaco"></span>
        <kbd>Alt+A</kbd>
      </div>

      <div #lista class="merge-ia-conversa" aria-live="polite">
        @for (item of ia.itens(); track $index) {
          @switch (item.tipo) {
            @case ('usuario') { <div class="ia-usuario">{{ item.texto }}</div> }
            @case ('texto') { @if (item.texto) { <div class="ia-texto"><sd-markdown [texto]="item.texto" /></div> } }
            @case ('ferramentas') {
              <div class="ia-ferramentas">
                @for (p of item.passos; track $index) {
                  <div class="ia-passo">
                    <span [class.git-mais]="p.ok === true" [class.git-menos]="p.ok === false" [class.suave]="p.ok === null">
                      {{ p.ok === null ? '…' : p.ok ? '✓' : '✕' }}
                    </span>
                    <span class="destaque-texto ia-passo-nome">{{ nomeDaFerramenta(p.nome) }}</span>
                    <span class="suave">{{ p.detalhe }}</span>
                  </div>
                }
              </div>
            }
            @case ('proposta') {
              <div class="ia-proposta" [attr.data-estado]="item.estado">
                <div class="ia-proposta-titulo">
                  <span>conflito {{ item.conflito }} → resultado</span>
                  <span class="espaco"></span>
                  <span class="git-mais">+{{ contagem(item).mais }}</span> <span class="git-menos">−{{ contagem(item).menos }}</span>
                </div>
                <div class="ia-proposta-codigo">
                  @for (l of linhasDa(item); track $index) {
                    <div class="git-diff-linha" [attr.data-tipo]="l.tipo">
                      <span class="git-diff-sinal">{{ l.tipo === 'mais' ? '+' : l.tipo === 'menos' ? '−' : '' }}</span><span>{{ l.texto }}</span>
                    </div>
                  }
                </div>
                @if (item.estado === 'pendente') {
                  <div class="ia-proposta-acoes">
                    <button class="botao destaque" (click)="ia.aplicar()">aplicar <kbd>⏎</kbd></button>
                    <button class="botao" (click)="ia.recusar()">recusar <kbd>esc</kbd></button>
                    <button class="botao" (click)="ia.outra()">outra <kbd>^r</kbd></button>
                  </div>
                } @else {
                  <div class="ia-proposta-acoes suave">{{ item.estado === 'aplicada' ? '✓ aplicada no resultado' : 'recusada' }}</div>
                }
              </div>
            }
            @case ('erro') { <div class="ia-erro">{{ item.texto }}</div> }
          }
        } @empty {
          <div class="ia-vazio suave">
            Pergunte sobre o conflito: o que cada lado mudou, qual manter, ou peça para juntar os dois.
            A IA lê o código relacionado e propõe; você aplica ou recusa.
          </div>
        }
        @if (ia.pensando()) { <div class="ia-pensando destaque-texto">✦ pensando…</div> }
      </div>

      <div class="merge-ia-pe">
        <div class="ia-contexto">
          @if (conflitoAtual(); as n) { <span class="ia-chip">&#64;conflito {{ n }}</span> }
          @if (merge.arquivo(); as a) { <span class="ia-chip">&#64;{{ a.split('/').pop() }}</span> }
        </div>
        <label class="ia-campo">
          <input #campo type="text" spellcheck="false" aria-label="Mensagem para a IA"
                 [placeholder]="ia.pendente() ? '⏎ aplica · esc recusa · ou escreva…' : 'pergunte sobre o conflito…'"
                 [value]="texto()" (input)="texto.set($any($event.target).value)" (keydown)="teclar($event)" />
          <button class="ia-enviar" aria-label="Enviar" [disabled]="ia.pensando()" (click)="enviar()">→</button>
        </label>
      </div>
    </section>
  `,
})
export class MergeIaComponent {
  protected readonly ia = inject(IaMergeService);
  protected readonly merge = inject(MergeService);
  private readonly campo = viewChild<ElementRef<HTMLInputElement>>('campo');
  private readonly lista = viewChild<ElementRef<HTMLElement>>('lista');
  protected readonly texto = signal('');

  /** Recalculado a cada mudança do chat ou dos conflitos (o cursor muda junto com eles). */
  protected readonly conflitoAtual = computed(() => {
    this.ia.itens();
    this.merge.restantes();
    return this.merge.acoes?.contexto()?.atual ?? null;
  });
  protected readonly totalDeConflitos = computed(() => {
    this.merge.restantes();
    return this.merge.acoes?.contexto()?.conflitos.length ?? 0;
  });

  constructor() {
    // Abriu: foco no campo.
    effect(() => {
      if (this.ia.aberto()) queueMicrotask(() => this.campo()?.nativeElement.focus());
    });
    // Conversa cresceu: rola para o fim.
    effect(() => {
      this.ia.itens();
      this.ia.pensando();
      queueMicrotask(() => {
        const l = this.lista()?.nativeElement;
        if (l) l.scrollTop = l.scrollHeight;
      });
    });
  }

  protected focar(): void {
    this.campo()?.nativeElement.focus();
  }

  protected teclar(e: KeyboardEvent): void {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'Enter' && !e.shiftKey) {
      if (this.texto().trim()) void this.enviar();
      else this.ia.aplicar();
    } else if (e.key === 'Escape') {
      if (this.ia.pendente()) this.ia.recusar();
      else this.merge.acoes?.focarResultado();
    } else if (ctrl && e.code === 'KeyR') {
      void this.ia.outra();
    } else {
      // Teclas comuns ficam no campo (o espaço não abre o líder, j/k não mexem no vim).
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
    this.focar();
  }

  protected nomeDaFerramenta(nome: string): string {
    return nome === 'ler_arquivo' ? 'codigo.ler' : nome === 'historico_git' ? 'git.log' : nome === 'propor_resolucao' ? 'conflito.propor' : nome;
  }

  protected linhasDa(item: Extract<ItemDoChat, { tipo: 'proposta' }>): LinhaDaProposta[] {
    return linhasDaProposta(item.antes, item.linhas);
  }

  protected contagem(item: Extract<ItemDoChat, { tipo: 'proposta' }>): { mais: number; menos: number } {
    const l = this.linhasDa(item);
    return { mais: l.filter((x) => x.tipo === 'mais').length, menos: l.filter((x) => x.tipo === 'menos').length };
  }
}

/** A proposta comparada com a sua versão do trecho: o que sai (−) e o que entra (+). */
function linhasDaProposta(antes: string[], depois: string[]): LinhaDaProposta[] {
  const saida: LinhaDaProposta[] = [];
  let a = 0;
  let b = 0;
  for (const m of diffDeLinhas(antes, depois)) {
    while (a < m.aInicio && b < m.bInicio) {
      saida.push({ tipo: 'igual', texto: depois[b] });
      a++;
      b++;
    }
    for (; a < m.aFim; a++) saida.push({ tipo: 'menos', texto: antes[a] });
    for (; b < m.bFim; b++) saida.push({ tipo: 'mais', texto: depois[b] });
  }
  for (; b < depois.length; b++) saida.push({ tipo: 'igual', texto: depois[b] });
  return saida;
}
