import { computed, inject, Injectable, signal } from '@angular/core';
import * as monaco from 'monaco-editor';
import { JdtlsService } from '../java/jdtls.service';
import { EdicaoDeWorkspaceLsp } from '../java/conversao';
import { EditorService } from '../editor/editor.service';
import { RecentesService } from '../inicio/recentes.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { ProjetoService } from '../nucleo/projeto.service';
import { nomeBase, ponte } from '../nucleo/ponte';
import { HistoricoService } from '../historico/historico.service';
import { LayoutService } from '../layout/layout.service';
import { ajustarClasseColada, nomeDaClasse, ordenar, outroNome, pacoteDe, TipoNovo } from './modelos';

/** O item da árvore sobre o qual se age (a raiz do projeto conta como pasta). */
export interface Alvo {
  caminho: string;
  pasta: boolean;
}

export interface MenuAberto {
  x: number;
  y: number;
  alvo: Alvo;
  /** Já abre na lista de tipos (Alt+Insert, `n` na árvore, menu do líder). */
  novo: boolean;
}

export interface DialogoAberto {
  tipo: TipoNovo | 'colar' | 'renomear' | 'apagar';
  /** Pasta onde vai ser criado. */
  pasta: string;
  /** Em `colar`, `renomear` e `apagar`: sobre o que se age, e o nome sugerido. */
  origem?: Alvo;
  sugestao?: string;
}

const separador = (caminho: string): string => (caminho.includes('\\') ? '\\' : '/');

export const juntar = (pasta: string, relativo: string): string => {
  const s = separador(pasta);
  return `${pasta.replace(/[\\/]+$/, '')}${s}${relativo.split(/[\\/]+/).filter(Boolean).join(s)}`;
};

const pai = (caminho: string): string => caminho.replace(/[\\/][^\\/]+[\\/]*$/, '');

/** Criar, copiar, colar e mostrar arquivos pelo menu da árvore (mockups 40 a 42). */
@Injectable({ providedIn: 'root' })
export class ArquivosService {
  private readonly projeto = inject(ProjetoService);
  private readonly editor = inject(EditorService);
  private readonly recentes = inject(RecentesService);
  private readonly mensagens = inject(MensagensService);
  private readonly jdtls = inject(JdtlsService);
  private readonly historico = inject(HistoricoService);
  private readonly layout = inject(LayoutService);

  readonly menu = signal<MenuAberto | null>(null);
  readonly dialogo = signal<DialogoAberto | null>(null);
  readonly copiado = signal<Alvo | null>(null);
  /** A árvore abre as pastas até este caminho e o seleciona. */
  readonly revelar = signal<{ caminho: string; vez: number } | null>(null);
  /** A árvore registra aqui o item selecionado (para o menu do líder). */
  selecionado: () => Alvo | null = () => null;
  private foco: HTMLElement | null = null;

  readonly aberto = computed(() => !!this.menu() || !!this.dialogo());

  pastaDe(alvo: Alvo): string {
    return alvo.pasta ? alvo.caminho : pai(alvo.caminho);
  }

  /** Como a pasta aparece nos títulos: relativa à raiz do projeto. */
  relativa(pasta: string): string {
    const raiz = this.projeto.raiz() ?? '';
    const rel = pasta.startsWith(raiz) ? pasta.slice(raiz.length).replace(/^[\\/]+/, '') : pasta;
    return rel ? `${rel.replace(/\\/g, '/')}/` : `${nomeBase(raiz)}/`;
  }

  itensNovos(pasta: string) {
    const tipo = this.recentes.lista().find((r) => r.caminho === this.projeto.raiz())?.tipo ?? 'pasta';
    return ordenar(pacoteDe(pasta) === null && /Angular|React|Node|Tauri/.test(tipo));
  }

  abrirMenu(x: number, y: number, alvo: Alvo, novo = false): void {
    if (!this.aberto()) this.foco = document.activeElement as HTMLElement | null;
    this.menu.set({ x, y, alvo, novo });
  }

  /** Menu do líder: no item selecionado da árvore ou na pasta do arquivo aberto. */
  novoPeloTeclado(): void {
    const raiz = this.projeto.raiz();
    if (!raiz) return this.mensagens.alerta('abra um projeto para criar arquivos');
    const aberto = this.editor.ativo();
    const alvo = this.selecionado() ?? (aberto ? { caminho: aberto, pasta: false } : { caminho: raiz, pasta: true });
    this.abrirMenu(Math.round(window.innerWidth / 2) - 140, 90, alvo, true);
  }

  fechar(): void {
    this.menu.set(null);
    this.dialogo.set(null);
    this.foco?.focus();
    this.foco = null;
  }

  pedirNovo(tipo: TipoNovo, pasta: string): void {
    this.menu.set(null);
    this.dialogo.set({ tipo, pasta });
  }

  /** Cria e abre. Devolve o motivo se não deu (o diálogo continua aberto). */
  async criar(caminho: string, conteudo: string | null): Promise<string | null> {
    try {
      if (conteudo === null) await ponte.arquivos.criarPasta(caminho);
      else await ponte.arquivos.criar(caminho, conteudo);
    } catch (e) {
      return String(e);
    }
    this.fechar();
    await this.mostrarNaArvore(caminho);
    if (conteudo !== null) await this.editor.abrir(caminho);
    return null;
  }

  copiar(alvo: Alvo): void {
    this.menu.set(null);
    if (alvo.caminho === this.projeto.raiz()) return this.mensagens.alerta('copie um arquivo ou uma pasta do projeto');
    this.copiado.set(alvo);
    this.fechar();
    this.mensagens.mostrar(`copiado: ${nomeBase(alvo.caminho)}`);
  }

  async colar(alvo: Alvo): Promise<void> {
    const origem = this.copiado();
    this.menu.set(null);
    if (!origem) {
      this.fechar();
      return this.mensagens.alerta('nada copiado: use "copiar" antes');
    }
    const pasta = this.pastaDe(alvo);
    const nome = nomeBase(origem.caminho);
    if (!(await ponte.arquivos.existe(juntar(pasta, nome)))) {
      const erro = await this.colarComo(origem, pasta, nome);
      if (erro) this.mensagens.erro(erro);
      return;
    }
    // Já existe um com esse nome: pergunta o novo, com uma sugestão livre.
    let sugestao = nome;
    for (let n = 2; n < 100 && (await ponte.arquivos.existe(juntar(pasta, sugestao))); n++) sugestao = outroNome(nome, n);
    this.dialogo.set({ tipo: 'colar', pasta, origem, sugestao });
  }

  /** Copia com o nome dado. Uma classe Java sozinha leva o nome e o pacote novos. */
  async colarComo(origem: Alvo, pasta: string, nome: string): Promise<string | null> {
    const destino = juntar(pasta, nome);
    try {
      if (!origem.pasta && /\.java$/.test(origem.caminho) && /\.java$/.test(nome)) {
        const conteudo = await ponte.lerArquivo(origem.caminho);
        const sem = (n: string) => nomeBase(n).replace(/\.java$/, '');
        await ponte.arquivos.criar(destino, ajustarClasseColada(conteudo, sem(origem.caminho), sem(destino), pacoteDe(pai(destino))));
      } else {
        await ponte.arquivos.copiar(origem.caminho, destino);
      }
    } catch (e) {
      return String(e);
    }
    this.fechar();
    await this.mostrarNaArvore(destino);
    return null;
  }

  /** A raiz do projeto não se renomeia nem se apaga por aqui. */
  podeMudar(alvo: Alvo): boolean {
    return alvo.caminho !== this.projeto.raiz();
  }

  pedirRenomear(alvo: Alvo): void {
    this.menu.set(null);
    if (!this.podeMudar(alvo)) return this.fechar();
    this.dialogo.set({ tipo: 'renomear', pasta: pai(alvo.caminho), origem: alvo, sugestao: nomeBase(alvo.caminho) });
  }

  pedirApagar(alvo: Alvo): void {
    if (!this.aberto()) this.foco = document.activeElement as HTMLElement | null;
    this.menu.set(null);
    if (!this.podeMudar(alvo)) return this.fechar();
    this.dialogo.set({ tipo: 'apagar', pasta: pai(alvo.caminho), origem: alvo });
  }

  /** Os arquivos abertos que são o item ou estão dentro dele. */
  abertosEm(alvo: Alvo) {
    return this.editor.buffers().filter((b) => b.caminho === alvo.caminho || (b.caminho.startsWith(alvo.caminho) && /^[\\/]/.test(b.caminho.slice(alvo.caminho.length))));
  }

  /**
   * Renomeia. Numa classe Java, o jdtls atualiza as referências no projeto inteiro (como no
   * IntelliJ); sem ele, só o nome dentro do próprio arquivo. Devolve o motivo se não deu.
   */
  async renomear(alvo: Alvo, nome: string): Promise<string | null> {
    const destino = juntar(pai(alvo.caminho), nome);
    if (destino === alvo.caminho) {
      this.fechar();
      return null;
    }
    const abertos = this.abertosEm(alvo);
    const sujos = this.editor.buffers().filter((b) => this.editor.sujo(b));
    const java = !alvo.pasta && /\.java$/.test(alvo.caminho) && /\.java$/.test(nome);
    // O jdtls pode mexer em qualquer arquivo do projeto: nada pode estar por salvar.
    if (java ? sujos.length : abertos.some((b) => this.editor.sujo(b))) return 'salve os arquivos alterados antes de renomear';
    if (destino.toLowerCase() !== alvo.caminho.toLowerCase() && (await ponte.arquivos.existe(destino))) return `já existe: ${destino}`;

    let semReferencias = false;
    try {
      if (java) semReferencias = !(await this.atualizarReferencias(alvo.caminho, destino));
      const reabrir = abertos.map((b) => b.caminho);
      for (const c of reabrir) this.editor.fechar(c, true);
      await ponte.arquivos.renomear(alvo.caminho, destino);
      if (java && semReferencias) {
        const sem = (c: string) => nomeBase(c).replace(/\.java$/, '');
        const texto = await ponte.lerArquivo(destino);
        await ponte.gravarArquivo(destino, ajustarClasseColada(texto, sem(alvo.caminho), sem(destino), null));
      }
      this.fechar();
      await this.mostrarNaArvore(destino);
      for (const c of reabrir) await this.editor.abrir(destino + c.slice(alvo.caminho.length));
    } catch (e) {
      return String(e);
    }
    if (java && semReferencias) this.mensagens.alerta('renomeado sem o jdtls: as referências em outros arquivos não foram atualizadas');
    return null;
  }

  /** Pede ao jdtls as edições do renomear e salva o que ele tocou. false: não deu para pedir. */
  private async atualizarReferencias(de: string, para: string): Promise<boolean> {
    const cliente = this.jdtls.cliente();
    if (!cliente) return false;
    const uri = (c: string) => monaco.Uri.file(c).toString();
    const edicao = await cliente.pedir<EdicaoDeWorkspaceLsp | null>('workspace/willRenameFiles', { files: [{ oldUri: uri(de), newUri: uri(para) }] }).catch(() => null);
    if (!edicao || (!edicao.changes && !edicao.documentChanges?.length)) return false;
    const antes = new Set(this.editor.buffers().map((b) => b.caminho));
    const ativo = this.editor.ativo();
    const r = await this.jdtls.aplicarEdicao(edicao);
    if (!r.applied) return false;
    for (const b of this.editor.buffers().filter((x) => this.editor.sujo(x))) await this.editor.salvar(b.caminho, false);
    // Os que só foram abertos para editar voltam a ficar fechados.
    for (const b of this.editor.buffers().filter((x) => !antes.has(x.caminho))) this.editor.fechar(b.caminho, true);
    if (ativo) this.editor.ativo.set(ativo);
    return true;
  }

  async apagar(alvo: Alvo): Promise<string | null> {
    try {
      await this.historico.guardar(alvo.caminho, 'antes de apagar');
      await ponte.arquivos.apagar(alvo.caminho);
    } catch (e) {
      return String(e);
    }
    for (const b of this.abertosEm(alvo)) this.editor.fechar(b.caminho, true);
    if (this.copiado()?.caminho === alvo.caminho) this.copiado.set(null);
    this.fechar();
    this.projeto.recarregar();
    this.mensagens.mostrar(`${nomeBase(alvo.caminho)} foi para a Lixeira`);
    return null;
  }

  /** Para o menu: o caminho dentro do projeto, com "/". */
  async copiarCaminho(alvo: Alvo): Promise<void> {
    const raiz = this.projeto.raiz() ?? '';
    const dentro = alvo.caminho.startsWith(raiz) ? alvo.caminho.slice(raiz.length).replace(/^[\\/]+/, '') : alvo.caminho;
    await this.paraAAreaDeTransferencia(dentro.replace(/\\/g, '/') || nomeBase(raiz));
  }

  async copiarNomeDaClasse(alvo: Alvo): Promise<void> {
    const nome = nomeDaClasse(alvo.caminho);
    if (nome) await this.paraAAreaDeTransferencia(nome);
  }

  private async paraAAreaDeTransferencia(texto: string): Promise<void> {
    this.fechar();
    try {
      await navigator.clipboard.writeText(texto);
      this.mensagens.mostrar(`copiado: ${texto}`);
    } catch {
      this.mensagens.alerta('não consegui copiar');
    }
  }

  /** Mostra na árvore o arquivo que está no editor (como o "Select Opened File" do IntelliJ). */
  mostrarArquivoAberto(): void {
    const raiz = this.projeto.raiz();
    const caminho = this.editor.ativo();
    if (!raiz || !caminho) return this.mensagens.alerta('nenhum arquivo aberto');
    if (!caminho.startsWith(raiz)) return this.mensagens.alerta('o arquivo aberto está fora do projeto');
    this.layout.mostrar('arquivos');
    this.revelar.set({ caminho, vez: Date.now() });
  }

  async explorador(alvo: Alvo): Promise<void> {
    this.fechar();
    await ponte.arquivos.mostrarNoExplorador(alvo.caminho).catch((e) => this.mensagens.erro(String(e)));
  }

  private async mostrarNaArvore(caminho: string): Promise<void> {
    this.projeto.recarregar();
    this.revelar.set({ caminho, vez: Date.now() });
  }
}
