import { computed, effect, inject, Injectable, isDevMode, signal, untracked } from '@angular/core';
import { ProjetoService } from '../nucleo/projeto.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { EscolhaService } from '../escolha/escolha.service';
import { JdtlsService } from '../java/jdtls.service';
import { LayoutService } from '../layout/layout.service';
import { ServidorService } from '../servidor/servidor.service';
import { DepuradorService } from '../servidor/depurador.service';
import { lerLinha, LinhaDeLog } from '../servidor/log';

/** O que o RUN/DEBUG roda: um servidor de aplicação do projeto ou uma classe com `main`. */
export type ConfigDeExecucao =
  | { id: string; tipo: 'servidor'; nome: string; perfilId: string }
  | { id: string; tipo: 'main'; nome: string; mainClass: string; projectName: string; caminho: string | null };

/** Um processo `main` rodando (ou que já terminou): a saída fica no painel de execução. */
export interface ExecucaoDeMain {
  config: Extract<ConfigDeExecucao, { tipo: 'main' }>;
  fase: 'subindo' | 'rodando' | 'parado';
  debug: boolean;
  inicio: number;
  linhas: LinhaDeLog[];
  erros: number;
  avisos: number;
  codigo: number | null;
}

const LIMITE_DE_LINHAS = 5000;
const CHAVE = 'seedy.execucao';

/**
 * Configurações de execução (como no IntelliJ): RUN (shift+F10) e DEBUG (shift+F9) rodam a
 * escolhida (␣ r troca). Classe `main`: o java-debug sobe a JVM com o classpath do jdtls;
 * servidor: sobe o WildFly/Tomcat do perfil. ctrl+F2 para.
 */
@Injectable({ providedIn: 'root' })
export class ExecucaoService {
  private readonly projeto = inject(ProjetoService);
  private readonly mensagens = inject(MensagensService);
  private readonly escolha = inject(EscolhaService);
  private readonly jdtls = inject(JdtlsService);
  private readonly layout = inject(LayoutService);
  private readonly servidor = inject(ServidorService);
  private readonly depurador = inject(DepuradorService);

  /** Classes com `main` do projeto (vêm do jdtls). */
  readonly mains = signal<Extract<ConfigDeExecucao, { tipo: 'main' }>[]>([]);
  readonly procurando = signal(false);
  private readonly escolhida = signal<string | null>(null);
  /** Classe `main` preferida para um projeto recém-criado (vira a escolhida quando o jdtls achar). */
  private preferida: string | null = null;
  readonly main = signal<ExecucaoDeMain | null>(null);

  readonly configs = computed<ConfigDeExecucao[]>(() => [
    ...this.servidor.doProjeto().map((p) => ({ id: `servidor:${p.id}`, tipo: 'servidor' as const, nome: p.nome, perfilId: p.id })),
    ...this.mains(),
  ]);
  readonly atual = computed(() => {
    const lista = this.configs();
    return lista.find((c) => c.id === this.escolhida()) ?? lista[0] ?? null;
  });
  /** O que está rodando agora para a configuração escolhida. */
  readonly rodando = computed(() => {
    const c = this.atual();
    if (!c) return false;
    if (c.tipo === 'servidor') return (this.servidor.execucoes().get(c.perfilId)?.fase ?? 'parado') !== 'parado';
    const m = this.main();
    return !!m && m.config.id === c.id && m.fase !== 'parado';
  });
  readonly depurando = computed(() => {
    const c = this.atual();
    const s = this.depurador.sessao();
    if (!c || !s || s.semDebug) return false;
    return c.tipo === 'servidor' ? s.perfilId === c.perfilId : s.tipo === 'main';
  });

  private contador = 0;
  private resto = { stdout: '', stderr: '' };

  constructor() {
    this.depurador.aoSaida = (texto, categoria) => this.registrarSaida(texto, categoria);
    this.depurador.aoTerminar = (codigo) => this.aoTerminar(codigo);
    // Projeto novo (ou trocado): lembra a escolha dele e procura as mains quando o jdtls ficar pronto.
    effect(() => {
      const raiz = this.projeto.raiz();
      untracked(() => {
        this.mains.set([]);
        this.escolhida.set(raiz ? lerEscolha(raiz) : null);
      });
    });
    effect(() => {
      if (this.jdtls.pronto() && this.projeto.raiz()) untracked(() => void this.procurarMains());
    });
    if (isDevMode()) Object.assign(window, { seedyExecucao: this });
  }

  /** Um projeto recém-criado já abre com a `main` dele escolhida. */
  preferir(mainClass: string): void {
    this.preferida = mainClass;
  }

  async procurarMains(): Promise<void> {
    const raiz = this.projeto.raiz();
    if (!raiz || !this.jdtls.pronto()) return;
    this.procurando.set(true);
    try {
      const r = await this.jdtls.executar<{ mainClass: string; projectName: string; filePath?: string }[]>('vscode.java.resolveMainClass');
      const doProjeto = (r ?? []).filter((m) => !m.filePath || dentro(m.filePath, raiz));
      this.mains.set(
        doProjeto
          .map((m) => ({
            id: `main:${m.mainClass}`,
            tipo: 'main' as const,
            nome: m.mainClass.split('.').pop() ?? m.mainClass,
            mainClass: m.mainClass,
            projectName: m.projectName,
            caminho: m.filePath ?? null,
          }))
          .sort((a, b) => a.nome.localeCompare(b.nome)),
      );
      if (this.preferida && this.mains().some((m) => m.mainClass === this.preferida)) {
        this.escolher(`main:${this.preferida}`);
        this.preferida = null;
      }
    } catch {
      /* jdtls ainda importando: tenta de novo quando o usuário abrir a lista */
    } finally {
      this.procurando.set(false);
    }
  }

  escolher(id: string): void {
    this.escolhida.set(id);
    const raiz = this.projeto.raiz();
    if (raiz) gravarEscolha(raiz, id);
  }

  /** ␣ r: escolhe o que o RUN/DEBUG roda. */
  async escolherConfig(): Promise<void> {
    await this.procurarMains();
    const lista = this.configs();
    const atual = this.atual()?.id;
    const id = await this.escolha.escolherUm('RODAR / DEBUG', [
      ...lista.map((c) => ({
        rotulo: `${c.id === atual ? '● ' : ''}${c.nome}`,
        detalhe: c.tipo === 'servidor' ? 'servidor de aplicação' : c.mainClass,
        valor: c.id,
      })),
      { rotulo: '+ novo servidor', detalhe: 'WildFly/JBoss ou Tomcat', valor: '+servidor' },
    ]);
    if (id === '+servidor') await this.servidor.novo();
    else if (id) this.escolher(id);
  }

  /** RUN (shift+F10) e DEBUG (shift+F9). */
  async rodar(debug: boolean): Promise<void> {
    if (!this.projeto.raiz()) return void this.mensagens.mostrar('abra um projeto primeiro');
    if (!this.configs().length) await this.procurarMains();
    const c = this.atual();
    if (!c) {
      this.mensagens.mostrar(this.jdtls.pronto() ? 'nenhuma classe com main nem servidor no projeto (␣ r)' : 'o jdtls ainda está carregando o projeto');
      return;
    }
    if (c.tipo === 'servidor') {
      const e = this.servidor.execucoes().get(c.perfilId);
      if (e && e.fase !== 'parado') {
        // Já rodando: DEBUG anexa o depurador (se subiu com a porta de debug); RUN mostra o painel.
        if (debug && e.info?.portaDebug && !this.depurando()) await this.depurador.anexar(c.perfilId, e.info.portaDebug);
        else if (debug && !e.info?.portaDebug) this.mensagens.mostrar(`${c.nome} subiu sem debug: pare (ctrl+F2) e use o DEBUG`);
        else this.layout.mostrar('servidor');
        if (debug) this.layout.tela.set('debug');
        return;
      }
      await this.servidor.iniciar(debug, c.perfilId);
      if (debug) this.layout.tela.set('debug');
      return;
    }
    if (this.rodando()) await this.parar();
    this.contador = 0;
    this.resto = { stdout: '', stderr: '' };
    this.main.set({ config: c, fase: 'subindo', debug, inicio: Date.now(), linhas: [], erros: 0, avisos: 0, codigo: null });
    this.registrarSeedy(`${debug ? 'depurando' : 'rodando'} ${c.mainClass}…`);
    this.layout.mostrar('servidor');
    if (debug) this.layout.tela.set('debug');
    const ok = await this.depurador.lancar({ nome: c.nome, mainClass: c.mainClass, projectName: c.projectName }, debug);
    if (ok) this.mudar((m) => ({ ...m, fase: 'rodando' }));
    else {
      this.mudar((m) => ({ ...m, fase: 'parado' }));
      this.registrarSeedy('não rodou', 'erro');
    }
  }

  /** ctrl+F2: para o que estiver rodando da configuração escolhida. */
  async parar(): Promise<void> {
    const c = this.atual();
    if (c?.tipo === 'servidor') return this.servidor.parar(c.perfilId);
    if (this.main()?.fase !== 'parado' && this.depurador.sessao()?.tipo === 'main') await this.depurador.desanexar(true);
  }

  limparSaida(): void {
    this.mudar((m) => ({ ...m, linhas: [], erros: 0, avisos: 0 }));
  }

  // ---------- saída do main ----------

  private registrarSaida(texto: string, categoria: string): void {
    const canal = categoria === 'stderr' ? 'stderr' : 'stdout';
    const junto = this.resto[canal] + texto.replace(/\r\n/g, '\n');
    const partes = junto.split('\n');
    this.resto[canal] = partes.pop() ?? '';
    if (partes.length) this.registrar(partes, canal === 'stderr');
  }

  private registrar(textos: string[], erro: boolean): void {
    this.mudar((m) => {
      let anterior = m.linhas[m.linhas.length - 1] ?? null;
      let { erros, avisos } = m;
      const novas: LinhaDeLog[] = [];
      for (const t of textos) {
        const l = lerLinha(t, ++this.contador, anterior);
        if (erro && !l.nivel) l.nivel = 'erro';
        if (!l.pilha && l.nivel === 'erro') erros++;
        if (!l.pilha && l.nivel === 'aviso') avisos++;
        novas.push(l);
        anterior = l;
      }
      const linhas = [...m.linhas, ...novas].slice(-LIMITE_DE_LINHAS);
      return { ...m, linhas, erros, avisos };
    });
  }

  private registrarSeedy(texto: string, nivel: 'info' | 'erro' = 'info'): void {
    this.mudar((m) => ({
      ...m,
      linhas: [...m.linhas, { n: ++this.contador, texto, nivel, hora: new Date().toTimeString().slice(0, 8), mensagem: texto, frame: null, pilha: false, seedy: true }],
    }));
  }

  private aoTerminar(codigo: number | null): void {
    const m = this.main();
    if (!m || m.fase === 'parado') return;
    for (const canal of ['stdout', 'stderr'] as const) {
      if (this.resto[canal]) this.registrar([this.resto[canal]], canal === 'stderr');
      this.resto[canal] = '';
    }
    const s = ((Date.now() - m.inicio) / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    this.mudar((x) => ({ ...x, fase: 'parado', codigo }));
    this.registrarSeedy(`processo terminou${codigo !== null ? ` com código ${codigo}` : ''} (${s} s)`, codigo ? 'erro' : 'info');
  }

  private mudar(fn: (m: ExecucaoDeMain) => ExecucaoDeMain): void {
    const m = this.main();
    if (m) this.main.set(fn(m));
  }
}

function normal(c: string): string {
  return c.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function dentro(c: string, raiz: string): boolean {
  return normal(c).startsWith(normal(raiz) + '/');
}

function lerEscolha(raiz: string): string | null {
  try {
    return (JSON.parse(localStorage.getItem(CHAVE) ?? '{}') as Record<string, string>)[normal(raiz)] ?? null;
  } catch {
    return null;
  }
}

function gravarEscolha(raiz: string, id: string): void {
  try {
    const m = JSON.parse(localStorage.getItem(CHAVE) ?? '{}') as Record<string, string>;
    m[normal(raiz)] = id;
    localStorage.setItem(CHAVE, JSON.stringify(m));
  } catch {
    /* sem armazenamento */
  }
}
