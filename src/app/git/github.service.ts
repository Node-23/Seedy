import { inject, Injectable, signal } from '@angular/core';
import { noApp, ponte, RepositorioGithub, UsuarioGithub } from '../nucleo/ponte';
import { MensagensService } from '../nucleo/mensagens.service';
import { ProjetoService } from '../nucleo/projeto.service';
import { EscolhaService } from '../escolha/escolha.service';
import { haQuanto } from './tempo';

/**
 * Conta do GitHub, como no IntelliJ. O login é o do Git da máquina: no Windows
 * o Git Credential Manager abre o navegador; sem ele, dá para colar um token.
 * O token fica no núcleo (e no cofre de credenciais do sistema); aqui só o usuário.
 */
@Injectable({ providedIn: 'root' })
export class GithubService {
  private readonly mensagens = inject(MensagensService);
  private readonly escolha = inject(EscolhaService);
  private readonly projeto = inject(ProjetoService);

  readonly usuario = signal<UsuarioGithub | null>(null);
  readonly conectando = signal(false);

  /** Ao abrir o Seedy: usa o login que já existir, sem abrir nada. */
  async iniciar(): Promise<void> {
    if (!noApp()) return;
    try {
      this.usuario.set(await ponte.github.conta(false));
    } catch {
      /* sem conta: fica desconectado */
    }
  }

  /** Conectar: o gerenciador de credenciais abre o login do GitHub no navegador. */
  async conectar(): Promise<void> {
    if (!noApp()) {
      this.mensagens.mostrar('a conta do GitHub só conecta dentro do app');
      return;
    }
    const forma = await this.escolha.escolherUm(
      'CONECTAR AO GITHUB',
      [
        { rotulo: 'Entrar pelo navegador', detalhe: 'Git Credential Manager', valor: 'navegador' as const },
        { rotulo: 'Usar um token', detalhe: 'personal access token (repo, read:user)', valor: 'token' as const },
      ],
      'o token fica no cofre de credenciais do sistema, não no Seedy',
    );
    if (forma === 'navegador') await this.entrarPeloNavegador();
    else if (forma === 'token') await this.entrarComToken();
  }

  private async entrarPeloNavegador(): Promise<void> {
    this.conectando.set(true);
    this.mensagens.mostrar('abrindo o login do GitHub no navegador…');
    try {
      const u = await ponte.github.conta(true);
      this.usuario.set(u);
      if (u) this.mensagens.mostrar(`conectado ao GitHub como ${u.login}`);
    } catch (e) {
      this.mensagens.erro(`GitHub: ${e}`);
    } finally {
      this.conectando.set(false);
    }
  }

  private async entrarComToken(): Promise<void> {
    const token = await this.escolha.perguntar('TOKEN DO GITHUB', {
      senha: true,
      placeholder: 'ghp_… ou github_pat_…',
      dica: 'github.com → Settings → Developer settings → Tokens',
    });
    if (!token) return;
    this.conectando.set(true);
    try {
      const u = await ponte.github.token(token);
      this.usuario.set(u);
      this.mensagens.mostrar(`conectado ao GitHub como ${u.login}`);
    } catch (e) {
      this.mensagens.erro(`GitHub: ${e}`);
    } finally {
      this.conectando.set(false);
    }
  }

  async desconectar(): Promise<void> {
    const u = this.usuario();
    if (!u) return;
    const sim = await this.escolha.escolherUm(`DESCONECTAR ${u.login.toUpperCase()}?`, [
      { rotulo: 'Desconectar', detalhe: 'o Git esquece o login do github.com', valor: true },
      { rotulo: 'Cancelar', valor: false },
    ]);
    if (!sim) return;
    try {
      await ponte.github.desconectar();
      this.usuario.set(null);
      this.mensagens.mostrar('conta do GitHub desconectada');
    } catch (e) {
      this.mensagens.erro(`GitHub: ${e}`);
    }
  }

  /** Clonar um dos seus repositórios (como o "Get from VCS" do IntelliJ) e abrir. */
  async clonar(): Promise<void> {
    if (!this.usuario()) {
      await this.conectar();
      if (!this.usuario()) return;
    }
    let repos: RepositorioGithub[];
    try {
      this.mensagens.mostrar('buscando seus repositórios…');
      repos = await ponte.github.repositorios();
    } catch (e) {
      this.mensagens.erro(`GitHub: ${e}`);
      return;
    }
    const repo = await this.escolha.escolherUm(
      'CLONAR DO GITHUB',
      repos.map((r) => ({
        rotulo: `${r.dono}/${r.nome}`,
        detalhe: `${r.privado ? 'privado · ' : ''}${haQuanto(Date.parse(r.atualizado) / 1000)}`,
        valor: r,
      })),
      'escolha o repositório; depois, a pasta onde ele vai ficar',
    );
    if (!repo) return;
    const pasta = await ponte.escolherPasta();
    if (!pasta) return;
    const destino = `${pasta}${pasta.includes('\\') ? '\\' : '/'}${repo.nome}`;
    this.mensagens.mostrar(`clonando ${repo.dono}/${repo.nome}…`);
    const r = await ponte.git(null, ['clone', repo.url_clone, destino]);
    if (r.codigo !== 0) {
      this.mensagens.erro(`clone: ${(r.erro || r.saida).trim().split('\n').pop()}`);
      return;
    }
    this.mensagens.mostrar(`${repo.nome} clonado`);
    await this.projeto.abrir(destino);
  }
}
