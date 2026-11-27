import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { MensagensService } from '../nucleo/mensagens.service';
import { ProjetoService } from '../nucleo/projeto.service';
import { AtualizacaoService } from '../atualizacao/atualizacao.service';
import { RecentesService } from '../inicio/recentes.service';
import { LayoutService } from '../layout/layout.service';
import { ponte } from '../nucleo/ponte';
import { hora, limpar, linkDeEmail, montarRelatorio } from './relatorio';

const ROTULO = { info: 'MENSAGEM', aviso: 'AVISO', erro: 'ERRO' };

/**
 * A notificação inteira (mockup 35). Nas falhas do Seedy, o desenvolvedor pode contar o que fazia
 * e mandar o relatório por e-mail, vendo antes o texto exato.
 * Teclado: Ctrl+⏎ envia, c copia, v mostra o texto, esc fecha.
 */
@Component({
  selector: 'sd-erro',
  template: `
    @if (m.aberta(); as n) {
      <div class="veu" (mousedown)="fechar()"></div>
      <div #caixa [class]="'painel erro-popup ' + n.tipo" role="dialog" tabindex="-1"
           [attr.aria-label]="rotulo()" (keydown)="teclar($event)">
        <div class="painel-faixa">
          <span class="rotulo">{{ rotulo() }}</span>
          <span class="suave">{{ quando() }}</span>
          <span class="espaco"></span>
          <kbd>esc</kbd>
        </div>
        <div class="erro-corpo">
          <b>{{ n.titulo }}</b>
          @if (verTexto()) {
            <pre class="erro-texto">{{ relatorio() }}</pre>
          } @else if (detalhe()) {
            <pre class="erro-texto">{{ detalhe() }}</pre>
          }
          @if (n.doSeedy) {
            <label class="erro-conta">O que você estava fazendo? <span class="suave">(opcional)</span>
              <textarea rows="3" spellcheck="false" placeholder="abri o projeto e…" [value]="oQueFazia()"
                        (input)="oQueFazia.set($any($event.target).value)"></textarea>
            </label>
            <div class="erro-junto">
              <b>Vai junto, e só isto:</b>
              <span class="suave">{{ resumo() }}<br>Sem código, sem senhas; o nome do seu usuário é trocado por “~” nos caminhos.</span>
              <button class="erro-ver" (click)="verTexto.set(!verTexto())"><kbd>v</kbd> {{ verTexto() ? 'voltar a ver só o erro' : 'ver o texto exato antes de enviar' }}</button>
            </div>
          }
        </div>
        <div class="erro-acoes">
          <button class="botao" (click)="copiar()">copiar <kbd>c</kbd></button>
          <span class="espaco"></span>
          <button class="botao" (click)="fechar()">fechar <kbd>esc</kbd></button>
          @if (n.doSeedy) { <button class="botao destaque" (click)="enviar()">enviar para análise <kbd>Ctrl+⏎</kbd></button> }
        </div>
      </div>
    }
  `,
})
export class ErroComponent {
  protected readonly m = inject(MensagensService);
  private readonly projeto = inject(ProjetoService);
  private readonly atualizacao = inject(AtualizacaoService);
  private readonly recentes = inject(RecentesService);
  private readonly layout = inject(LayoutService);
  private readonly caixa = viewChild<ElementRef<HTMLElement>>('caixa');
  private focoAnterior: HTMLElement | null = null;

  protected readonly oQueFazia = signal('');
  protected readonly verTexto = signal(false);

  protected readonly rotulo = computed(() => {
    const n = this.m.aberta();
    return !n ? '' : n.doSeedy ? 'ERRO DO SEEDY' : ROTULO[n.tipo];
  });

  protected readonly quando = computed(() => {
    const n = this.m.aberta();
    if (!n) return '';
    const hoje = n.quando.toDateString() === new Date().toDateString();
    return `${hoje ? 'hoje' : n.quando.toLocaleDateString('pt-BR')}, ${hora(n.quando)}`;
  });

  /** O que vem além do título (que já está em cima). */
  protected readonly detalhe = computed(() => {
    const n = this.m.aberta();
    if (!n || n.completo === n.titulo) return '';
    return n.completo.startsWith(`${n.titulo}\n`) ? n.completo.slice(n.titulo.length + 1) : n.completo;
  });

  constructor() {
    effect(() => {
      const aberta = this.m.aberta();
      const caixa = this.caixa();
      untracked(() => {
        if (!aberta) {
          this.focoAnterior?.focus();
          this.focoAnterior = null;
          return;
        }
        if (!caixa || caixa.nativeElement.contains(document.activeElement)) return;
        this.focoAnterior = document.activeElement as HTMLElement | null;
        this.oQueFazia.set('');
        this.verTexto.set(false);
        caixa.nativeElement.focus();
      });
    });
  }

  private sistema(): string {
    const ua = navigator.userAgent;
    return ua.includes('Windows') ? 'Windows' : ua.includes('Linux') ? 'Linux' : navigator.platform;
  }

  private tipoDoProjeto(): string {
    const raiz = this.projeto.raiz();
    if (!raiz) return 'sem projeto';
    return `projeto ${this.recentes.lista().find((r) => r.caminho === raiz)?.tipo ?? 'pasta'}`;
  }

  private tela(): string {
    return this.projeto.raiz() || this.layout.tela() !== 'editor' ? this.layout.tela() : 'início';
  }

  protected resumo(): string {
    return `Seedy ${this.atualizacao.versao() || '?'} · ${this.sistema()} · ${this.tipoDoProjeto()} · tela: ${this.tela()} · as 10 últimas notificações.`;
  }

  protected relatorio(): string {
    return montarRelatorio({
      erro: this.m.aberta()!,
      oQueFazia: this.oQueFazia(),
      versao: this.atualizacao.versao() || '?',
      sistema: this.sistema(),
      projeto: this.tipoDoProjeto(),
      tela: this.tela(),
      ultimas: this.m.historico().slice(0, 10),
    });
  }

  protected fechar(): void {
    this.m.fecharPopup();
  }

  protected async copiar(): Promise<void> {
    const n = this.m.aberta();
    if (!n) return;
    if (await this.paraAAreaDeTransferencia(n.doSeedy ? this.relatorio() : n.completo)) this.m.mostrar('copiado');
    else this.m.alerta('não consegui copiar');
  }

  /** Abre o e-mail pronto; quem envia é o desenvolvedor, no programa de e-mail dele. */
  protected async enviar(): Promise<void> {
    const n = this.m.aberta();
    if (!n?.doSeedy) return;
    const relatorio = this.relatorio();
    const copiou = await this.paraAAreaDeTransferencia(relatorio);
    const assunto = limpar(`[Seedy ${this.atualizacao.versao() || '?'}] ${n.titulo}`).slice(0, 120);
    try {
      await ponte.abrirLink(linkDeEmail(assunto, relatorio));
    } catch (e) {
      this.m.erro(`não consegui abrir o e-mail${copiou ? ' (o relatório está copiado)' : ''}: ${e}`);
      return;
    }
    this.m.marcarEnviada(n.id);
    this.fechar();
    this.m.mostrar(`confira o e-mail e clique em enviar${copiou ? ' · relatório copiado' : ''}`);
  }

  private async paraAAreaDeTransferencia(texto: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      return false;
    }
  }

  protected teclar(e: KeyboardEvent): void {
    const escrevendo = (e.target as HTMLElement).tagName === 'TEXTAREA';
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') this.fechar();
    else if (e.key === 'Enter' && ctrl) void this.enviar();
    else if (escrevendo || ctrl || e.altKey) return void e.stopPropagation();
    else if (e.key === 'c') void this.copiar();
    else if (e.key === 'v' && this.m.aberta()?.doSeedy) this.verTexto.update((v) => !v);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
}
