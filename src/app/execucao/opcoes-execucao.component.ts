import { Component, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { ExecucaoService, OpcoesDeExecucao, OPCOES_VAZIAS } from './execucao.service';
import { EnvService } from './env.service';
import { ponte } from '../nucleo/ponte';
import { ProjetoService } from '../nucleo/projeto.service';
import { SpringService } from '../spring/spring.service';

/**
 * Argumentos do programa, variáveis de ambiente e opções da JVM de uma configuração de
 * execução (Alt+Shift+F10 → ⚙). Ficam em `.seedy/execucao.json`; o RUN e o DEBUG usam.
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
          @if (c.tipo === 'main' && spring.ehSpring()) {
            <div class="spring-perfis larga">
              <span class="suave">perfil do Spring@if (spring.perfis().length) { (achados em application-*.yml) } @else { (nenhum application-*.yml em src/main/resources) }</span>
              <div class="spring-perfis-lista">
                @for (p of spring.perfis(); track p) {
                  <button type="button" class="entender-chip" [class.ligado]="o().perfis?.includes(p)" (click)="alternarPerfil(p)">{{ p }}</button>
                }
                @if (spring.perfilDoArquivo(); as f) { <span class="suave">o application já ativa: {{ f }}</span> }
              </div>
              <div class="suave spring-perfis-nota">{{ notaDoPerfil() }}</div>
            </div>
          }
          @if (env.arquivos().length) {
            <div class="env-caixa larga" [class.desligado]="!env.escolhido().usar">
              <label class="commit-opcao" title="alt+e">
                <input type="checkbox" [checked]="env.escolhido().usar" (change)="usarEnv(!env.escolhido().usar)" />
                usar variáveis de um arquivo .env
                <span class="espaco"></span><kbd>alt+e</kbd>
              </label>
              @if (env.escolhido().usar) {
                <div class="env-linha">
                  <label class="campo env-arquivo"><span>arquivo</span>
                    <select [value]="env.emUso()?.nome ?? ''" (change)="escolherArquivo(valor($event))">
                      @if (!env.emUso()) { <option value="">escolher…</option> }
                      @for (a of env.arquivos(); track a.nome) { <option [value]="a.nome">{{ a.nome }}{{ a.modelo ? ' (modelo)' : '' }}</option> }
                    </select></label>
                  @if (env.emUso(); as f) { <span class="suave env-resumo">{{ f.variaveis }} {{ f.variaveis === 1 ? 'variável' : 'variáveis' }} · lidas de novo a cada execução</span> }
                  @else { <span class="suave env-resumo">escolha o arquivo: há mais de um na raiz do projeto</span> }
                </div>
                @if (previa().length) {
                  <div class="env-variaveis">
                    @for (v of previa().slice(0, 3); track v.nome) { <div><span class="destaque-texto">{{ v.nome }}</span><span class="suave">{{ env.mascarar(v.nome, v.valor) }}</span></div> }
                    @if (previa().length > 3) { <div><span class="suave">… mais {{ previa().length - 3 }}</span></div> }
                  </div>
                }
                @if (env.emUso(); as f) {
                  @if (ignorado() === false) {
                    <div class="env-aviso"><span>⚠ {{ f.nome }} não está no .gitignore deste projeto</span><button class="botao" (click)="ignorar(f.nome)">adicionar</button></div>
                  }
                }
              }
            </div>
          }
          <label class="campo larga"><span>variáveis de ambiente (uma por linha: NOME=valor){{ env.escolhido().usar && env.emUso() ? ' — valem por cima do .env' : '' }}</span>
            <textarea class="campo-variaveis" spellcheck="false" [value]="variaveis()" (input)="definirVariaveis(valor($event))" placeholder="DATABASE_URL=jdbc:postgresql://localhost:5432/feira"></textarea></label>
          <div class="perfil-dica larga suave">fica em .seedy/execucao.json (vai para o git; dá para editar à mão) · o RUN, o DEBUG, os testes e a IA usam</div>
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
  protected readonly env = inject(EnvService);
  protected readonly spring = inject(SpringService);
  /** As primeiras variáveis do .env em uso (para mostrar; o valor com cara de senha sai mascarado). */
  protected readonly previa = signal<{ nome: string; valor: string }[]>([]);
  protected readonly ignorado = signal<boolean | null>(null);
  private readonly projeto = inject(ProjetoService);
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
        void this.env.carregar();
        setTimeout(() => this.primeiro()?.nativeElement.focus());
      });
    });
    // A prévia e o aviso do .gitignore acompanham o arquivo em uso.
    effect(() => {
      const aberto = this.x.editandoOpcoes();
      const f = this.env.emUso();
      this.env.nomes();
      untracked(() => void this.atualizarPrevia(aberto ? f?.nome ?? null : null));
    });
  }

  private async atualizarPrevia(arquivo: string | null): Promise<void> {
    const raiz = this.projeto.raiz();
    if (!arquivo || !raiz) {
      this.previa.set([]);
      this.ignorado.set(null);
      return;
    }
    this.previa.set(await ponte.env.ler(raiz, arquivo).catch(() => []));
    this.ignorado.set(await this.env.ignorado(arquivo));
  }

  protected usarEnv(usar: boolean): void {
    this.env.mudar({ usar, arquivo: this.env.escolhido().arquivo });
  }

  protected escolherArquivo(nome: string): void {
    if (nome) this.env.mudar({ usar: true, arquivo: nome });
  }

  protected async ignorar(arquivo: string): Promise<void> {
    await this.env.ignorar(arquivo);
    this.ignorado.set(await this.env.ignorado(arquivo));
  }

  protected valor(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected mudar(campo: 'argumentos' | 'jvm', valor: string): void {
    this.o.update((o) => ({ ...o, [campo]: valor }));
  }

  protected alternarPerfil(p: string): void {
    this.o.update((o) => {
      const atuais = o.perfis ?? [];
      return { ...o, perfis: atuais.includes(p) ? atuais.filter((x) => x !== p) : [...atuais, p] };
    });
  }

  protected notaDoPerfil(): string {
    const perfis = this.o().perfis ?? [];
    if (!perfis.length) return 'sem escolha: vale o que o application.yml e o .env definirem';
    if (/spring\.profiles\.active/.test(this.o().jvm) || this.variaveis().includes('SPRING_PROFILES_ACTIVE')) return 'a JVM ou o ambiente já definem o perfil: essa escolha fica de lado';
    const lista = perfis.join(',');
    const doEnv = this.previa().find((v) => v.nome === 'SPRING_PROFILES_ACTIVE');
    return doEnv ? `troca o SPRING_PROFILES_ACTIVE do .env (${doEnv.valor}) por ${lista} no RUN e no DEBUG` : `vira -Dspring.profiles.active=${lista} no RUN e no DEBUG`;
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
    } else if (e.altKey && e.code === 'KeyE' && this.env.arquivos().length) {
      e.preventDefault();
      e.stopPropagation();
      this.usarEnv(!this.env.escolhido().usar);
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
