import { EnvService } from '../execucao/env.service';
import { computed, effect, inject, Injectable, isDevMode, signal, untracked } from '@angular/core';
import { EditorService } from '../editor/editor.service';
import { EntenderService } from '../entender/entender.service';
import { IaService } from '../ia/ia.service';
import { LayoutService } from '../layout/layout.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { noApp, ponte, ResultadoTeste, TesteInfo, TipoDeTeste } from '../nucleo/ponte';
import { ProjetoService } from '../nucleo/projeto.service';
import { ScriptsService } from '../web/scripts.service';
import { chaveDoResultado, coberturaDaRegra, CoberturaDaRegra, EstadoDeTeste, estadoDoTeste, resumirCobertura } from './cobertura';

export type FiltroDeTipo = 'todos' | TipoDeTeste;
export type FiltroDeEstado = 'todos' | 'falhas' | 'ignorados';

export const NOMES_DO_TIPO: Record<TipoDeTeste, string> = { unitario: 'unitários', integracao: 'integração', api: 'API', e2e: 'e2e' };
export const SIGLA_DO_TIPO: Record<TipoDeTeste, string> = { unitario: 'U', integracao: 'I', api: 'API', e2e: 'E2E' };

export type LinhaDaArvore =
  | { tipo: 'modulo'; chave: string; nome: string; total: number }
  | { tipo: 'classe'; chave: string; nome: string; estado: EstadoDeTeste | 'parcial'; segundos: number; aberta: boolean; modulo: string }
  | { tipo: 'teste'; chave: string; teste: TesteInfo; estado: EstadoDeTeste; segundos: number };

/**
 * Tela de testes (␣ E): lista os testes lidos do código (unitários, integração, API e e2e), roda
 * pelo Maven/Gradle e mostra o resultado dos relatórios. As regras de negócio usam a mesma
 * leitura para dizer o que está coberto, inclusive os cenários que dão errado.
 */
@Injectable({ providedIn: 'root' })
export class TestesService {
  private readonly layout = inject(LayoutService);
  private readonly projeto = inject(ProjetoService);
  private readonly editor = inject(EditorService);
  private readonly mensagens = inject(MensagensService);
  private readonly env = inject(EnvService);
  private readonly entender = inject(EntenderService);
  private readonly scripts = inject(ScriptsService);
  private readonly ia = inject(IaService);

  readonly testes = computed<TesteInfo[]>(() => this.entender.analise()?.testes ?? []);
  readonly resultados = signal<ReadonlyMap<string, ResultadoTeste>>(new Map());
  /** Tipo que está rodando agora (null = nada). */
  readonly rodando = signal<FiltroDeTipo | null>(null);
  readonly saida = signal<string[]>([]);
  /** Lendo os relatórios JUnit do último run. */
  readonly lendoRelatorios = signal(false);
  /** A análise do projeto ainda está lendo o código (a lista de testes vem dela). */
  readonly lendoCodigo = computed(() => this.entender.analisando());
  readonly comandoAtual = signal('');
  /** Montando o comando: na primeira vez, sem Maven instalado, o Seedy baixa o Maven (alguns segundos). */
  readonly preparando = signal(false);
  readonly ultimaExecucao = signal<{ em: Date; segundos: number; codigo: number | null } | null>(null);

  readonly filtroTipo = signal<FiltroDeTipo>('todos');
  readonly filtroEstado = signal<FiltroDeEstado>('todos');
  readonly selecionado = signal<string | null>(null);
  readonly fechadas = signal<ReadonlySet<string>>(new Set());

  // ---------- cobertura das regras (usada pela aba Regras) ----------

  readonly cobertura = computed<ReadonlyMap<string, CoberturaDaRegra>>(() => {
    const a = this.entender.analise();
    const r = this.resultados();
    return new Map((a?.regras ?? []).map((x) => [x.chave, coberturaDaRegra(a!, x, r)]));
  });
  readonly resumoDaCobertura = computed(() => resumirCobertura(this.cobertura()));

  // ---------- lista ----------

  estadoDe(t: TesteInfo): EstadoDeTeste {
    return estadoDoTeste(t, this.resultados());
  }

  resultadoDe(t: TesteInfo): ResultadoTeste | null {
    return this.resultados().get(t.linguagem === 'java' ? chaveDoResultado(t.classe, t.metodo) : t.id) ?? null;
  }

  readonly totais = computed(() => {
    const r = { todos: 0, unitario: 0, integracao: 0, api: 0, e2e: 0, ok: 0, falhou: 0, ignorado: 0, semResultado: 0, falhasPorTipo: { unitario: 0, integracao: 0, api: 0, e2e: 0 } as Record<TipoDeTeste, number> };
    for (const t of this.testes()) {
      const e = this.estadoDe(t);
      r.todos++;
      r[t.tipo]++;
      if (e === 'ok') r.ok++;
      else if (e === 'falhou') {
        r.falhou++;
        r.falhasPorTipo[t.tipo]++;
      } else if (e === 'ignorado') r.ignorado++;
      else r.semResultado++;
    }
    return r;
  });

  readonly visiveis = computed(() => {
    const tipo = this.filtroTipo();
    const estado = this.filtroEstado();
    return this.testes().filter((t) => {
      if (tipo !== 'todos' && t.tipo !== tipo) return false;
      const e = this.estadoDe(t);
      return estado === 'todos' || (estado === 'falhas' ? e === 'falhou' : e === 'ignorado');
    });
  });

  /** A árvore: módulo (back, front...) › classe › teste. */
  readonly linhas = computed<LinhaDaArvore[]>(() => {
    const fechadas = this.fechadas();
    const porModulo = new Map<string, Map<string, TesteInfo[]>>();
    for (const t of this.visiveis()) {
      const modulo = t.relativo.includes('/') ? t.relativo.split('/')[0] : '.';
      const classes = porModulo.get(modulo) ?? new Map<string, TesteInfo[]>();
      classes.set(t.classe, [...(classes.get(t.classe) ?? []), t]);
      porModulo.set(modulo, classes);
    }
    const saida: LinhaDaArvore[] = [];
    for (const [modulo, classes] of [...porModulo].sort((a, b) => a[0].localeCompare(b[0]))) {
      saida.push({ tipo: 'modulo', chave: `m:${modulo}`, nome: modulo, total: [...classes.values()].reduce((n, l) => n + l.length, 0) });
      for (const [classe, lista] of [...classes].sort((a, b) => a[0].localeCompare(b[0]))) {
        const estados = lista.map((t) => this.estadoDe(t));
        const estado: EstadoDeTeste | 'parcial' = estados.includes('falhou') ? 'falhou' : estados.every((e) => e === 'desconhecido') ? 'desconhecido' : estados.some((e) => e === 'ignorado' || e === 'desconhecido') ? 'parcial' : 'ok';
        const chave = `c:${modulo}/${classe}`;
        const aberta = !fechadas.has(chave);
        saida.push({ tipo: 'classe', chave, nome: classe, estado, segundos: lista.reduce((n, t) => n + (this.resultadoDe(t)?.segundos ?? 0), 0), aberta, modulo });
        if (aberta) for (const t of lista) saida.push({ tipo: 'teste', chave: t.id, teste: t, estado: this.estadoDe(t), segundos: this.resultadoDe(t)?.segundos ?? 0 });
      }
    }
    return saida;
  });

  readonly atual = computed(() => this.testes().find((t) => t.id === this.selecionado()) ?? null);
  readonly atualResultado = computed(() => {
    const t = this.atual();
    return t ? this.resultadoDe(t) : null;
  });
  /** As regras de negócio que um teste cobre. */
  regrasDoTeste(t: TesteInfo): { chave: string; rotulo: string }[] {
    const a = this.entender.analise();
    return [...this.cobertura()]
      .filter(([, c]) => c.testes.some((x) => x.id === t.id))
      .map(([chave]) => {
        const r = a?.regras.find((x) => x.chave === chave);
        return { chave, rotulo: r?.mensagem ?? r?.condicao ?? r?.detalhe ?? chave };
      })
      .slice(0, 6);
  }

  constructor() {
    effect(() => {
      this.projeto.raiz();
      untracked(() => {
        this.resultados.set(new Map());
        this.selecionado.set(null);
      });
    });
    if (isDevMode()) Object.assign(window, { seedyTestes: this });
  }

  // ---------- tela ----------

  async abrir(): Promise<void> {
    this.layout.tela.set('testes');
    if (!this.entender.analise()) await this.entender.analisar();
    await this.lerRelatorios();
    if (!this.selecionado()) this.selecionado.set(this.testes().find((t) => this.estadoDe(t) === 'falhou')?.id ?? this.testes()[0]?.id ?? null);
  }

  alternar(): void {
    if (this.layout.tela() === 'testes') this.fechar();
    else void this.abrir();
  }

  fechar(): void {
    this.layout.tela.set('editor');
    queueMicrotask(() => this.editor.focar());
  }

  alternarClasse(chave: string): void {
    const n = new Set(this.fechadas());
    if (n.has(chave)) n.delete(chave);
    else n.add(chave);
    this.fechadas.set(n);
  }

  // ---------- rodar ----------

  async lerRelatorios(): Promise<void> {
    const raiz = this.projeto.raiz();
    if (!raiz) return;
    this.lendoRelatorios.set(true);
    const lista = await ponte.testes.relatorios(raiz).catch(() => [] as ResultadoTeste[]).finally(() => this.lendoRelatorios.set(false));
    if (!lista.length && this.resultados().size) return; // um run que não gerou relatório não apaga o que já se sabia
    this.resultados.set(new Map(lista.map((r) => [chaveDoResultado(r.classe, r.metodo), r])));
  }

  /** `tipo`: o que rodar; `filtro`: classe ou classe#método (Maven/Gradle). Os do front rodam pelos scripts. */
  async rodar(tipo: FiltroDeTipo, filtro: string | null = null, doFront = false): Promise<void> {
    const raiz = this.projeto.raiz();
    if (!raiz || this.rodando()) return;
    if (doFront || tipo === 'e2e') return this.rodarFront(tipo);
    this.rodando.set(tipo);
    this.saida.set([]);
    const inicio = Date.now();
    const terminar = async (codigo: number | null) => {
      await this.lerRelatorios();
      this.ultimaExecucao.set({ em: new Date(), segundos: (Date.now() - inicio) / 1000, codigo });
      this.rodando.set(null);
    };
    if (!noApp()) {
      this.comandoAtual.set('mvn test -B');
      this.saida.set(['[INFO] Running br.com.feirinha.reserva.ReservaServiceTest', '[ERROR] naoReservaEmFeiraLotada  <<< FAILURE!', '[INFO] Tests run: 4, Failures: 2, Errors: 0, Skipped: 0']);
      await new Promise((r) => setTimeout(r, 600));
      await terminar(1);
      return;
    }
    try {
      const env = await this.env.variaveis();
      if (env === null) {
        this.rodando.set(null);
        return; // cancelou a escolha do .env
      }
      this.preparando.set(true);
      const comando = await ponte.testes.comando(raiz, tipo, filtro).finally(() => this.preparando.set(false));
      this.comandoAtual.set(comando.join(' '));
      await ponte.tarefa.iniciar(
        'testes',
        raiz,
        comando,
        (linhas) => this.saida.update((l) => [...l, ...linhas].slice(-3000)),
        (codigo) => void terminar(codigo),
        Object.keys(env).length ? env : null,
      );
    } catch (e) {
      this.mensagens.erro(String(e));
      this.rodando.set(null);
    }
  }

  async parar(): Promise<void> {
    if (this.rodando()) await ponte.tarefa.parar('testes').catch(() => undefined);
  }

  async rodarFalhas(): Promise<void> {
    const falhas = this.testes().filter((t) => t.linguagem === 'java' && this.estadoDe(t) === 'falhou');
    if (!falhas.length) return this.mensagens.alerta('nenhum teste falhou no último run');
    const classes = [...new Set(falhas.map((t) => t.classe))];
    await this.rodar('todos', classes.join(','));
  }

  async rodarTeste(t: TesteInfo): Promise<void> {
    if (t.linguagem === 'ts') return this.rodarFront(t.tipo);
    await this.rodar(t.tipo === 'unitario' ? 'unitario' : 'todos', `${t.classe}#${t.metodo}`);
  }

  async rodarClasse(classe: string, tipo: TipoDeTeste = 'unitario'): Promise<void> {
    const t = this.testes().find((x) => x.classe === classe);
    if (t?.linguagem === 'ts') return this.rodarFront(t.tipo);
    await this.rodar(t?.tipo === 'unitario' || !t ? 'unitario' : 'todos', classe);
    void tipo;
  }

  /** Os do front rodam pelo painel de scripts do package.json (watch e e2e pedem terminal próprio). */
  private async rodarFront(tipo: FiltroDeTipo): Promise<void> {
    const nomes = this.scripts.scripts().map((s) => s.nome);
    const candidatos = tipo === 'e2e' ? ['e2e', 'test:e2e', 'cypress:run', 'playwright', 'e2e:ci'] : ['test', 'test:ci'];
    const nome = candidatos.find((c) => nomes.includes(c));
    if (!nome) {
      this.mensagens.alerta(tipo === 'e2e' ? 'não achei um script e2e no package.json' : 'não achei um script "test" no package.json');
      return;
    }
    this.layout.mostrar('scripts');
    await this.scripts.rodar(nome);
    this.mensagens.mostrar(`rodando "npm run ${nome}" no painel de scripts (␣ p)`);
  }

  // ---------- ações do detalhe ----------

  abrirNoCodigo(t: TesteInfo | null = this.atual()): void {
    if (!t) return;
    this.fechar();
    void this.editor.abrir(t.caminho, t.linha);
  }

  async explicarFalha(t: TesteInfo | null = this.atual()): Promise<void> {
    const r = t ? this.resultadoDe(t) : null;
    if (!t || !r || r.estado !== 'falhou') return this.mensagens.alerta('escolha um teste que falhou');
    this.layout.tela.set('editor');
    this.layout.mostrar('ia');
    await this.ia.enviar(`O teste ${t.id} (${t.relativo}:${t.linha}) falhou.\n\nMensagem: ${r.mensagem ?? '(sem mensagem)'}\n\n${(r.detalhe ?? '').slice(0, 1800)}\n\nExplique a causa provável. Leia o teste e o código que ele exercita antes de responder; se a correção estiver no código, proponha a edição.`);
  }

  /** Um trecho do arquivo do teste ao redor da linha que falhou (a do stack trace que está no arquivo do teste). */
  async trechoDaFalha(t: TesteInfo): Promise<{ n: number; texto: string; falha: boolean }[]> {
    const r = this.resultadoDe(t);
    if (!r?.detalhe) return [];
    const arquivo = t.relativo.split('/').pop() ?? '';
    const m = new RegExp(`${arquivo.replace('.', '\\.')}:(\\d+)`).exec(r.detalhe);
    const linha = m ? Number(m[1]) : t.linha;
    const texto = await ponte.lerArquivo(t.caminho).catch(() => '');
    const linhas = texto.split(/\r?\n/);
    const de = Math.max(1, linha - 3);
    return linhas.slice(de - 1, linha + 1).map((l, i) => ({ n: de + i, texto: l, falha: de + i === linha }));
  }
}
