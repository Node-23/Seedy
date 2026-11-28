import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { Entrada, ponte } from '../nucleo/ponte';
import { ProjetoService } from '../nucleo/projeto.service';
import { EditorService } from '../editor/editor.service';
import { LayoutService } from '../layout/layout.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { GitService, LetraGit } from '../git/git.service';
import { Alvo, ArquivosService } from './arquivos.service';
import { pacoteDe } from './modelos';

interface No {
  entrada: Entrada;
  nivel: number;
  aberto: boolean;
  filhos: No[] | null;
}

/**
 * Árvore de arquivos do projeto.
 * Teclado: j/k ou ↑/↓ navegam, l/→/Enter abrem, h/← fecham a pasta, n ou Alt+Insert criam,
 * ctrl+c / ctrl+v copiam e colam, F2 ou Shift+F6 renomeiam, del apaga (para a Lixeira),
 * a tecla de menu abre o menu do botão direito.
 */
@Component({
  selector: 'sd-arvore',
  template: `
    <section class="painel arvore" aria-label="Arquivos">
      <div class="painel-faixa">
        <span class="rotulo">ARQUIVOS</span>
        <span class="faixa-acoes">
          <button class="botao-icone" aria-label="Novo arquivo" title="Novo arquivo (n)" [disabled]="!projeto.raiz()" (click)="novoPeloBotao($event)">+</button>
          <button class="botao-icone" aria-label="Mostrar o arquivo aberto" title="Mostrar o arquivo aberto (Alt+F1)" [disabled]="!editor.ativo()" (click)="arquivos.mostrarArquivoAberto()">◎</button>
          <button class="botao-icone" aria-label="Recarregar" title="Recarregar" (click)="projeto.recarregar()">↻</button>
          <kbd>Alt+1</kbd>
        </span>
      </div>
      <div
        #lista
        class="arvore-lista"
        role="tree"
        tabindex="0"
        [attr.aria-activedescendant]="selecionado() ? 'no-' + selecionado() : null"
        (keydown)="teclar($event)"
        (contextmenu)="menuNaRaiz($event)"
      >
        @if (!projeto.raiz()) {
          <p class="suave arvore-vazia">Nenhum projeto aberto.<br />
            <button class="botao" (click)="projeto.escolher()">abrir pasta</button></p>
        }
        @for (no of visiveis(); track no.entrada.caminho; let i = $index) {
          <div
            class="arvore-item"
            role="treeitem"
            [id]="'no-' + i"
            [attr.aria-expanded]="no.entrada.pasta ? no.aberto : null"
            [class.selecionado]="i === selecionado()"
            [class.ativo]="no.entrada.caminho === editor.ativo()"
            [attr.data-git]="corGit(no)"
            [style.padding-left.px]="12 + no.nivel * 14"
            (click)="selecionado.set(i); ativar(no)"
            (contextmenu)="$event.preventDefault(); $event.stopPropagation(); selecionado.set(i); arquivos.abrirMenu($event.clientX, $event.clientY, alvoDe(no))"
          >
            @if (no.entrada.pasta) {
              <span class="seta">{{ no.aberto ? '▾' : '▸' }}</span>
              <svg class="icone-pasta" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                @if (no.aberto) { <path d="M1.8 12.8V3.6c0-.6.4-1 1-1h3l1.4 1.6h5c.6 0 1 .4 1 1v1.4M1.8 12.8l1.7-5.2c.1-.4.5-.7.9-.7h9.6c.7 0 1.1.6.9 1.2l-1.4 4.2c-.1.4-.5.7-.9.7H2.8c-.6 0-1-.4-1-1z" /> }
                @else { <path d="M1.8 12.4V3.6c0-.6.4-1 1-1h3l1.4 1.6h6c.6 0 1 .4 1 1v7.2c0 .6-.4 1-1 1H2.8c-.6 0-1-.4-1-1z" /> }
              </svg>
            }
            @if (!no.entrada.pasta && tipoDe(no.entrada.nome); as t) {
              @if (t === 'java') {
                <svg class="tipo-arquivo tipo-java" data-tipo="java" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h8v3a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" /><path d="M11 8h1.2a1.6 1.6 0 0 1 0 3.2H11" /><path d="M5.5 2.5c-.8 1 .8 1.6 0 2.6M8.5 2.5c-.8 1 .8 1.6 0 2.6" /></svg>
              } @else {
                <span class="tipo-arquivo" [attr.data-tipo]="t">{{ t }}</span>
              }
            }
            <span class="nome">{{ no.entrada.nome }}</span>
            @if (letraGit(no.entrada.caminho); as l) {
              <span class="marca-git" [attr.data-letra]="l" [title]="tituloDaLetra(l)">{{ l === '?' ? 'U' : l }}</span>
            } @else if (sujo(no.entrada.caminho)) {
              <span class="marca-sujo" title="alterado e não salvo">●</span>
            }
          </div>
        }
      </div>
    </section>
  `,
})
export class ArvoreComponent {
  protected readonly projeto = inject(ProjetoService);
  protected readonly editor = inject(EditorService);
  private readonly layout = inject(LayoutService);
  private readonly mensagens = inject(MensagensService);
  private readonly git = inject(GitService);
  protected readonly arquivos = inject(ArquivosService);
  private readonly lista = viewChild.required<ElementRef<HTMLDivElement>>('lista');

  private readonly raizes = signal<No[]>([]);
  /** Força o recálculo depois de abrir/fechar pastas (os nós são mutáveis). */
  private readonly mudancas = signal(0);
  protected readonly selecionado = signal(0);

  protected readonly visiveis = computed(() => {
    this.mudancas();
    const saida: No[] = [];
    const visitar = (nos: No[]) => {
      for (const no of nos) {
        saida.push(no);
        if (no.aberto && no.filhos) visitar(no.filhos);
      }
    };
    visitar(this.raizes());
    return saida;
  });

  constructor() {
    effect(() => {
      this.projeto.versao();
      const raiz = this.projeto.raiz();
      // untracked: o carregamento lê outros sinais que não devem disparar este efeito.
      untracked(() => void this.naFila(async () => (raiz ? this.carregarRaiz(raiz) : this.raizes.set([]))));
    });
    this.arquivos.selecionado = () => {
      const no = this.visiveis()[this.selecionado()];
      return no ? this.alvoDe(no) : null;
    };
    // Acabou de criar ou colar: abre as pastas até lá e seleciona.
    effect(() => {
      const pedido = this.arquivos.revelar();
      if (pedido) untracked(() => void this.naFila(() => this.revelarCaminho(pedido.caminho)));
    });
    effect(() => {
      const pedido = this.layout.pedidoDeFoco();
      if (pedido?.id === 'arquivos') queueMicrotask(() => this.lista().nativeElement.focus());
    });
  }

  /** Situação no Git (M alterado, A/U novo, D apagado, R renomeado, C conflito). */
  protected letraGit(caminho: string): LetraGit | null {
    return this.git.letraDe(caminho);
  }

  /** A cor do nome, como no IntelliJ: a situação do arquivo, ou "ignorado" (arquivo ou pasta). */
  protected corGit(no: No): LetraGit | 'ignorado' | null {
    const caminho = no.entrada.caminho;
    const letra = no.entrada.pasta ? null : this.git.letraDe(caminho);
    return letra ?? (this.git.ignorado(caminho) ? 'ignorado' : null);
  }

  protected tituloDaLetra(l: LetraGit): string {
    return { M: 'alterado', A: 'novo (no stage)', D: 'apagado', R: 'renomeado', C: 'em conflito', '?': 'novo (fora do git)' }[l];
  }

  protected sujo(caminho: string): boolean {
    const b = this.editor.buffers().find((x) => x.caminho === caminho);
    return !!b && this.editor.sujo(b);
  }

  protected async ativar(no: No): Promise<void> {
    if (no.entrada.pasta) await this.alternar(no);
    else await this.editor.abrir(no.entrada.caminho);
  }

  /** Recarregar e revelar mexem na mesma árvore: um de cada vez, senão um desfaz o outro. */
  private fila: Promise<unknown> = Promise.resolve();

  private naFila(fazer: () => Promise<void>): Promise<unknown> {
    return (this.fila = this.fila.then(fazer).catch((e) => this.mensagens.erro(String(e))));
  }

  protected alvoDe(no: No): Alvo {
    return { caminho: no.entrada.caminho, pasta: no.entrada.pasta };
  }

  /** O "+" do topo: os tipos, na pasta do item selecionado (ou na raiz). */
  protected novoPeloBotao(e: MouseEvent): void {
    const raiz = this.projeto.raiz();
    if (!raiz) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.arquivos.abrirMenu(r.left, r.bottom + 6, this.arquivos.selecionado() ?? { caminho: raiz, pasta: true }, true);
  }

  /** Botão direito no vazio: age na raiz do projeto. */
  protected menuNaRaiz(e: MouseEvent): void {
    const raiz = this.projeto.raiz();
    if (!raiz) return;
    e.preventDefault();
    this.arquivos.abrirMenu(e.clientX, e.clientY, { caminho: raiz, pasta: true });
  }

  private async revelarCaminho(caminho: string): Promise<void> {
    const raiz = this.projeto.raiz();
    if (!raiz) return;
    await this.carregarRaiz(raiz);
    const dentro = (pasta: string) => caminho.startsWith(pasta) && /^[\\/]/.test(caminho.slice(pasta.length));
    let nos = this.raizes();
    for (;;) {
      const pasta = nos.find((n) => n.entrada.pasta && dentro(n.entrada.caminho));
      if (!pasta) break;
      pasta.filhos = await this.carregar(pasta.entrada.caminho, pasta.nivel + 1);
      pasta.aberto = true;
      nos = pasta.filhos;
    }
    this.mudancas.update((n) => n + 1);
    const i = this.visiveis().findIndex((n) => n.entrada.caminho === caminho);
    if (i < 0) return;
    this.selecionado.set(i);
    setTimeout(() => this.lista().nativeElement.querySelector(`#no-${i}`)?.scrollIntoView({ block: 'nearest' }));
  }

  protected teclar(e: KeyboardEvent): void {
    const nos = this.visiveis();
    const atual = nos[this.selecionado()];
    const raiz = this.projeto.raiz();
    const alvo = atual ? this.alvoDe(atual) : raiz ? { caminho: raiz, pasta: true } : null;
    const tecla = e.key.toLowerCase();
    if (alvo && (e.key === 'F2' || (e.key === 'F6' && e.shiftKey) || e.key === 'Delete')) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Delete') return this.arquivos.pedirApagar(alvo);
      this.arquivos.abrirMenu(0, 0, alvo);
      return this.arquivos.pedirRenomear(alvo);
    }
    // Novo, copiar, colar e o menu: com o teclado, na linha selecionada.
    const novo = (e.key === 'n' && !e.ctrlKey && !e.altKey) || (e.key === 'Insert' && e.altKey);
    const deMenu = e.key === 'ContextMenu';
    const ctrl = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
    if (alvo && (novo || deMenu || (ctrl && (tecla === 'c' || tecla === 'v')))) {
      e.preventDefault();
      e.stopPropagation();
      if (ctrl && tecla === 'c') return this.arquivos.copiar(alvo);
      if (ctrl) return void this.arquivos.colar(alvo);
      const linha = this.lista().nativeElement.querySelector(`#no-${this.selecionado()}`) ?? this.lista().nativeElement;
      const r = linha.getBoundingClientRect();
      return this.arquivos.abrirMenu(r.left + 90, r.top + 20, alvo, novo);
    }
    const mover = (d: number) => {
      this.selecionado.set(Math.max(0, Math.min(nos.length - 1, this.selecionado() + d)));
      this.lista().nativeElement.querySelector(`#no-${this.selecionado()}`)?.scrollIntoView({ block: 'nearest' });
    };
    switch (e.key) {
      case 'j':
      case 'ArrowDown':
        mover(1);
        break;
      case 'k':
      case 'ArrowUp':
        mover(-1);
        break;
      case 'l':
      case 'ArrowRight':
      case 'Enter':
        if (atual) void this.ativar(atual);
        break;
      case 'h':
      case 'ArrowLeft':
        if (atual?.entrada.pasta && atual.aberto) void this.alternar(atual);
        break;
      case 'Escape':
        this.editor.focar();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  private async alternar(no: No): Promise<void> {
    if (!no.aberto && no.filhos === null) {
      no.filhos = await this.carregar(no.entrada.caminho, no.nivel + 1);
    }
    no.aberto = !no.aberto;
    this.mudancas.update((n) => n + 1);
  }

  private async carregarRaiz(raiz: string): Promise<void> {
    // Recarregar mantém abertas as pastas que já estavam.
    const abertas = new Set(this.visiveis().filter((n) => n.aberto).map((n) => n.entrada.caminho));
    const reabrir = async (nos: No[]): Promise<void> => {
      for (const no of nos) {
        if (no.entrada.pasta && abertas.has(no.entrada.caminho)) {
          no.filhos = await this.carregar(no.entrada.caminho, no.nivel + 1);
          no.aberto = true;
          await reabrir(no.filhos);
        }
      }
    };
    const nos = await this.carregar(raiz, 0);
    await reabrir(nos);
    this.raizes.set(nos);
    this.selecionado.set(Math.min(this.selecionado(), Math.max(0, this.visiveis().length - 1)));
  }

  private async carregar(caminho: string, nivel: number): Promise<No[]> {
    try {
      const entradas = await ponte.lerPasta(caminho);
      const juntas = await Promise.all(entradas.map((e) => this.juntarPacotes(e)));
      return juntas.map((entrada) => ({ entrada, nivel, aberto: false, filhos: null }));
    } catch (e) {
      this.mensagens.erro(String(e));
      return [];
    }
  }

  /**
   * Dentro das fontes Java, um pacote que só tem outro pacote vira uma linha só (br/com/mana),
   * como no IntelliJ. A linha vale pela pasta mais funda.
   */
  private async juntarPacotes(entrada: Entrada): Promise<Entrada> {
    if (!entrada.pasta || !pacoteDe(entrada.caminho)) return entrada;
    let atual = entrada;
    const nomes = [entrada.nome];
    for (let n = 0; n < 20; n++) {
      const filhos = await ponte.lerPasta(atual.caminho).catch(() => [] as Entrada[]);
      if (filhos.length !== 1 || !filhos[0].pasta) break;
      atual = filhos[0];
      nomes.push(atual.nome);
    }
    return { nome: nomes.join('/'), caminho: atual.caminho, pasta: true };
  }

  /** Ícone do tipo do arquivo: xícara (java) ou marca curta (TS, JS, <>, #, {}, XML...). */
  protected tipoDe(nome: string): string | null {
    const i = nome.lastIndexOf('.');
    if (i < 0) return nome.toLowerCase() === 'dockerfile' ? 'DK' : null;
    const ext = nome.slice(i + 1).toLowerCase();
    const mapa: Record<string, string> = {
      java: 'java', jsp: 'JSP', class: 'CL', jar: 'JAR',
      ts: 'TS', tsx: 'TS', mts: 'TS', js: 'JS', jsx: 'JS', mjs: 'JS', cjs: 'JS',
      html: '<>', htm: '<>', css: '#', scss: '#', less: '#', json: '{}',
      xml: 'XML', xsd: 'XML', properties: 'CFG', yml: 'YML', yaml: 'YML', toml: 'CFG',
      md: 'MD', txt: 'TXT', sql: 'SQL', sh: 'SH', bat: 'SH', ps1: 'SH',
      doc: 'DOC', docx: 'DOC', odt: 'DOC', rtf: 'DOC', xls: 'XLS', xlsx: 'XLS', ods: 'XLS', csv: 'XLS',
      ppt: 'PPT', pptx: 'PPT', odp: 'PPT', pdf: 'PDF', zip: 'ZIP', rar: 'ZIP', '7z': 'ZIP', tar: 'ZIP', gz: 'ZIP',
      rs: 'RS', gradle: 'GR', png: 'IMG', jpg: 'IMG', jpeg: 'IMG', gif: 'IMG', svg: 'IMG', ico: 'IMG',
    };
    return mapa[ext] ?? null;
  }
}
