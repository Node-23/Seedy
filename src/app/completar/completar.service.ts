import { computed, effect, inject, Injectable, isDevMode, signal, untracked } from '@angular/core';
import * as monaco from 'monaco-editor';
import { ConfigService } from '../config/config.service';
import { EditorService } from '../editor/editor.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { nomeBase, noApp, ponte } from '../nucleo/ponte';
import { arquivoSensivel, cortarNoBloco, ondeInserir, trechoEmVolta } from './trecho';

export type ModoDeCompletar = 'desligado' | 'local' | 'api';
type Fase = 'parado' | 'baixando' | 'ligando' | 'pronto' | 'erro';

/** Para o Alt+Shift+C religar o que estava ligado. */
const CHAVE_ANTERIOR = 'seedy.completar.anterior';

/**
 * Sugestões em texto fantasma enquanto se digita (mockups 37 a 39): modelo local no próprio
 * computador, ou a API da Anthropic. A escolha vale só pelo seedy.json global: um projeto não
 * pode, sozinho, mandar o código para fora nem baixar nada.
 */
@Injectable({ providedIn: 'root' })
export class CompletarService {
  private readonly config = inject(ConfigService);
  private readonly editor = inject(EditorService);
  private readonly mensagens = inject(MensagensService);

  private readonly ia = computed(() => this.config.iaGlobal());
  readonly modo = computed<ModoDeCompletar>(() => this.ia().completar ?? 'desligado');
  readonly sozinho = computed(() => this.ia().completarSozinho !== false);
  readonly variasLinhas = computed(() => this.ia().completarLinhas !== false);

  /** A pergunta (mockup 38): na primeira abertura, ou quando o local é pedido sem estar baixado. */
  private readonly pedida = signal(false);
  readonly perguntando = computed(() => this.pedida() || (noApp() && this.config.carregada() && this.ia().completar === undefined));

  readonly fase = signal<Fase>('parado');
  readonly instalado = signal(false);
  readonly progresso = signal<{ baixado: number; total: number } | null>(null);
  readonly porcento = computed(() => {
    const p = this.progresso();
    return p && p.total ? Math.min(100, Math.floor((p.baixado / p.total) * 100)) : 0;
  });
  readonly ultimaMs = signal<number | null>(null);

  private avisou = false;
  private registrado = false;

  /** Chamado uma vez pelo App. */
  iniciar(): void {
    if (this.registrado) return;
    this.registrado = true;
    monaco.languages.registerInlineCompletionsProvider('*', {
      debounceDelayMs: 250,
      provideInlineCompletions: (modelo, posicao, contexto, token) => this.sugerir(modelo, posicao, contexto, token),
      disposeInlineCompletions: () => {},
    });
  }

  constructor() {
    if (isDevMode()) Object.assign(window, { seedyCompletar: this });
    effect(() => {
      const modo = this.modo();
      if (!this.config.carregada()) return;
      untracked(() => void this.aplicar(modo));
    });
  }

  /** Liga o que o modo pede. Nunca baixa nada por conta própria. */
  private async aplicar(modo: ModoDeCompletar): Promise<void> {
    this.avisou = false;
    if (modo !== 'local') {
      if (this.fase() !== 'baixando') this.fase.set('parado');
      await ponte.completar.desligar().catch(() => {});
      return;
    }
    const e = await ponte.completar.estado().catch(() => null);
    this.instalado.set(!!e?.instalado);
    if (e?.instalado) await this.ligar();
  }

  private async ligar(): Promise<void> {
    if (this.fase() === 'ligando' || this.fase() === 'pronto') return;
    this.fase.set('ligando');
    try {
      await ponte.completar.ligar();
      // O usuário pode ter desligado enquanto o modelo carregava.
      if (this.modo() !== 'local') return void (await ponte.completar.desligar());
      this.fase.set('pronto');
    } catch (e) {
      this.fase.set('erro');
      this.mensagens.erro(`completar local: ${e}`);
    }
  }

  async baixar(): Promise<void> {
    if (this.fase() === 'baixando') return;
    this.fase.set('baixando');
    this.progresso.set(null);
    try {
      await ponte.completar.baixar((p) => this.progresso.set(p));
    } catch (e) {
      this.fase.set('parado');
      if (!String(e).includes('cancelado')) this.mensagens.erro(`completar local: ${e}`);
      return;
    }
    this.fase.set('parado');
    this.instalado.set(true);
    this.mensagens.mostrar('modelo baixado: completar ligado');
    if (this.modo() === 'local') await this.ligar();
  }

  /** A escolha da pergunta ou das configurações; `local` baixa o que faltar. */
  async escolher(modo: ModoDeCompletar): Promise<void> {
    this.pedida.set(false);
    if (modo !== 'desligado') lembrar(modo);
    const jaEra = this.ia().completar === modo;
    await this.config.gravarIa({ completar: modo });
    if (modo !== 'local') return;
    const e = await ponte.completar.estado().catch(() => null);
    this.instalado.set(!!e?.instalado);
    if (!e?.instalado) await this.baixar();
    else if (jaEra) await this.ligar();
  }

  /** Alt+Shift+C: desliga o que está ligado ou religa o de antes. */
  async alternar(): Promise<void> {
    if (this.modo() !== 'desligado') {
      lembrar(this.modo());
      await this.config.gravarIa({ completar: 'desligado' });
      return this.mensagens.mostrar('completar desligado');
    }
    const anterior = lerAnterior();
    if (anterior === 'local') {
      const e = await ponte.completar.estado().catch(() => null);
      // Sem o modelo, quem decide baixar é o usuário.
      if (!e?.instalado) return this.pedida.set(true);
    }
    await this.escolher(anterior);
    this.mensagens.mostrar(`completar ligado: ${anterior === 'api' ? 'API' : 'local'}`);
  }

  perguntar(): void {
    this.pedida.set(true);
  }

  fecharPergunta(): void {
    this.pedida.set(false);
  }

  async remover(): Promise<void> {
    if (this.modo() === 'local') await this.config.gravarIa({ completar: 'desligado' });
    try {
      await ponte.completar.remover();
      this.instalado.set(false);
      this.fase.set('parado');
      this.mensagens.mostrar('modelo removido');
    } catch (e) {
      this.mensagens.erro(String(e));
    }
  }

  async definir(parte: { completarSozinho?: boolean; completarLinhas?: boolean }): Promise<void> {
    await this.config.gravarIa(parte);
  }

  private async sugerir(
    modelo: monaco.editor.ITextModel,
    posicao: monaco.Position,
    contexto: monaco.languages.InlineCompletionContext,
    token: monaco.CancellationToken,
  ): Promise<monaco.languages.InlineCompletions> {
    const nada = { items: [] };
    const modo = this.modo();
    if (modo === 'desligado') return nada;
    // Só nos arquivos abertos no editor, e fora dos somente leitura.
    const buffer = this.editor.buffers().find((b) => b.modelo === modelo);
    if (!buffer || buffer.somenteLeitura) return nada;
    // No modo normal do Vim não se escreve; com a lista do jdtls aberta, ela manda.
    if (this.editor.modo() !== 'insert' || contexto.selectedSuggestionInfo) return nada;
    if (contexto.triggerKind === monaco.languages.InlineCompletionTriggerKind.Automatic && !this.sozinho()) return nada;
    if (modo === 'api' && arquivoSensivel(nomeBase(buffer.caminho))) return nada;
    if (modo === 'local' && this.fase() !== 'pronto') {
      if (this.fase() === 'parado' && this.instalado()) void this.ligar();
      return nada;
    }
    const { prefixo, sufixo } = trechoEmVolta(modelo.getValue(), modelo.getOffsetAt(posicao));
    if (!prefixo.trim()) return nada;

    const inicio = Date.now();
    let texto: string;
    try {
      texto = await ponte.completar.pedir(prefixo, sufixo, this.variasLinhas(), modo === 'api');
    } catch (e) {
      // Um aviso só: falhar a cada tecla seria pior que não sugerir.
      if (!this.avisou) this.mensagens.alerta(String(e));
      this.avisou = true;
      if (modo === 'local') this.fase.set('parado');
      return nada;
    }
    if (token.isCancellationRequested || !texto.trim()) return nada;
    this.ultimaMs.set(Date.now() - inicio);
    const linha = modelo.getLineContent(posicao.lineNumber);
    const restoDaLinha = linha.slice(posicao.column - 1);
    const encaixe = ondeInserir(cortarNoBloco(texto, linha, sufixo), restoDaLinha);
    if (!encaixe) return nada;
    return {
      items: [{
        insertText: encaixe.texto,
        range: new monaco.Range(posicao.lineNumber, posicao.column, posicao.lineNumber, posicao.column + encaixe.substitui),
      }],
    };
  }
}

function lembrar(modo: ModoDeCompletar): void {
  try {
    localStorage.setItem(CHAVE_ANTERIOR, modo);
  } catch {
    /* sem armazenamento */
  }
}

function lerAnterior(): 'local' | 'api' {
  try {
    return localStorage.getItem(CHAVE_ANTERIOR) === 'api' ? 'api' : 'local';
  } catch {
    return 'local';
  }
}
