import { computed, inject, Injectable, isDevMode, signal } from '@angular/core';
import { Jdk, MetadadosSpring, PedidoDeProjeto, ponte } from '../nucleo/ponte';
import { ProjetoService } from '../nucleo/projeto.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { ExecucaoService } from '../execucao/execucao.service';

export type Modelo = PedidoDeProjeto['modelo'];

export interface InfoDoModelo {
  id: Modelo;
  titulo: string;
  descricao: string;
  letra: string;
  /** Classe do ícone (cor do tema). */
  cor: string;
}

export const MODELOS: InfoDoModelo[] = [
  { id: 'spring', titulo: 'Spring Boot', descricao: 'API ou web com os iniciadores do Spring (start.spring.io)', letra: 'S', cor: 'git-mais' },
  { id: 'maven', titulo: 'Java com Maven', descricao: 'pom.xml, Main e JUnit', letra: 'M', cor: 'destaque-texto' },
  { id: 'war', titulo: 'Java web (WAR)', descricao: 'servlet + webapp, pronto para o WildFly/Tomcat do Seedy', letra: 'W', cor: 'aviso-texto' },
  { id: 'simples', titulo: 'Java simples', descricao: 'src/ e uma classe Main, sem ferramenta de build', letra: 'J', cor: '' },
  { id: 'angular', titulo: 'Angular', descricao: 'ng new, com roteamento e estilos em CSS', letra: 'A', cor: 'rosa-texto' },
  { id: 'react', titulo: 'React', descricao: 'Vite + React + TypeScript, com as dependências instaladas', letra: 'R', cor: 'destaque-texto' },
];

/** Grupos de iniciadores do Spring: os mais usados primeiro, com nome em português. */
const GRUPOS_SPRING: [string, string][] = [
  ['Web', 'WEB'],
  ['SQL', 'DADOS'],
  ['Developer Tools', 'FERRAMENTAS'],
  ['Security', 'SEGURANÇA'],
  ['Testing', 'TESTES'],
  ['Template Engines', 'TEMPLATES'],
  ['I/O', 'I/O'],
  ['Messaging', 'MENSAGERIA'],
  ['NoSQL', 'NOSQL'],
  ['Ops', 'OPERAÇÃO'],
  ['Observability', 'OBSERVABILIDADE'],
  ['AI', 'IA'],
];

const CHAVE = 'seedy.novoProjeto';

/** Janela de novo projeto (mockup 12, ␣ N). */
@Injectable({ providedIn: 'root' })
export class NovoProjetoService {
  private readonly projeto = inject(ProjetoService);
  private readonly mensagens = inject(MensagensService);
  private readonly execucao = inject(ExecucaoService);

  readonly aberta = signal(false);
  readonly modelo = signal<Modelo>('spring');
  readonly nome = signal('');
  readonly pastaPai = signal('');
  readonly grupo = signal('br.com.exemplo');
  /** Pacote digitado (vazio = derivado do grupo e do nome). */
  readonly pacoteDigitado = signal('');
  readonly java = signal(21);
  readonly build = signal<'maven' | 'gradle'>('maven');
  readonly empacotamento = signal<'jar' | 'war'>('jar');
  readonly springBoot = signal<string | null>(null);
  readonly dependencias = signal(new Set<string>());
  readonly filtro = signal('');
  readonly git = signal(true);

  readonly jdks = signal<Jdk[]>([]);
  readonly spring = signal<MetadadosSpring | null>(null);
  readonly erroSpring = signal<string | null>(null);
  readonly criando = signal(false);
  readonly progresso = signal<string[]>([]);

  readonly pasta = computed(() => (this.pastaPai() && this.nome() ? juntar(this.pastaPai(), this.nome()) : ''));
  readonly pacote = computed(() => this.pacoteDigitado() || `${this.grupo()}.${pacoteDoNome(this.nome() || 'app')}`);
  readonly classePrincipal = computed(() => `${nomeDeClasse(this.nome() || 'app')}Application`);

  /** Versões do Java oferecidas: as instaladas (no Spring, só as que ele aceita). */
  readonly versoesJava = computed(() => {
    const instaladas = [...new Set(this.jdks().map((j) => j.maior))].filter((v) => v >= 8).sort((a, b) => b - a);
    if (this.modelo() !== 'spring' || !this.spring()) return instaladas.length ? instaladas : [21, 17];
    const aceitas = this.spring()!.javaVersion.values.map((v) => Number(v.id)).filter((v) => !Number.isNaN(v));
    return aceitas.sort((a, b) => b - a);
  });
  readonly instaladas = computed(() => new Set(this.jdks().map((j) => j.maior)));
  readonly versoesSpring = computed(() => (this.spring()?.bootVersion.values ?? []).filter((v) => !/SNAPSHOT|M\d|RC\d/i.test(v.id)).slice(0, 4));

  /** Grupos de iniciadores filtrados por `/`. */
  readonly grupos = computed(() => {
    const m = this.spring();
    if (!m) return [];
    const f = semAcento(this.filtro().trim().toLowerCase());
    const ordem = new Map(GRUPOS_SPRING.map(([n], i) => [n, i]));
    return m.dependencies.values
      .slice()
      .sort((a, b) => (ordem.get(a.name) ?? 99) - (ordem.get(b.name) ?? 99))
      // Sem filtro, só os grupos comuns; filtrando, procura em todos (Spring Cloud, Azure...).
      .filter((g) => f || ordem.has(g.name))
      .map((g) => ({
        nome: GRUPOS_SPRING.find(([n]) => n === g.name)?.[1] ?? g.name.toUpperCase(),
        itens: g.values.filter((d) => !f || semAcento(`${d.name} ${d.id} ${d.description ?? ''}`.toLowerCase()).includes(f)),
      }))
      .filter((g) => g.itens.length);
  });

  constructor() {
    try {
      const salvo = JSON.parse(localStorage.getItem(CHAVE) ?? '{}');
      if (salvo.grupo) this.grupo.set(salvo.grupo);
      if (salvo.pastaPai) this.pastaPai.set(salvo.pastaPai);
    } catch {
      /* sem armazenamento */
    }
    if (isDevMode()) Object.assign(window, { seedyNovoProjeto: this });
  }

  async abrir(): Promise<void> {
    if (!this.pastaPai()) {
      const raiz = this.projeto.raiz();
      if (raiz) this.pastaPai.set(raiz.replace(/[\\/][^\\/]+[\\/]?$/, ''));
    }
    this.nome.set('');
    this.pacoteDigitado.set('');
    this.progresso.set([]);
    this.filtro.set('');
    this.dependencias.set(new Set());
    this.aberta.set(true);
    void ponte.java.jdks().then((l) => {
      this.jdks.set(l);
      this.ajustarJava();
    });
    if (this.modelo() === 'spring') void this.carregarSpring();
  }

  fechar(): void {
    if (!this.criando()) this.aberta.set(false);
  }

  escolherModelo(m: Modelo): void {
    this.modelo.set(m);
    if (m === 'spring') void this.carregarSpring();
    this.ajustarJava();
  }

  async carregarSpring(): Promise<void> {
    if (this.spring()) return;
    this.erroSpring.set(null);
    try {
      const m = await ponte.novoProjeto.springMetadados();
      this.spring.set(m);
      this.springBoot.set(this.versoesSpring().some((v) => v.id === m.bootVersion.default) ? m.bootVersion.default : (this.versoesSpring()[0]?.id ?? null));
      this.ajustarJava();
    } catch (e) {
      this.erroSpring.set(String(e));
    }
  }

  /** Java escolhido sempre entre os oferecidos: o mais novo instalado, de preferência LTS. */
  private ajustarJava(): void {
    const ofertas = this.versoesJava();
    if (ofertas.includes(this.java())) return;
    const instaladas = ofertas.filter((v) => this.instaladas().has(v));
    const lts = instaladas.find((v) => [25, 21, 17, 11].includes(v));
    this.java.set(lts ?? instaladas[0] ?? ofertas[0] ?? 21);
  }

  alternarDependencia(id: string): void {
    this.dependencias.update((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async escolherPasta(): Promise<void> {
    const p = await ponte.escolherPasta('Onde criar o projeto');
    if (p) this.pastaPai.set(p);
  }

  /** O que impede de criar (null = pode). */
  readonly problema = computed(() => {
    const nome = this.nome();
    if (!nome) return 'dê um nome ao projeto';
    if (!/^[A-Za-z][\w.-]*$/.test(nome)) return 'o nome começa com letra e tem só letras, números, - _ .';
    if (!this.pastaPai()) return 'escolha onde criar (ctrl+o)';
    if (this.modelo() !== 'angular' && this.modelo() !== 'react' && !/^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)*$/.test(this.pacote())) return 'pacote inválido';
    if (this.modelo() === 'spring' && !this.spring()) return this.erroSpring() ? 'sem o start.spring.io (precisa de internet)' : 'carregando o start.spring.io…';
    return null;
  });

  async criar(): Promise<void> {
    const problema = this.problema();
    if (problema) return void this.mensagens.mostrar(problema);
    if (this.criando()) return;
    this.criando.set(true);
    this.progresso.set([]);
    const pedido: PedidoDeProjeto = {
      modelo: this.modelo(),
      nome: this.nome(),
      pasta: this.pasta(),
      grupo: this.grupo(),
      pacote: this.pacote(),
      java: this.java(),
      build: this.build(),
      empacotamento: this.empacotamento(),
      springBoot: this.springBoot(),
      dependencias: [...this.dependencias()],
      git: this.git(),
    };
    try {
      const r = await ponte.novoProjeto.criar(pedido, (t) => this.progresso.update((l) => [...l.slice(-200), t]));
      try {
        localStorage.setItem(CHAVE, JSON.stringify({ grupo: this.grupo(), pastaPai: this.pastaPai() }));
      } catch {
        /* sem armazenamento */
      }
      if (r.principal) this.execucao.preferir(r.principal);
      this.criando.set(false);
      this.aberta.set(false);
      await this.projeto.abrir(r.pasta);
      this.mensagens.mostrar(r.aviso ? `projeto ${pedido.nome} criado · ${r.aviso}` : `projeto ${pedido.nome} criado`);
    } catch (e) {
      this.criando.set(false);
      this.progresso.update((l) => [...l, `✕ ${e}`]);
      this.mensagens.erro(String(e));
    }
  }
}

function juntar(base: string, nome: string): string {
  // Mantém o separador que a pasta já usa (no Windows, \ por padrão).
  const sep = base.includes('\\') || (/^[a-zA-Z]:/.test(base) && !base.includes('/')) ? '\\' : '/';
  return `${base.replace(/[\\/]+$/, '')}${sep}${nome}`;
}

/** "feira-api" → "feiraapi" (igual ao núcleo). */
export function pacoteDoNome(nome: string): string {
  const s = nome.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  return /^\d/.test(s) ? `app${s}` : s;
}

/** "feira-api" → "FeiraApi" (igual ao start.spring.io). */
export function nomeDeClasse(nome: string): string {
  const s = nome
    .split(/[^A-Za-z0-9]/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join('');
  return !s || /^\d/.test(s) ? `App${s}` : s;
}

function semAcento(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
