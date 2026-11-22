import { EnvService } from '../execucao/env.service';
import { computed, effect, inject, Injectable, isDevMode, signal, untracked } from '@angular/core';
import { FonteDeDeploy, InfoExecucao, nomeBase, PerfilServidor, ponte, TipoServidor } from '../nucleo/ponte';
import { ProjetoService } from '../nucleo/projeto.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { EscolhaService } from '../escolha/escolha.service';
import { JdtlsService } from '../java/jdtls.service';
import { BuscaService } from '../busca/busca.service';
import { EditorService } from '../editor/editor.service';
import { LayoutService } from '../layout/layout.service';
import { monaco } from '../editor/monaco';
import { aplicacaoPronta, deFramework, Frame, lerLinha, LinhaDeLog, subiu } from './log';

export type FaseServidor = 'subindo' | 'rodando' | 'parando' | 'parado';

export interface Execucao {
  perfilId: string;
  fase: FaseServidor;
  debug: boolean;
  info: InfoExecucao | null;
  inicio: number;
  /** Quanto levou para subir (ms), quando já subiu. */
  subiuEm: number | null;
  linhas: LinhaDeLog[];
  erros: number;
  avisos: number;
}

/** Onde a última exceção do servidor passou pelo código do projeto (marca no editor). */
export interface UltimaExcecao {
  caminho: string;
  linha: number;
  excecao: string;
}

const LIMITE_DE_LINHAS = 5000;
const PASTAS_WEB = ['src/main/webapp', 'WebContent', 'web', 'WebRoot', 'src/main/resources/META-INF/resources'];
const PASTAS_CLASSES = ['target/classes', 'build/classes/java/main', 'bin', 'build/classes', 'WebContent/WEB-INF/classes'];
/** Jars que o servidor já traz (API Jakarta/Java EE): ficam fora do WEB-INF/lib. */
const JAR_DO_SERVIDOR = /(^|[-_.])(servlet-api|jsp-api|el-api|javaee-(web-)?api|jakartaee-(web-)?api|jakarta\.servlet|jakarta\.el|jakarta\.servlet\.jsp|jboss-|wildfly-|tomcat-)/i;

/**
 * Servidores de aplicação (Fase 5, mockup 06): perfis, iniciar (com ou sem debug),
 * parar, redeploy, saída do servidor com stack trace clicável e hot swap.
 */
@Injectable({ providedIn: 'root' })
export class ServidorService {
  private readonly projeto = inject(ProjetoService);
  private readonly mensagens = inject(MensagensService);
  private readonly env = inject(EnvService);
  private readonly escolha = inject(EscolhaService);
  private readonly jdtls = inject(JdtlsService);
  private readonly busca = inject(BuscaService);
  private readonly editor = inject(EditorService);
  private readonly layout = inject(LayoutService);

  readonly perfis = signal<PerfilServidor[]>([]);
  readonly execucoes = signal(new Map<string, Execucao>());
  /** Perfil mostrado no painel do servidor. */
  readonly selecionado = signal<string | null>(null);
  readonly editando = signal<{ perfil: PerfilServidor; novo: boolean } | null>(null);
  readonly ultimaExcecao = signal<UltimaExcecao | null>(null);

  /** Perfis do projeto aberto (cada servidor pertence a um projeto). */
  readonly doProjeto = computed(() => {
    const raiz = this.projeto.raiz();
    return this.perfis().filter((p) => !raiz || mesmoCaminho(p.projeto, raiz));
  });
  readonly perfilAtual = computed(() => {
    const lista = this.doProjeto();
    return lista.find((p) => p.id === this.selecionado()) ?? lista[0] ?? null;
  });
  readonly execucaoAtual = computed(() => {
    const p = this.perfilAtual();
    return p ? (this.execucoes().get(p.id) ?? null) : null;
  });
  /** Algum servidor rodando (para a statusline). */
  readonly rodando = computed(() => [...this.execucoes().values()].filter((e) => e.fase !== 'parado'));

  /** Avisado a cada linha nova (o depurador espera o servidor subir para se anexar). */
  aoSubir: ((perfilId: string, porta: number) => void) | null = null;
  aoParar: ((perfilId: string) => void) | null = null;

  private contador = 0;
  private readonly marcas = new Map<string, monaco.editor.IEditorDecorationsCollection>();

  constructor() {
    void this.carregar();
    // A marca da exceção aparece quando o arquivo dela é o ativo.
    effect(() => {
      this.editor.ativo();
      this.ultimaExcecao();
      untracked(() => queueMicrotask(() => this.marcarExcecao()));
    });
    if (isDevMode()) Object.assign(window, { seedyServidor: this });
  }

  async carregar(): Promise<void> {
    try {
      this.perfis.set(await ponte.servidor.perfis());
      // Servidor que já rodava antes da interface recarregar: aparece como rodando (dá para parar).
      for (const r of await ponte.servidor.emExecucao()) {
        if (this.execucoes().has(r.id)) continue;
        const info: InfoExecucao = { versao: '', url: r.url, portaDebug: r.portaDebug, aplicacao: '', copiados: 0, pid: 0 };
        this.atualizar(r.id, { perfilId: r.id, fase: 'rodando', debug: !!r.portaDebug, info, inicio: Date.now(), subiuEm: null, linhas: [], erros: 0, avisos: 0 });
        this.registrar(r.id, ['servidor já estava rodando (a saída anterior não está disponível)'], true);
      }
    } catch (e) {
      this.mensagens.erro(`servidores: ${e}`);
    }
  }

  perfil(id: string): PerfilServidor | undefined {
    return this.perfis().find((p) => p.id === id);
  }

  // ---------- perfis ----------

  /** Novo servidor: começa pedindo a pasta de instalação (o tipo vem dela). */
  async novo(): Promise<void> {
    const raiz = this.projeto.raiz();
    if (!raiz) {
      this.mensagens.alerta('abra um projeto antes de configurar o servidor');
      return;
    }
    const nomeDoProjeto = nomeBase(raiz);
    this.editando.set({
      novo: true,
      perfil: {
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        nome: '',
        tipo: 'wildfly',
        instalacao: '',
        jdk: null,
        portaHttp: 8080,
        portaDebug: 8787,
        opcoesJvm: '-Xms256m -Xmx1024m',
        variaveis: {},
        contexto: `/${nomeDoProjeto}`,
        projeto: raiz,
        pastaWeb: (await this.primeiraQueExiste(raiz, PASTAS_WEB)) ?? 'src/main/webapp',
        pastaClasses: (await this.primeiraQueExiste(raiz, PASTAS_CLASSES)) ?? 'target/classes',
      },
    });
  }

  /**
   * Cria e salva um perfil de servidor sem o diálogo (a IA usa, pela ferramenta servidor_criar).
   * Aponta para uma instalação existente de Tomcat ou WildFly/JBoss.
   */
  async criarPerfil(o: { instalacao: string; nome?: string; tipo?: TipoServidor; portaHttp?: number; portaDebug?: number; contexto?: string; opcoesJvm?: string }): Promise<PerfilServidor> {
    const raiz = this.projeto.raiz();
    if (!raiz) throw new Error('nenhum projeto aberto');
    const instalacao = o.instalacao.trim().replace(/[\\/]+$/, '');
    const igual = this.perfis().find((p) => p.instalacao.replace(/[\\/]+$/, '') === instalacao && p.projeto === raiz);
    if (igual) return igual;
    const info = await ponte.servidor.inspecionar(instalacao).catch((e) => {
      throw new Error(`"${instalacao}" não parece uma instalação de Tomcat nem de WildFly/JBoss (${e})`);
    });
    const tipo = o.tipo ?? info.tipo;
    const perfil: PerfilServidor = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      nome: o.nome?.trim() || `${tipo === 'tomcat' ? 'Tomcat' : 'WildFly'} ${info.versao}`,
      tipo,
      instalacao,
      jdk: null,
      portaHttp: o.portaHttp ?? 8080,
      portaDebug: o.portaDebug ?? 8787,
      opcoesJvm: o.opcoesJvm ?? '-Xms256m -Xmx1024m',
      variaveis: {},
      contexto: o.contexto ?? `/${nomeBase(raiz)}`,
      projeto: raiz,
      pastaWeb: (await this.primeiraQueExiste(raiz, PASTAS_WEB)) ?? 'src/main/webapp',
      pastaClasses: (await this.primeiraQueExiste(raiz, PASTAS_CLASSES)) ?? 'target/classes',
    };
    if (!(await this.salvar(perfil))) throw new Error('não consegui salvar o servidor');
    return perfil;
  }

  editar(id: string): void {
    const p = this.perfil(id);
    if (p) this.editando.set({ novo: false, perfil: { ...p, variaveis: { ...p.variaveis } } });
  }

  async salvar(perfil: PerfilServidor): Promise<boolean> {
    try {
      await ponte.servidor.salvarPerfil(perfil);
    } catch (e) {
      this.mensagens.erro(String(e));
      return false;
    }
    await this.carregar();
    this.editando.set(null);
    this.selecionado.set(perfil.id);
    this.mensagens.mostrar(`servidor ${perfil.nome} salvo`);
    return true;
  }

  async apagar(id: string): Promise<void> {
    const p = this.perfil(id);
    if (!p) return;
    const ok = await this.escolha.escolherUm(`APAGAR O SERVIDOR ${p.nome.toUpperCase()}?`, [
      { rotulo: 'Apagar', detalhe: 'o perfil e a pasta de servidor dele (a instalação não é tocada)', valor: true },
      { rotulo: 'Cancelar', valor: false },
    ]);
    if (!ok) return;
    await ponte.servidor.apagarPerfil(id);
    this.atualizar(id, null);
    await this.carregar();
  }

  /** Escolhe qual servidor do projeto o painel mostra. */
  async escolher(): Promise<void> {
    const lista = this.doProjeto();
    if (!lista.length) return void this.novo();
    const id = await this.escolha.escolherUm(
      'SERVIDOR',
      [
        ...lista.map((p) => ({ rotulo: p.nome, detalhe: `${p.tipo} · :${p.portaHttp} · ${p.contexto}${this.execucoes().get(p.id)?.fase === 'rodando' ? ' · rodando' : ''}`, valor: p.id })),
        { rotulo: '+ novo servidor', valor: '' },
      ],
    );
    if (id === '') await this.novo();
    else if (id) this.selecionado.set(id);
  }

  // ---------- execução ----------

  /** Sobe o servidor do painel (ou o informado); com `debug`, anexa o depurador ao subir. */
  async iniciar(debug: boolean, id = this.perfilAtual()?.id): Promise<void> {
    if (!id) return void this.novo();
    const p = this.perfil(id);
    if (!p) return;
    const atual = this.execucoes().get(id);
    if (atual && atual.fase !== 'parado') {
      this.mensagens.mostrar(`${p.nome} já está rodando`);
      return;
    }
    const env = await this.env.variaveis();
    if (env === null) return; // cancelou a escolha do .env
    this.layout.mostrar('servidor');
    this.selecionado.set(id);
    const fontes = await this.fontes(p);
    this.atualizar(id, { perfilId: id, fase: 'subindo', debug, info: null, inicio: Date.now(), subiuEm: null, linhas: [], erros: 0, avisos: 0 });
    this.registrar(id, [`subindo ${p.nome}${debug ? ' em modo debug' : ''}…`], true);
    try {
      const info = await ponte.servidor.iniciar(
        id,
        fontes,
        debug,
        (linhas) => this.registrar(id, linhas),
        (e) => {
          if (e.tipo === 'copiados') this.aoCopiar(id, e.arquivos);
          else this.aoEncerrar(id, e.codigo);
        },
        env,
      );
      this.mudar(id, (x) => ({ ...x, info }));
      this.registrar(id, [`${info.versao} · aplicação montada (${info.copiados} arquivos) em ${info.aplicacao}`], true);
    } catch (e) {
      this.mudar(id, (x) => ({ ...x, fase: 'parado' }));
      this.registrar(id, [`não subiu: ${e}`], true, 'erro');
      this.mensagens.erro(String(e));
    }
  }

  async parar(id = this.perfilAtual()?.id): Promise<void> {
    if (!id) return;
    const e = this.execucoes().get(id);
    if (!e || e.fase === 'parado') return;
    this.mudar(id, (x) => ({ ...x, fase: 'parando' }));
    try {
      await ponte.servidor.parar(id);
    } catch (erro) {
      this.mensagens.erro(String(erro));
    }
    // O aviso "encerrado" normalmente chega sozinho; se não chegar (a interface recarregou), confere.
    for (let i = 0; i < 20 && this.execucoes().get(id)?.fase === 'parando'; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (!(await ponte.servidor.emExecucao()).some((r) => r.id === id) && this.execucoes().get(id)?.fase === 'parando') this.aoEncerrar(id, null);
    }
  }

  /** ctrl+F10: refaz a aplicação (classes, jars) e manda o servidor recarregar. */
  async redeploy(id = this.perfilAtual()?.id): Promise<void> {
    const p = id ? this.perfil(id) : undefined;
    const e = id ? this.execucoes().get(id) : undefined;
    if (!p || !e || e.fase === 'parado') {
      this.mensagens.alerta('o servidor não está rodando');
      return;
    }
    try {
      const n = await ponte.servidor.redeploy(p.id, await this.fontes(p));
      this.registrar(p.id, [`redeploy pedido (${n} ${n === 1 ? 'arquivo atualizado' : 'arquivos atualizados'})`], true);
    } catch (erro) {
      this.mensagens.erro(String(erro));
    }
  }

  async abrirNoNavegador(id = this.perfilAtual()?.id): Promise<void> {
    const url = id ? this.execucoes().get(id)?.info?.url : null;
    if (!url) return void this.mensagens.alerta('o servidor não está rodando');
    await ponte.servidor.abrirUrl(url).catch((e) => this.mensagens.erro(String(e)));
  }

  limpar(id = this.perfilAtual()?.id): void {
    if (id) this.mudar(id, (x) => ({ ...x, linhas: [], erros: 0, avisos: 0 }));
  }

  // ---------- deploy explodido ----------

  /** O que entra na aplicação: pasta web, classes do jdtls e jars de dependência. */
  async fontes(p: PerfilServidor): Promise<FonteDeDeploy[]> {
    const juntar = (rel: string) => juntarCaminho(p.projeto, rel);
    const web = juntar(p.pastaWeb);
    const classes = juntar(p.pastaClasses);
    const fontes: FonteDeDeploy[] = [
      { origem: web, destino: '' },
      { origem: classes, destino: 'WEB-INF/classes' },
    ];
    const libDoProjeto = new Set(
      (await ponte.lerPasta(juntarCaminho(web, 'WEB-INF/lib')).catch(() => [])).map((e) => e.nome.toLowerCase()),
    );
    try {
      const r = await this.jdtls.executar<{ classpaths: string[] }>(
        'java.project.getClasspaths',
        monaco.Uri.file(p.projeto).toString(),
        JSON.stringify({ scope: 'runtime' }),
      );
      const vistos = new Set<string>();
      for (const c of r?.classpaths ?? []) {
        const nome = nomeBase(c);
        if (/\.jar$/i.test(c)) {
          if (JAR_DO_SERVIDOR.test(nome) || libDoProjeto.has(nome.toLowerCase()) || vistos.has(nome)) continue;
          vistos.add(nome);
          fontes.push({ origem: c, destino: `WEB-INF/lib/${nome}` });
        } else if (!mesmoCaminho(c, classes) && !/test-classes|[\\/]test[\\/]?$/i.test(c) && dentroDe(c, p.projeto)) {
          // Saída de outro módulo do mesmo projeto: entra junto nas classes.
          fontes.push({ origem: c, destino: 'WEB-INF/classes' });
        }
      }
    } catch {
      this.mensagens.mostrar('jdtls ainda não está pronto: subindo só com a pasta web e as classes (sem as dependências do Maven/Gradle)');
    }
    return fontes;
  }

  private async primeiraQueExiste(raiz: string, candidatas: string[]): Promise<string | null> {
    for (const c of candidatas) {
      const pai = juntarCaminho(raiz, c.split('/').slice(0, -1).join('/'));
      const nome = c.split('/').pop()!;
      const lista = await ponte.lerPasta(pai).catch(() => []);
      if (lista.some((e) => e.pasta && e.nome === nome)) return c;
    }
    return null;
  }

  // ---------- saída do servidor ----------

  private registrar(id: string, textos: string[], seedy = false, nivel: 'erro' | null = null): void {
    const r = { subiu: null as number | null, pronta: false };
    this.mudar(id, (x) => {
      const novas: LinhaDeLog[] = [];
      let anterior = x.linhas[x.linhas.length - 1] ?? null;
      let erros = x.erros;
      let avisos = x.avisos;
      for (const t of textos) {
        const l: LinhaDeLog = seedy
          ? { n: ++this.contador, texto: t, nivel: nivel ?? 'info', hora: hora(), mensagem: t, frame: null, pilha: false, seedy: true }
          : lerLinha(t, ++this.contador, anterior);
        if (!l.pilha && l.nivel === 'erro' && !seedy) erros++;
        if (!l.pilha && l.nivel === 'aviso') avisos++;
        if (!seedy) {
          const ms = subiu(t);
          if (ms !== null && x.subiuEm === null) r.subiu = ms;
          if (aplicacaoPronta(t)) r.pronta = true;
        }
        novas.push(l);
        anterior = l;
      }
      const linhas = x.linhas.length + novas.length > LIMITE_DE_LINHAS ? [...x.linhas, ...novas].slice(-LIMITE_DE_LINHAS) : [...x.linhas, ...novas];
      return {
        ...x,
        linhas,
        erros,
        avisos,
        fase: r.subiu !== null && x.fase === 'subindo' ? 'rodando' : x.fase,
        subiuEm: r.subiu ?? x.subiuEm,
      };
    });
    if (!seedy) this.procurarExcecao(id, textos);
    const e = this.execucoes().get(id);
    if (r.subiu !== null && e) {
      this.mensagens.mostrar(`${this.perfil(id)?.nome ?? 'servidor'} subiu em ${(r.subiu / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`);
      if (e.debug && e.info?.portaDebug) this.aoSubir?.(id, e.info.portaDebug);
    }
    if (r.pronta) this.mensagens.mostrar('aplicação no ar');
  }

  private aoCopiar(id: string, arquivos: string[]): void {
    const classes = arquivos.filter((a) => a.startsWith('WEB-INF/classes/'));
    const outros = arquivos.filter((a) => !a.startsWith('WEB-INF/classes/'));
    const linhas: string[] = [];
    if (outros.length) linhas.push(`${outros.length === 1 ? nomeBase(outros[0]) : `${outros.length} arquivos`} atualizado${outros.length === 1 ? '' : 's'} (hot swap)`);
    if (classes.length) {
      const debug = this.execucoes().get(id)?.debug;
      linhas.push(
        `${classes.length} ${classes.length === 1 ? 'classe atualizada' : 'classes atualizadas'}${debug ? ' (o depurador aplica no servidor)' : ' — ctrl+F10 redeploy para o servidor carregar'}`,
      );
    }
    if (linhas.length) this.registrar(id, linhas, true);
  }

  private aoEncerrar(id: string, codigo: number | null): void {
    this.mudar(id, (x) => ({ ...x, fase: 'parado' }));
    this.registrar(id, [`servidor parado${codigo !== null && codigo !== 0 && codigo !== 1 ? ` (código ${codigo})` : ''}`], true);
    this.aoParar?.(id);
  }

  /** Primeiro frame do projeto na última exceção: abre no editor e marca a linha. */
  async abrirFrame(f: Frame): Promise<void> {
    const caminho = this.arquivoDoFrame(f);
    if (!caminho) {
      this.mensagens.alerta(`${f.classe} não é do projeto`);
      return;
    }
    await this.editor.abrir(caminho, f.linha ?? undefined);
    this.editor.focar();
  }

  /** Arquivo .java do projeto para a classe do frame (classes internas `$` contam como a externa). */
  arquivoDoFrame(f: Frame): string | null {
    const externa = f.classe.split('$')[0];
    const sufixo = `${externa.split('.').slice(0, -1).join('/')}/${f.arquivo || `${externa.split('.').pop()}.java`}`;
    const indice = this.busca.indice();
    const achado = indice?.arquivos.find((a) => a.relativo === sufixo || a.relativo.endsWith(`/${sufixo}`));
    return achado?.caminho ?? null;
  }

  private procurarExcecao(id: string, textos: string[]): void {
    const linhas = this.execucoes().get(id)?.linhas ?? [];
    // Só olha o fim (as linhas que acabaram de chegar).
    let excecao: string | null = null;
    for (let i = Math.max(0, linhas.length - textos.length - 3); i < linhas.length; i++) {
      const l = linhas[i];
      // O nome da exceção vem numa linha própria ou no fim da linha do ERROR (WildFly).
      const nome = !l.frame && (l.nivel === 'erro' || l.pilha) ? /(?:^|[\s:])((?:[a-z][\w$]*\.)+([\w$]+(?:Exception|Error)))\b/.exec(l.texto) : null;
      if (nome) excecao = nome[2];
      if (excecao && l.frame && !deFramework(l.frame.classe) && l.frame.linha) {
        const caminho = this.arquivoDoFrame(l.frame);
        if (caminho) {
          this.ultimaExcecao.set({ caminho, linha: l.frame.linha, excecao });
          this.marcarExcecao();
          return;
        }
      }
    }
  }

  /** "◆ NullPointerException" no fim da linha do editor onde a exceção passou (mockup 06). */
  marcarExcecao(): void {
    const u = this.ultimaExcecao();
    for (const [, d] of this.marcas) d.clear();
    this.marcas.clear();
    if (!u) return;
    const modelo = monaco.editor.getModel(monaco.Uri.file(u.caminho));
    const ed = this.editor.instancia;
    if (!modelo || !ed || ed.getModel() !== modelo || u.linha > modelo.getLineCount()) return;
    const col = modelo.getLineMaxColumn(u.linha);
    this.marcas.set(
      u.caminho,
      ed.createDecorationsCollection([
        { range: new monaco.Range(u.linha, 1, u.linha, 1), options: { isWholeLine: true, className: 'linha-excecao', linesDecorationsClassName: 'margem-excecao' } },
        { range: new monaco.Range(u.linha, col, u.linha, col), options: { after: { content: `   ◆ ${u.excecao}`, inlineClassName: 'etiqueta-excecao' }, showIfCollapsed: true } },
      ]),
    );
  }

  // ---------- estado ----------

  private atualizar(id: string, e: Execucao | null): void {
    this.execucoes.update((m) => {
      const n = new Map(m);
      if (e) n.set(id, e);
      else n.delete(id);
      return n;
    });
  }

  private mudar(id: string, fn: (e: Execucao) => Execucao): void {
    const atual = this.execucoes().get(id);
    if (atual) this.atualizar(id, fn(atual));
  }
}

function hora(): string {
  return new Date().toTimeString().slice(0, 8);
}

function juntarCaminho(base: string, rel: string): string {
  if (!rel) return base;
  const sep = /^[a-zA-Z]:/.test(base) ? '\\' : '/';
  return `${base.replace(/[\\/]+$/, '')}${sep}${rel.replace(/[\\/]+/g, sep)}`;
}

function normal(c: string): string {
  return c.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function mesmoCaminho(a: string, b: string): boolean {
  return normal(a) === normal(b);
}

function dentroDe(c: string, raiz: string): boolean {
  return normal(c).startsWith(normal(raiz) + '/');
}
