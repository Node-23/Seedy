import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { ServidorService } from './servidor.service';
import { Jdk, PerfilServidor, ponte } from '../nucleo/ponte';

/** Novo servidor / editar: a pasta de instalação define o tipo (WildFly/JBoss ou Tomcat). */
@Component({
  selector: 'sd-perfil-servidor',
  template: `
    @if (s.editando(); as ed) {
      <div class="busca perfil-banco perfil-servidor" role="dialog" [attr.aria-label]="ed.novo ? 'Novo servidor' : 'Editar servidor'" (keydown)="teclar($event)">
        <div class="painel-faixa"><span class="rotulo">{{ ed.novo ? 'NOVO SERVIDOR' : 'SERVIDOR · ' + ed.perfil.nome.toUpperCase() }}</span></div>
        <div class="perfil-corpo">
          <label class="campo larga"><span>instalação (pasta do WildFly/JBoss ou do Tomcat)</span>
            <span class="campo-com-botao">
              <input #primeiro type="text" spellcheck="false" [value]="p().instalacao" (change)="definirInstalacao(valor($event))" placeholder="C:\\servidores\\wildfly-42.0.0.Final" />
              <button class="botao" (click)="escolherPasta()">escolher…</button>
            </span>
          </label>
          <div class="perfil-dica larga" [class.erro-texto]="!!erroDaInstalacao()">{{ erroDaInstalacao() ?? versao() ?? 'escolha a pasta: o tipo do servidor vem dela' }}</div>
          <label class="campo"><span>nome</span>
            <input type="text" spellcheck="false" [value]="p().nome" (input)="mudar('nome', valor($event))" placeholder="wildfly-local" /></label>
          <label class="campo"><span>JDK do servidor</span>
            <select [value]="p().jdk ?? ''" (change)="mudar('jdk', valor($event) || null)">
              <option value="">o do sistema (JAVA_HOME)</option>
              @for (j of jdks(); track j.home) { <option [value]="j.home" [selected]="j.home === p().jdk">Java {{ j.versao }}</option> }
            </select></label>
          <label class="campo"><span>contexto (URL)</span>
            <input type="text" spellcheck="false" [value]="p().contexto" (input)="mudar('contexto', valor($event))" placeholder="/feira" /></label>
          <label class="campo"><span>porta HTTP</span>
            <input type="number" [value]="p().portaHttp" (input)="mudar('portaHttp', +valor($event))" /></label>
          <label class="campo"><span>porta de debug</span>
            <input type="number" [value]="p().portaDebug" (input)="mudar('portaDebug', +valor($event))" /></label>
          <label class="campo"><span>opções da JVM</span>
            <input type="text" spellcheck="false" [value]="p().opcoesJvm" (input)="mudar('opcoesJvm', valor($event))" /></label>
          <label class="campo"><span>pasta web (do projeto)</span>
            <input type="text" spellcheck="false" [value]="p().pastaWeb" (input)="mudar('pastaWeb', valor($event))" placeholder="src/main/webapp" /></label>
          <label class="campo"><span>classes compiladas</span>
            <input type="text" spellcheck="false" [value]="p().pastaClasses" (input)="mudar('pastaClasses', valor($event))" placeholder="target/classes" /></label>
          <div class="perfil-dica suave">o jdtls compila ao salvar; os jars do Maven/Gradle entram em WEB-INF/lib</div>
          <label class="campo larga"><span>variáveis de ambiente (uma por linha: NOME=valor)</span>
            <textarea class="campo-variaveis" spellcheck="false" [value]="variaveisEmTexto()" (input)="definirVariaveis(valor($event))"></textarea></label>
        </div>
        <div class="perfil-acoes">
          @if (!ed.novo) { <button class="botao perigo" (click)="apagar()">apagar</button> }
          <span class="espaco"></span>
          <button class="botao" (click)="fechar()">cancelar <kbd>esc</kbd></button>
          <button class="botao destaque" (click)="salvar()">salvar <kbd>ctrl ⏎</kbd></button>
        </div>
      </div>
    }
  `,
})
export class PerfilServidorComponent {
  protected readonly s = inject(ServidorService);
  private readonly primeiro = viewChild<ElementRef<HTMLInputElement>>('primeiro');
  protected readonly jdks = signal<Jdk[]>([]);
  protected readonly versao = signal<string | null>(null);
  protected readonly erroDaInstalacao = signal<string | null>(null);
  private focoAnterior: HTMLElement | null = null;

  private readonly aberto = computed(() => this.s.editando()?.perfil.id ?? null);

  protected p(): PerfilServidor {
    return this.s.editando()!.perfil;
  }

  protected readonly variaveisEmTexto = computed(() =>
    Object.entries(this.s.editando()?.perfil.variaveis ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
  );

  constructor() {
    effect(() => {
      const id = this.aberto();
      if (!id) return;
      untracked(() => {
        this.focoAnterior = document.activeElement as HTMLElement | null;
        this.versao.set(null);
        this.erroDaInstalacao.set(null);
        void ponte.java.jdks().then((j) => this.jdks.set(j));
        const inst = this.p().instalacao;
        if (inst) void this.definirInstalacao(inst);
        queueMicrotask(() => this.primeiro()?.nativeElement.focus());
      });
    });
  }

  protected valor(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected mudar<K extends keyof PerfilServidor>(campo: K, valor: PerfilServidor[K]): void {
    this.s.editando.update((ed) => (ed ? { ...ed, perfil: { ...ed.perfil, [campo]: valor } } : ed));
  }

  protected async escolherPasta(): Promise<void> {
    const pasta = await ponte.escolherPasta();
    if (pasta) await this.definirInstalacao(pasta);
  }

  protected async definirInstalacao(caminho: string): Promise<void> {
    this.mudar('instalacao', caminho.trim());
    try {
      const i = await ponte.servidor.inspecionar(caminho.trim());
      this.mudar('tipo', i.tipo);
      this.versao.set(`${i.versao} · ${i.tipo === 'wildfly' ? 'WildFly/JBoss' : 'Tomcat'}`);
      this.erroDaInstalacao.set(null);
      if (!this.p().nome) this.mudar('nome', `${i.tipo}-local`);
    } catch (e) {
      this.versao.set(null);
      this.erroDaInstalacao.set(String(e));
    }
  }

  protected definirVariaveis(texto: string): void {
    const v: Record<string, string> = {};
    for (const linha of texto.split(/\r?\n/)) {
      const i = linha.indexOf('=');
      if (i > 0) v[linha.slice(0, i).trim()] = linha.slice(i + 1).trim();
    }
    this.mudar('variaveis', v);
  }

  protected async salvar(): Promise<void> {
    const p = this.p();
    if (this.erroDaInstalacao() || !p.instalacao) {
      this.primeiro()?.nativeElement.focus();
      return;
    }
    if (await this.s.salvar({ ...p, nome: p.nome.trim() || `${p.tipo}-local` })) this.restaurarFoco();
  }

  protected async apagar(): Promise<void> {
    const id = this.p().id;
    this.s.editando.set(null);
    await this.s.apagar(id);
  }

  protected fechar(): void {
    this.s.editando.set(null);
    this.restaurarFoco();
  }

  protected teclar(e: KeyboardEvent): void {
    if (e.key === 'Escape') this.fechar();
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void this.salvar();
    else {
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  private restaurarFoco(): void {
    const a = this.focoAnterior;
    this.focoAnterior = null;
    if (a?.isConnected && a !== document.body) queueMicrotask(() => a.focus());
  }
}
