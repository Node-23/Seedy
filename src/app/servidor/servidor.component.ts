import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { ServidorService } from './servidor.service';
import { DepuradorService } from './depurador.service';
import { LayoutService } from '../layout/layout.service';
import { EditorService } from '../editor/editor.service';
import { deFramework, LinhaDeLog } from './log';
import { ExecucaoDeMain, ExecucaoService } from '../execucao/execucao.service';

type Filtro = 'todos' | 'avisos' | 'erros';
type Item = { tipo: 'linha'; l: LinhaDeLog; projeto: boolean } | { tipo: 'oculto'; chave: number; total: number };

const NOME_DO_NIVEL = { erro: 'ERROR', aviso: 'WARN ', info: 'INFO ', debug: 'DEBUG' } as const;

/**
 * Painel do servidor (mockup 06): estado, contadores de ERROR/WARN, redeploy, debug,
 * parar e a saída com stack trace clicável. Com o depurador anexado, a coluna da
 * direita mostra pilha, variáveis e o avaliador.
 */
@Component({
  selector: 'sd-servidor',
  template: `
    <section class="painel servidor" aria-label="Servidor">
      <div class="servidor-faixa">
        @if (mainEscolhida(); as cfg) {
          <!-- A configuração de execução é uma classe main: o painel mostra a saída dela. -->
          <span class="rotulo">EXECUÇÃO</span>
          <button class="servidor-nome" title="trocar o que roda (␣ r)" (click)="exec.escolherConfig()">{{ cfg.nome }}</button>
          <span class="servidor-estado" [attr.data-fase]="exec.main()?.config?.id === cfg.id ? exec.main()!.fase : 'parado'"><span class="ponto"></span>{{ textoDoEstado() }}</span>
          <span class="espaco"></span>
          @if (fonte(); as e) {
            <button class="chip-log erro" [class.ligado]="filtro() === 'erros'" (click)="alternarFiltro('erros')">ERROR {{ e.erros }}</button>
            <button class="chip-log" [class.ligado]="filtro() === 'avisos'" (click)="alternarFiltro('avisos')">WARN {{ e.avisos }}</button>
          }
          @if (rodando()) {
            <button class="botao perigo" (click)="exec.parar()" title="ctrl+F2">■ parar</button>
          } @else {
            <button class="botao" (click)="exec.rodar(true)" title="shift+F9">debug</button>
            <button class="botao destaque" (click)="exec.rodar(false)" title="shift+F10">▶ rodar</button>
          }
        } @else {
        <span class="rotulo">SERVIDOR</span>
        @if (s.perfilAtual(); as p) {
          <button class="servidor-nome" title="trocar de servidor (s)" (click)="s.escolher()">{{ p.nome }}</button>
          @if (s.execucaoAtual(); as e) {
            <span class="servidor-estado" [attr.data-fase]="e.fase"><span class="ponto"></span>{{ textoDoEstado() }}</span>
          } @else {
            <span class="servidor-estado" data-fase="parado"><span class="ponto"></span>parado</span>
          }
          <span class="espaco"></span>
          @if (s.execucaoAtual(); as e) {
            <button class="chip-log erro" [class.ligado]="filtro() === 'erros'" (click)="alternarFiltro('erros')">ERROR {{ e.erros }}</button>
            <button class="chip-log" [class.ligado]="filtro() === 'avisos'" (click)="alternarFiltro('avisos')">WARN {{ e.avisos }}</button>
          }
          @if (rodando()) {
            <button class="botao" (click)="s.redeploy()" title="ctrl+F10">↻ redeploy</button>
            @if (s.execucaoAtual()?.info?.portaDebug; as porta) {
              <button class="botao" [class.destaque-texto]="dep.ativo()" (click)="dep.ativo() ? dep.desanexar() : dep.anexar(p.id, porta)"
                      [title]="dep.ativo() ? 'depurador anexado (clique para soltar)' : 'anexar o depurador'">debug :{{ porta }}</button>
            }
            <button class="botao perigo" (click)="s.parar()" title="ctrl+F2">■ parar</button>
          } @else {
            <button class="botao" (click)="s.iniciar(true)" title="shift+F9">debug</button>
            <button class="botao destaque" (click)="s.iniciar(false)" title="shift+F10">▶ iniciar</button>
          }
        } @else {
          <span class="espaco"></span>
        }
        }
      </div>

      <div class="servidor-corpo">
        <div #lista class="servidor-log" tabindex="0" role="log" aria-label="Saída do servidor" (keydown)="teclar($event)" (scroll)="aoRolar()">
          @if (mainEscolhida(); as cfg) {
            @if (!fonte()) {
              <div class="servidor-vazio">
                <p>{{ cfg.mainClass }}</p>
                <p class="suave">shift+F10 roda, shift+F9 depura; a saída do programa aparece aqui. ␣ r troca o que roda.</p>
                <button class="botao destaque" (click)="exec.rodar(false)">▶ rodar <kbd>⇧F10</kbd></button>
              </div>
            }
          } @else if (!s.perfilAtual()) {
            <div class="servidor-vazio">
              <p>Nenhum servidor configurado para este projeto.</p>
              <p class="suave">WildFly/JBoss ou Tomcat: o Seedy monta a aplicação explodida a partir do projeto, sobe, faz hot swap de JSP e estáticos e anexa o depurador.</p>
              <button class="botao destaque" (click)="s.novo()">+ novo servidor <kbd>n</kbd></button>
            </div>
          }
          @for (it of itens(); track $index; let i = $index) {
            @if (it.tipo === 'linha') {
              <div class="log-linha" [attr.data-nivel]="it.l.nivel" [class.seedy]="it.l.seedy" [class.pilha]="it.l.pilha"
                   [class.framework]="it.l.frame && !it.projeto" [class.selecionada]="i === sel()" (click)="sel.set(i)">
                @if (it.l.frame; as f) {
                  <span class="log-recuo">    at </span>
                  @if (it.projeto) {
                    <a class="log-frame" (click)="s.abrirFrame(f); $event.stopPropagation()">{{ prefixo(f.classe) }}{{ simples(f.classe) }}.{{ f.metodo }}({{ f.arquivo }}{{ f.linha ? ':' + f.linha : '' }})</a>
                  } @else {
                    <span>{{ f.classe }}.{{ f.metodo }}({{ f.arquivo }}{{ f.linha ? ':' + f.linha : '' }})</span>
                  }
                } @else if (it.l.pilha || !it.l.nivel) {
                  <span>{{ it.l.texto }}</span>
                } @else {
                  <span class="log-hora">{{ it.l.hora ?? '' }}</span><span class="log-nivel">{{ nomeDoNivel(it.l.nivel) }}</span><span>{{ it.l.mensagem }}</span>
                }
              </div>
            } @else {
              <div class="log-linha recolhido" [class.selecionada]="i === sel()" (click)="expandir(it.chave)">    ... {{ it.total }} linhas ocultas</div>
            }
          }
        </div>

        @if (dep.depurando()) {
          <aside class="depurador" aria-label="Depurador">
            <div class="depurador-faixa">
              <span class="rotulo destaque-texto">DEBUG</span>
              @if (dep.pausado(); as pz) {
                <span class="aviso-texto">● pausado@if (dep.localAtual(); as l) { em {{ arquivo(l.caminho) }}:{{ l.linha }} }</span>
              } @else {
                <span class="git-mais">● rodando</span>
              }
            </div>
            <div class="depurador-controles">
              <button class="botao" (click)="dep.continuar()" [disabled]="!dep.pausado()" title="F9">▶ <kbd>F9</kbd></button>
              <button class="botao" (click)="dep.passar()" [disabled]="!dep.pausado()" title="passar (F8)">⤼ <kbd>F8</kbd></button>
              <button class="botao" (click)="dep.entrar()" [disabled]="!dep.pausado()" title="entrar (F7)">↓ <kbd>F7</kbd></button>
              <button class="botao" (click)="dep.sair()" [disabled]="!dep.pausado()" title="sair (shift+F8)">↑ <kbd>⇧F8</kbd></button>
            </div>
            <div class="depurador-secao">PILHA</div>
            <div class="depurador-lista">
              @for (f of dep.frames(); track f.id) {
                <div class="depurador-item" [class.selecionado]="f.id === dep.frameAtual()" [class.suave]="!f.source?.path" (click)="dep.escolherFrame(f.id)">
                  {{ f.name }} <span class="suave">{{ f.source?.name ?? '' }}{{ f.source?.name ? ':' + f.line : '' }}</span>
                </div>
              } @empty {
                <div class="suave depurador-item">ctrl+F8 marca um breakpoint na linha</div>
              }
            </div>
            <div class="depurador-secao">VARIÁVEIS</div>
            <div class="depurador-lista variaveis">
              @for (n of dep.variaveis(); track n.chave) {
                <div class="depurador-item" [style.padding-left.px]="10 + n.nivel * 14" (click)="dep.alternarVariavel(n.chave)">
                  <span class="seta">{{ n.v.variablesReference ? (n.aberto ? '▾' : '▸') : '' }}</span>
                  <span class="destaque-texto">{{ n.v.name }}</span> = <span class="valor">{{ n.v.value }}</span>
                </div>
              }
            </div>
            <div class="depurador-secao">AVALIAR <kbd>alt F8</kbd></div>
            <div class="depurador-avaliacoes">
              @for (a of dep.avaliacoes(); track $index) {
                <div><span class="suave">› {{ a.expressao }}</span><br /><span [class.erro-texto]="a.erro">{{ a.resultado }}</span></div>
              }
            </div>
            <input #avaliar class="depurador-avaliar" type="text" spellcheck="false" placeholder="expressão (⏎)" aria-label="Expressão para avaliar"
                   (keydown)="teclarAvaliar($event)" />
          </aside>
        }
      </div>
    </section>
  `,
})
export class ServidorComponent {
  protected readonly s = inject(ServidorService);
  protected readonly exec = inject(ExecucaoService);
  protected readonly dep = inject(DepuradorService);
  private readonly layout = inject(LayoutService);
  private readonly editor = inject(EditorService);
  private readonly lista = viewChild.required<ElementRef<HTMLElement>>('lista');
  private readonly campoAvaliar = viewChild<ElementRef<HTMLInputElement>>('avaliar');

  protected readonly filtro = signal<Filtro>('todos');
  protected readonly sel = signal(-1);
  private readonly expandidos = signal(new Set<number>());
  /** Acompanha o fim da saída (desliga quando o usuário rola para cima). */
  private seguir = true;

  /** Configuração escolhida quando é uma classe main (senão, o painel é do servidor). */
  protected readonly mainEscolhida = computed(() => {
    const c = this.exec.atual();
    return c?.tipo === 'main' ? c : null;
  });
  /** De onde vem a saída mostrada: o processo main ou o servidor. */
  protected readonly fonte = computed(() => {
    const cfg = this.mainEscolhida();
    if (!cfg) return this.s.execucaoAtual();
    const m = this.exec.main();
    return m && m.config.id === cfg.id ? m : null;
  });

  protected readonly rodando = computed(() => {
    if (this.mainEscolhida()) return this.exec.rodando();
    const f = this.s.execucaoAtual()?.fase;
    return f === 'subindo' || f === 'rodando' || f === 'parando';
  });

  protected readonly textoDoEstado = computed(() => {
    if (this.mainEscolhida()) {
      const m = this.fonte() as ExecucaoDeMain | null;
      if (!m) return 'parado';
      if (m.fase === 'parado') return m.codigo !== null ? `terminou · código ${m.codigo}` : 'parado';
      return m.debug ? 'rodando (debug)' : 'rodando';
    }
    const e = this.s.execucaoAtual();
    if (!e) return 'parado';
    if (e.fase === 'subindo') return e.debug ? 'subindo (debug)…' : 'subindo…';
    if (e.fase === 'parando') return 'parando…';
    if (e.fase === 'parado') return 'parado';
    const t = e.subiuEm !== null ? ` · subiu em ${(e.subiuEm / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s` : '';
    return `rodando${t}${e.info ? ` · :${new URL(e.info.url).port}` : ''}`;
  });

  /** Linhas visíveis: filtradas por nível e com os frames de framework recolhidos. */
  protected readonly itens = computed<Item[]>(() => {
    const linhas = this.fonte()?.linhas ?? [];
    const filtro = this.filtro();
    const expandidos = this.expandidos();
    const saida: Item[] = [];
    let i = 0;
    while (i < linhas.length) {
      const l = linhas[i];
      if (filtro === 'erros' && l.nivel !== 'erro') {
        i++;
        continue;
      }
      if (filtro === 'avisos' && l.nivel !== 'erro' && l.nivel !== 'aviso') {
        i++;
        continue;
      }
      // Sequência de frames de framework: mostra 2, recolhe o resto.
      if (l.frame && deFramework(l.frame.classe) && !expandidos.has(l.n)) {
        let j = i;
        while (j < linhas.length && (linhas[j].frame ? deFramework(linhas[j].frame!.classe) : /^\s+\.\.\./.test(linhas[j].texto))) j++;
        const total = j - i;
        if (total > 3) {
          saida.push({ tipo: 'linha', l: linhas[i], projeto: false }, { tipo: 'linha', l: linhas[i + 1], projeto: false });
          saida.push({ tipo: 'oculto', chave: l.n, total: total - 2 });
          i = j;
          continue;
        }
      }
      saida.push({ tipo: 'linha', l, projeto: !!l.frame && !deFramework(l.frame.classe) && !!this.s.arquivoDoFrame(l.frame) });
      i++;
    }
    return saida;
  });

  constructor() {
    effect(() => {
      const pedido = this.layout.pedidoDeFoco();
      if (pedido?.id === 'servidor') untracked(() => queueMicrotask(() => this.lista().nativeElement.focus()));
    });
    // Saída nova: desce até o fim (se o usuário não rolou para cima).
    effect(() => {
      this.itens();
      untracked(() =>
        queueMicrotask(() => {
          const el = this.lista()?.nativeElement;
          if (el && this.seguir) el.scrollTop = el.scrollHeight;
        }),
      );
    });
  }

  protected aoRolar(): void {
    const el = this.lista().nativeElement;
    this.seguir = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  protected alternarFiltro(f: Filtro): void {
    this.filtro.set(this.filtro() === f ? 'todos' : f);
  }

  protected expandir(chave: number): void {
    this.expandidos.update((s) => new Set(s).add(chave));
  }

  protected nomeDoNivel(n: keyof typeof NOME_DO_NIVEL): string {
    return NOME_DO_NIVEL[n];
  }

  /** `br.gov.pcnet.custodia.X` → `...custodia.` (como no mockup). */
  protected prefixo(classe: string): string {
    const partes = classe.split('.');
    return partes.length > 2 ? `...${partes[partes.length - 2]}.` : partes.length === 2 ? `${partes[0]}.` : '';
  }

  protected simples(classe: string): string {
    return classe.split('.').pop() ?? classe;
  }

  protected arquivo(caminho: string): string {
    return caminho.split(/[\\/]/).pop() ?? caminho;
  }

  focarAvaliar(): void {
    this.campoAvaliar()?.nativeElement.focus();
  }

  protected teclarAvaliar(e: KeyboardEvent): void {
    const campo = e.target as HTMLInputElement;
    if (e.key === 'Enter') {
      void this.dep.avaliar(campo.value);
      campo.value = '';
    } else if (e.key === 'Escape') {
      this.lista().nativeElement.focus();
    } else {
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  protected teclar(e: KeyboardEvent): void {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const itens = this.itens();
    const ir = (i: number) => {
      this.sel.set(Math.max(0, Math.min(itens.length - 1, i)));
      this.seguir = this.sel() === itens.length - 1;
      queueMicrotask(() => this.lista().nativeElement.querySelector('.log-linha.selecionada')?.scrollIntoView({ block: 'nearest' }));
    };
    switch (e.key) {
      case 'j':
      case 'ArrowDown':
        ir(this.sel() + 1);
        break;
      case 'k':
      case 'ArrowUp':
        ir(this.sel() < 0 ? itens.length - 1 : this.sel() - 1);
        break;
      case 'g':
        ir(0);
        break;
      case 'G':
        ir(itens.length - 1);
        this.seguir = true;
        break;
      case 'Enter': {
        const it = itens[this.sel()];
        if (it?.tipo === 'oculto') this.expandir(it.chave);
        else if (it?.l.frame) void this.s.abrirFrame(it.l.frame);
        break;
      }
      case 'i':
        void (this.mainEscolhida() ? this.exec.rodar(false) : this.s.iniciar(false));
        break;
      case 'd':
        void (this.mainEscolhida() ? this.exec.rodar(true) : this.s.iniciar(true));
        break;
      case 'x':
        void (this.mainEscolhida() ? this.exec.parar() : this.s.parar());
        break;
      case 'r':
        void this.s.redeploy();
        break;
      case 'o':
        void this.s.abrirNoNavegador();
        break;
      case 'e':
        this.alternarFiltro('erros');
        break;
      case 'w':
        this.alternarFiltro('avisos');
        break;
      case 'a':
        this.filtro.set('todos');
        break;
      case 'c':
        if (this.mainEscolhida()) this.exec.limparSaida();
        else this.s.limpar();
        break;
      case 's':
        void this.s.escolher();
        break;
      case 'n':
        void this.s.novo();
        break;
      case 'E': {
        const p = this.s.perfilAtual();
        if (p) this.s.editar(p.id);
        break;
      }
      case 'Escape':
        this.editor.focar();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }
}
