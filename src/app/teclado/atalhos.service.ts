import { inject, Injectable, signal } from '@angular/core';
import { EditorService } from '../editor/editor.service';
import { LayoutService } from '../layout/layout.service';
import { ProjetoService } from '../nucleo/projeto.service';
import { TemaService } from '../tema/tema';
import { MensagensService } from '../nucleo/mensagens.service';
import { BuscaService } from '../busca/busca.service';
import { BuscaProjetoService } from '../busca/busca-projeto.service';
import { JdtlsService } from '../java/jdtls.service';
import { EscolhaService } from '../escolha/escolha.service';

export interface AcaoLider {
  tecla: string;
  rotulo: string;
  /** false = aparece no menu, mas ainda não existe (fases seguintes). */
  disponivel: boolean;
  executar?: () => void;
  /** Abre a busca; não aparece de novo dentro da própria busca, no filtro "Ações". */
  busca?: boolean;
}

/**
 * Atalhos de teclado.
 *
 * - Tecla líder (␣ no modo normal do vim, ou fora de campos de texto) abre o
 *   menu de atalhos, estilo which-key.
 * - Buscas: Ctrl+F no arquivo aberto, Ctrl+P arquivo (␣ f; ␣␣ abre a mesma
 *   janela em "Tudo"), Ctrl+Shift+F no projeto (␣ /), Ctrl+Shift+R substituir (␣ R).
 * - Alt+← / Alt+→ voltam e avançam nos arquivos vistos.
 * - Atalhos globais: Ctrl+S salva, Ctrl+Shift+S salva todos, Alt+F12 abre/fecha o terminal,
 *   Ctrl+Tab troca de buffer.
 */
@Injectable({ providedIn: 'root' })
export class AtalhosService {
  private readonly editor = inject(EditorService);
  private readonly layout = inject(LayoutService);
  private readonly projeto = inject(ProjetoService);
  private readonly tema = inject(TemaService);
  private readonly mensagens = inject(MensagensService);
  private readonly busca = inject(BuscaService);
  private readonly buscaProjeto = inject(BuscaProjetoService);
  private readonly jdtls = inject(JdtlsService);
  private readonly escolha = inject(EscolhaService);

  readonly liderAberto = signal(false);

  readonly acoes: AcaoLider[] = [
    { tecla: ' ', rotulo: 'buscar tudo', disponivel: true, busca: true, executar: () => this.busca.abrir('tudo') },
    { tecla: 'f', rotulo: 'buscar arquivo', disponivel: true, busca: true, executar: () => this.busca.abrir('arquivos') },
    { tecla: '/', rotulo: 'buscar no projeto', disponivel: true, busca: true, executar: () => this.buscaProjeto.abrir() },
    { tecla: 'R', rotulo: 'substituir no projeto', disponivel: true, busca: true, executar: () => this.buscaProjeto.abrir('substituir') },
    { tecla: 's', rotulo: 'símbolos', disponivel: true, busca: true, executar: () => this.busca.abrir('simbolos') },
    { tecla: 'e', rotulo: 'árvore de arquivos', disponivel: true, executar: () => this.layout.alternar('arquivos') },
    { tecla: 't', rotulo: 'terminal', disponivel: true, executar: () => this.layout.alternar('terminal') },
    { tecla: 'o', rotulo: 'abrir projeto', disponivel: true, executar: () => void this.projeto.escolher() },
    { tecla: 'w', rotulo: 'salvar', disponivel: true, executar: () => void this.editor.salvar() },
    { tecla: 'q', rotulo: 'fechar buffer', disponivel: true, executar: () => this.editor.fechar() },
    { tecla: 'c', rotulo: 'editar tema', disponivel: true, executar: () => this.abrirTema() },
    { tecla: 'l', rotulo: 'reiniciar jdtls', disponivel: true, executar: () => void this.jdtls.reiniciar() },
    { tecla: 'v', rotulo: 'JDK do jdtls', disponivel: true, executar: () => void this.jdtls.escolherJdk() },
    { tecla: 'r', rotulo: 'rodar / debug', disponivel: false },
    { tecla: 'g', rotulo: 'git', disponivel: false },
    { tecla: 'd', rotulo: 'banco', disponivel: false },
    { tecla: 'j', rotulo: 'servidor', disponivel: false },
    { tecla: 'm', rotulo: 'diff / merge', disponivel: false },
    { tecla: 'a', rotulo: 'IA', disponivel: false },
  ];

  iniciar(): void {
    // Fase de captura: o menu do líder pega a tecla antes do editor e do terminal.
    window.addEventListener('keydown', (e) => this.aoTeclar(e), { capture: true });
  }

  abrirLider(): void {
    this.liderAberto.set(true);
  }

  fecharLider(): void {
    this.liderAberto.set(false);
  }

  executar(acao: AcaoLider): void {
    this.fecharLider();
    if (!acao.disponivel || !acao.executar) {
      this.mensagens.mostrar(`${acao.rotulo}: em breve`);
      return;
    }
    acao.executar();
  }

  private aoTeclar(e: KeyboardEvent): void {
    if (this.liderAberto()) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return this.fecharLider();
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      const acao = this.acoes.find((a) => a.tecla === e.key);
      if (acao) this.executar(acao);
      else this.fecharLider();
      return;
    }

    // Ctrl+W e depois h/l/w/v/q/o: painéis do editor, como no vim.
    if (this.esperandoJanela) {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      this.esperandoJanela = false;
      this.engolir(e);
      this.comandoDeJanela(e.key);
      return;
    }
    const emInsercao = this.editor.modo() === 'insert' && !!(e.target as HTMLElement | null)?.closest?.('.monaco-editor');
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === 'KeyW' && !emInsercao && !this.noTerminal(e.target)) {
      this.engolir(e);
      this.esperandoJanela = true;
      return;
    }

    const ctrl = e.ctrlKey || e.metaKey;
    const soCtrl = ctrl && !e.shiftKey && !e.altKey;
    // Dentro de uma busca, Ctrl+P/Ctrl+N navegam; no terminal, Ctrl+P/Ctrl+F são do shell.
    const livre = !this.busca.aberta() && !this.buscaProjeto.aberta() && !this.escolha.pedido() && !this.noTerminal(e.target);

    if (ctrl && e.shiftKey && !e.altKey && (e.code === 'KeyF' || e.code === 'KeyR')) {
      // Ctrl+Shift+R também é "recarregar" do navegador: aqui é substituir no projeto.
      this.engolir(e);
      if (this.busca.aberta()) this.busca.fechar(false);
      this.buscaProjeto.abrir(e.code === 'KeyR' ? 'substituir' : 'buscar');
    } else if (e.altKey && !ctrl && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && livre) {
      // Voltar/avançar nos arquivos vistos.
      this.engolir(e);
      void this.editor.navegar(e.key === 'ArrowLeft' ? -1 : 1);
    } else if (soCtrl && e.code === 'Backslash' && livre) {
      // Dividir o editor (como no VS Code); no vim também :vs e ctrl+w v.
      this.engolir(e);
      if (this.editor.divisao()) this.editor.fecharPainel();
      else void this.editor.dividir();
    } else if (soCtrl && e.code === 'KeyP' && livre) {
      this.engolir(e);
      this.busca.abrir('arquivos');
    } else if (soCtrl && e.code === 'KeyF' && livre) {
      // Antes do vim (onde Ctrl+F rola a página) e do navegador (barra de busca dele).
      this.engolir(e);
      this.editor.buscarNoArquivo();
    } else if (ctrl && e.shiftKey && !e.altKey && e.code === 'KeyS') {
      this.engolir(e);
      void this.editor.salvarTodos();
    } else if (ctrl && !e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void this.editor.salvar();
    } else if (e.altKey && e.key === 'F12') {
      e.preventDefault();
      this.layout.alternar('terminal');
    } else if (ctrl && e.key === 'Tab') {
      e.preventDefault();
      this.editor.proximo(e.shiftKey ? -1 : 1);
    } else if (e.key === ' ' && !ctrl && !e.altKey && this.foraDeCampoDeTexto(e.target)) {
      // No editor, quem cuida do espaço é o vim (só no modo normal).
      e.preventDefault();
      this.abrirLider();
    }
  }

  private esperandoJanela = false;

  private comandoDeJanela(tecla: string): void {
    const outro = this.editor.painelFocado() === 0 ? 1 : 0;
    switch (tecla) {
      case 'h':
      case 'ArrowLeft':
        return this.editor.focarPainel(0);
      case 'l':
      case 'ArrowRight':
        return this.editor.focarPainel(1);
      case 'w':
        return this.editor.focarPainel(outro);
      case 'v':
        return void this.editor.dividir();
      case 'q':
      case 'c':
        return this.editor.fecharPainel();
      case 'o':
        return this.editor.fecharPainel(outro);
    }
  }

  private engolir(e: KeyboardEvent): void {
    e.preventDefault();
    e.stopPropagation();
  }

  private noTerminal(alvo: EventTarget | null): boolean {
    return !!(alvo as HTMLElement | null)?.closest?.('.xterm');
  }

  private foraDeCampoDeTexto(alvo: EventTarget | null): boolean {
    const el = alvo as HTMLElement | null;
    if (!el) return true;
    if (el.closest('.monaco-editor, .xterm')) return false;
    return !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(el.tagName) && !el.isContentEditable;
  }

  private abrirTema(): void {
    const caminho = this.tema.caminho();
    if (caminho) void this.editor.abrir(caminho);
    else this.mensagens.mostrar('o tema.json só existe dentro do app');
  }
}
