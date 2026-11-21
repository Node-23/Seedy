import { computed, effect, inject, Injectable, isDevMode, signal, untracked } from '@angular/core';
import { ContainerDocker, ponte, TrafegoDocker } from '../nucleo/ponte';
import { ProjetoService } from '../nucleo/projeto.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { LayoutService } from '../layout/layout.service';
import { BancoService } from '../banco/banco.service';
import { TerminalService } from '../terminal/terminal.service';
import { EscolhaService } from '../escolha/escolha.service';
import { lerLinha, LinhaDeLog } from '../servidor/log';

export type TipoDeConexao = 'depends' | 'trafego' | 'config' | 'porta';

/** Uma seta do mapa (mockup 15). `de` = '@host' para porta publicada. */
export interface Conexao {
  de: string;
  para: string;
  tipo: TipoDeConexao;
  rotulo: string;
}

export interface GrupoDeContainers {
  titulo: string;
  containers: ContainerDocker[];
}

export const HOST = '@host';
const INTERVALO_MS = 5000;
const LIMITE_DE_LINHAS = 3000;
const SENHA = /(PASS|SECRET|TOKEN|KEY|CREDENTIAL)/i;

/**
 * Containers do Docker (Fase 8, mockups 15 e 16): lista, conexões para o mapa (rede,
 * depends_on, configuração, tráfego medido e portas no host), ações, logs ao vivo,
 * terminal dentro do container e "ligar ao banco" do Seedy.
 */
@Injectable({ providedIn: 'root' })
export class DockerService {
  private readonly projeto = inject(ProjetoService);
  private readonly mensagens = inject(MensagensService);
  private readonly layout = inject(LayoutService);
  private readonly banco = inject(BancoService);
  private readonly terminal = inject(TerminalService);
  private readonly escolha = inject(EscolhaService);

  readonly versao = signal<string | null>(null);
  readonly erro = signal<string | null>(null);
  readonly containers = signal<ContainerDocker[]>([]);
  readonly trafego = signal<TrafegoDocker[]>([]);
  readonly trafegoEm = signal<number | null>(null);
  readonly uso = signal(new Map<string, { cpu: string; memoria: string }>());
  readonly selecionado = signal<string | null>(null);
  readonly logs = signal(new Map<string, LinhaDeLog[]>());
  readonly seguindo = signal<string | null>(null);
  readonly ocupado = signal<string | null>(null);

  /** A tela ou o painel estão abertos: só então o Seedy consulta o Docker periodicamente. */
  readonly visivel = computed(() => this.layout.tela() === 'containers' || this.layout.disposicao().visiveis.containers);
  readonly rodando = computed(() => this.containers().filter((c) => c.estado === 'running'));

  /** Compose do projeto aberto (o que tem a pasta do projeto como working_dir). */
  readonly composeDoProjeto = computed(() => {
    const raiz = normal(this.projeto.raiz() ?? '');
    return this.containers().find((c) => c.composePasta && normal(c.composePasta) === raiz)?.composeProjeto ?? null;
  });

  /** Grupos da lista: o compose do projeto, os outros composes e os soltos. */
  readonly grupos = computed<GrupoDeContainers[]>(() => {
    const doProjeto = this.composeDoProjeto();
    const porProjeto = new Map<string, ContainerDocker[]>();
    const soltos: ContainerDocker[] = [];
    for (const c of this.containers()) {
      if (c.composeProjeto) porProjeto.set(c.composeProjeto, [...(porProjeto.get(c.composeProjeto) ?? []), c]);
      else soltos.push(c);
    }
    const ordem = [...porProjeto.keys()].sort((a, b) => Number(b === doProjeto) - Number(a === doProjeto) || a.localeCompare(b));
    const ordenar = (l: ContainerDocker[]) => l.slice().sort((a, b) => Number(b.estado === 'running') - Number(a.estado === 'running') || a.nome.localeCompare(b.nome));
    return [
      ...ordem.map((p) => ({ titulo: `COMPOSE · ${p.toUpperCase()}`, containers: ordenar(porProjeto.get(p)!) })),
      ...(soltos.length ? [{ titulo: 'SOLTOS', containers: ordenar(soltos) }] : []),
    ];
  });
  readonly ordenados = computed(() => this.grupos().flatMap((g) => g.containers));
  readonly atual = computed(() => this.containers().find((c) => c.nome === this.selecionado()) ?? this.ordenados()[0] ?? null);
  readonly redes = computed(() => [...new Set(this.containers().flatMap((c) => c.redes.map((r) => r.nome)))]);

  /** Todas as setas do mapa. */
  readonly conexoes = computed<Conexao[]>(() => {
    const lista = this.containers();
    const saida: Conexao[] = [];
    const tem = (de: string, para: string, tipo: TipoDeConexao) => saida.some((x) => x.de === de && x.para === para && x.tipo === tipo);
    // depends_on do compose
    for (const c of lista) {
      for (const servico of c.dependeDe) {
        const alvo = lista.find((o) => o.composeProjeto === c.composeProjeto && o.composeServico === servico);
        if (alvo) saida.push({ de: c.nome, para: alvo.nome, tipo: 'depends', rotulo: 'depends_on' });
      }
    }
    // tráfego medido agora
    for (const t of this.trafego()) {
      const atual = saida.find((x) => x.de === t.de && x.para === t.para && x.tipo === 'trafego');
      if (atual) atual.rotulo = `${Number(atual.rotulo.split(' ')[0]) + t.conexoes} conexões`;
      else saida.push({ de: t.de, para: t.para, tipo: 'trafego', rotulo: `${t.conexoes} ${t.conexoes === 1 ? 'conexão' : 'conexões'}` });
    }
    // pela configuração: variável de ambiente que aponta para o nome de outro container
    for (const c of lista) {
      for (const o of lista) {
        if (o === c || tem(c.nome, o.nome, 'depends')) continue;
        // Só entre containers da mesma rede (fora dela o nome nem resolveria).
        if (!c.redes.some((r) => o.redes.some((x) => x.nome === r.nome))) continue;
        const nomes = [o.nome, o.composeServico, ...o.redes.flatMap((r) => r.apelidos)].filter((n): n is string => !!n && n.length > 1 && !/^[0-9a-f]{12}$/.test(n));
        // O nome como host: o valor inteiro, "://db", "@db" ou "db:5432" (e não "/data/db").
        const comoHost = (valor: string, n: string) => {
          const e = escapar(n);
          return new RegExp(`^${e}$|(://|@)${e}(?=[:/?,;]|$)|(^|[\\s,;=])${e}:\\d+`, 'i').test(valor);
        };
        const variavel = c.ambiente.find((e) => {
          const valor = e.slice(e.indexOf('=') + 1);
          return nomes.some((n) => comoHost(valor, n));
        });
        if (variavel) saida.push({ de: c.nome, para: o.nome, tipo: 'config', rotulo: variavel.split('=')[0] });
      }
    }
    // portas publicadas no host
    for (const c of lista) {
      const portas = c.portas.filter((p) => p.host !== null);
      if (portas.length && c.estado === 'running') saida.push({ de: HOST, para: c.nome, tipo: 'porta', rotulo: portas.map((p) => `:${p.host}`).join(' ') });
    }
    return saida;
  });

  /** Perfil de banco do Seedy que usa a porta publicada do container (marca "◆ Homolog"). */
  readonly perfisPorContainer = computed(() => {
    const mapa = new Map<string, string>();
    for (const c of this.containers()) {
      for (const p of c.portas) {
        const perfil = this.banco.perfis().find((b) => !b.ssh && /^(localhost|127\.0\.0\.1|::1)$/.test(b.host) && b.porta === p.host);
        if (perfil) mapa.set(c.nome, perfil.nome);
      }
    }
    return mapa;
  });

  private relogio: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      const visivel = this.visivel();
      untracked(() => {
        if (visivel) {
          void this.atualizar(true);
          this.relogio ??= setInterval(() => void this.atualizar(false), INTERVALO_MS);
        } else if (this.relogio) {
          clearInterval(this.relogio);
          this.relogio = null;
        }
      });
    });
    // Logs acompanham o container escolhido enquanto a tela/painel estão abertos.
    effect(() => {
      const c = this.atual();
      const visivel = this.visivel();
      untracked(() => {
        if (visivel && c && c.nome !== this.seguindo()) void this.seguirLogs(c.nome);
        if (!visivel && this.seguindo()) void this.pararLogs();
      });
    });
    if (isDevMode()) Object.assign(window, { seedyDocker: this });
  }

  async atualizar(completo: boolean): Promise<void> {
    try {
      if (completo || !this.versao()) this.versao.set(await ponte.docker.versao());
      const [lista, trafego] = await Promise.all([ponte.docker.listar(), ponte.docker.trafego().catch(() => this.trafego())]);
      this.containers.set(lista);
      this.trafego.set(trafego);
      this.trafegoEm.set(Date.now());
      this.erro.set(null);
      if (completo || this.layout.tela() === 'containers') void ponte.docker.uso().then((u) => this.uso.set(new Map(u.map((x) => [x.nome, x]))));
    } catch (e) {
      this.versao.set(null);
      this.erro.set(String(e));
    }
  }

  escolher(nome: string | undefined): void {
    if (nome) this.selecionado.set(nome);
  }

  // ---------- ações ----------

  async iniciarOuParar(nome = this.atual()?.nome): Promise<void> {
    const c = this.containers().find((x) => x.nome === nome);
    if (!c) return;
    await this.acao(c.nome, c.estado === 'running' ? 'stop' : 'start');
  }

  async reiniciar(nome = this.atual()?.nome): Promise<void> {
    if (nome) await this.acao(nome, 'restart');
  }

  private async acao(nome: string, acao: 'start' | 'stop' | 'restart'): Promise<void> {
    const verbo = { start: 'iniciando', stop: 'parando', restart: 'reiniciando' }[acao];
    this.ocupado.set(`${verbo} ${nome}`);
    try {
      await ponte.docker.acao(nome, acao);
      this.mensagens.mostrar(`${nome}: ${acao === 'stop' ? 'parado' : acao === 'start' ? 'iniciado' : 'reiniciado'}`);
    } catch (e) {
      this.mensagens.erro(`${nome}: ${e}`);
    } finally {
      this.ocupado.set(null);
      await this.atualizar(false);
    }
  }

  /** docker compose up -d / down na pasta do compose do projeto (ou do container escolhido). */
  async compose(acao: 'up' | 'down'): Promise<void> {
    const pasta = this.atual()?.composePasta ?? this.projeto.raiz();
    if (!pasta) return;
    const id = `compose:${acao}`;
    this.ocupado.set(`compose ${acao}`);
    await ponte.tarefa
      .iniciar(id, pasta, acao === 'up' ? ['docker', 'compose', 'up', '-d'] : ['docker', 'compose', 'down'], (l) => this.registrar(`compose ${acao}`, l), (codigo) => {
        this.ocupado.set(null);
        if (codigo) this.mensagens.erro(`docker compose ${acao} falhou (código ${codigo}) — veja os logs`);
        else this.mensagens.mostrar(`docker compose ${acao} concluído`);
        void this.atualizar(false);
      })
      .catch((e) => {
        this.ocupado.set(null);
        this.mensagens.erro(String(e));
      });
  }

  /** compose down pede confirmação (remove os containers do compose). */
  async composeDown(): Promise<void> {
    const ok = await this.escolha.escolherUm('DOCKER COMPOSE DOWN?', [
      { rotulo: 'Derrubar', detalhe: 'para e remove os containers do compose (os volumes ficam)', valor: true },
      { rotulo: 'Cancelar', valor: false },
    ]);
    if (ok) await this.compose('down');
  }

  // ---------- logs ----------

  async seguirLogs(nome: string): Promise<void> {
    await this.pararLogs();
    const raiz = this.projeto.raiz() ?? '.';
    this.seguindo.set(nome);
    this.logs.update((m) => new Map(m).set(nome, []));
    await ponte.tarefa
      .iniciar(`logs:${nome}`, raiz, ['docker', 'logs', '-f', '--tail', '300', '--timestamps', nome], (l) => this.registrar(nome, l), () => {
        if (this.seguindo() === nome) this.seguindo.set(null);
      })
      .catch(() => this.seguindo.set(null));
  }

  async pararLogs(): Promise<void> {
    const atual = this.seguindo();
    if (!atual) return;
    this.seguindo.set(null);
    await ponte.tarefa.parar(`logs:${atual}`).catch(() => undefined);
  }

  private contador = 0;

  private registrar(nome: string, textos: string[]): void {
    this.logs.update((m) => {
      const antes = m.get(nome) ?? [];
      let anterior = antes[antes.length - 1] ?? null;
      const novas = textos.map((t) => {
        // "2026-11-21T14:02:11.123456789Z mensagem": a hora vira HH:MM:SS na frente.
        const ts = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.\d+Z\s?(.*)$/.exec(t);
        const l = lerLinha(ts ? ts[2] : t, ++this.contador, anterior);
        // O Docker manda em UTC; a tela mostra a hora local.
        if (ts && !l.hora) l.hora = new Date(`${ts[1]}Z`).toTimeString().slice(0, 8);
        anterior = l;
        return l;
      });
      return new Map(m).set(nome, [...antes, ...novas].slice(-LIMITE_DE_LINHAS));
    });
  }

  // ---------- terminal e banco ----------

  /** Shell dentro do container no terminal integrado (bash se tiver, senão sh). */
  abrirTerminal(nome = this.atual()?.nome): void {
    const c = this.containers().find((x) => x.nome === nome);
    if (!c) return;
    if (c.estado !== 'running') return void this.mensagens.mostrar(`${c.nome} não está rodando`);
    this.terminal.abrir(`🐳 ${c.nome}`, ['docker', 'exec', '-it', c.nome, 'sh', '-c', 'command -v bash >/dev/null 2>&1 && exec bash || exec sh']);
    this.layout.tela.set('editor');
  }

  /** Container de PostgreSQL/MySQL vira conexão no painel de banco (o editor abre preenchido). */
  ligarAoBanco(nome = this.atual()?.nome): void {
    const c = this.containers().find((x) => x.nome === nome);
    if (!c) return;
    const tipo = /postgres|postgis|timescale/i.test(c.imagem) ? 'postgres' : /mysql|mariadb|percona/i.test(c.imagem) ? 'mysql' : null;
    if (!tipo) return void this.mensagens.mostrar(`${c.nome} não parece um PostgreSQL nem um MySQL`);
    const padrao = tipo === 'postgres' ? 5432 : 3306;
    const porta = c.portas.find((p) => p.container === padrao && p.host)?.host ?? c.portas.find((p) => p.host)?.host;
    if (!porta) return void this.mensagens.mostrar(`${c.nome} não publica a porta ${padrao} no host`);
    const env = (k: string) => c.ambiente.find((e) => e.startsWith(`${k}=`))?.slice(k.length + 1);
    const usuario = tipo === 'postgres' ? (env('POSTGRES_USER') ?? 'postgres') : (env('MYSQL_USER') ?? 'root');
    const senha = tipo === 'postgres' ? env('POSTGRES_PASSWORD') : usuario === 'root' ? env('MYSQL_ROOT_PASSWORD') : env('MYSQL_PASSWORD');
    const banco = tipo === 'postgres' ? (env('POSTGRES_DB') ?? usuario) : (env('MYSQL_DATABASE') ?? '');
    this.banco.editando.set({
      novo: true,
      senha: senha ?? undefined,
      perfil: {
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        nome: c.composeServico ?? c.nome,
        ambiente: 'local',
        tipo,
        host: 'localhost',
        porta,
        banco,
        usuario,
        somenteLeitura: false,
        ssl: 'desligado',
        ssh: null,
      },
    });
    this.layout.tela.set('editor');
  }

  /** Variável de ambiente com cara de senha aparece mascarada. */
  ambienteVisivel(e: string): string {
    const i = e.indexOf('=');
    return i > 0 && SENHA.test(e.slice(0, i)) ? `${e.slice(0, i)}=••••` : e;
  }
}

function normal(c: string): string {
  return c.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function escapar(t: string): string {
  return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
