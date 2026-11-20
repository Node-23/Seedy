import { inject, Injectable, signal } from '@angular/core';
import { EditorService } from '../editor/editor.service';
import { LayoutService } from '../layout/layout.service';
import { ProjetoService } from '../nucleo/projeto.service';
import { TemaService } from '../tema/tema';
import { MensagensService } from '../nucleo/mensagens.service';

export interface AcaoLider {
  tecla: string;
  rotulo: string;
  /** false = aparece no menu, mas ainda não existe (fases seguintes). */
  disponivel: boolean;
  executar?: () => void;
}

/**
 * Atalhos de teclado.
 *
 * - Tecla líder (␣ no modo normal do vim, ou fora de campos de texto) abre o
 *   menu de atalhos, estilo which-key.
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

  readonly liderAberto = signal(false);

  readonly acoes: AcaoLider[] = [
    { tecla: 'e', rotulo: 'arquivos', disponivel: true, executar: () => this.layout.alternar('arquivos') },
    { tecla: 't', rotulo: 'terminal', disponivel: true, executar: () => this.layout.alternar('terminal') },
    { tecla: 'o', rotulo: 'abrir projeto', disponivel: true, executar: () => void this.projeto.escolher() },
    { tecla: 'w', rotulo: 'salvar', disponivel: true, executar: () => void this.editor.salvar() },
    { tecla: 'q', rotulo: 'fechar buffer', disponivel: true, executar: () => this.editor.fechar() },
    { tecla: 'c', rotulo: 'editar tema', disponivel: true, executar: () => this.abrirTema() },
    { tecla: 'f', rotulo: 'buscar arquivos', disponivel: false },
    { tecla: '/', rotulo: 'buscar texto', disponivel: false },
    { tecla: 'g', rotulo: 'git', disponivel: false },
    { tecla: 'd', rotulo: 'banco', disponivel: false },
    { tecla: 's', rotulo: 'servidor', disponivel: false },
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
    if (ctrl && !e.shiftKey && e.key.toLowerCase() === 's') {
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
