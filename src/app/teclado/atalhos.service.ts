import { RecentesDeArquivosService } from '../arquivos/recentes-arquivos.service';
import { HistoricoService } from '../historico/historico.service';
import { ProblemasService } from '../problemas/problemas.service';
import { RodarMargemService } from '../editor/rodar-margem.service';
import { AnexosService } from '../ia/anexos.service';
import { Injectable, Injector, effect, inject, signal, untracked } from '@angular/core';
import { EditorService } from '../editor/editor.service';
import { LayoutService, NOME_DA_REGIAO, NOME_PADRAO, PAINEIS, Regiao } from '../layout/layout.service';
import { ProjetoService } from '../nucleo/projeto.service';
import { TemaService } from '../tema/tema';
import { ArquivosService } from '../arquivos/arquivos.service';
import { CompletarService } from '../completar/completar.service';
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
import { EntenderService } from '../entender/entender.service';
import { TodoService } from '../todo/todo.service';
import { ConfigService } from '../config/config.service';
import { AutomaticoService } from '../ia/automatico.service';
import { TestesService } from '../testes/testes.service';
import { EndpointsService } from '../endpoints/endpoints.service';
import { AtualizacaoService } from '../atualizacao/atualizacao.service';
import { VimAjudaService } from '../vim/vim-ajuda.component';
import { LoginEndpointsService } from '../endpoints/login-endpoints.component';
import { BookmarksService } from '../editor/bookmarks.service';
import { ConfiguracoesService } from '../config/configuracoes.service';

/**
 * Atalhos diretos (um acorde só, como no IntelliJ): id da ação → acorde. Os que o Seedy já tratava
 * antes (Ctrl+K, Ctrl+P...) ficam em ACORDES_NATIVOS, só para aparecerem nas dicas. Nada com
 * Ctrl+Alt: no teclado ABNT2 o AltGr é Ctrl+Alt e digita caracteres. Troca no seedy.json:
 * `"atalhos": { "teclas": { "git": "alt+9", "testes": null } }` (null desliga).
 */
export const ACORDES_PADRAO: Record<string, string> = {
  'buscar-tudo': 'ctrl+shift+p',
  simbolos: 'ctrl+shift+o',
  arquivos: 'alt+1',
  bookmarks: 'alt+2',
  servidor: 'alt+4',
  debug: 'alt+5',
  todo: 'alt+6',
  entender: 'alt+7',
  'containers-painel': 'alt+8',
  containers: 'alt+shift+8',
  git: 'alt+9',
  banco: 'alt+shift+d',
  scripts: 'alt+shift+j',
  testes: 'alt+shift+t',
  endpoints: 'alt+shift+e',
  vim: 'alt+shift+v',
  atualizar: 'alt+shift+u',
  'novo-projeto': 'alt+shift+n',
  'abrir-projeto': 'alt+shift+o',
  'fechar-buffer': 'ctrl+f4',
  execucao: 'alt+shift+f10',
  branch: 'alt+shift+b',
  blame: 'alt+shift+k',
  merge: 'alt+shift+m',
  github: 'alt+shift+g',
  prateleira: 'alt+shift+s',
  'pull-request': 'alt+shift+p',
  issue: 'alt+shift+q',
  ia: 'alt+a',
  'ia-automatico': 'alt+shift+y',
  'revisar-ia': 'alt+y',
  layout: 'alt+shift+l',
  notificacoes: 'alt+shift+h',
  completar: 'alt+shift+c',
  'arquivo-na-arvore': 'alt+f1',
  markdown: 'alt+shift+r',
  problemas: 'alt+3',
  'historico-local': 'alt+shift+z',
  'historico-git': 'alt+shift+f',
  config: 'ctrl+,',
};

/** Já funcionavam antes dos atalhos diretos (cada um no seu lugar do código); aqui só para mostrar. */
export const ACORDES_NATIVOS: Record<string, string> = {
  'buscar-arquivo': 'ctrl+p',
  'buscar-no-projeto': 'ctrl+shift+f',
  substituir: 'ctrl+shift+r',
  terminal: 'alt+f12',
  salvar: 'ctrl+s',
  commit: 'ctrl+k',
  bookmark: 'ctrl+f2',
  recentes: 'ctrl+e',
  'proximo-problema': 'f8',
  'rodar-no-cursor': 'ctrl+shift+f10',
  'depurar-no-cursor': 'ctrl+shift+f9',
};

/** "Ctrl+Shift+F", "Alt+9", "F12": o acorde como aparece nas dicas. */
export function rotuloDoAcorde(acorde: string): string {
  return acorde
    .split('+')
    .map((p) => (p === 'space' ? 'Espaço' : /^f\d+$/.test(p) ? p.toUpperCase() : p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
    .join('+');
}

/** Normaliza o texto do seedy.json ("Shift+Alt+9") para a forma interna ("alt+shift+9"). */
export function normalizarAcorde(texto: string): string | null {
  const partes = texto.toLowerCase().split('+').map((p) => p.trim()).filter(Boolean);
  const tecla = partes.filter((p) => !['ctrl', 'control', 'alt', 'shift', 'cmd', 'meta'].includes(p));
  if (tecla.length !== 1) return null;
  const mods = [
    partes.some((p) => ['ctrl', 'control', 'cmd', 'meta'].includes(p)) && 'ctrl',
    partes.includes('alt') && 'alt',
    partes.includes('shift') && 'shift',
  ].filter(Boolean) as string[];
  return [...mods, tecla[0] === 'espaço' ? 'space' : tecla[0]].join('+');
}

export interface AcaoLider {
  /** Nome da ação no seedy.json (atalhos.lider: { "todo": "T" }). */
  id: string;
  tecla: string;
  /** Atalho direto (acorde) que vale agora: o de fábrica ou o do seedy.json. */
  atalho?: string;
  /** Tecla de fábrica (a do seedy.json pode trocar a `tecla`). */
  padrao?: string;
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
  private readonly completar = inject(CompletarService);
  private readonly arquivos = inject(ArquivosService);
  private readonly configuracoes = inject(ConfiguracoesService);
  private readonly bookmarks = inject(BookmarksService);
  private readonly testes = inject(TestesService);
  private readonly endpoints = inject(EndpointsService);
  private readonly atualizacao = inject(AtualizacaoService);
  private readonly vimAjuda = inject(VimAjudaService);
  private readonly loginEndpoints = inject(LoginEndpointsService);
  private readonly automatico = inject(AutomaticoService);
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
  private readonly anexos = inject(AnexosService);
  private readonly execucao = inject(ExecucaoService);
  private readonly novoProjeto = inject(NovoProjetoService);
  private readonly servidor = inject(ServidorService);
  private readonly depurador = inject(DepuradorService);
  private readonly entender = inject(EntenderService);
  private readonly todo = inject(TodoService);
  private readonly config = inject(ConfigService);
  private readonly recentes = inject(RecentesDeArquivosService);
  private readonly problemas = inject(ProblemasService);
  private readonly margem = inject(RodarMargemService);
  private readonly historico = inject(HistoricoService);

  readonly liderAberto = signal(false);
  /** acorde → ação (atalhos diretos). */
  private porAcorde = new Map<string, AcaoLider>();
  private readonly injetor = inject(Injector);

  readonly acoes: AcaoLider[] = [
    { id: 'buscar-tudo', tecla: ' ', rotulo: 'buscar tudo', disponivel: true, busca: true, executar: () => this.busca.abrir('tudo') },
    { id: 'buscar-arquivo', tecla: 'f', rotulo: 'buscar arquivo', disponivel: true, busca: true, executar: () => this.busca.abrir('arquivos') },
    { id: 'buscar-no-projeto', tecla: '/', rotulo: 'buscar no projeto', disponivel: true, busca: true, executar: () => this.buscaProjeto.abrir() },
    { id: 'substituir', tecla: 'R', rotulo: 'substituir no projeto', disponivel: true, busca: true, executar: () => this.buscaProjeto.abrir('substituir') },
    { id: 'simbolos', tecla: 's', rotulo: 'símbolos', disponivel: true, busca: true, executar: () => this.busca.abrir('simbolos') },
    { id: 'arquivos', tecla: 'e', rotulo: 'árvore de arquivos', disponivel: true, executar: () => this.layout.alternar('arquivos') },
    { id: 'terminal', tecla: 't', rotulo: 'terminal', disponivel: true, executar: () => this.layout.alternar('terminal') },
    { id: 'abrir-projeto', tecla: 'o', rotulo: 'abrir projeto', disponivel: true, executar: () => void this.projeto.escolher() },
    { id: 'fechar-projeto', tecla: 'Q', rotulo: 'fechar projeto (tela de início)', disponivel: true, executar: () => this.fecharProjeto() },
    { id: 'novo-projeto', tecla: 'N', rotulo: 'novo projeto', disponivel: true, executar: () => void this.novoProjeto.abrir() },
    { id: 'salvar', tecla: 'w', rotulo: 'salvar', disponivel: true, executar: () => void this.editor.salvar() },
    { id: 'fechar-buffer', tecla: 'q', rotulo: 'fechar buffer', disponivel: true, executar: () => this.editor.fechar() },
    { id: 'tema', tecla: 'c', rotulo: 'editar tema', disponivel: true, executar: () => this.abrirTema() },
    { id: 'reiniciar-jdtls', tecla: 'l', rotulo: 'reiniciar jdtls', disponivel: true, executar: () => void this.jdtls.reiniciar() },
    { id: 'jdk', tecla: 'v', rotulo: 'JDK do jdtls', disponivel: true, executar: () => void this.jdtls.escolherJdk() },
    { id: 'execucao', tecla: 'r', rotulo: 'o que o RUN/DEBUG roda', disponivel: true, executar: () => void this.execucao.escolherConfig() },
    { id: 'debug', tecla: 'x', rotulo: 'tela de debug', disponivel: true, executar: () => this.alternarDebug() },
    { id: 'git', tecla: 'g', rotulo: 'git', disponivel: true, executar: () => this.alternarGit() },
    { id: 'commit', tecla: 'k', rotulo: 'commit', disponivel: true, executar: () => void this.commit.abrir() },
    { id: 'branch', tecla: 'b', rotulo: 'trocar de branch', disponivel: true, executar: () => void this.trocarDeBranch() },
    { id: 'blame', tecla: 'n', rotulo: 'anotar (blame)', disponivel: true, executar: () => void this.blame.alternar() },
    { id: 'banco', tecla: 'd', rotulo: 'conexões (banco)', disponivel: true, executar: () => this.layout.alternar('conexoes') },
    { id: 'servidor', tecla: 'j', rotulo: 'servidor (painel)', disponivel: true, executar: () => this.layout.alternar('servidor') },
    { id: 'scripts', tecla: 'p', rotulo: 'scripts do package.json', disponivel: true, executar: () => this.layout.alternar('scripts') },
    { id: 'containers-painel', tecla: 'h', rotulo: 'containers (painel)', disponivel: true, executar: () => this.layout.alternar('containers') },
    { id: 'containers', tecla: 'D', rotulo: 'containers e o mapa (Docker)', disponivel: true, executar: () => this.alternarContainers() },
    { id: 'todo', tecla: 'T', rotulo: 'TODO (cards ligados ao código, regras e containers)', disponivel: true, executar: () => this.todo.alternar() },
    { id: 'entender', tecla: 'A', rotulo: 'entender o sistema (arquitetura, regras, caminho)', disponivel: true, executar: () => this.entender.alternar() },
    { id: 'testes', tecla: 'E', rotulo: 'testes: rodar, resultado e cobertura das regras', disponivel: true, executar: () => this.testes.alternar() },
    { id: 'vim', tecla: 'V', rotulo: 'Vim: configuração, comandos e atalhos', disponivel: true, executar: () => this.vimAjuda.alternar() },
    { id: 'atualizar', tecla: 'U', rotulo: 'atualizar o Seedy (procura e instala a versão nova)', disponivel: true, executar: () => this.atualizacao.alternar() },
    { id: 'endpoints', tecla: 'H', rotulo: 'endpoints do Spring: ver, chamar e abrir o código', disponivel: true, executar: () => this.endpoints.alternar() },
    { id: 'bookmark', tecla: 'M', rotulo: 'bookmark: marcar/desmarcar a linha', disponivel: true, executar: () => void this.bookmarks.alternar() },
    { id: 'bookmarks', tecla: 'B', rotulo: 'bookmarks: lista e ir até uma marca', disponivel: true, executar: () => void this.bookmarks.listar() },
    { id: 'merge', tecla: 'm', rotulo: 'resolver conflitos (merge)', disponivel: true, executar: () => this.abrirMerge() },
    { id: 'github', tecla: 'G', rotulo: 'GitHub: conta, clonar, PR, issue', disponivel: true, executar: () => void this.menuGithub() },
    { id: 'prateleira', tecla: 'S', rotulo: 'guardar na prateleira', disponivel: true, executar: () => void this.guardarNaPrateleira() },
    { id: 'pull-request', tecla: 'P', rotulo: 'criar pull request', disponivel: true, executar: () => void this.githubForm.abrir('pr') },
    { id: 'issue', tecla: 'I', rotulo: 'criar issue', disponivel: true, executar: () => void this.githubForm.abrir('issue') },
    { id: 'ia', tecla: 'a', rotulo: 'IA (painel; no merge, o chat do conflito)', disponivel: true, executar: () => this.alternarIA() },
    { id: 'ia-automatico', tecla: 'Y', rotulo: 'IA: modo automático (sem confirmar) liga/desliga', disponivel: true, executar: () => void this.automatico.alternar() },
    { id: 'revisar-ia', tecla: 'y', rotulo: 'revisar alterações da IA', disponivel: true, executar: () => this.revisao.aberta.set(true) },
    { id: 'layout', tecla: 'L', rotulo: 'layout: mover painel, disposições', disponivel: true, executar: () => void this.menuLayout() },
    { id: 'config', tecla: ',', rotulo: 'configurações (atalhos, IA, editor)', disponivel: true, executar: () => this.abrirConfig() },
    { id: 'novo-arquivo', tecla: 'F', rotulo: 'novo arquivo (na pasta selecionada na árvore)', disponivel: true, executar: () => this.arquivos.novoPeloTeclado() },
    { id: 'arquivo-na-arvore', tecla: 'O', rotulo: 'mostrar na árvore o arquivo aberto', disponivel: true, executar: () => this.arquivos.mostrarArquivoAberto() },
    { id: 'markdown', tecla: 'W', rotulo: 'Markdown: ao vivo ou fonte', disponivel: true, executar: () => this.editor.alternarMarkdown() },
    { id: 'recentes', tecla: 'u', rotulo: 'arquivos recentes', disponivel: true, executar: () => this.recentes.abrir() },
    { id: 'problemas', tecla: 'X', rotulo: 'problemas do projeto (erros e avisos)', disponivel: true, executar: () => this.layout.alternar('problemas') },
    { id: 'proximo-problema', tecla: 'K', rotulo: 'ir para o próximo erro', disponivel: true, executar: () => void this.problemas.proximo(1) },
    { id: 'rodar-no-cursor', tecla: 'Z', rotulo: 'rodar o teste ou a main do cursor', disponivel: true, executar: () => void this.margem.noCursor(false) },
    { id: 'depurar-no-cursor', tecla: 'J', rotulo: 'depurar o teste ou a main do cursor', disponivel: true, executar: () => void this.margem.noCursor(true) },
    { id: 'historico-local', tecla: '.', rotulo: 'histórico local: versões sem commit, com restaurar', disponivel: true, executar: () => this.historico.abrirLocal() },
    { id: 'historico-git', tecla: ';', rotulo: 'histórico no Git do arquivo ou do trecho selecionado', disponivel: true, executar: () => this.historico.abrirNoGit() },
    { id: 'completar', tecla: 'C', rotulo: 'completar código enquanto digita: liga/desliga', disponivel: true, executar: () => void this.completar.alternar() },
    { id: 'notificacoes', tecla: 'z', rotulo: 'notificações: os avisos e erros que passaram', disponivel: true, executar: () => this.mensagens.alternarLista() },
    { id: 'mcp', tecla: 'i', rotulo: 'ligar o Claude Code ao Seedy (MCP)', disponivel: true, executar: () => void this.mcp.copiarComandoDoClaudeCode() },
  ];

  iniciar(): void {
    effect(() => {
      const trocas = this.config.atual().atalhos.lider ?? {};
      const teclas = this.config.atual().atalhos.teclas ?? {};
      untracked(() => {
        this.aplicarTeclas(trocas);
        this.aplicarAcordes(teclas);
      });
    }, { injector: this.injetor });
    // Fase de captura: o menu do líder pega a tecla antes do editor e do terminal.
    window.addEventListener('keydown', (e) => this.aoTeclar(e), { capture: true });
  }

  abrirLider(): void {
    this.liderAberto.set(true);
  }

  /** O botão da logo: abre o menu do líder e, com ele aberto, fecha. */
  alternarLider(): void {
    this.liderAberto.update((v) => !v);
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

  /**
   * Clicar numa área sem campo dentro de um popup tira o foco dele (vai para o body) e o Esc
   * deixa de chegar ao popup. Nesse caso, devolve o foco ao popup aberto por cima e repete o Esc
   * para ele, que fecha como sempre. Devolve true se tratou a tecla.
   */
  private devolverFocoAoPopup(e: KeyboardEvent): boolean {
    const alvo = e.target as HTMLElement | null;
    if (!e.isTrusted || (alvo !== document.body && alvo !== document.documentElement)) return false;
    const popups = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).filter((p) => p.getClientRects().length > 0);
    const popup = popups.at(-1);
    if (!popup) return false;
    const campo = popup.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, select, button, [tabindex]') ?? popup;
    if (campo === popup && !popup.hasAttribute('tabindex')) popup.setAttribute('tabindex', '-1');
    campo.focus();
    this.engolir(e);
    campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    return true;
  }

  private aoTeclar(e: KeyboardEvent): void {
    if (this.liderAberto()) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return this.fecharLider();
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      const acao = this.acoes.find((a) => a.tecla && a.tecla === e.key);
      if (acao) this.executar(acao);
      else this.fecharLider();
      return;
    }

    if (e.key === 'Escape' && this.devolverFocoAoPopup(e)) return;

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
    // A janela do Vim só mostra texto: os atalhos diretos continuam valendo com ela aberta.
    const modalAberto = this.recentes.aberto() || this.arquivos.aberto() || this.completar.perguntando() || !!this.mensagens.aberta() || !!this.loginEndpoints.pedido() || this.busca.aberta() || this.buscaProjeto.aberta() || !!this.escolha.pedido() || this.commit.aberta() || this.githubForm.aberta() || !!this.banco.editando() || !!this.servidor.editando() || this.revisao.aberta() || this.novoProjeto.aberta() || !!this.execucao.editandoOpcoes();
    const janelaAberta = modalAberto || this.vimAjuda.aberta();
    const livre = !janelaAberta && !this.noTerminal(e.target);

    // Atalhos diretos (um acorde, como no IntelliJ) e o menu de atalhos em Ctrl+Shift+Espaço.
    const acorde = !modalAberto || this.liderAberto() ? this.acordeDe(e) : null;
    // Ctrl+1 a Ctrl+9: vai para o 1º, 2º... arquivo aberto (os números aparecem nas abas de cima).
    const numero = acorde ? /^ctrl\+([1-9])$/.exec(acorde)?.[1] : undefined;
    if (numero) {
      this.engolir(e);
      const alvo = this.editor.buffers()[Number(numero) - 1];
      if (!alvo) this.mensagens.alerta(`só há ${this.editor.buffers().length} ${this.editor.buffers().length === 1 ? 'arquivo aberto' : 'arquivos abertos'}`);
      else {
        if (this.layout.tela() !== 'editor') this.layout.tela.set('editor');
        this.editor.ativo.set(alvo.caminho);
        queueMicrotask(() => this.editor.focar());
      }
      return;
    }
    if (acorde === 'ctrl+shift+space') {
      this.engolir(e);
      this.alternarLider();
      return;
    }
    const direta = acorde ? this.porAcorde.get(acorde) : undefined;
    if (direta) {
      this.engolir(e);
      if (this.vimAjuda.aberta() && direta.id !== 'vim') this.vimAjuda.fechar();
      this.executar(direta);
      return;
    }

    if (ctrl && e.shiftKey && !e.altKey && e.code === 'KeyA') {
      this.engolir(e);
      this.anexos.anexarEmFoco();
      return;
    }
    if (ctrl && e.shiftKey && !e.altKey && e.code === 'Backspace') {
      this.engolir(e);
      this.anexos.limpar();
      return;
    }

    if (ctrl && e.shiftKey && !e.altKey && (e.code === 'KeyF' || e.code === 'KeyR')) {
      // Ctrl+Shift+R também é "recarregar" do navegador: aqui é substituir no projeto.
      this.engolir(e);
      if (this.busca.aberta()) this.busca.fechar(false);
      this.buscaProjeto.abrir(e.code === 'KeyR' ? 'substituir' : 'buscar');
    } else if (e.altKey && !ctrl && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && livre) {
      // Voltar/avançar nos arquivos vistos.
      this.engolir(e);
      void this.editor.navegar(e.key === 'ArrowLeft' ? -1 : 1);
    } else if (soCtrl && e.code === 'KeyE' && livre) {
      // Ctrl+E: arquivos recentes, como no IntelliJ (no vim, Ctrl+D continua rolando).
      this.engolir(e);
      this.recentes.abrir();
    } else if (!janelaAberta && ctrl && e.shiftKey && !e.altKey && (e.key === 'F10' || e.key === 'F9')) {
      this.engolir(e);
      void this.margem.noCursor(e.key === 'F9');
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
    } else if (e.key === 'F8' && !ctrl && !e.altKey && livre && this.layout.tela() === 'editor') {
      this.engolir(e);
      void this.problemas.proximo(e.shiftKey ? -1 : 1);
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
    } else if (e.key === ' ' && !ctrl && !e.altKey && !janelaAberta && this.config.atual().atalhos.espacoAbreMenu === true && this.foraDeCampoDeTexto(e.target)) {
      // No editor, quem cuida do espaço é o vim (só no modo normal).
      e.preventDefault();
      this.abrirLider();
    }
  }

  private esperandoJanela = false;

  /** Fecha os arquivos e volta para a tela de início; nada se perde sem salvar. */
  private fecharProjeto(): void {
    if (!this.projeto.raiz()) return;
    if (this.editor.buffers().some((b) => this.editor.sujo(b))) {
      this.mensagens.alerta('há arquivos não salvos: salve (ctrl+shift+s) antes de fechar o projeto');
      return;
    }
    if (this.execucao.rodando()) {
      this.mensagens.alerta('pare a aplicação (ctrl+F2) antes de fechar o projeto');
      return;
    }
    for (const b of [...this.editor.buffers()]) this.editor.fechar(b.caminho);
    this.layout.tela.set('editor');
    this.projeto.fechar();
  }

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
      this.mensagens.alerta('nenhum conflito para resolver');
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
            { rotulo: 'Criar pull request', detalhe: this.rotuloDoAtalho('pull-request') ?? '', valor: 'pr' as const },
            { rotulo: 'Criar issue', detalhe: this.rotuloDoAtalho('issue') ?? '', valor: 'issue' as const },
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
      this.mensagens.alerta('nada para guardar: não há alterações');
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
      this.mensagens.alerta('este projeto não é um repositório git');
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

  /** ␣ L: o layout pelo teclado (mover painel de região e as disposições salvas). */
  private async menuLayout(): Promise<void> {
    const l = this.layout;
    const salvas = Object.keys(l.salvas());
    const op = await this.escolha.escolherUm(
      'LAYOUT',
      [
        { rotulo: 'mover um painel…', valor: 'mover' },
        { rotulo: 'trocar de disposição…', detalhe: `agora: ${l.nomeAtual()}`, valor: 'usar' },
        { rotulo: 'salvar esta disposição como…', valor: 'salvar' },
        ...(salvas.length ? [{ rotulo: 'apagar uma disposição…', valor: 'apagar' }] : []),
      ],
      'arrastar a faixa de título de um painel também muda ele de lugar · fica no seedy.json',
    );
    if (op === 'mover') {
      const id = await this.escolha.escolherUm('MOVER QUAL PAINEL?', PAINEIS.map((p) => ({ rotulo: p.titulo, detalhe: NOME_DA_REGIAO[l.regiaoDe(p.id)], valor: p.id })));
      if (!id) return;
      const titulo = PAINEIS.find((p) => p.id === id)!.titulo;
      const regioes: Regiao[] = ['esquerda', 'inferior', 'direita'];
      const r = await this.escolha.escolherUm(`${titulo.toUpperCase()} VAI PARA`, regioes.filter((x) => x !== l.regiaoDe(id)).map((x) => ({ rotulo: NOME_DA_REGIAO[x], valor: x })));
      if (!r) return;
      this.layout.tela.set('editor');
      l.mover(id, r);
      this.mensagens.mostrar(`${titulo} ${NOME_DA_REGIAO[r]}`);
    } else if (op === 'usar') {
      const nome = await this.escolha.escolherUm('DISPOSIÇÃO', [NOME_PADRAO, ...salvas].map((n) => ({ rotulo: n, detalhe: n === l.nomeAtual() ? 'em uso' : '', valor: n })));
      if (nome) {
        this.layout.tela.set('editor');
        l.usar(nome);
      }
    } else if (op === 'salvar') {
      const nome = await this.escolha.perguntar('NOME DA DISPOSIÇÃO', { valor: l.nomeAtual() === NOME_PADRAO ? '' : l.nomeAtual(), placeholder: 'ex.: debug, banco, foco' });
      if (nome && nome !== NOME_PADRAO) {
        l.salvarComo(nome);
        this.mensagens.mostrar(`disposição "${nome}" salva no seedy.json`);
      }
    } else if (op === 'apagar') {
      const nome = await this.escolha.escolherUm('APAGAR QUAL DISPOSIÇÃO?', salvas.map((n) => ({ rotulo: n, valor: n })));
      if (nome) l.apagar(nome);
    }
  }

  private abrirConfig(): void {
    this.configuracoes.alternar();
  }

  /** Teclas do líder trocadas no seedy.json; a ação que perde a tecla fica sem atalho. */
  private aplicarTeclas(trocas: Record<string, string>): void {
    for (const a of this.acoes) a.tecla = a.padrao ?? a.tecla;
    for (const a of this.acoes) a.padrao ??= a.tecla;
    const novas = Object.entries(trocas).filter(([id, t]) => typeof t === 'string' && [...t].length === 1 && this.acoes.some((a) => a.id === id));
    const usadas = new Set(novas.map(([, t]) => t));
    for (const a of this.acoes) {
      const troca = novas.find(([id]) => id === a.id);
      if (troca) a.tecla = troca[1];
      else if (usadas.has(a.tecla)) a.tecla = '';
    }
  }

  /** Os acordes de fábrica mais as trocas do seedy.json (`atalhos.teclas`). */
  private aplicarAcordes(teclas: Record<string, string | null>): void {
    this.porAcorde = new Map();
    for (const a of this.acoes) {
      const troca = teclas[a.id];
      const acorde = troca === null || troca === '' ? undefined : typeof troca === 'string' ? (normalizarAcorde(troca) ?? undefined) : ACORDES_PADRAO[a.id];
      a.atalho = acorde;
      if (acorde && !this.porAcorde.has(acorde)) this.porAcorde.set(acorde, a);
    }
  }

  /** Quem já usa o acorde (ação do menu ou atalho fixo do Seedy), para avisar conflito. */
  donoDoAcorde(acorde: string, exceto: string): string | null {
    const a = this.porAcorde.get(acorde);
    if (a && a.id !== exceto) return a.rotulo;
    const nativo = Object.entries(ACORDES_NATIVOS).find(([id, c]) => c === acorde && id !== exceto);
    if (nativo) return this.acoes.find((x) => x.id === nativo[0])?.rotulo ?? nativo[0];
    return null;
  }

  /** O atalho da ação para mostrar nas dicas ("Alt+9"), ou null. */
  rotuloDoAtalho(id: string): string | null {
    const a = this.acoes.find((x) => x.id === id);
    const acorde = a?.atalho ?? (a && !('atalho' in a) ? ACORDES_PADRAO[id] : undefined) ?? ACORDES_NATIVOS[id];
    return acorde ? rotuloDoAcorde(acorde) : null;
  }

  /** O acorde de um KeyboardEvent na forma interna ("ctrl+shift+f"), ou null para teclas que não entram. */
  acordeDe(e: KeyboardEvent): string | null {
    const c = e.code;
    let tecla: string | null = null;
    if (/^Key[A-Z]$/.test(c)) tecla = c.slice(3).toLowerCase();
    else if (/^Digit\d$/.test(c)) tecla = c.slice(5);
    else if (/^F\d{1,2}$/.test(c)) tecla = c.toLowerCase();
    else if (c === 'Comma') tecla = ',';
    else if (c === 'Period') tecla = '.';
    else if (c === 'Slash') tecla = '/';
    else if (c === 'Backslash') tecla = '\\';
    else if (c === 'Space') tecla = 'space';
    if (!tecla) return null;
    const mods = [(e.ctrlKey || e.metaKey) && 'ctrl', e.altKey && 'alt', e.shiftKey && 'shift'].filter(Boolean) as string[];
    return [...mods, tecla].join('+');
  }

  private abrirTema(): void {
    const caminho = this.tema.caminho();
    if (caminho) void this.editor.abrir(caminho);
    else this.mensagens.alerta('o tema.json só existe dentro do app');
  }
}
