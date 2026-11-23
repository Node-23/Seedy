import { EnvService } from '../execucao/env.service';
import { computed, effect, inject, Injectable, isDevMode, signal, untracked } from '@angular/core';
import { ponte } from '../nucleo/ponte';
import { ProjetoService } from '../nucleo/projeto.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { LayoutService } from '../layout/layout.service';
import { LinhaDeLog } from '../servidor/log';

export interface ScriptDoPacote {
  nome: string;
  comando: string;
}

/** Um script rodando (ou que já rodou) com a saída dele. */
export interface ExecucaoDeScript {
  nome: string;
  fase: 'rodando' | 'parado';
  inicio: number;
  fim: number | null;
  codigo: number | null;
  linhas: LinhaDeLog[];
  erros: number;
  avisos: number;
  /** Endereço que o servidor de desenvolvimento anunciou (ng serve, vite...). */
  url: string | null;
}

const LIMITE_DE_LINHAS = 5000;
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;
const URL_LOCAL = /(https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d+)?[^\s'"]*)/;
export const ID_INSTALAR = '__install__';

/**
 * Scripts do package.json (mockup 13, Alt+Shift+J): roda, para, mostra a saída e descobre o
 * endereço do servidor de desenvolvimento para abrir no navegador (e depurar).
 */
@Injectable({ providedIn: 'root' })
export class ScriptsService {
  private readonly projeto = inject(ProjetoService);
  private readonly mensagens = inject(MensagensService);
  private readonly env = inject(EnvService);
  private readonly layout = inject(LayoutService);

  readonly scripts = signal<ScriptDoPacote[]>([]);
  readonly execucoes = signal(new Map<string, ExecucaoDeScript>());
  readonly selecionado = signal<string | null>(null);
  readonly atual = computed(() => {
    const nome = this.selecionado() ?? this.scripts()[0]?.nome ?? null;
    return nome ? (this.execucoes().get(nome) ?? null) : null;
  });
  readonly rodando = computed(() => [...this.execucoes().values()].filter((e) => e.fase === 'rodando'));

  private contador = 0;
  /** Scripts parados pelo usuário: o código de saída (taskkill/SIGTERM) não conta como falha. */
  private readonly parados = new Set<string>();

  constructor() {
    effect(() => {
      const raiz = this.projeto.raiz();
      this.projeto.versao();
      untracked(() => void this.ler(raiz));
    });
    effect(() => {
      const m = this.projeto.mudancas();
      if (m?.alterados.some((c) => /(^|[\\/])package\.json$/.test(c))) untracked(() => void this.ler(this.projeto.raiz()));
    });
    if (isDevMode()) Object.assign(window, { seedyScripts: this });
  }

  private async ler(raiz: string | null): Promise<void> {
    if (!raiz) return void this.scripts.set([]);
    try {
      const pkg = JSON.parse(await ponte.lerArquivo(juntar(raiz, 'package.json')));
      const lista = Object.entries((pkg.scripts ?? {}) as Record<string, string>).map(([nome, comando]) => ({ nome, comando }));
      // "start" primeiro: é o que o RUN roda por padrão.
      this.scripts.set(lista.sort((a, b) => Number(b.nome === 'start') - Number(a.nome === 'start')));
    } catch {
      this.scripts.set([]);
    }
  }

  async rodar(nome: string, extras: { argumentos?: string[]; ambiente?: Record<string, string> } = {}): Promise<void> {
    const raiz = this.projeto.raiz();
    if (!raiz) return;
    if (this.execucoes().get(nome)?.fase === 'rodando') {
      this.mensagens.mostrar(`${nome} já está rodando`);
      return;
    }
    const env = await this.env.variaveis();
    if (env === null) return; // cancelou a escolha do .env
    const ambiente = { ...env, ...(extras.ambiente ?? {}) };
    this.selecionado.set(nome);
    this.layout.mostrar('scripts');
    const args = extras.argumentos?.length ? ['--', ...extras.argumentos] : [];
    const comando = nome === ID_INSTALAR ? ['npm', 'install'] : ['npm', 'run', nome, ...args];
    this.atualizar(nome, { nome, fase: 'rodando', inicio: Date.now(), fim: null, codigo: null, linhas: [], erros: 0, avisos: 0, url: null });
    this.registrar(nome, [comando.join(' ')], true);
    try {
      await ponte.tarefa.iniciar(
        nome,
        raiz,
        comando,
        (linhas) => this.registrar(nome, linhas),
        (codigo) => this.aoTerminar(nome, codigo),
        Object.keys(ambiente).length ? ambiente : null,
      );
    } catch (e) {
      this.registrar(nome, [String(e)], true, 'erro');
      this.mudar(nome, (x) => ({ ...x, fase: 'parado' }));
    }
  }

  async parar(nome = this.selecionado() ?? this.rodando()[0]?.nome): Promise<void> {
    if (!nome || this.execucoes().get(nome)?.fase !== 'rodando') return;
    this.parados.add(nome);
    await ponte.tarefa.parar(nome).catch((e) => this.mensagens.erro(String(e)));
  }

  instalar(): Promise<void> {
    return this.rodar(ID_INSTALAR);
  }

  async abrirNoNavegador(nome = this.selecionado()): Promise<void> {
    const url = nome ? this.execucoes().get(nome)?.url : null;
    if (!url) return void this.mensagens.alerta('o script ainda não anunciou um endereço');
    await ponte.servidor.abrirUrl(url).catch((e) => this.mensagens.erro(String(e)));
  }

  /** Espera o servidor de desenvolvimento anunciar o endereço (para o debug no navegador). */
  async esperarUrl(nome: string, limiteMs = 180_000): Promise<string | null> {
    const fim = Date.now() + limiteMs;
    while (Date.now() < fim) {
      const e = this.execucoes().get(nome);
      if (e?.url) return e.url;
      if (!e || e.fase === 'parado') return null;
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  }

  limpar(nome = this.selecionado()): void {
    if (nome) this.mudar(nome, (x) => ({ ...x, linhas: [], erros: 0, avisos: 0 }));
  }

  // ---------- saída ----------

  private registrar(nome: string, textos: string[], seedy = false, nivel: 'erro' | null = null): void {
    this.mudar(nome, (x) => {
      let { erros, avisos, url } = x;
      const novas: LinhaDeLog[] = [];
      for (const bruto of textos) {
        const texto = bruto.replace(ANSI, '');
        const n = seedy ? (nivel ?? 'info') : nivelDe(texto);
        if (!seedy && n === 'erro') erros++;
        if (!seedy && n === 'aviso') avisos++;
        url ??= URL_LOCAL.exec(texto)?.[1]?.replace(/0\.0\.0\.0/, 'localhost') ?? null;
        novas.push({ n: ++this.contador, texto, nivel: n, hora: null, mensagem: texto, frame: null, pilha: false, seedy });
      }
      return { ...x, erros, avisos, url, linhas: [...x.linhas, ...novas].slice(-LIMITE_DE_LINHAS) };
    });
  }

  private aoTerminar(nome: string, codigo: number | null): void {
    const e = this.execucoes().get(nome);
    if (!e) return;
    const s = ((Date.now() - e.inicio) / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    const pedido = this.parados.delete(nome);
    if (pedido) codigo = null;
    this.mudar(nome, (x) => ({ ...x, fase: 'parado', codigo, fim: Date.now() }));
    this.registrar(nome, [pedido ? `parado (${s} s)` : `terminou${codigo !== null ? ` com código ${codigo}` : ''} (${s} s)`], true, codigo ? 'erro' : null);
    if (nome === ID_INSTALAR && codigo === 0) this.mensagens.mostrar('npm install concluído');
  }

  private atualizar(nome: string, e: ExecucaoDeScript): void {
    this.execucoes.update((m) => new Map(m).set(nome, e));
  }

  private mudar(nome: string, fn: (e: ExecucaoDeScript) => ExecucaoDeScript): void {
    const e = this.execucoes().get(nome);
    if (e) this.atualizar(nome, fn(e));
  }
}

function nivelDe(t: string): LinhaDeLog['nivel'] {
  if (/(\bERROR\b|\[ERROR\]|✘|✖|^\s*Error:|\berror TS\d+|npm ERR!|ERR!)/.test(t)) return 'erro';
  if (/(\bWARNING\b|\[WARNING\]|▲|\bwarn(ing)?\b|npm WARN)/i.test(t)) return 'aviso';
  return null;
}

function juntar(base: string, rel: string): string {
  const sep = base.includes('\\') ? '\\' : '/';
  return `${base.replace(/[\\/]+$/, '')}${sep}${rel}`;
}
