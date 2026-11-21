import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { ponte } from '../nucleo/ponte';
import { Inline, Lista, parseMarkdown } from './markdown';

/**
 * Texto do chat da IA com a formatação que ela usa: **negrito**, *itálico*, `código`, links
 * clicáveis, títulos, listas (- e 1.), blocos de código e citações. Tudo desenhado pela
 * interface (sem innerHTML); os links abrem no navegador do sistema.
 */
@Component({
  selector: 'sd-markdown',
  imports: [NgTemplateOutlet],
  template: `
    <div class="md">
      @for (b of blocos(); track $index) {
        @switch (b.t) {
          @case ('paragrafo') { <p class="md-p"><ng-container *ngTemplateOutlet="inline; context: { $implicit: b.inline }" /></p> }
          @case ('titulo') { <p class="md-titulo" [attr.data-nivel]="b.nivel"><ng-container *ngTemplateOutlet="inline; context: { $implicit: b.inline }" /></p> }
          @case ('lista') { <ng-container *ngTemplateOutlet="lista; context: { $implicit: b.lista }" /> }
          @case ('codigo') { <pre class="md-codigo"><code>{{ b.texto }}</code></pre> }
          @case ('citacao') { <blockquote class="md-citacao"><ng-container *ngTemplateOutlet="inline; context: { $implicit: b.inline }" /></blockquote> }
        }
      }
    </div>

    <ng-template #inline let-partes>
      @for (p of partes; track $index) {
        @switch (p.t) {
          @case ('texto') {{{ p.v }}}
          @case ('negrito') { <strong><ng-container *ngTemplateOutlet="inline; context: { $implicit: p.v }" /></strong> }
          @case ('italico') { <em><ng-container *ngTemplateOutlet="inline; context: { $implicit: p.v }" /></em> }
          @case ('codigo') { <code class="md-codigo-em-linha">{{ p.v }}</code> }
          @case ('link') { <a class="md-link" [href]="p.url" [title]="p.url" rel="noopener noreferrer" (click)="abrir($event, p.url)"><ng-container *ngTemplateOutlet="inline; context: { $implicit: p.v }" /></a> }
        }
      }
    </ng-template>

    <ng-template #lista let-l>
      @if (l.ordenada) {
        <ol class="md-lista" [attr.start]="l.inicio">
          @for (item of l.itens; track $index) {
            <li><ng-container *ngTemplateOutlet="inline; context: { $implicit: item.inline }" />@if (item.filhos) { <ng-container *ngTemplateOutlet="lista; context: { $implicit: item.filhos }" /> }</li>
          }
        </ol>
      } @else {
        <ul class="md-lista">
          @for (item of l.itens; track $index) {
            <li><ng-container *ngTemplateOutlet="inline; context: { $implicit: item.inline }" />@if (item.filhos) { <ng-container *ngTemplateOutlet="lista; context: { $implicit: item.filhos }" /> }</li>
          }
        </ul>
      }
    </ng-template>
  `,
})
export class MarkdownComponent {
  readonly texto = input.required<string>();
  protected readonly blocos = computed(() => parseMarkdown(this.texto()));

  protected abrir(e: MouseEvent, url: string): void {
    e.preventDefault();
    void ponte.abrirLink(url);
  }
}

export type { Inline, Lista };
