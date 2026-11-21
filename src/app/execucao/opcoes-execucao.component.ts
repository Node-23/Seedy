import { Component, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { ExecucaoService, OpcoesDeExecucao, OPCOES_VAZIAS } from './execucao.service';

/**
 * Argumentos do programa, variáveis de ambiente e opções da JVM de uma configuração de
 * execução (␣ r → ⚙). Ficam em `.seedy/execucao.json`; o RUN e o DEBUG usam.
 */
@Component({
  selector: 'sd-opcoes-execucao',
  template: `
    @if (x.editandoOpcoes(); as c) {
      <div class="busca perfil-banco perfil-servidor" role="dialog" aria-label="Opções de execução" (keydown)="teclar($event)">
        <div class="painel-faixa"><span class="rotulo">EXECUÇÃO · {{ c.nome.toUpperCase() }}</span><span class="suave">{{ c.tipo === 'main' ? c.mainClass : 'script do package.json' }}</span></div>
        <div class="perfil-corpo">
          <label class="campo larga"><span>argumentos do programa{{ c.tipo === 'script' ? ' (vão depois do --)' : '' }}</span>
            <input #primeiro type="text" spellcheck="false" [value]="o().argumentos" (input)="mudar('argumentos', valor($event))" [placeholder]="c.tipo === 'main' ? '--porta 8081 \\'nome com espaço\\'' : '--port 4300'" /></label>
          @if (c.tipo === 'main') {
            <label class="campo larga"><span>opções da JVM</span>
              <input type="text" spellcheck="false" [value]="o().jvm" (input)="mudar('jvm', valor($event))" placeholder="-Xmx1g -Dspring.profiles.active=dev" /></label>
          }
          <label class="campo larga"><span>variáveis de ambiente (uma por linha: NOME=valor)</span>
            <textarea class="campo-variaveis" spellcheck="false" [value]="variaveis()" (input)="definirVariaveis(valor($event))" placeholder="DATABASE_URL=jdbc:postgresql://localhost:5432/feira"></textarea></label>
          <div class="perfil-dica larga suave">fica em .seedy/execucao.json (vai para o git; dá para editar à mão) · o RUN e o DEBUG usam</div>
        </div>
        <div class="perfil-acoes">
          <span class="espaco"></span>
          <button class="botao" (click)="fechar()">cancelar <kbd>esc</kbd></button>
          <button class="botao destaque" (click)="salvar()">salvar <kbd>ctrl ⏎</kbd></button>
        </div>
      </div>
    }
  `,
})
export class OpcoesExecucaoComponent {
  protected readonly x = inject(ExecucaoService);
  private readonly primeiro = viewChild<ElementRef<HTMLInputElement>>('primeiro');
  protected readonly o = signal<OpcoesDeExecucao>(OPCOES_VAZIAS);
  protected readonly variaveis = signal('');
  private focoAnterior: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const c = this.x.editandoOpcoes();
      if (!c) return;
      untracked(() => {
        this.focoAnterior = document.activeElement as HTMLElement | null;
        const o = this.x.opcoesDe(c.id);
        this.o.set(o);
        this.variaveis.set(Object.entries(o.ambiente).map(([k, v]) => `${k}=${v}`).join('\n'));
        setTimeout(() => this.primeiro()?.nativeElement.focus());
      });
    });
  }

  protected valor(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected mudar(campo: 'argumentos' | 'jvm', valor: string): void {
    this.o.update((o) => ({ ...o, [campo]: valor }));
  }

  protected definirVariaveis(texto: string): void {
    this.variaveis.set(texto);
    const ambiente: Record<string, string> = {};
    for (const linha of texto.split(/\r?\n/)) {
      const i = linha.indexOf('=');
      if (i > 0) ambiente[linha.slice(0, i).trim()] = linha.slice(i + 1).trim();
    }
    this.o.update((o) => ({ ...o, ambiente }));
  }

  protected teclar(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.fechar();
    } else if (e.key === 'Enter' && (e.ctrlKey || (e.target as HTMLElement).tagName === 'INPUT')) {
      e.preventDefault();
      void this.salvar();
    }
  }

  protected async salvar(): Promise<void> {
    const c = this.x.editandoOpcoes();
    if (!c) return;
    await this.x.salvarOpcoes(c.id, this.o());
    this.fechar();
  }

  protected fechar(): void {
    this.x.editandoOpcoes.set(null);
    this.focoAnterior?.focus();
  }
}
