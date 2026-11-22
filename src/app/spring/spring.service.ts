import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { EnvService } from '../execucao/env.service';
import { ponte } from '../nucleo/ponte';
import { ProjetoService } from '../nucleo/projeto.service';

/**
 * O que o Seedy sabe do projeto Spring Boot aberto: se é Spring, a porta e o contexto (de
 * `application.properties`/`.yml`) e os perfis (`application-<perfil>.yml`/`.properties`).
 * A tela de endpoints e o RUN/DEBUG usam.
 */
@Injectable({ providedIn: 'root' })
export class SpringService {
  private readonly projeto = inject(ProjetoService);
  private readonly env = inject(EnvService);

  /** pom.xml ou build.gradle com spring-boot. */
  readonly ehSpring = signal(false);
  readonly porta = signal(8080);
  readonly contexto = signal('');
  /** Perfis achados em `src/main/resources/application-*.yml|yaml|properties`. */
  readonly perfis = signal<string[]>([]);
  /** `spring.profiles.active` que o próprio application.yml/.properties já define. */
  readonly perfilDoArquivo = signal<string | null>(null);

  constructor() {
    effect(() => {
      this.projeto.raiz();
      this.projeto.mudancas();
      this.env.emUso();
      untracked(() => void this.atualizar());
    });
  }

  /** Lê de novo (a tela de endpoints chama ao abrir: os perfis escolhidos em `.seedy/execucao.json` podem ter mudado). */
  async atualizar(): Promise<void> {
    const raiz = this.projeto.raiz();
    if (!raiz) return this.limpar();
    const sep = raiz.includes('\\') ? '\\' : '/';
    const base = raiz.replace(/[\\/]+$/, '');
    const ler = (rel: string) => ponte.lerArquivo(`${base}${sep}${rel.replace(/\//g, sep)}`).catch(() => '');
    const [pom, gradle, kts] = await Promise.all([ler('pom.xml'), ler('build.gradle'), ler('build.gradle.kts')]);
    const spring = /spring-boot/i.test(pom + gradle + kts);
    this.ehSpring.set(spring);
    if (!spring) return this.limpar(false);
    const recursos = `${base}${sep}src${sep}main${sep}resources`;
    const [props, yml, yaml, pasta] = await Promise.all([
      ler('src/main/resources/application.properties'),
      ler('src/main/resources/application.yml'),
      ler('src/main/resources/application.yaml'),
      ponte.lerPasta(recursos).catch(() => []),
    ]);
    const texto = `${props}\n${yml}\n${yaml}`;
    // Quem manda na porta: SERVER_PORT do .env, o application-<perfil> dos perfis em uso, o application.
    const doPorta = (t: string) => /^\s*server\.port\s*[=:]\s*(\d+)/m.exec(t)?.[1] ?? /^server:\s*\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+port:\s*(\d+)/m.exec(t)?.[1];
    const arquivoEnv = this.env.emUso()?.nome;
    const doEnv = arquivoEnv ? await ponte.env.ler(raiz, arquivoEnv).catch(() => []) : [];
    const opcoes = await ler('.seedy/execucao.json');
    let escolhidos: string[] = [];
    try {
      const todas = JSON.parse(opcoes || '{}') as Record<string, { perfis?: string[] }>;
      escolhidos = Object.entries(todas).find(([id, o]) => id.startsWith('main:') && o.perfis?.length)?.[1].perfis ?? [];
    } catch {
      /* execucao.json inválido: sem perfis escolhidos */
    }
    if (!escolhidos.length) escolhidos = (doEnv.find((v) => v.nome === 'SPRING_PROFILES_ACTIVE')?.valor ?? '').split(',').map((p) => p.trim()).filter(Boolean);
    let porta = doEnv.find((v) => v.nome === 'SERVER_PORT')?.valor;
    for (const p of escolhidos.slice().reverse()) {
      if (porta) break;
      porta = doPorta(`${await ler(`src/main/resources/application-${p}.yml`)}\n${await ler(`src/main/resources/application-${p}.yaml`)}\n${await ler(`src/main/resources/application-${p}.properties`)}`);
    }
    porta = porta ?? doPorta(texto);
    this.porta.set(porta && /^\d+$/.test(porta) ? Number(porta) : 8080);
    const ctx = /^\s*server\.servlet\.context-path\s*[=:]\s*(\S+)/m.exec(texto)?.[1] ?? /^[ \t]+context-path:\s*(\S+)/m.exec(texto)?.[1] ?? '';
    this.contexto.set(ctx === '/' ? '' : ctx.replace(/\/+$/, ''));
    const ativo = /^\s*spring\.profiles\.active\s*[=:]\s*([^\s#]+)/m.exec(texto)?.[1] ?? /^[ \t]+active:\s*([^\s#]+)/m.exec(texto)?.[1] ?? null;
    this.perfilDoArquivo.set(ativo && !ativo.includes('${') ? ativo : null);
    const nomes = new Set<string>();
    for (const e of pasta) {
      const m = /^application-(.+)\.(ya?ml|properties)$/i.exec(e.nome);
      if (!e.pasta && m) nomes.add(m[1]);
    }
    this.perfis.set([...nomes].sort());
  }

  private limpar(spring = false): void {
    this.ehSpring.set(spring);
    this.perfis.set([]);
    this.perfilDoArquivo.set(null);
  }
}
