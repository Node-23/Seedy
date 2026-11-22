import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { ArquivoEnv, ponte } from '../nucleo/ponte';
import { ProjetoService } from '../nucleo/projeto.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { EscolhaService } from '../escolha/escolha.service';

/** O que o projeto escolheu: usar ou não o .env e qual arquivo (guardado por projeto, neste computador). */
export interface EscolhaDeEnv {
  usar: boolean;
  arquivo: string | null;
}

const SEM_ENV = '__sem_env__';
const PARECE_SENHA = /(PASS|SECRET|TOKEN|KEY|CREDENTIAL|PWD|PRIVATE)/i;

/**
 * Variáveis do `.env` do projeto. Por padrão o Seedy usa o `.env` que achar na raiz; com mais de um
 * (`.env`, `.env.local`, `.env.dev`...) pergunta qual usar na primeira execução e guarda a escolha.
 * O arquivo é lido de novo a cada execução. Quem roda (a classe `main`, o servidor, scripts, testes e os
 * comandos da IA) junta as variáveis por baixo das "variáveis de ambiente" da configuração de execução.
 */
@Injectable({ providedIn: 'root' })
export class EnvService {
  private readonly projeto = inject(ProjetoService);
  private readonly escolha = inject(EscolhaService);
  private readonly mensagens = inject(MensagensService);

  /** Os `.env*` da raiz (o primeiro é o `.env`; os modelos, como `.env.example`, vão por último). */
  readonly arquivos = signal<ArquivoEnv[]>([]);
  readonly escolhido = signal<EscolhaDeEnv>({ usar: true, arquivo: null });
  /** Os nomes das variáveis do arquivo em uso (sem valores): para a tela e para a IA. */
  readonly nomes = signal<string[]>([]);
  /** O arquivo que vale agora: o escolhido (se existe) ou o único possível. */
  readonly emUso = computed(() => this.arquivoEscolhido(this.arquivos(), this.escolhido()));

  constructor() {
    effect(() => {
      this.projeto.raiz();
      untracked(() => void this.carregar());
    });
    effect(() => {
      const m = this.projeto.mudancas();
      if (m && [...m.alterados, ...m.criados].some((c) => /[\\/]\.env[^\\/]*$|[^\\/]+\.env$/.test(c))) untracked(() => void this.carregar());
    });
  }

  private chave(raiz: string): string {
    return `seedy.env:${raiz}`;
  }

  async carregar(): Promise<void> {
    const raiz = this.projeto.raiz();
    if (!raiz) {
      this.arquivos.set([]);
      this.nomes.set([]);
      return;
    }
    this.arquivos.set(await ponte.env.arquivos(raiz).catch(() => []));
    try {
      const bruto = localStorage.getItem(this.chave(raiz));
      this.escolhido.set(bruto ? { usar: true, arquivo: null, ...(JSON.parse(bruto) as Partial<EscolhaDeEnv>) } : { usar: true, arquivo: null });
    } catch {
      this.escolhido.set({ usar: true, arquivo: null });
    }
    const f = this.emUso();
    this.nomes.set(f ? (await ponte.env.ler(raiz, f.nome).catch(() => [])).map((v) => v.nome) : []);
  }

  private arquivoEscolhido(lista: ArquivoEnv[], e: EscolhaDeEnv): ArquivoEnv | null {
    if (!e.usar) return null;
    const reais = lista.filter((a) => !a.modelo);
    if (e.arquivo) return lista.find((a) => a.nome === e.arquivo) ?? null;
    return reais.length === 1 ? reais[0] : null;
  }

  mudar(e: EscolhaDeEnv): void {
    const raiz = this.projeto.raiz();
    this.escolhido.set(e);
    if (raiz) {
      try {
        localStorage.setItem(this.chave(raiz), JSON.stringify(e));
      } catch {
        /* sem armazenamento: vale só nesta sessão */
      }
    }
    void this.carregar();
  }

  /** Esconde o valor de uma variável com cara de senha. */
  mascarar(nome: string, valor: string): string {
    return PARECE_SENHA.test(nome) ? '••••••••' : valor;
  }

  /** Pergunta qual `.env` usar (há mais de um e nada escolhido). Devolve false se o usuário cancelou. */
  private async perguntar(): Promise<boolean> {
    const reais = this.arquivos();
    const r = await this.escolha.escolherUm<string>(
      'QUAL .ENV USAR?',
      [
        ...reais.map((a) => ({ rotulo: a.nome + (a.modelo ? ' (modelo)' : ''), detalhe: `${a.variaveis} variáveis`, valor: a.nome })),
        { rotulo: 'Rodar sem .env', detalhe: 'desliga a opção neste projeto', valor: SEM_ENV },
      ],
      'achei mais de um na raiz do projeto; a escolha fica guardada (␣ r → ⚙ muda)',
    );
    if (!r) return false;
    this.mudar(r === SEM_ENV ? { usar: false, arquivo: null } : { usar: true, arquivo: r });
    return true;
  }

  /**
   * As variáveis para quem vai rodar. `{}` se não há .env (ou foi desligado); `null` se o usuário
   * cancelou a escolha (quem chamou não deve rodar). Lê o arquivo de novo a cada chamada.
   */
  async variaveis(): Promise<Record<string, string> | null> {
    const raiz = this.projeto.raiz();
    if (!raiz) return {};
    await this.carregar();
    const e = this.escolhido();
    if (!e.usar) return {};
    const reais = this.arquivos().filter((a) => !a.modelo);
    if (!e.arquivo && reais.length > 1) {
      if (!(await this.perguntar())) return null;
    }
    const f = this.emUso();
    if (!f) return {};
    try {
      const lista = await ponte.env.ler(raiz, f.nome);
      return Object.fromEntries(lista.map((v) => [v.nome, v.valor]));
    } catch (erro) {
      this.mensagens.erro(`não consegui ler ${f.nome}: ${erro}`);
      return {};
    }
  }

  /** O `.env` em uso está no .gitignore? `null` se não dá para saber (não é um repositório). */
  async ignorado(arquivo: string): Promise<boolean | null> {
    const raiz = this.projeto.raiz();
    if (!raiz) return null;
    const r = await ponte.git(raiz, ['check-ignore', '-q', '--', arquivo]).catch(() => null);
    if (!r) return null;
    return r.codigo === 0 ? true : r.codigo === 1 ? false : null;
  }

  /** Põe o arquivo no .gitignore do projeto. */
  async ignorar(arquivo: string): Promise<void> {
    const raiz = this.projeto.raiz();
    if (!raiz) return;
    const sep = raiz.includes('\\') ? '\\' : '/';
    const caminho = `${raiz.replace(/[\\/]+$/, '')}${sep}.gitignore`;
    const atual = await ponte.lerArquivo(caminho).catch(() => '');
    if (atual.split(/\r?\n/).some((l) => l.trim().replace(/^\//, '') === arquivo)) return;
    await ponte.gravarArquivo(caminho, `${atual}${atual && !atual.endsWith('\n') ? '\n' : ''}${arquivo}\n`);
    this.mensagens.mostrar(`${arquivo} entrou no .gitignore`);
  }
}
