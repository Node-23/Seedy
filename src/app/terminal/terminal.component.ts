import {
  afterNextRender,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
  viewChildren,
} from '@angular/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { noApp, ponte } from '../nucleo/ponte';
import { ProjetoService } from '../nucleo/projeto.service';
import { TemaService, Tema } from '../tema/tema';
import { LayoutService } from '../layout/layout.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { ConfigService } from '../config/config.service';
import { TerminalService } from './terminal.service';

interface Aba {
  chave: number;
  titulo: string;
  idPty: number | null;
  terminal: Terminal;
  ajuste: FitAddon;
  montado: boolean;
  /** Programa da aba no lugar do shell (ex.: docker exec num container). */
  comando?: string[];
}

let proximaChave = 1;

/** Painel de terminal com abas. Cada aba é um shell de verdade (PTY no núcleo). */
@Component({
  selector: 'sd-terminal',
  template: `
    <section class="painel terminal" aria-label="Terminal">
      <div class="painel-faixa">
        <span class="rotulo">TERMINAL</span>
        <div class="abas" role="tablist">
          @for (aba of abas(); track aba.chave) {
            <div class="aba" role="tab" [attr.aria-selected]="aba.chave === ativa()" [class.ativa]="aba.chave === ativa()">
              <button class="aba-nome" (click)="ativar(aba.chave)">{{ aba.titulo }}</button>
              <button class="aba-fechar" [attr.aria-label]="'Fechar ' + aba.titulo" (click)="fechar(aba.chave)">×</button>
            </div>
          }
          <button class="botao-icone" aria-label="Novo terminal" title="Novo terminal" (click)="novo()">+</button>
        </div>
        <span class="faixa-acoes">
          <kbd>alt f12</kbd>
          <button class="botao-icone" aria-label="Fechar painel" title="Fechar painel" (click)="layout.alternar('terminal')">–</button>
        </span>
      </div>
      <div class="terminal-corpo">
        @for (aba of abas(); track aba.chave) {
          <div #hospedeiro class="terminal-hospedeiro" [attr.data-chave]="aba.chave" [class.oculto]="aba.chave !== ativa()"></div>
        }
      </div>
    </section>
  `,
})
export class TerminalComponent {
  private readonly config = inject(ConfigService);
  protected readonly layout = inject(LayoutService);
  private readonly projeto = inject(ProjetoService);
  private readonly tema = inject(TemaService);
  private readonly mensagens = inject(MensagensService);
  private readonly terminais = inject(TerminalService);
  private readonly hospedeiros = viewChildren<ElementRef<HTMLDivElement>>('hospedeiro');

  protected readonly abas = signal<Aba[]>([]);
  protected readonly ativa = signal<number | null>(null);
  private observador: ResizeObserver | null = null;

  constructor() {
    afterNextRender(() => {
      const corpo = document.querySelector('.terminal-corpo');
      this.observador = new ResizeObserver(() => this.ajustarAtiva());
      if (corpo) this.observador.observe(corpo);
    });

    // Monta no DOM as abas novas assim que o hospedeiro delas aparece.
    effect(() => {
      for (const ref of this.hospedeiros()) {
        const chave = Number(ref.nativeElement.dataset['chave']);
        const aba = this.abas().find((a) => a.chave === chave);
        if (aba && !aba.montado) this.montar(aba, ref.nativeElement);
      }
    });

    // O painel só é escondido (não destruído), para os shells continuarem vivos.
    effect(() => {
      // Sem projeto (tela de início) não abre shell: ele nasceria na pasta errada.
      if (!this.layout.disposicao().visiveis.terminal || !this.projeto.pronto() || !this.projeto.raiz()) return;
      if (untracked(this.abas).length === 0) void this.novo();
      queueMicrotask(() => this.ajustarAtiva());
    });

    // Fechou o projeto: os shells dele fecham junto.
    effect(() => {
      if (this.projeto.raiz() || !this.projeto.pronto()) return;
      untracked(() => {
        for (const aba of this.abas()) this.descartar(aba);
        this.abas.set([]);
        this.ativa.set(null);
      });
    });

    effect(() => {
      const t = this.tema.tema();
      for (const aba of this.abas()) this.aplicarTema(aba.terminal, t);
      queueMicrotask(() => this.ajustarAtiva());
    });

    effect(() => {
      const pedido = this.layout.pedidoDeFoco();
      if (pedido?.id === 'terminal') queueMicrotask(() => this.focarAtiva());
    });

    // Outros módulos pedem uma aba rodando um comando (ex.: shell num container).
    effect(() => {
      const pedido = this.terminais.pedido();
      if (!pedido) return;
      untracked(() => {
        void this.novo(pedido.comando, pedido.titulo);
        this.layout.mostrar('terminal');
      });
    });

    inject(DestroyRef).onDestroy(() => {
      this.observador?.disconnect();
      for (const aba of this.abas()) this.descartar(aba);
    });
  }

  protected async novo(comando?: string[], titulo?: string): Promise<void> {
    const terminal = new Terminal({
      cursorBlink: true,
      allowProposedApi: false,
      scrollback: 5000,
      ...this.opcoesDeFonte(this.tema.tema()),
    });
    const ajuste = new FitAddon();
    terminal.loadAddon(ajuste);
    this.aplicarTema(terminal, this.tema.tema());
    const chave = proximaChave++;
    const aba: Aba = { chave, titulo: titulo ?? `shell ${chave}`, idPty: null, terminal, ajuste, montado: false, comando };
    this.abas.update((l) => [...l, aba]);
    this.ativa.set(chave);
  }

  protected ativar(chave: number): void {
    this.ativa.set(chave);
    queueMicrotask(() => {
      this.ajustarAtiva();
      this.focarAtiva();
    });
  }

  protected fechar(chave: number): void {
    const aba = this.abas().find((a) => a.chave === chave);
    if (!aba) return;
    this.descartar(aba);
    const resto = this.abas().filter((a) => a !== aba);
    this.abas.set(resto);
    if (this.ativa() === chave) this.ativa.set(resto[resto.length - 1]?.chave ?? null);
    if (resto.length === 0) this.layout.alternar('terminal');
  }

  private async montar(aba: Aba, el: HTMLDivElement): Promise<void> {
    aba.montado = true;
    aba.terminal.open(el);
    aba.ajuste.fit();
    aba.terminal.focus();

    if (!noApp()) {
      aba.terminal.writeln('O terminal funciona dentro do app (npm run tauri dev).');
      return;
    }
    try {
      aba.idPty = await ponte.terminal.abrir(
        this.projeto.raiz(),
        aba.terminal.cols,
        aba.terminal.rows,
        (texto) => aba.terminal.write(texto),
        () => aba.terminal.writeln('\r\n[processo encerrado]'),
        aba.comando ?? null,
        this.config.atual().terminal.shell ? [this.config.atual().terminal.shell!, ...this.config.atual().terminal.argumentos] : null,
      );
      aba.terminal.onData((dados) => {
        if (aba.idPty !== null) void ponte.terminal.escrever(aba.idPty, dados);
      });
      aba.terminal.onResize(({ cols, rows }) => {
        if (aba.idPty !== null) void ponte.terminal.redimensionar(aba.idPty, cols, rows);
      });
      aba.terminal.onTitleChange((titulo) => {
        if (aba.comando) return; // aba de comando (ex.: container) mantém o nome dado
        aba.titulo = titulo.length > 24 ? '…' + titulo.slice(-23) : titulo || aba.titulo;
        this.abas.update((l) => [...l]);
      });
    } catch (e) {
      this.mensagens.falha('não consegui abrir o terminal', e);
      aba.terminal.writeln(`Erro ao abrir o shell: ${e}`);
    }
  }

  private descartar(aba: Aba): void {
    if (aba.idPty !== null) void ponte.terminal.fechar(aba.idPty);
    aba.terminal.dispose();
  }

  private ajustarAtiva(): void {
    const aba = this.abas().find((a) => a.chave === this.ativa());
    if (aba?.montado) {
      try {
        aba.ajuste.fit();
      } catch {
        // painel oculto: sem tamanho para medir
      }
    }
  }

  private focarAtiva(): void {
    this.abas().find((a) => a.chave === this.ativa())?.terminal.focus();
  }

  private opcoesDeFonte(t: Tema) {
    const f = t.fontes.codigo;
    return { fontFamily: `"${f.familia}", ${t.fontes.reserva}`, fontSize: f.tamanho, lineHeight: 1.2 };
  }

  private aplicarTema(terminal: Terminal, t: Tema): void {
    const c = t.cores;
    const [black, red, green, yellow, blue, magenta, cyan, white, brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite] =
      t.terminal.ansi;
    terminal.options.theme = {
      background: c.painel,
      foreground: c.texto,
      cursor: c.destaque,
      cursorAccent: c.textoSobreDestaque,
      selectionBackground: c.destaque + '55',
      black, red, green, yellow, blue, magenta, cyan, white,
      brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite,
    };
    Object.assign(terminal.options, this.opcoesDeFonte(t));
  }
}
