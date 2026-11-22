import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { ConfigService } from '../config/config.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { AtualizacaoInfo, noApp, ponte } from '../nucleo/ponte';

const A_CADA = 6 * 60 * 60 * 1000;

/**
 * Atualização do Seedy (␣ U): vê a última release do GitHub ao abrir e a cada 6 horas e avisa na barra
 * de status; nada baixa sozinho. O núcleo baixa o instalador, confere o tamanho e o SHA-256 publicado,
 * fecha o app, instala e abre de novo. Desligável em `seedy.json` (`atualizacao.verificar`).
 */
@Injectable({ providedIn: 'root' })
export class AtualizacaoService {
  private readonly config = inject(ConfigService);
  private readonly mensagens = inject(MensagensService);

  readonly versao = signal('');
  readonly disponivel = signal<AtualizacaoInfo | null>(null);
  readonly aberto = signal(false);
  readonly baixando = signal(false);
  readonly progresso = signal<{ lido: number; total: number } | null>(null);
  readonly erro = signal<string | null>(null);
  private iniciou = false;

  constructor() {
    if (!noApp()) return;
    void ponte.atualizacao.versao().then((v) => this.versao.set(v));
    void ponte.atualizacao.aoProgresso((p) => this.progresso.set(p));
    effect(() => {
      const ligado = this.config.atual().atualizacao?.verificar !== false;
      untracked(() => {
        if (!ligado || this.iniciou) return;
        this.iniciou = true;
        // Dá tempo de a IDE terminar de abrir (e da conta do GitHub conectar) antes da primeira olhada.
        setTimeout(() => void this.verificar(false), 15_000);
        setInterval(() => {
          if (this.config.atual().atualizacao?.verificar !== false) void this.verificar(false);
        }, A_CADA);
      });
    });
  }

  /** `manual`: foi o usuário que pediu (␣ U): responde "em dia" e mostra os erros. */
  async verificar(manual: boolean): Promise<void> {
    if (!noApp()) return void this.mensagens.alerta('atualização: só no app instalado');
    try {
      const a = await ponte.atualizacao.verificar();
      this.disponivel.set(a);
      if (manual) {
        if (a) this.aberto.set(true);
        else this.mensagens.mostrar(`Seedy ${this.versao()} está em dia`);
      }
    } catch (e) {
      if (manual) this.mensagens.erro(String(e));
    }
  }

  /** ␣ U: abre o aviso se há atualização; senão, procura agora. */
  alternar(): void {
    if (this.aberto()) return this.fechar();
    if (this.disponivel()) this.aberto.set(true);
    else void this.verificar(true);
  }

  fechar(): void {
    if (this.baixando()) return;
    this.aberto.set(false);
    this.erro.set(null);
  }

  verNotas(): void {
    const a = this.disponivel();
    if (a?.pagina) void ponte.abrirLink(a.pagina);
  }

  async instalar(): Promise<void> {
    const a = this.disponivel();
    if (!a || this.baixando()) return;
    if (!a.automatica || !a.confere) return this.verNotas();
    this.baixando.set(true);
    this.erro.set(null);
    this.progresso.set(null);
    try {
      await ponte.atualizacao.instalar(a.versao);
    } catch (e) {
      this.erro.set(String(e));
      this.baixando.set(false);
    }
  }
}
