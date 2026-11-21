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
import { CommitService } from '../git/commit.service';
import { GitService } from '../git/git.service';
import { GithubService } from '../git/github.service';
import { PrateleiraService } from '../git/prateleira.service';
import { GithubFormService } from '../git/github-form.service';
import { IaMergeService } from '../ia/ia-merge.service';
import { BancoService } from '../banco/banco.service';
import { RevisaoService } from '../ia/revisao.service';
import { McpService } from '../ia/mcp.service';
import { ExecucaoService } from '../execucao/execucao.service';
import { NovoProjetoService } from '../novo-projeto/novo-projeto.service';
import { ServidorService } from '../servidor/servidor.service';
import { aceitaBreakpoint, DepuradorService } from '../servidor/depurador.service';
import { BlameService } from '../git/blame.service';

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
  private readonly commit = inject(CommitService);
  private readonly git = inject(GitService);
  private readonly blame = inject(BlameService);
  private readonly github = inject(GithubService);
  private readonly prateleira = inject(PrateleiraService);
  private readonly githubForm = inject(GithubFormService);
  private readonly ia = inject(IaMergeService);
  private readonly banco = inject(BancoService);
  private readonly revisao = inject(RevisaoService);
  private readonly mcp = inject(McpService);
  private readonly execucao = inject(ExecucaoService);
  private readonly novoProjeto = inject(NovoProjetoService);
  private readonly servidor = inject(ServidorService);
  private readonly depurador = inject(DepuradorService);

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
    { tecla: 'N', rotulo: 'novo projeto', disponivel: true, executar: () => void this.novoProjeto.abrir() },
    { tecla: 'w', rotulo: 'salvar', disponivel: true, executar: () => void this.editor.salvar() },
    { tecla: 'q', rotulo: 'fechar buffer', disponivel: true, executar: () => this.editor.fechar() },
    { tecla: 'c', rotulo: 'editar tema', disponivel: true, executar: () => this.abrirTema() },
    { tecla: 'l', rotulo: 'reiniciar jdtls', disponivel: true, executar: () => void this.jdtls.reiniciar() },
    { tecla: 'v', rotulo: 'JDK do jdtls', disponivel: true, executar: () => void this.jdtls.escolherJdk() },
    { tecla: 'r', rotulo: 'o que o RUN/DEBUG roda', disponivel: true, executar: () => void this.execucao.escolherConfig() },
    { tecla: 'x', rotulo: 'tela de debug', disponivel: true, executar: () => this.alternarDebug() },
    { tecla: 'g', rotulo: 'git', disponivel: true, executar: () => this.alternarGit() },
    { tecla: 'k', rotulo: 'commit', disponivel: true, executar: () => void this.commit.abrir() },
    { tecla: 'b', rotulo: 'trocar de branch', disponivel: true, executar: () => void this.trocarDeBranch() },
    { tecla: 'n', rotulo: 'anotar (blame)', disponivel: true, executar: () => void this.blame.alternar() },
    { tecla: 'd', rotulo: 'conexões (banco)', disponivel: true, executar: () => this.layout.alternar('conexoes') },
    { tecla: 'j', rotulo: 'servidor (painel)', disponivel: true, executar: () => this.layout.alternar('servidor') },
    { tecla: 'p', rotulo: 'scripts do package.json', disponivel: true, executar: () => this.layout.alternar('scripts') },
    { tecla: 'h', rotulo: 'containers (painel)', disponivel: true, executar: () => this.layout.alternar('containers') },
    { tecla: 'D', rotulo: 'containers e o mapa (Docker)', disponivel: true, executar: () => this.alternarContainers() },
    { tecla: 'm', rotulo: 'resolver conflitos (merge)', disponivel: true, executar: () => this.abrirMerge() },
    { tecla: 'G', rotulo: 'GitHub: conta, clonar, PR, issue', disponivel: true, executar: () => void this.menuGithub() },
    { tecla: 'S', rotulo: 'guardar na prateleira', disponivel: true, executar: () => void this.guardarNaPrateleira() },
    { tecla: 'P', rotulo: 'criar pull request', disponivel: true, executar: () => void this.githubForm.abrir('pr') },
    { tecla: 'I', rotulo: 'criar issue', disponivel: true, executar: () => void this.githubForm.abrir('issue') },
    { tecla: 'a', rotulo: 'IA (painel; no merge, o chat do conflito)', disponivel: true, executar: () => this.alternarIA() },
    { tecla: 'y', rotulo: 'revisar alterações da IA', disponivel: true, executar: () => this.revisao.aberta.set(true) },
    { tecla: 'i', rotulo: 'ligar o Claude Code ao Seedy (MCP)', disponivel: true, executar: () => void this.mcp.copiarComandoDoClaudeCode() },
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
    const janelaAberta = this.busca.aberta() || this.buscaProjeto.aberta() || !!this.escolha.pedido() || this.commit.aberta() || this.githubForm.aberta() || !!this.banco.editando() || !!this.servidor.editando() || this.revisao.aberta() || this.novoProjeto.aberta();
    const livre = !janelaAberta && !this.noTerminal(e.target);

    if (ctrl && e.shiftKey && !e.altKey && (e.code === 'KeyF' || e.code === 'KeyR')) {
      // Ctrl+Shift+R também é "recarregar" do navegador: aqui é substituir no projeto.
      this.engolir(e);
      if (this.busca.aberta()) this.busca.fechar(false);
      this.buscaProjeto.abrir(e.code === 'KeyR' ? 'substituir' : 'buscar');
    } else if (e.altKey && !ctrl && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && livre) {
      // Voltar/avançar nos arquivos vistos.
      this.engolir(e);
      void this.editor.navegar(e.key === 'ArrowLeft' ? -1 : 1);
    } else if (!janelaAberta && this.teclaDoServidor(e, ctrl)) {
      // Servidor e debug com as teclas do IntelliJ (ver teclaDoServidor).
      this.engolir(e);
    } else if (ctrl && !e.altKey && e.key === 'Enter' && !janelaAberta && this.banco.ehSql() && this.noEditor(e.target)) {
      // Ctrl+Enter executa o SQL sob o cursor; Ctrl+Shift+Enter mostra o plano (explain).
      this.engolir(e);
      void this.banco.executarNoCursor(e.shiftKey);
    } else if (ctrl && !e.altKey && e.code === 'KeyK' && !janelaAberta) {
      // Ctrl+K commit, Ctrl+Shift+K push (como no IntelliJ).
      this.engolir(e);
      if (e.shiftKey) void this.git.push();
      else void this.commit.abrir();
    } else if (soCtrl && e.code === 'KeyT' && livre) {
      // Ctrl+T atualiza o projeto (pull), como no IntelliJ.
      this.engolir(e);
      void this.git.pull();
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
    } else if (e.key === ' ' && !ctrl && !e.altKey && !janelaAberta && this.foraDeCampoDeTexto(e.target)) {
      // No editor, quem cuida do espaço é o vim (só no modo normal).
      e.preventDefault();
      this.abrirLider();
    }
  }

  private esperandoJanela = false;

  private alternarContainers(): void {
    this.layout.tela.set(this.layout.tela() === 'containers' ? 'editor' : 'containers');
    if (this.layout.tela() === 'editor') queueMicrotask(() => this.editor.focar());
  }

  private alternarDebug(): void {
    this.layout.tela.set(this.layout.tela() === 'debug' ? 'editor' : 'debug');
    if (this.layout.tela() === 'editor') queueMicrotask(() => this.editor.focar());
  }

  /** Linha do cursor para breakpoint / "até o cursor": a da tela de debug, se aberta. */
  private cursor(): { caminho: string; linha: number } | null {
    if (this.layout.tela() === 'debug') return this.depurador.telaDebug?.cursor() ?? null;
    const b = this.editor.bufferAtivo();
    const pos = this.editor.instancia?.getPosition();
    return b && !b.somenteLeitura && pos ? { caminho: b.caminho, linha: pos.lineNumber } : null;
  }

  private alternarGit(): void {
    this.layout.tela.set(this.layout.tela() === 'git' ? 'editor' : 'git');
    if (this.layout.tela() === 'editor') queueMicrotask(() => this.editor.focar());
  }

  /** ␣ a: o chat da IA, por enquanto ao lado do merge de conflitos (mockup 10). */
  private alternarIA(): void {
    // No merge, o chat do conflito; no resto, o painel de IA que opera a IDE.
    if (this.layout.tela() === 'merge') this.ia.alternar();
    else this.layout.alternar('ia');
  }

  /** ␣ m: abre o merge em 3 colunas quando há conflitos. */
  private abrirMerge(): void {
    if (!this.git.conflitos().length) {
      this.mensagens.mostrar('nenhum conflito para resolver');
      return;
    }
    this.layout.tela.set('merge');
  }

  /** ␣ G: conectar/desconectar a conta do GitHub e clonar um repositório dela. */
  private async menuGithub(): Promise<void> {
    const u = this.github.usuario();
    const acao = await this.escolha.escolherUm<'conectar' | 'clonar' | 'desconectar' | 'pr' | 'issue'>('GITHUB', [
      ...(u
        ? [
            { rotulo: 'Criar pull request', detalhe: '␣ P', valor: 'pr' as const },
            { rotulo: 'Criar issue', detalhe: '␣ I', valor: 'issue' as const },
            { rotulo: 'Clonar um repositório', detalhe: `de @${u.login}`, valor: 'clonar' as const },
            { rotulo: 'Desconectar', detalhe: `@${u.login}`, valor: 'desconectar' as const },
          ]
        : [{ rotulo: 'Conectar a conta', detalhe: 'pelo navegador ou com um token', valor: 'conectar' as const }]),
    ]);
    if (acao === 'conectar') await this.github.conectar();
    else if (acao === 'clonar') await this.github.clonar();
    else if (acao === 'desconectar') await this.github.desconectar();
    else if (acao === 'pr' || acao === 'issue') await this.githubForm.abrir(acao);
  }

  /** ␣ S: guarda todas as mudanças (menos conflitos) na prateleira, com um nome. */
  private async guardarNaPrateleira(): Promise<void> {
    await this.git.atualizar();
    const arquivos = this.git.alterados().filter((a) => a.letra !== 'C');
    if (!arquivos.length) {
      this.mensagens.mostrar('nada para guardar: não há alterações');
      return;
    }
    const nome = await this.escolha.perguntar('GUARDAR NA PRATELEIRA', {
      valor: `mudanças em ${this.git.estado()?.branch ?? 'HEAD'}`,
      dica: `${arquivos.length} ${arquivos.length === 1 ? 'arquivo' : 'arquivos'} · para escolher quais, use alt+s no commit (Ctrl+K)`,
    });
    if (nome) await this.prateleira.guardar(nome, arquivos.map((a) => a.relativo));
  }

  /** ␣ b: trocar de branch (locais e remotas), como o menu de branches do IntelliJ. */
  private async trocarDeBranch(): Promise<void> {
    if (!this.git.ehRepositorio()) {
      this.mensagens.mostrar('este projeto não é um repositório git');
      return;
    }
    const b = await this.git.branches();
    const locais = new Set(b.locais.map((l) => l.nome));
    const opcoes = [
      { rotulo: '+ nova branch', detalhe: `a partir de ${this.git.estado()?.branch ?? 'HEAD'}`, valor: { nova: true, nome: '', remoto: '' } },
      ...b.locais.map((l) => ({
        rotulo: `${l.atual ? '● ' : ''}${l.nome}`,
        detalhe: [l.aFrente ? `↑${l.aFrente}` : '', l.atras ? `↓${l.atras}` : '', l.upstream ?? 'local'].filter(Boolean).join(' '),
        valor: { nova: false, nome: l.nome, remoto: '' },
      })),
      ...[...b.remotas].flatMap(([remoto, nomes]) =>
        nomes.filter((n) => !locais.has(n)).map((n) => ({ rotulo: `${remoto}/${n}`, detalhe: 'remota', valor: { nova: false, nome: n, remoto } })),
      ),
    ];
    const r = await this.escolha.escolherUm('BRANCHES', opcoes);
    if (!r) return;
    if (r.nova) {
      const nome = await this.escolha.perguntar('NOVA BRANCH', { placeholder: 'feature/nome-da-branch' });
      if (nome) await this.git.criarBranch(nome.replace(/\s+/g, '-'));
    } else if (r.remoto) await this.git.checkoutRemota(r.remoto, r.nome);
    else await this.git.checkout(r.nome);
  }

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

  /**
   * Rodar e depurar (como no IntelliJ): shift+F10 roda e shift+F9 depura a configuração
   * escolhida (␣ r), ctrl+F2 para, ctrl+F10 redeploy do servidor. Debug: ctrl+F8 breakpoint,
   * F8 passa, F7 entra, shift+F8 sai, F9 continua, alt+F9 até o cursor, alt+F8 avalia.
   * true = a tecla foi usada.
   */
  private teclaDoServidor(e: KeyboardEvent, ctrl: boolean): boolean {
    const so = (c: boolean, s: boolean, a: boolean) => ctrl === c && e.shiftKey === s && e.altKey === a;
    const pausado = !!this.depurador.pausado();
    switch (e.key) {
      case 'F10':
        if (so(false, true, false)) { void this.execucao.rodar(false); return true; }
        if (so(true, false, false)) { void this.servidor.redeploy(); return true; }
        return false;
      case 'F9':
        if (so(false, true, false)) { void this.execucao.rodar(true); return true; }
        if (so(false, false, false) && pausado) { this.depurador.continuar(); return true; }
        if (so(false, false, true) && pausado) {
          const c = this.cursor();
          if (c) void this.depurador.ateALinha(c.caminho, c.linha);
          return true;
        }
        return false;
      case 'F2':
        if (so(true, false, false)) { void this.execucao.parar(); return true; }
        return false;
      case 'F8':
        if (so(true, false, false)) {
          const c = this.cursor();
          if (c && aceitaBreakpoint(c.caminho)) this.depurador.alternar(c.caminho, c.linha);
          else if (c) this.mensagens.mostrar('breakpoints só em arquivos .java, .ts e .js');
          return true;
        }
        if (so(false, false, false) && pausado) { this.depurador.passar(); return true; }
        if (so(false, true, false) && pausado) { this.depurador.sair(); return true; }
        if (so(false, false, true) && this.layout.tela() === 'debug') {
          this.depurador.telaDebug?.focarAvaliar();
          return true;
        }
        if (so(false, false, true) && this.depurador.depurando()) {
          this.layout.mostrar('servidor');
          queueMicrotask(() => (document.querySelector('.depurador-avaliar') as HTMLInputElement | null)?.focus());
          return true;
        }
        return false;
      case 'F7':
        if (so(false, false, false) && pausado) { this.depurador.entrar(); return true; }
        return false;
      default:
        return false;
    }
  }

  /** O foco está no editor de código (não no merge, nas buscas ou no terminal). */
  private noEditor(alvo: EventTarget | null): boolean {
    return !!(alvo as HTMLElement | null)?.closest?.('sd-editor .monaco-editor');
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
