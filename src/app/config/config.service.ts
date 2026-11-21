import { computed, effect, inject, Injectable, isDevMode, signal, untracked } from '@angular/core';
import padrao from './config-padrao.json';
import { ponte } from '../nucleo/ponte';
import { MensagensService } from '../nucleo/mensagens.service';
import { ProjetoService } from '../nucleo/projeto.service';

export interface Config {
  editor: {
    /** null = detecta pelo arquivo. */
    tabulacao: number | null;
    espacos: boolean;
    quebraDeLinha: boolean;
    numerosRelativos: boolean;
    minimapa: boolean;
    formatarAoSalvar: boolean;
  };
  terminal: { shell: string | null; argumentos: string[] };
  /** id da ação do líder → tecla (ex.: { "todo": "T" }). */
  atalhos: { lider: Record<string, string> };
  ia: { modelo: string; modo: 'chave' | 'assinatura' };
  /** Barra de ícones: ordem dos botões (arraste para reorganizar). */
  barra?: { ordem?: string[] };
  /** Disposições do layout (gravadas pelo próprio Seedy ao editar o layout). */
  layout?: unknown;
}

export const CONFIG_PADRAO = padrao as unknown as Config;

type Objeto = Record<string, unknown>;
const ehObjeto = (v: unknown): v is Objeto => !!v && typeof v === 'object' && !Array.isArray(v);

/** Junta `por cima` em `base`, campo a campo (objetos se misturam; o resto é trocado). */
export function mesclar<T>(base: T, porCima: unknown): T {
  if (!ehObjeto(base) || !ehObjeto(porCima)) return (porCima === undefined ? base : porCima) as T;
  const saida: Objeto = { ...base };
  for (const [k, v] of Object.entries(porCima)) saida[k] = k in saida ? mesclar(saida[k], v) : v;
  return saida as T;
}

/**
 * `seedy.json` (␣ ,): configurações em arquivo, na pasta de configuração do Seedy, ao lado do
 * tema.json. Um `.seedy/seedy.json` no projeto sobrepõe o global (o time pode combinar a
 * tabulação, por exemplo). Salvou o arquivo, vale na hora.
 */
@Injectable({ providedIn: 'root' })
export class ConfigService {
  private readonly mensagens = inject(MensagensService);
  private readonly projeto = inject(ProjetoService);

  /** Caminho do seedy.json global (só existe dentro do app). */
  readonly caminho = signal<string | null>(null);
  private readonly global = signal<unknown>({});
  private readonly doProjeto = signal<unknown>({});
  readonly atual = computed<Config>(() => mesclar(mesclar(CONFIG_PADRAO, this.global()), this.doProjeto()));

  constructor() {
    effect(() => {
      this.projeto.raiz();
      untracked(() => void this.lerDoProjeto());
    });
    effect(() => {
      const m = this.projeto.mudancas();
      if (m && [...m.alterados, ...m.criados].some((c) => /[\\/]\.seedy[\\/]seedy\.json$/.test(c))) untracked(() => void this.lerDoProjeto());
    });
    effect(() => {
      ponte.ia.modo = this.atual().ia.modo === 'assinatura' ? 'assinatura' : 'chave';
    });
    if (isDevMode()) Object.assign(window, { seedyConfig: this });
  }

  async iniciar(): Promise<void> {
    const arquivo = await ponte.configCarregar().catch(() => null);
    if (arquivo) this.receber(arquivo.caminho, arquivo.conteudo, false);
    await ponte.aoAlterarConfig((a) => this.receber(a.caminho, a.conteudo, true));
  }

  private receber(caminho: string, conteudo: string, avisar: boolean): void {
    this.caminho.set(caminho);
    try {
      const novo = JSON.parse(conteudo);
      if (JSON.stringify(novo) === JSON.stringify(this.global())) return;
      this.global.set(novo);
      if (avisar) this.mensagens.mostrar('seedy.json aplicado');
    } catch (e) {
      this.mensagens.erro(`seedy.json inválido, mantive o anterior (${(e as Error).message})`);
    }
  }

  private async lerDoProjeto(): Promise<void> {
    const raiz = this.projeto.raiz();
    const texto = raiz ? await ponte.lerArquivo(`${raiz.replace(/[\\/]+$/, '')}${raiz.includes('\\') ? '\\' : '/'}.seedy${raiz.includes('\\') ? '\\' : '/'}seedy.json`).catch(() => null) : null;
    try {
      this.doProjeto.set(texto ? JSON.parse(texto) : {});
    } catch (e) {
      this.doProjeto.set({});
      this.mensagens.erro(`.seedy/seedy.json inválido (${(e as Error).message})`);
    }
  }

  /**
   * Grava uma parte do seedy.json global (ex.: { layout: ... }), sem mexer no resto do
   * arquivo. Fora do app, só vale até fechar.
   */
  async gravar(parte: Objeto): Promise<void> {
    const novo = { ...(ehObjeto(this.global()) ? (this.global() as Objeto) : {}), ...parte };
    this.global.set(novo);
    const caminho = this.caminho();
    if (!caminho) return;
    await ponte.gravarArquivo(caminho, JSON.stringify(novo, null, 2) + '\n').catch((e) => this.mensagens.erro(String(e)));
  }
}
