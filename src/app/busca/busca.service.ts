import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { Indice, ponte } from '../nucleo/ponte';
import { ProjetoService } from '../nucleo/projeto.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { EditorService } from '../editor/editor.service';

export type Filtro = 'tudo' | 'classes' | 'arquivos' | 'simbolos' | 'texto' | 'acoes';

export const FILTROS: { id: Filtro; rotulo: string }[] = [
  { id: 'tudo', rotulo: 'Tudo' },
  { id: 'classes', rotulo: 'Classes' },
  { id: 'arquivos', rotulo: 'Arquivos' },
  { id: 'simbolos', rotulo: 'Símbolos' },
  { id: 'texto', rotulo: 'Texto' },
  { id: 'acoes', rotulo: 'Ações' },
];

/**
 * Search Everywhere: estado da janela de busca e o índice do projeto
 * (arquivos + classes/métodos Java), refeito a cada abertura de projeto
 * e a cada vez que a busca abre.
 */
@Injectable({ providedIn: 'root' })
export class BuscaService {
  private readonly projeto = inject(ProjetoService);
  private readonly mensagens = inject(MensagensService);
  private readonly editor = inject(EditorService);

  readonly aberta = signal(false);
  readonly filtro = signal<Filtro>('tudo');
  readonly consulta = signal('');

  readonly indice = signal<Indice | null>(null);
  readonly indexando = signal(false);
  readonly totalIndice = computed(() => {
    const i = this.indice();
    return i ? i.arquivos.length + i.simbolos.length : 0;
  });

  /** Quem tinha o foco antes da busca abrir, para devolver ao fechar. */
  private focoAnterior: HTMLElement | null = null;

  constructor() {
    effect(() => {
      this.projeto.versao();
      const raiz = this.projeto.raiz();
      untracked(() => (raiz ? void this.indexar() : this.indice.set(null)));
    });
  }

  abrir(filtro: Filtro = 'tudo', consulta = ''): void {
    if (!this.aberta()) this.focoAnterior = document.activeElement as HTMLElement | null;
    this.filtro.set(filtro);
    this.consulta.set(consulta);
    this.aberta.set(true);
    if (!this.projeto.raiz()) this.mensagens.alerta('abra um projeto para buscar nos arquivos (Alt+Shift+O)');
    else void this.indexar();
  }

  /** Fecha; `devolverFoco` = false quando a busca acabou abrindo algo no editor. */
  fechar(devolverFoco = true): void {
    this.aberta.set(false);
    const anterior = this.focoAnterior;
    this.focoAnterior = null;
    if (!devolverFoco) return;
    // Vindo do vim (␣ no modo normal), o foco estava na linha de comando dele, que já sumiu.
    const valido = anterior && anterior !== document.body && anterior.isConnected;
    queueMicrotask(() => (valido ? anterior.focus() : this.editor.focar()));
  }

  proximoFiltro(passo: 1 | -1): void {
    const i = FILTROS.findIndex((f) => f.id === this.filtro());
    this.filtro.set(FILTROS[(i + passo + FILTROS.length) % FILTROS.length].id);
  }

  private async indexar(): Promise<void> {
    const raiz = this.projeto.raiz();
    if (!raiz || this.indexando()) return;
    this.indexando.set(true);
    try {
      const indice = await ponte.indexar(raiz);
      if (this.projeto.raiz() === raiz) this.indice.set(indice);
    } catch (e) {
      this.mensagens.erro(`não consegui indexar o projeto: ${e}`);
    } finally {
      this.indexando.set(false);
    }
  }
}
