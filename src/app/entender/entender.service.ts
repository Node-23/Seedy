import { computed, effect, inject, Injectable, isDevMode, signal, untracked } from '@angular/core';
import { monaco } from '../editor/monaco';
import { EditorService } from '../editor/editor.service';
import { LayoutService } from '../layout/layout.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { ProjetoService } from '../nucleo/projeto.service';
import { AnaliseArquitetura, ComponenteAnalise, DesvioAnalise, MetodoAnalise, ponte, RegraAnalise } from '../nucleo/ponte';
import { caminhoDaUri } from '../java/conversao';
import { IaService } from '../ia/ia.service';
import { pedirComStream } from '../ia/stream';
import { desenharArquitetura, desenharCaminho, desenharVisaoGeral, PAPEIS_NA_GRADE } from './desenho';
import { ConfigService } from '../config/config.service';
import { agora, ARQUIVO_VAZIO, ArquivoRegras, escreverRegras, lerRegras, linhaDaRegra, proximoId, RegraEscrita, textoDoCodigo } from './regras';

export type AbaEntender = 'arquitetura' | 'regras' | 'caminho';

/** Regra como aparece na aba: o texto (do arquivo ou do código) + a ligação com o código. */
export interface RegraVisivel extends RegraEscrita {
  codigo: RegraAnalise | null;
  /** Ainda não está no .seedy/regras.md (veio da análise agora). */
  noArquivo: boolean;
}

const CMD_ACOMPANHAR = 'seedy.acompanharMetodo';

/**
 * Fase 9 — Entender o sistema (Alt+7): arquitetura em blocos, regras de negócio e o caminho
 * de um método (ctrl+. "acompanhar método"). A análise vem do núcleo (leitura do código);
 * as regras ficam em `.seedy/regras.md`; a IA reescreve as regras e explica o caminho.
 */
@Injectable({ providedIn: 'root' })
export class EntenderService {
  private readonly config = inject(ConfigService);
  private readonly layout = inject(LayoutService);
  private readonly projeto = inject(ProjetoService);
  private readonly editor = inject(EditorService);
  private readonly mensagens = inject(MensagensService);
  private readonly ia = inject(IaService);

  readonly aba = signal<AbaEntender>('arquitetura');
  readonly analise = signal<AnaliseArquitetura | null>(null);
  readonly analisando = signal(false);
  readonly erro = signal<string | null>(null);
  readonly analisadaEm = signal<Date | null>(null);
  private raizAnalisada: string | null = null;

  // Arquitetura
  readonly selecionado = signal<string | null>(null);
  readonly metodoSel = signal(0);

  // Regras
  readonly arquivo = signal<ArquivoRegras>(ARQUIVO_VAZIO);
  readonly dominioSel = signal<string | null>(null);
  readonly regraSel = signal<string | null>(null);
  readonly filtro = signal('');
  readonly escrevendo = signal(false);

  // Caminho
  readonly foco = signal<{ comp: string; metodo: string } | null>(null);
  readonly niveis = signal(3);
  readonly noSel = signal<string | null>(null);
  readonly explicacao = signal('');
  readonly explicando = signal(false);
  private geracao = 0;

  readonly componentes = computed(() => new Map((this.analise()?.componentes ?? []).map((c) => [c.id, c])));

  /** As regras da aba: as do arquivo (com o código ligado) + as novas que a análise achou. */
  readonly regras = computed<RegraVisivel[]>(() => {
    const a = this.analise();
    const arq = this.arquivo();
    const porChave = new Map((a?.regras ?? []).map((r) => [r.chave, r]));
    const lista: RegraVisivel[] = arq.regras.map((r) => ({ ...r, codigo: porChave.get(r.chave) ?? null, noArquivo: true }));
    const ja = new Set(arq.regras.map((r) => r.chave));
    let ids = [...lista];
    for (const r of a?.regras ?? []) {
      if (ja.has(r.chave)) continue;
      const t = textoDoCodigo(r);
      const nova: RegraVisivel = { id: proximoId(ids), chave: r.chave, dominio: r.dominio, titulo: t.titulo, descricao: t.descricao, estado: 'nova', codigo: r, noArquivo: false };
      ids = [...ids, nova];
      lista.push(nova);
    }
    return lista;
  });

  readonly dominiosDasRegras = computed(() => {
    const contagem = new Map<string, { total: number; novas: number }>();
    for (const r of this.regras()) {
      const c = contagem.get(r.dominio) ?? { total: 0, novas: 0 };
      c.total++;
      if (r.estado === 'nova') c.novas++;
      contagem.set(r.dominio, c);
    }
    return [...contagem.entries()].map(([nome, c]) => ({ nome, ...c })).sort((x, y) => y.total - x.total || x.nome.localeCompare(y.nome));
  });

  readonly regrasDoDominio = computed(() => {
    const d = this.dominioSel() ?? this.dominiosDasRegras()[0]?.nome;
    const f = this.filtro().trim().toLowerCase();
    return this.regras().filter((r) => r.dominio === d && (!f || `${r.titulo} ${r.descricao} ${r.codigo?.componente ?? ''}`.toLowerCase().includes(f)));
  });

  readonly regraAtual = computed(() => {
    const lista = this.regrasDoDominio();
    return lista.find((r) => r.id === this.regraSel()) ?? lista[0] ?? null;
  });

  readonly regrasPorComp = computed(() => {
    const m = new Map<string, number>();
    for (const r of this.regras()) if (r.codigo) m.set(r.codigo.componente, (m.get(r.codigo.componente) ?? 0) + 1);
    return m;
  });

  /** Domínio aberto na arquitetura (null = a visão geral, um bloco por domínio). */
  readonly dominioAberto = signal<string | null>(null);
  /** Camadas escondidas dentro do domínio (chaves das camadas do desenho). */
  readonly camadasOff = signal<ReadonlySet<string>>(new Set());
  /** Busca por componente: o que não casa fica apagado; ⏎ vai até o primeiro. */
  readonly busca = signal('');
  /** Aba Regras: só as sem teste ou as que falham (u e x). */
  readonly filtroCobertura = signal<'todas' | 'sem' | 'falhando'>('todas');
  /** Saltos de vizinhança desenhados a partir do bloco selecionado (+ e -). */
  readonly vizinhanca = signal(1);

  readonly desenhoArquitetura = computed(() => {
    const a = this.analise();
    if (!a) return null;
    const dominio = this.dominioAberto();
    return dominio ? desenharArquitetura(a, this.regrasPorComp(), { dominio, camadasOff: this.camadasOff() }) : desenharVisaoGeral(a, this.regrasPorComp());
  });

  entrarNoDominio(nome: string): void {
    this.dominioAberto.set(nome);
    this.camadasOff.set(new Set());
    this.busca.set('');
    this.metodoSel.set(0);
    const a = this.analise();
    const doDominio = (a?.componentes ?? []).filter((c) => c.dominio === nome && PAPEIS_NA_GRADE.has(c.papel));
    const inicial = doDominio.filter((c) => c.papel === 'servico').sort((x, y) => (this.regrasPorComp().get(y.id) ?? 0) - (this.regrasPorComp().get(x.id) ?? 0))[0] ?? doDominio[0];
    this.selecionado.set(inicial?.id ?? null);
  }

  sairDoDominio(): void {
    const d = this.dominioAberto();
    this.dominioAberto.set(null);
    this.camadasOff.set(new Set());
    this.busca.set('');
    this.selecionado.set(d ? `dom:${d}` : null);
  }

  /** Liga/desliga uma camada do domínio aberto (as telas levam junto os serviços do front). */
  alternarCamada(chave: string): void {
    const novo = new Set(this.camadasOff());
    const chaves = chave === 'tela' ? ['tela', 'front'] : [chave];
    const ligar = novo.has(chave);
    for (const k of chaves) ligar ? novo.delete(k) : novo.add(k);
    this.camadasOff.set(novo);
  }

  /** Vai até o componente da busca (abre o domínio dele). Devolve se achou. */
  buscar(): boolean {
    const t = this.busca().trim().toLowerCase();
    const a = this.analise();
    if (!t || !a) return false;
    const casa = a.componentes.filter((c) => PAPEIS_NA_GRADE.has(c.papel) && `${c.nome} ${c.tabela ?? ''}`.toLowerCase().includes(t));
    const melhor = casa.sort((x, y) => Number(!y.nome.toLowerCase().startsWith(t)) - Number(!x.nome.toLowerCase().startsWith(t)) || x.nome.length - y.nome.length)[0];
    if (!melhor) return false;
    if (this.dominioAberto() !== melhor.dominio) {
      this.dominioAberto.set(melhor.dominio);
      this.camadasOff.set(new Set());
    }
    this.selecionado.set(melhor.id);
    this.metodoSel.set(0);
    return true;
  }

  /** De um card do TODO, de uma regra...: mostra o bloco no diagrama (abrindo o domínio dele). */
  irParaBloco(id: string): void {
    if (id.startsWith('dom:')) {
      this.dominioAberto.set(null);
    } else {
      const c = this.analise()?.componentes.find((x) => x.id === id);
      this.dominioAberto.set(c?.dominio ?? null);
    }
    this.camadasOff.set(new Set());
    this.busca.set('');
    this.selecionado.set(id);
  }

  readonly desenhoCaminho = computed(() => {
    const a = this.analise();
    const f = this.foco();
    return a && f ? desenharCaminho(a, f, this.niveis(), (c, m, d) => this.idsDasRegras(c, m, d)) : null;
  });

  constructor() {
    this.registrarAcao();
    // Projeto novo: a análise antiga não vale mais.
    effect(() => {
      const raiz = this.projeto.raiz();
      untracked(() => {
        if (raiz !== this.raizAnalisada) {
          this.analise.set(null);
          this.arquivo.set(ARQUIVO_VAZIO);
          this.foco.set(null);
          if (this.layout.tela() === 'entender' && raiz) void this.analisar();
          else if (raiz) {
            // Em segundo plano, logo depois de abrir: a barra de status mostra "lendo o código".
            const pedido = raiz;
            setTimeout(() => {
              if (this.projeto.raiz() === pedido && !this.analise() && !this.analisando()) void this.analisar();
            }, 1500);
          }
        }
      });
    });
    // O .seedy/regras.md mudou (editado à mão no editor ou fora): relê.
    effect(() => {
      const m = this.projeto.mudancas();
      if (!m) return;
      if ([...m.alterados, ...m.criados].some((c) => /[\\/]\.seedy[\\/]regras\.md$/.test(c))) untracked(() => void this.carregarRegras());
    });
    if (isDevMode()) Object.assign(window, { seedyEntender: this });
  }

  // ---------- abrir e analisar ----------

  async abrir(aba?: AbaEntender): Promise<void> {
    if (aba) this.aba.set(aba);
    this.layout.tela.set('entender');
    if (!this.analise() || this.raizAnalisada !== this.projeto.raiz()) await this.analisar();
  }

  alternar(): void {
    if (this.layout.tela() === 'entender') this.fechar();
    else void this.abrir();
  }

  fechar(): void {
    this.layout.tela.set('editor');
    queueMicrotask(() => this.editor.focar());
  }

  async analisar(): Promise<void> {
    const raiz = this.projeto.raiz();
    if (!raiz || this.analisando()) return;
    this.analisando.set(true);
    this.erro.set(null);
    try {
      const a = await ponte.arquitetura.analisar(raiz);
      this.raizAnalisada = raiz;
      this.analise.set(a);
      this.analisadaEm.set(new Date());
      await this.carregarRegras();
      // O domínio aberto pode ter sumido na análise nova.
      const aberto = this.dominioAberto();
      if (aberto && !a.componentes.some((c) => c.dominio === aberto && PAPEIS_NA_GRADE.has(c.papel))) this.dominioAberto.set(null);
      const sel = this.selecionado();
      if (!this.dominioAberto()) {
        // Visão geral: o bloco selecionado é um domínio.
        const doms = this.desenhoArquitetura()?.resumos ?? [];
        if (!sel?.startsWith('dom:') || !doms.some((r) => `dom:${r.nome}` === sel)) this.selecionado.set(doms[0] ? `dom:${doms[0].nome}` : null);
      } else if (!sel || !a.componentes.some((c) => c.id === sel)) {
        const inicial = a.componentes.filter((c) => c.papel === 'servico').sort((x, y) => (this.regrasPorComp().get(y.id) ?? 0) - (this.regrasPorComp().get(x.id) ?? 0))[0] ?? a.componentes.find((c) => PAPEIS_NA_GRADE.has(c.papel));
        this.selecionado.set(inicial?.id ?? null);
        this.metodoSel.set(0);
      }
      if (!a.componentes.some((c) => PAPEIS_NA_GRADE.has(c.papel))) this.erro.set('não achei Spring, Jakarta nem Angular neste projeto');
    } catch (e) {
      this.erro.set(String(e));
    } finally {
      this.analisando.set(false);
    }
  }

  // ---------- arquitetura ----------

  metodosDe(c: ComponenteAnalise): MetodoAnalise[] {
    return c.metodos.filter((m) => m.nome !== c.nome && m.nome !== 'constructor');
  }

  abrirNoEditor(caminho: string | undefined, linha?: number): void {
    if (!caminho) return;
    this.fechar();
    void this.editor.abrir(caminho, linha);
  }

  // ---------- caminho ----------

  async acompanhar(comp: string, metodo: string): Promise<void> {
    this.foco.set({ comp, metodo });
    this.noSel.set(`${comp}.${metodo}`);
    this.explicacao.set('');
    this.geracao++;
    this.explicando.set(false);
    await this.abrir('caminho');
  }

  /** ctrl+. "acompanhar método" no editor: o método onde está o cursor. */
  async acompanharNoCursor(caminho: string, linha: number): Promise<void> {
    if (!this.analise() || this.raizAnalisada !== this.projeto.raiz()) await this.analisar();
    const alvo = this.metodoEm(caminho, linha);
    if (!alvo) {
      this.mensagens.mostrar('acompanhar método: ponha o cursor dentro de um método');
      return;
    }
    await this.acompanhar(alvo.comp.id, alvo.metodo.nome);
  }

  metodoEm(caminho: string, linha: number): { comp: ComponenteAnalise; metodo: MetodoAnalise } | null {
    const norm = (s: string) => s.replace(/\\/g, '/').toLowerCase();
    const alvo = norm(caminho);
    let melhor: { comp: ComponenteAnalise; metodo: MetodoAnalise } | null = null;
    for (const c of this.analise()?.componentes ?? []) {
      if (norm(c.caminho) !== alvo) continue;
      for (const m of c.metodos) {
        if (linha >= m.linha && linha <= Math.max(m.linha, m.linhaFim) && (!melhor || m.linha > melhor.metodo.linha)) melhor = { comp: c, metodo: m };
      }
    }
    return melhor;
  }

  mudarNiveis(delta: number): void {
    this.niveis.set(Math.max(1, Math.min(8, this.niveis() + delta)));
  }

  /** Ids das regras de um método (ou do desvio dele): "R1", "R4". */
  idsDasRegras(comp: string, metodo: string, d?: DesvioAnalise): string[] {
    return this.regras()
      .filter((r) => r.codigo?.componente === comp && r.codigo.metodo === metodo && (!d || (r.codigo.condicao === d.condicao && r.codigo.mensagem === d.mensagem)))
      .map((r) => r.id);
  }

  async explicar(): Promise<void> {
    const desenho = this.desenhoCaminho();
    const f = this.foco();
    const c = f ? this.componentes().get(f.comp) : null;
    const m = c && f ? c.metodos.find((x) => x.nome === f.metodo) : null;
    if (!desenho || !c || !m || this.explicando()) return;
    if (!(await this.ia.garantirChave())) return;
    const geracao = ++this.geracao;
    this.explicando.set(true);
    this.explicacao.set('');
    try {
      const fonte = await ponte.lerArquivo(c.caminho).catch(() => '');
      const linhas = fonte.split(/\r?\n/).slice(m.linha - 1, Math.min(m.linhaFim, m.linha + 80)).join('\n');
      const passos = desenho.passos.map((p, i) => `${i + 1}. ${p.partes.map((x) => x.texto).join('')}${p.desvios.map((d) => `\n   ↳ ${d.texto}${d.regra ? ` (${d.regra})` : ''}`).join('')}`).join('\n');
      const outras = desenho.outras.map((o) => `- ${o.texto} ${o.sub}`).join('\n');
      const pergunta = `Método: ${c.nome}.${m.nome} (${c.relativo}:${m.linha})\n\nCaminho que o Seedy montou lendo o código:\n${passos}${outras ? `\n\nOutras entradas:\n${outras}` : ''}\n\nCódigo do método:\n\`\`\`\n${linhas}\n\`\`\``;
      await pedirComStream(
        {
          model: this.config.atual().ia.modelo,
          max_tokens: 1500,
          stream: true,
          system:
            'Você explica um trecho de sistema para alguém que acabou de chegar no projeto. Em português do Brasil, em até 6 frases curtas: de onde a chamada vem (quem dispara), o que o método faz, onde ele pode barrar (condições e o que o usuário vê) e para onde vai (banco, outros serviços, sistemas externos). Cite Classe.método. Sem títulos nem listas; texto corrido.',
          messages: [{ role: 'user', content: [{ type: 'text', text: pergunta }] }],
        },
        (_i, texto) => {
          if (geracao === this.geracao) this.explicacao.set(texto);
        },
        () => geracao === this.geracao,
      );
    } catch (e) {
      if (geracao === this.geracao) this.explicacao.set(`não deu para explicar: ${e instanceof Error ? e.message : e}`);
    } finally {
      if (geracao === this.geracao) this.explicando.set(false);
    }
  }

  // ---------- regras ----------

  private caminhoDasRegras(): string | null {
    const raiz = this.projeto.raiz();
    if (!raiz) return null;
    const sep = raiz.includes('\\') ? '\\' : '/';
    return `${raiz.replace(/[\\/]+$/, '')}${sep}.seedy${sep}regras.md`;
  }

  async carregarRegras(): Promise<void> {
    const caminho = this.caminhoDasRegras();
    if (!caminho) return;
    const texto = await ponte.lerArquivo(caminho).catch(() => null);
    this.arquivo.set(texto ? lerRegras(texto) : ARQUIVO_VAZIO);
  }

  private async salvarRegras(regras: RegraEscrita[], pelaIa?: boolean): Promise<string | null> {
    const caminho = this.caminhoDasRegras();
    if (!caminho) return null;
    const atual = this.arquivo();
    const arquivo: ArquivoRegras = { escritasEm: pelaIa !== undefined ? agora() : (atual.escritasEm ?? agora()), pelaIa: pelaIa ?? atual.pelaIa, regras };
    const texto = escreverRegras(arquivo);
    await ponte.gravarArquivo(caminho, texto);
    this.arquivo.set(arquivo);
    return texto;
  }

  private escritas(): RegraEscrita[] {
    return this.regras().map(({ codigo: _c, noArquivo: _n, ...r }) => r);
  }

  async alternarRevisada(r: RegraVisivel): Promise<void> {
    const estado = r.estado === 'revisada' ? 'nova' : 'revisada';
    await this.salvarRegras(this.escritas().map((x) => (x.id === r.id ? { ...x, estado } : x))).catch((e) => this.mensagens.erro(String(e)));
  }

  /** Abre o .seedy/regras.md na regra (grava antes, se ela ainda não está lá). */
  async editarRegra(r: RegraVisivel | null): Promise<void> {
    const caminho = this.caminhoDasRegras();
    if (!caminho) return;
    let texto: string | null = null;
    try {
      texto = !r || r.noArquivo ? await ponte.lerArquivo(caminho).catch(() => null) : null;
      if (texto === null) texto = await this.salvarRegras(this.escritas());
    } catch (e) {
      this.mensagens.erro(String(e));
      return;
    }
    this.fechar();
    void this.editor.abrir(caminho, r && texto ? linhaDaRegra(texto, r.id) : 1);
  }

  /** ✦ atualizar com IA: reescreve em linguagem de negócio as regras ainda não revisadas. */
  async atualizarComIa(): Promise<void> {
    if (this.escrevendo()) return;
    const pendentes = this.regras().filter((r) => r.estado !== 'revisada' && r.codigo);
    if (!pendentes.length) {
      this.mensagens.mostrar('todas as regras já estão revisadas');
      return;
    }
    if (!(await this.ia.garantirChave())) return;
    this.escrevendo.set(true);
    const geracao = ++this.geracao;
    try {
      const textos = new Map<string, string[]>();
      const trecho = async (r: RegraAnalise) => {
        if (!textos.has(r.caminho)) textos.set(r.caminho, (await ponte.lerArquivo(r.caminho).catch(() => '')).split(/\r?\n/));
        const l = textos.get(r.caminho)!;
        return l.slice(Math.max(0, r.linha - 3), Math.min(l.length, r.linhaFim + 3)).join('\n');
      };
      const itens = [];
      for (const r of pendentes.slice(0, 80)) {
        const c = r.codigo!;
        itens.push({ chave: c.chave, tipo: c.tipo, dominio: c.dominio, classe: c.componente, metodo: c.metodo, condicao: c.condicao, mensagem: c.mensagem, excecao: c.excecao, status: c.status, detalhe: c.detalhe, ondeMaisAparece: c.apareceEm.map((l) => `${l.relativo}:${l.linha} ${l.detalhe}`), codigo: await trecho(c) });
      }
      let saida = '';
      await pedirComStream(
        {
          model: this.config.atual().ia.modelo,
          max_tokens: 12000,
          stream: true,
          system:
            'Você escreve as regras de negócio de um sistema a partir do código, para quem vai manter o sistema e para quem é do negócio. Responda só com um array JSON, sem texto em volta: [{"chave": "...", "titulo": "...", "descricao": "..."}], um item por regra recebida, com a mesma chave. Em português do Brasil. titulo: uma frase curta de negócio, até 60 caracteres, sem nomes de classes (ex.: "Só reserva banca em feira que não está lotada"). descricao: 1 ou 2 frases do que acontece, com os valores concretos (limites, prazos, status HTTP, mensagem que o usuário vê); identificadores do código entre crases (ex.: `LIMITE_BANCAS`).',
          messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(itens) }] }],
        },
        (_i, texto) => (saida = texto),
        () => geracao === this.geracao,
      );
      const json = saida.slice(saida.indexOf('['), saida.lastIndexOf(']') + 1);
      const novas = new Map<string, { titulo: string; descricao: string }>((JSON.parse(json) as { chave: string; titulo: string; descricao: string }[]).map((x) => [x.chave, x]));
      const regras = this.escritas().map((r) => {
        const t = novas.get(r.chave);
        return t && r.estado !== 'revisada' ? { ...r, titulo: t.titulo || r.titulo, descricao: t.descricao || r.descricao } : r;
      });
      await this.salvarRegras(regras, true);
      this.mensagens.mostrar(`${novas.size} regras escritas pela IA em .seedy/regras.md`);
    } catch (e) {
      this.mensagens.erro(`IA: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.escrevendo.set(false);
    }
  }

  // ---------- ctrl+. no editor ----------

  private registrarAcao(): void {
    monaco.editor.registerCommand(CMD_ACOMPANHAR, (_acessor, caminho: string, linha: number) => void this.acompanharNoCursor(caminho, linha));
    monaco.languages.registerCodeActionProvider(['java', 'typescript'], {
      provideCodeActions: (modelo, intervalo) => {
        const vazio = { actions: [], dispose: () => {} };
        if (modelo.uri.scheme !== 'file') return vazio;
        const caminho = caminhoDaUri(modelo.uri);
        const linha = intervalo.startLineNumber;
        const alvo = this.analise() ? this.metodoEm(caminho, linha) : null;
        // Sem análise ainda: oferece em qualquer linha (a análise roda ao escolher).
        if (this.analise() && this.raizAnalisada === this.projeto.raiz() && !alvo) return vazio;
        const titulo = alvo ? `⇢ acompanhar método ${alvo.comp.nome}.${alvo.metodo.nome}` : '⇢ acompanhar método';
        return {
          actions: [{ title: titulo, kind: 'refactor.seedy.acompanhar', command: { id: CMD_ACOMPANHAR, title: titulo, arguments: [caminho, linha] } }],
          dispose: () => {},
        };
      },
    });
  }
}
