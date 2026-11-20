import { inject, Injectable, signal } from '@angular/core';
import { EditorService } from '../editor/editor.service';
import { LayoutService } from '../layout/layout.service';
import { ProjetoService } from '../nucleo/projeto.service';
import { TemaService } from '../tema/tema';
import { MensagensService } from '../nucleo/mensagens.service';
import { BuscaService } from '../busca/busca.service';
import { BuscaProjetoService } from '../busca/busca-projeto.service';

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
 *   janela em "Tudo"), Ctrl+Shift+F no projeto (␣ /).
 * - Atalhos globais: Ctrl+S salva, Alt+F12 abre/fecha o terminal,
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

  readonly liderAberto = signal(false);

  readonly acoes: AcaoLider[] = [
    { tecla: ' ', rotulo: 'buscar tudo', disponivel: true, busca: true, executar: () => this.busca.abrir('tudo') },
    { tecla: 'f', rotulo: 'buscar arquivo', disponivel: true, busca: true, executar: () => this.busca.abrir('arquivos') },
    { tecla: '/', rotulo: 'buscar no projeto', disponivel: true, busca: true, executar: () => this.buscaProjeto.abrir() },
    { tecla: 's', rotulo: 'símbolos', disponivel: true, busca: true, executar: () => this.busca.abrir('simbolos') },
    { tecla: 'e', rotulo: 'árvore de arquivos', disponivel: true, executar: () => this.layout.alternar('arquivos') },
    { tecla: 't', rotulo: 'terminal', disponivel: true, executar: () => this.layout.alternar('terminal') },
    { tecla: 'o', rotulo: 'abrir projeto', disponivel: true, executar: () => void this.projeto.escolher() },
    { tecla: 'w', rotulo: 'salvar', disponivel: true, executar: () => void this.editor.salvar() },
    { tecla: 'q', rotulo: 'fechar buffer', disponivel: true, executar: () => this.editor.fechar() },
    { tecla: 'c', rotulo: 'editar tema', disponivel: true, executar: () => this.abrirTema() },
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

    const ctrl = e.ctrlKey || e.metaKey;
    const soCtrl = ctrl && !e.shiftKey && !e.altKey;
    // Dentro de uma busca, Ctrl+P/Ctrl+N navegam; no terminal, Ctrl+P/Ctrl+F são do shell.
    const livre = !this.busca.aberta() && !this.buscaProjeto.aberta() && !this.noTerminal(e.target);

    if (ctrl && e.shiftKey && !e.altKey && e.code === 'KeyF') {
      this.engolir(e);
      if (this.busca.aberta()) this.busca.fechar(false);
      this.buscaProjeto.abrir();
    } else if (soCtrl && e.code === 'KeyP' && livre) {
      this.engolir(e);
      this.busca.abrir('arquivos');
    } else if (soCtrl && e.code === 'KeyF' && livre) {
      // Antes do vim (onde Ctrl+F rola a página) e do navegador (barra de busca dele).
      this.engolir(e);
      this.editor.buscarNoArquivo();
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
