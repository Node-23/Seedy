import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { EditorService } from '../editor/editor.service';
import { EntenderService } from '../entender/entender.service';
import { EnvService } from '../execucao/env.service';
import { LayoutService } from '../layout/layout.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { ComponenteAnalise, MetodoAnalise, ponte, TesteInfo } from '../nucleo/ponte';
import { ProjetoService } from '../nucleo/projeto.service';
import { TestesService } from '../testes/testes.service';
import { EstadoDeTeste } from '../testes/cobertura';
import { SpringService } from '../spring/spring.service';

export type Http = NonNullable<MetodoAnalise['http']>;
export type Verbo = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
export const VERBOS: Verbo[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

export interface EndpointInfo {
  /** `Controller.metodo`. */
  id: string;
  verbo: string;
  rota: string;
  controller: ComponenteAnalise;
  metodo: MetodoAnalise;
  http: Http;
}

export type LinhaDeEndpoint =
  | { tipo: 'grupo'; chave: string; controller: ComponenteAnalise; total: number; aberto: boolean }
  | { tipo: 'endpoint'; chave: string; e: EndpointInfo };

export interface RespostaDaChamada {
  status: number;
  tipo: string | null;
  corpo: string;
  ms: number;
}

const CONTROLLERS = new Set(['RestController', 'Controller']);
const NOME_DE_TOKEN = /^(API_?)?(ACCESS_?)?(TOKEN|JWT|BEARER)$|_TOKEN$/i;

/** Valor de exemplo para um tipo Java (corpo e parâmetros da chamada). */
function exemploDe(tipo: string): string | number | boolean | null | unknown[] {
  const t = tipo.replace(/<.*$/, '').trim();
  if (/\[\]$/.test(tipo) || /^(List|Set|Collection|Iterable)$/.test(t)) return [];
  if (/^(Long|Integer|Short|Byte|long|int|short|byte|BigInteger)$/.test(t)) return 0;
  if (/^(Double|Float|double|float|BigDecimal)$/.test(t)) return 0.0;
  if (/^(Boolean|boolean)$/.test(t)) return false;
  if (/^(String|Character|char)$/.test(t)) return '';
  if (/^UUID$/.test(t)) return '00000000-0000-0000-0000-000000000000';
  if (/^(LocalDate)$/.test(t)) return '2026-01-01';
  if (/^(LocalDateTime|OffsetDateTime|ZonedDateTime|Instant|Date)$/.test(t)) return '2026-01-01T00:00:00';
  return null;
}

/**
 * Tela Endpoints (␣ H), só em projeto Spring Boot: lista os endpoints que o Seedy leu do código
 * (controller, verbo, caminho, parâmetros, corpo, acesso), os testes que passam por cada um e
 * chama o endpoint na aplicação local. Aproveita a análise da tela "entender o sistema".
 */
@Injectable({ providedIn: 'root' })
export class EndpointsService {
  private readonly layout = inject(LayoutService);
  private readonly projeto = inject(ProjetoService);
  private readonly entender = inject(EntenderService);
  private readonly editor = inject(EditorService);
  private readonly testes = inject(TestesService);
  private readonly env = inject(EnvService);
  private readonly mensagens = inject(MensagensService);

  private readonly spring = inject(SpringService);
  /** O projeto aberto é Spring Boot? Mostra o botão. */
  readonly ehSpring = this.spring.ehSpring;
  readonly porta = this.spring.porta;
  readonly contexto = this.spring.contexto;
  readonly noAr = signal(false);

  readonly selecionado = signal<string | null>(null);
  readonly filtroVerbo = signal<Verbo | 'todos'>('todos');
  readonly soProtegidos = signal(false);
  readonly busca = signal('');
  readonly fechados = signal<ReadonlySet<string>>(new Set());

  /** O pedido (texto no formato `.http`): primeira linha, cabeçalhos, linha em branco, corpo. */
  readonly pedido = signal('');
  readonly resposta = signal<RespostaDaChamada | null>(null);
  readonly chamando = signal(false);
  readonly erroDaChamada = signal<string | null>(null);

  readonly todos = computed<EndpointInfo[]>(() => {
    const lista: EndpointInfo[] = [];
    for (const c of this.entender.analise()?.componentes ?? []) {
      if (c.linguagem !== 'java' || !c.anotacoes.some((a) => CONTROLLERS.has(a))) continue;
      for (const m of c.metodos) {
        if (m.http) lista.push({ id: `${c.nome}.${m.nome}:${m.linha}`, verbo: m.http.verbo, rota: m.http.rota || '/', controller: c, metodo: m, http: m.http });
      }
    }
    return lista.sort((a, b) => a.controller.nome.localeCompare(b.controller.nome) || a.metodo.linha - b.metodo.linha);
  });

  readonly visiveis = computed(() => {
    const verbo = this.filtroVerbo();
    const busca = this.busca().trim().toLowerCase();
    return this.todos().filter(
      (e) => (verbo === 'todos' || e.verbo === verbo) && (!this.soProtegidos() || !!e.http.acesso) && (!busca || `${e.verbo} ${this.urlRelativa(e)} ${e.controller.nome} ${e.metodo.nome}`.toLowerCase().includes(busca)),
    );
  });

  readonly linhas = computed<LinhaDeEndpoint[]>(() => {
    const saida: LinhaDeEndpoint[] = [];
    const fechados = this.fechados();
    const grupos = new Map<string, EndpointInfo[]>();
    for (const e of this.visiveis()) grupos.set(e.controller.id, [...(grupos.get(e.controller.id) ?? []), e]);
    for (const lista of grupos.values()) {
      const aberto = !fechados.has(lista[0].controller.id);
      saida.push({ tipo: 'grupo', chave: lista[0].controller.id, controller: lista[0].controller, total: lista.length, aberto });
      if (aberto) for (const e of lista) saida.push({ tipo: 'endpoint', chave: e.id, e });
    }
    return saida;
  });

  readonly contagem = computed(() => {
    const t = this.todos();
    const porVerbo = Object.fromEntries(VERBOS.map((v) => [v, t.filter((e) => e.verbo === v).length])) as Record<Verbo, number>;
    return { todos: t.length, porVerbo, protegidos: t.filter((e) => e.http.acesso).length, controllers: new Set(t.map((e) => e.controller.id)).size };
  });

  readonly atual = computed(() => this.todos().find((e) => e.id === this.selecionado()) ?? null);

  constructor() {
    // A análise chegou (ou o projeto mudou): sem endpoint escolhido, vale o primeiro.
    effect(() => {
      const todos = this.todos();
      untracked(() => {
        if (!this.atual()) this.selecionado.set(todos[0]?.id ?? null);
      });
    });
    // Escolher outro endpoint monta o pedido de exemplo dele.
    effect(() => {
      const e = this.atual();
      this.env.nomes();
      untracked(() => {
        this.resposta.set(null);
        this.erroDaChamada.set(null);
        this.pedido.set(e ? this.montarPedido(e) : '');
      });
    });
    // Enquanto a tela está aberta, vê se a aplicação está no ar.
    effect((limpar) => {
      if (this.layout.tela() !== 'endpoints') return;
      const ver = () => void ponte.rede.portaEmUso(this.porta()).then((v) => this.noAr.set(v));
      ver();
      const id = setInterval(ver, 2500);
      limpar(() => clearInterval(id));
    });
  }

  // ---------- tela ----------

  async abrir(): Promise<void> {
    if (!this.ehSpring()) return void this.mensagens.alerta('endpoints: o projeto aberto não é Spring Boot');
    this.layout.tela.set('endpoints');
    void this.spring.atualizar();
    if (!this.entender.analise() || this.entender.analisando()) await this.entender.analisar();
    await this.testes.lerRelatorios?.();
    if (!this.atual()) this.selecionado.set(this.todos()[0]?.id ?? null);
  }

  alternar(): void {
    if (this.layout.tela() === 'endpoints') this.fechar();
    else void this.abrir();
  }

  fechar(): void {
    this.layout.tela.set('editor');
    queueMicrotask(() => this.editor.focar());
  }

  alternarGrupo(id: string): void {
    const n = new Set(this.fechados());
    if (n.has(id)) n.delete(id);
    else n.add(id);
    this.fechados.set(n);
  }

  proximoVerbo(): void {
    const ordem: (Verbo | 'todos')[] = ['todos', ...VERBOS];
    this.filtroVerbo.set(ordem[(ordem.indexOf(this.filtroVerbo()) + 1) % ordem.length]);
  }

  abrirNoCodigo(e: EndpointInfo | null = this.atual()): void {
    if (!e) return;
    this.fechar();
    void this.editor.abrir(e.controller.caminho, e.metodo.linha);
  }

  // ---------- endereços ----------

  urlRelativa(e: EndpointInfo): string {
    return `${this.contexto()}${e.rota.startsWith('/') ? e.rota : `/${e.rota}`}`;
  }

  base(): string {
    return `http://localhost:${this.porta()}`;
  }

  abrirSwagger(): void {
    this.abrirNoNavegador(`${this.base()}${this.contexto()}/swagger-ui/index.html`, 'Swagger');
  }

  abrirActuator(): void {
    this.abrirNoNavegador(`${this.base()}${this.contexto()}/actuator`, 'Actuator');
  }

  private abrirNoNavegador(url: string, nome: string): void {
    if (!this.noAr()) return void this.mensagens.alerta(`${nome}: a aplicação não está no ar na porta ${this.porta()} (inicie pelo RUN)`);
    void ponte.servidor.abrirUrl(url).catch((e) => this.mensagens.erro(String(e)));
  }

  // ---------- testes que passam pelo endpoint ----------

  testesDe(e: EndpointInfo): TesteInfo[] {
    const modelo = e.rota.replace(/\/+$/, '').split('/').map((t) => (/^\{.*\}$/.test(t) ? '[^/]+' : t.replace(/[.*+?^$()|[\]\\]/g, '\\$&'))).join('/');
    const casa = new RegExp(`(^|/)${modelo.replace(/^\//, '')}/?$`);
    return this.testes.testes().filter((t) => {
      if (t.linguagem !== 'java') return false;
      const porCaminho = (t.caminhos ?? []).some((c) => {
        const [v, ...resto] = c.includes(' ') ? c.split(' ') : ['', c];
        if (v && v !== e.verbo) return false;
        const limpo = resto.join(' ').split('?')[0].replace(/\/+$/, '');
        return casa.test(limpo.replace(/^\//, '').replace(/^/, '/'));
      });
      const porMetodo = t.componentes.includes(e.controller.id) && t.chamadas.includes(e.metodo.nome);
      return porCaminho || porMetodo;
    });
  }

  estadoDoTeste(t: TesteInfo): EstadoDeTeste {
    return this.testes.estadoDe(t);
  }

  // ---------- chamar ----------

  /** O pedido de exemplo: caminho com valores, parâmetros obrigatórios, token do .env e corpo. */
  montarPedido(e: EndpointInfo): string {
    let rota = this.urlRelativa(e);
    const query: string[] = [];
    for (const p of e.http.params ?? []) {
      if (p.origem === 'path') {
        const v = exemploDe(p.tipo);
        rota = rota.replace(new RegExp(`\\{${p.nome}(:[^}]*)?\\}`), String(v === 0 ? 1 : v || 'exemplo'));
      } else if (p.origem === 'query' && p.obrigatorio) {
        query.push(`${p.nome}=${p.padrao ?? (exemploDe(p.tipo) === 0 ? 1 : '')}`);
      }
    }
    rota = rota.replace(/\{[^}]*\}/g, '1');
    const linhas = [`${e.verbo} ${this.base()}${rota}${query.length ? `?${query.join('&')}` : ''}`];
    const token = this.env.nomes().find((n) => NOME_DE_TOKEN.test(n));
    if (e.http.acesso && token) linhas.push(`Authorization: Bearer {{${token}}}`);
    for (const p of e.http.params ?? []) if (p.origem === 'header' && p.obrigatorio) linhas.push(`${p.nome}: `);
    const corpo = e.http.params?.some((p) => p.origem === 'body') ? this.corpoDeExemplo(e) : null;
    if (corpo) linhas.push('Content-Type: application/json', '', corpo);
    return linhas.join('\n');
  }

  private corpoDeExemplo(e: EndpointInfo): string {
    if (!e.http.corpo?.length) return '{}';
    const o: Record<string, unknown> = {};
    for (const c of e.http.corpo) o[c.nome] = exemploDe(c.tipo);
    return JSON.stringify(o, null, 2);
  }

  /** O pedido já com os `{{NOME}}` trocados pelos valores do .env. */
  private async preencher(texto: string): Promise<string> {
    if (!/\{\{\w+\}\}/.test(texto)) return texto;
    const raiz = this.projeto.raiz();
    const arquivo = this.env.emUso()?.nome;
    const vars = raiz && arquivo ? await ponte.env.ler(raiz, arquivo).catch(() => []) : [];
    const mapa = new Map(vars.map((v) => [v.nome, v.valor]));
    const faltam: string[] = [];
    const feito = texto.replace(/\{\{(\w+)\}\}/g, (_t, n: string) => {
      if (!mapa.has(n)) faltam.push(n);
      return mapa.get(n) ?? '';
    });
    if (faltam.length) throw new Error(`faltam no .env: ${faltam.join(', ')}`);
    return feito;
  }

  private interpretar(texto: string): { metodo: string; url: string; cabecalhos: [string, string][]; corpo: string | null } {
    const linhas = texto.split(/\r?\n/);
    const primeira = /^\s*([A-Za-z]+)\s+(\S+)/.exec(linhas[0] ?? '');
    if (!primeira) throw new Error('a primeira linha do pedido deve ser "VERBO http://localhost:porta/caminho"');
    const cabecalhos: [string, string][] = [];
    let i = 1;
    for (; i < linhas.length && linhas[i].trim() !== ''; i++) {
      const m = /^([^:\s]+)\s*:\s*(.*)$/.exec(linhas[i]);
      if (m) cabecalhos.push([m[1], m[2].trim()]);
    }
    const corpo = linhas.slice(i + 1).join('\n').trim();
    return { metodo: primeira[1].toUpperCase(), url: primeira[2], cabecalhos, corpo: corpo || null };
  }

  async chamar(): Promise<void> {
    if (this.chamando()) return;
    this.chamando.set(true);
    this.erroDaChamada.set(null);
    try {
      const p = this.interpretar(await this.preencher(this.pedido()));
      const tipo = p.cabecalhos.find(([n]) => n.toLowerCase() === 'content-type')?.[1] ?? null;
      const resto = p.cabecalhos.filter(([n]) => n.toLowerCase() !== 'content-type');
      const r = await ponte.servidor.http(p.metodo, p.url, p.corpo, tipo ?? (p.corpo ? 'application/json' : null), resto);
      this.resposta.set(r);
    } catch (e) {
      this.resposta.set(null);
      this.erroDaChamada.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.chamando.set(false);
    }
  }

  /** `curl` do pedido (o token continua como variável de ambiente, não vai para a área de transferência). */
  curl(): string {
    const p = this.interpretar(this.pedido());
    const aspas = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
    const partes = [`curl -X ${p.metodo} ${aspas(p.url)}`];
    for (const [n, v] of p.cabecalhos) partes.push(`-H ${aspas(`${n}: ${v.replace(/\{\{(\w+)\}\}/g, '$$$1')}`)}`);
    if (p.corpo) partes.push(`-d ${aspas(p.corpo)}`);
    return partes.join(' \\\n  ');
  }

  async copiarCurl(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.curl());
      this.mensagens.mostrar('curl copiado');
    } catch (e) {
      this.mensagens.erro(e instanceof Error ? e.message : 'não consegui copiar');
    }
  }

  /** A resposta bonita quando for JSON. */
  corpoDaResposta(r: RespostaDaChamada): string {
    if (r.tipo?.includes('json')) {
      try {
        return JSON.stringify(JSON.parse(r.corpo), null, 2);
      } catch {
        /* cortada: mostra como veio */
      }
    }
    return r.corpo;
  }

  /** Resumo para a IA (ferramenta `endpoints_listar`). */
  resumo(): string {
    const t = this.todos();
    if (!t.length) return 'nenhum endpoint Spring achado (a análise lê @RestController/@Controller)';
    return t
      .map((e) => `${e.verbo} ${this.urlRelativa(e)} → ${e.controller.nome}.${e.metodo.nome} (${e.controller.relativo}:${e.metodo.linha})${e.http.acesso ? ` 🔒 ${e.http.acesso}` : ''} testes:${this.testesDe(e).length}`)
      .join('\n');
  }
}
