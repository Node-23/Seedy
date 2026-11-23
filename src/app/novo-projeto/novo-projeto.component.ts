import { Component, computed, effect, ElementRef, inject, untracked, viewChild } from '@angular/core';
import { MODELOS, nomeDeClasse, NovoProjetoService } from './novo-projeto.service';

/**
 * Janela de novo projeto (mockup 12, Alt+Shift+N): modelos à esquerda (j k), campos e iniciadores
 * do Spring no meio (tab anda, espaço marca, / filtra) e a prévia do que vai ser criado.
 * ctrl+⏎ cria; esc fecha.
 */
@Component({
  selector: 'sd-novo-projeto',
  template: `
    @if (np.aberta()) {
      <section class="painel novo-projeto" role="dialog" aria-label="Novo projeto" (keydown)="teclar($event)">
        <div class="painel-faixa"><span class="rotulo">NOVO PROJETO</span><span class="espaco"></span><kbd>Alt+Shift+N</kbd></div>

        <div class="novo-corpo">
          <div #modelos class="novo-modelos" tabindex="0" role="listbox" aria-label="Modelos" (keydown)="teclarModelos($event)">
            @for (m of modelosLista; track m.id) {
              <div class="novo-modelo" role="option" [class.selecionado]="np.modelo() === m.id" [attr.aria-selected]="np.modelo() === m.id" (click)="np.escolherModelo(m.id)">
                <span class="novo-icone" [class]="'novo-icone ' + m.cor">{{ m.letra }}</span>
                <div><div class="forte">{{ m.titulo }}</div><div class="suave novo-descricao">{{ m.descricao }}</div></div>
              </div>
            }
            <span class="espaco"></span>
            <div class="suave novo-dica">j k escolhe · tab vai aos campos</div>
          </div>

          <div class="novo-campos">
            <label class="novo-campo"><span class="suave">nome</span>
              <input #nome class="novo-entrada" type="text" spellcheck="false" placeholder="meu-projeto" [value]="np.nome()" (input)="np.nome.set(valor($event))" />
            </label>
            <label class="novo-campo"><span class="suave">pasta</span>
              <span class="novo-entrada novo-pasta">
                <input type="text" spellcheck="false" placeholder="onde criar" [value]="np.pastaPai()" (input)="np.pastaPai.set(valor($event))" />
                <span class="suave">{{ separador() }}{{ np.nome() }}</span>
                <span class="espaco"></span>
                <button type="button" class="novo-escolher destaque-texto" (click)="np.escolherPasta()">^o escolher</button>
              </span>
            </label>
            @if (np.modelo() !== 'angular' && np.modelo() !== 'react') {
              <label class="novo-campo"><span class="suave">grupo</span>
                <input class="novo-entrada" type="text" spellcheck="false" [value]="np.grupo()" (input)="np.grupo.set(valor($event))" />
              </label>
              <label class="novo-campo"><span class="suave">pacote</span>
                <input class="novo-entrada" type="text" spellcheck="false" [placeholder]="np.pacote()" [value]="np.pacoteDigitado()" (input)="np.pacoteDigitado.set(valor($event))" />
              </label>
              <div class="novo-campo"><span class="suave">Java</span>
                <span class="novo-opcoes">
                  @for (v of np.versoesJava(); track v) {
                    <button type="button" class="novo-op" [class.ligado]="np.java() === v" [class.suave]="!np.instaladas().has(v)" (click)="np.java.set(v)"
                            [title]="np.instaladas().has(v) ? 'JDK ' + v + ' instalado' : 'JDK ' + v + ' não está instalado'">{{ v }}</button>
                  }
                  <span class="suave novo-nota">{{ np.modelo() === 'spring' ? 'aceitos pelo Spring' : 'JDKs instalados' }}</span>
                </span>
              </div>
            }
            @if (np.modelo() === 'spring') {
              <div class="novo-campo"><span class="suave">build</span>
                <span class="novo-opcoes">
                  <button type="button" class="novo-op" [class.ligado]="np.build() === 'maven'" (click)="np.build.set('maven')">Maven</button>
                  <button type="button" class="novo-op" [class.ligado]="np.build() === 'gradle'" (click)="np.build.set('gradle')">Gradle</button>
                  <span class="novo-rotulo-meio suave">empacotar</span>
                  <button type="button" class="novo-op" [class.ligado]="np.empacotamento() === 'jar'" (click)="np.empacotamento.set('jar')">jar</button>
                  <button type="button" class="novo-op" [class.ligado]="np.empacotamento() === 'war'" (click)="np.empacotamento.set('war')">war</button>
                </span>
              </div>
              <div class="novo-campo"><span class="suave">Spring Boot</span>
                <span class="novo-opcoes">
                  @for (v of np.versoesSpring(); track v.id) {
                    <button type="button" class="novo-op" [class.ligado]="np.springBoot() === v.id" (click)="np.springBoot.set(v.id)">{{ v.name }}</button>
                  } @empty {
                    <span class="suave novo-nota">{{ np.erroSpring() ?? 'carregando o start.spring.io…' }}</span>
                  }
                </span>
              </div>

              <div class="novo-iniciadores-faixa">
                <span class="rotulo">ACOMPANHAMENTOS</span>
                <span class="destaque-texto novo-nota">{{ np.dependencias().size }} {{ np.dependencias().size === 1 ? 'marcado' : 'marcados' }}</span>
                <span class="espaco"></span>
                <label class="novo-entrada novo-filtro"><span class="destaque-texto">/</span>
                  <input #filtro type="text" spellcheck="false" placeholder="filtrar" [value]="np.filtro()" (input)="np.filtro.set(valor($event))" />
                </label>
              </div>
              <div class="novo-iniciadores"><div class="novo-colunas">
                @for (g of np.grupos(); track g.nome) {
                  <div class="novo-grupo">
                    <div class="novo-grupo-nome">{{ g.nome }}</div>
                    @for (d of g.itens; track d.id) {
                      <button type="button" class="novo-dep" [title]="d.description ?? d.name" (click)="np.alternarDependencia(d.id)">
                        <span class="novo-caixa" [class.ligado]="np.dependencias().has(d.id)">{{ np.dependencias().has(d.id) ? '✓' : '' }}</span>{{ d.name }}
                      </button>
                    }
                  </div>
                } @empty {
                  @if (np.spring()) { <div class="suave">nenhum iniciador com "{{ np.filtro() }}"</div> }
                }
              </div></div>
            } @else if (np.modelo() === 'react') {
              <p class="suave novo-nota novo-aviso">Roda <span class="destaque-texto">npx create-vite</span> (React + TypeScript) e depois <span class="destaque-texto">npm install</span>. Precisa do Node e de internet; a saída aparece à direita.</p>
            } @else if (np.modelo() === 'angular') {
              <p class="suave novo-nota novo-aviso">Roda <span class="destaque-texto">npx &#64;angular/cli new</span> (roteamento, CSS, sem SSR). Precisa do Node na versão que o Angular pede; a saída aparece à direita.</p>
            }
          </div>

          <div class="novo-previa">
            <span class="rotulo">{{ np.criando() || np.progresso().length ? 'CRIANDO' : 'VAI CRIAR' }}</span>
            @if (np.criando() || np.progresso().length) {
              <div #saida class="novo-saida">
                @for (l of np.progresso(); track $index) { <div [class.erro-texto]="l.startsWith('✕')">{{ l }}</div> }
              </div>
            } @else {
              <div class="novo-arvore">@for (l of arvore(); track $index) {<div><span class="suave">{{ l.galho }}</span><span [class]="l.classe">{{ l.nome }}</span></div>}</div>
            }
            <span class="espaco"></span>
            <div class="novo-extras suave">
              <button type="button" class="novo-dep" (click)="np.git.set(!np.git())"><span class="novo-caixa" [class.ligado]="np.git()">{{ np.git() ? '✓' : '' }}</span>git init + primeiro commit</button>
              <div><span class="git-mais">✓</span> abrir no Seedy ao terminar</div>
              @if (temMain()) { <div><span class="git-mais">✓</span> RUN aponta para a main</div> }
            </div>
          </div>
        </div>

        <div class="novo-rodape">
          <span class="suave"><span class="destaque-texto">tab</span> próximo campo</span>
          <span class="suave"><span class="destaque-texto">␣</span> marca</span>
          @if (np.modelo() === 'spring') { <span class="suave"><span class="destaque-texto">/</span> filtra acompanhamentos</span> }
          <span class="espaco"></span>
          @if (np.problema(); as p) { <span class="suave novo-problema">{{ p }}</span> }
          <button type="button" class="botao" [disabled]="np.criando()" (click)="np.fechar()">cancelar <kbd>esc</kbd></button>
          <button type="button" class="botao destaque" [disabled]="np.criando() || !!np.problema()" (click)="np.criar()">{{ np.criando() ? 'criando…' : 'criar projeto' }} <kbd>ctrl ⏎</kbd></button>
        </div>
      </section>
    }
  `,
})
export class NovoProjetoComponent {
  protected readonly np = inject(NovoProjetoService);
  protected readonly modelosLista = MODELOS;
  private readonly elNome = viewChild<ElementRef<HTMLInputElement>>('nome');
  private readonly elFiltro = viewChild<ElementRef<HTMLInputElement>>('filtro');
  private readonly elSaida = viewChild<ElementRef<HTMLElement>>('saida');
  private focoAnterior: HTMLElement | null = null;

  protected readonly separador = computed(() => (this.np.pastaPai().includes('\\') ? '\\' : '/'));
  protected readonly temMain = computed(() => ['spring', 'maven', 'simples'].includes(this.np.modelo()));

  /** Prévia da árvore que o modelo cria. */
  protected readonly arvore = computed(() => {
    const nome = this.np.nome() || 'meu-projeto';
    const pkg = this.np.pacote().replace(/\./g, '/');
    const java = (rel: string) => ({ nome: rel, classe: 'git-mais' });
    const pasta = (rel: string) => ({ nome: rel, classe: '' });
    const linhas: { nome: string; classe: string }[][] = [];
    switch (this.np.modelo()) {
      case 'spring': {
        const app = `${nomeDeClasse(this.np.nome() || 'meu-projeto')}Application`;
        const gradle = this.np.build() === 'gradle';
        linhas.push(
          [pasta(gradle ? 'build.gradle' : 'pom.xml')],
          [pasta(gradle ? 'gradlew  gradlew.bat' : 'mvnw  mvnw.cmd')],
          [pasta(`src/main/java/${pkg}/`)],
          [{ nome: '  └ ', classe: 'suave' }, java(`${app}.java`)],
          [pasta('src/main/resources/')],
          [{ nome: '  └ ', classe: 'suave' }, pasta('application.properties')],
          [pasta(`src/test/java/${pkg}/`)],
          [{ nome: '  └ ', classe: 'suave' }, pasta(`${app}Tests.java`)],
          [pasta('.gitignore')],
        );
        break;
      }
      case 'maven':
        linhas.push(
          [pasta('pom.xml')],
          [pasta(`src/main/java/${pkg}/`)],
          [{ nome: '  └ ', classe: 'suave' }, java('Main.java')],
          [pasta(`src/test/java/${pkg}/`)],
          [{ nome: '  └ ', classe: 'suave' }, pasta('MainTest.java')],
          [pasta('.gitignore')],
        );
        break;
      case 'war':
        linhas.push(
          [pasta('pom.xml')],
          [pasta(`src/main/java/${pkg}/`)],
          [{ nome: '  └ ', classe: 'suave' }, java('OlaServlet.java')],
          [pasta('src/main/webapp/')],
          [{ nome: '  └ ', classe: 'suave' }, pasta('index.jsp')],
          [pasta('.gitignore')],
        );
        break;
      case 'simples':
        linhas.push([pasta(`src/${pkg}/`)], [{ nome: '  └ ', classe: 'suave' }, java('Main.java')], [pasta('.gitignore')]);
        break;
      case 'react':
        linhas.push([pasta('package.json')], [pasta('vite.config.ts')], [pasta('index.html')], [pasta('src/')], [{ nome: '  └ ', classe: 'suave' }, java('App.tsx')], [pasta('src/main.tsx')], [pasta('node_modules/')]);
        break;
      case 'angular':
        linhas.push([pasta('angular.json')], [pasta('package.json')], [pasta('src/app/')], [{ nome: '  └ ', classe: 'suave' }, java('app.ts')], [pasta('src/main.ts')], [pasta('node_modules/')]);
        break;
    }
    return [
      { galho: '', nome: `${nome}/`, classe: 'destaque-texto' },
      ...linhas.map((partes, i) => ({
        galho: (i === linhas.length - 1 ? '└ ' : '├ ') + (partes.length > 1 ? partes[0].nome : ''),
        nome: partes[partes.length - 1].nome,
        classe: partes[partes.length - 1].classe,
      })),
    ];
  });

  constructor() {
    effect(() => {
      if (!this.np.aberta()) return;
      untracked(() => {
        this.focoAnterior = document.activeElement as HTMLElement | null;
        queueMicrotask(() => this.elNome()?.nativeElement.focus());
      });
    });
    effect(() => {
      this.np.progresso();
      untracked(() =>
        queueMicrotask(() => {
          const el = this.elSaida()?.nativeElement;
          if (el) el.scrollTop = el.scrollHeight;
        }),
      );
    });
    effect(() => {
      // Fechou: o foco volta para onde estava.
      if (this.np.aberta()) return;
      const f = untracked(() => this.focoAnterior);
      this.focoAnterior = null;
      if (f?.isConnected && f !== document.body) queueMicrotask(() => f.focus());
    });
  }

  protected valor(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected teclar(e: KeyboardEvent): void {
    const emCampo = (e.target as HTMLElement).tagName === 'INPUT';
    if (e.key === 'Escape') {
      if (emCampo && (e.target as HTMLElement) === this.elFiltro()?.nativeElement && this.np.filtro()) this.np.filtro.set('');
      else this.np.fechar();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      void this.np.criar();
    } else if (e.key.toLowerCase() === 'o' && (e.ctrlKey || e.metaKey)) {
      void this.np.escolherPasta();
    } else if (e.key === '/' && !emCampo && this.np.modelo() === 'spring') {
      this.elFiltro()?.nativeElement.focus();
    } else {
      // O resto (letras, tab, espaço) fica com o campo/botão; o líder e o editor não veem.
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  protected teclarModelos(e: KeyboardEvent): void {
    const i = MODELOS.findIndex((m) => m.id === this.np.modelo());
    if (e.key === 'j' || e.key === 'ArrowDown') this.np.escolherModelo(MODELOS[Math.min(MODELOS.length - 1, i + 1)].id);
    else if (e.key === 'k' || e.key === 'ArrowUp') this.np.escolherModelo(MODELOS[Math.max(0, i - 1)].id);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
}
