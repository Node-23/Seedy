import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { BuscaService, Filtro, FILTROS } from './busca.service';
import { casar, ocorrencias } from './fuzzy';
import { emPedacos, montarPrevia, Pedaco, Previa as PreviaBase } from './previa';
import { PreviaComponent } from './previa.component';
import { nomeBase, Ocorrencia, ponte } from '../nucleo/ponte';
import { ProjetoService } from '../nucleo/projeto.service';
import { EditorService } from '../editor/editor.service';
import { AtalhosService } from '../teclado/atalhos.service';

type TipoItem = 'classe' | 'metodo' | 'arquivo' | 'texto' | 'acao';

interface Item {
  id: string;
  tipo: TipoItem;
  pedacos: Pedaco[];
  detalhe: string;
  pontos: number;
  caminho?: string;
  linha?: number;
  /** Nome do símbolo (classes e métodos), para a prévia e os usos. */
  nome?: string;
  executar?: () => void;
}

interface Previa extends PreviaBase {
  arquivo: string;
}

interface Usos {
  total: number;
  lugares: string[];
}

const LETRA: Record<TipoItem, string> = { classe: 'c', metodo: 'm', arquivo: 'f', texto: 't', acao: 'a' };
/** Desempate no filtro "Tudo": classes, depois métodos, arquivos e ações. */
const PESO: Record<TipoItem, number> = { classe: 30, metodo: 20, arquivo: 10, texto: 0, acao: 0 };
const LIMITE = 100;
/** Código de teste vem depois do código principal. */
const PENALIDADE_TESTE = 60;
const ehTeste = (caminho: string) => /[\\/]src[\\/]test[\\/]/.test(caminho);

/** Pedaços do rótulo, com as letras casadas marcadas para sublinhar. */
function marcar(texto: string, posicoes: number[]): Pedaco[] {
  const marcadas = new Set(posicoes);
  return emPedacos(texto, (i) => (marcadas.has(i) ? 'casado' : ''));
}

/** `src/main/resources/db/migration/V12.sql` → `db/migration`. */
function pastaCurta(relativo: string): string {
  const partes = relativo.split('/').slice(0, -1);
  return partes.slice(-2).join('/') || '.';
}

/**
 * Buscar arquivo (Ctrl+P, abre no filtro Arquivos) — é o Search Everywhere
 * do mockup 02: classes, arquivos, símbolos, texto e ações num lugar só,
 * com prévia do código à direita. ␣␣ abre a mesma janela no filtro Tudo.
 */
@Component({
  selector: 'sd-busca',
  template: `
    @if (busca.aberta()) {
      <div class="busca" role="dialog" aria-label="Buscar em tudo" (keydown)="teclar($event)">
        <label class="busca-campo">
          <span class="busca-prompt" aria-hidden="true">›</span>
          <input
            #campo
            type="text"
            spellcheck="false"
            autocomplete="off"
            aria-label="Buscar"
            aria-controls="busca-resultados"
            [attr.aria-activedescendant]="selecionado() ? 'busca-item-' + indiceSelecionado() : null"
            [value]="busca.consulta()"
            (input)="busca.consulta.set($any($event.target).value)"
          />
          <span class="suave contagem">{{ contagem() }}</span>
        </label>

        <div class="busca-filtros" role="tablist" aria-label="Filtro">
          @for (f of filtros; track f.id) {
            <button role="tab" class="filtro" [class.ativo]="busca.filtro() === f.id" [attr.aria-selected]="busca.filtro() === f.id"
                    tabindex="-1" (click)="escolherFiltro(f.id)">{{ f.rotulo }}</button>
          }
          <span class="espaco"></span>
          <span class="suave">tab troca o filtro</span>
        </div>

        <div class="busca-corpo">
          <ul #lista id="busca-resultados" class="busca-resultados" role="listbox" aria-label="Resultados">
            @for (item of resultados(); track item.id; let i = $index) {
              <li class="busca-item" role="option" [id]="'busca-item-' + i" [class.selecionado]="i === indiceSelecionado()"
                  [attr.aria-selected]="i === indiceSelecionado()" (mousedown)="$event.preventDefault()" (click)="abrir(item)"
                  (mousemove)="indiceSelecionado.set(i)">
                <span class="marca-tipo" [attr.data-tipo]="item.tipo" aria-hidden="true">{{ letra[item.tipo] }}</span>
                <span class="busca-rotulo">@for (p of item.pedacos; track $index) {<span [class]="p.classe">{{ p.texto }}</span>}</span>
                <span class="espaco"></span>
                <span class="suave busca-detalhe">{{ item.detalhe }}</span>
              </li>
            } @empty {
              <li class="busca-vazio suave">{{ mensagemVazia() }}</li>
            }
          </ul>

          <div class="busca-previa" aria-label="Prévia">
            @if (previa(); as p) {
              <div class="busca-previa-topo suave"><span>{{ p.arquivo }}</span><span>linha {{ p.linha }}</span></div>
              <sd-previa [previa]="p" />
              @if (rodapePrevia(); as r) {
                <div class="busca-previa-rodape suave">
                  @if (r.usos; as u) {
                    <span class="forte-texto">{{ u.total }} {{ u.total === 1 ? 'uso' : 'usos' }}</span>
                    @for (lugar of u.lugares; track $index) { <span>· {{ lugar }}</span> }
                  } @else {
                    <span>{{ r.texto }}</span>
                  }
                </div>
              }
            } @else if (selecionado()?.tipo === 'acao') {
              <div class="busca-previa-acao suave">
                <span>ação do Seedy</span>
                <kbd>{{ selecionado()!.detalhe }}</kbd>
              </div>
            }
          </div>
        </div>

        <div class="busca-dicas">
          <span><span class="tecla">↑↓</span> navegar</span>
          <span><span class="tecla">⏎</span> abrir</span>
          <span><span class="tecla">^u</span> usos</span>
          <span><span class="tecla">esc</span> fechar</span>
          <span class="espaco"></span>
          <span>ctrl+p abre de qualquer lugar</span>
        </div>
      </div>
    }
  `,
  imports: [PreviaComponent],
})
export class BuscaComponent {
  protected readonly busca = inject(BuscaService);
  private readonly projeto = inject(ProjetoService);
  private readonly editor = inject(EditorService);
  private readonly atalhos = inject(AtalhosService);
  private readonly campo = viewChild<ElementRef<HTMLInputElement>>('campo');
  private readonly lista = viewChild<ElementRef<HTMLUListElement>>('lista');

  protected readonly filtros = FILTROS;
  protected readonly letra = LETRA;
  protected readonly indiceSelecionado = signal(0);

  private readonly ocorrenciasTexto = signal<Ocorrencia[]>([]);
  protected readonly previa = signal<Previa | null>(null);
  private readonly usos = signal<Usos | null>(null);
  private readonly cacheArquivos = new Map<string, string>();
  private readonly cacheUsos = new Map<string, Usos>();

  /** Busca de texto só a partir de 2 letras, e só nos filtros que mostram texto. */
  private readonly consultaDeTexto = computed(() => {
    const q = this.busca.consulta().trim();
    const f = this.busca.filtro();
    return q.length >= 2 && (f === 'tudo' || f === 'texto') ? q : '';
  });

  protected readonly resultados = computed<Item[]>(() => {
    const q = this.busca.consulta().trim();
    const f = this.busca.filtro();
    const indice = this.busca.indice();
    const itens: Item[] = [];

    if (indice && (f === 'tudo' || f === 'classes' || f === 'simbolos') && (q || f !== 'tudo')) {
      for (const s of indice.simbolos) {
        if (f === 'classes' && s.tipo !== 'classe') continue;
        const c = casar(q, s.nome);
        if (!c) continue;
        const rotulo = s.tipo === 'metodo' ? `${s.nome}(${s.detalhe})` : s.nome;
        itens.push({
          id: `s:${s.caminho}:${s.linha}`,
          tipo: s.tipo,
          pedacos: marcar(rotulo, c.posicoes),
          detalhe: s.conteiner,
          pontos: c.pontos + PESO[s.tipo] - (ehTeste(s.caminho) ? PENALIDADE_TESTE : 0),
          caminho: s.caminho,
          linha: s.linha,
          nome: s.nome,
        });
      }
    }

    if (indice && (f === 'tudo' || f === 'arquivos')) {
      const abertos = new Set(this.editor.buffers().map((b) => b.caminho));
      for (const a of indice.arquivos) {
        const nome = nomeBase(a.relativo);
        let c = casar(q, nome);
        // Com "/" na consulta, vale casar pelo caminho (ex.: "migration/v12").
        if (!c && q.includes('/')) {
          const peloCaminho = casar(q, a.relativo);
          if (peloCaminho) c = { pontos: peloCaminho.pontos - 200, posicoes: [] };
        }
        if (!c) continue;
        itens.push({
          id: `f:${a.caminho}`,
          tipo: 'arquivo',
          pedacos: marcar(nome, c.posicoes),
          detalhe: pastaCurta(a.relativo),
          pontos: c.pontos + PESO.arquivo + (abertos.has(a.caminho) ? 5 : 0) - (ehTeste(a.caminho) ? PENALIDADE_TESTE : 0),
          caminho: a.caminho,
        });
      }
    }

    if (f === 'tudo' || f === 'acoes') {
      for (const acao of this.atalhos.acoes) {
        if (!acao.disponivel || acao.busca) continue;
        const c = casar(q, acao.rotulo);
        if (!c || (f === 'tudo' && !q)) continue;
        itens.push({
          id: `a:${acao.tecla}`,
          tipo: 'acao',
          pedacos: marcar(acao.rotulo, c.posicoes),
          detalhe: `␣ ${acao.tecla}`,
          pontos: c.pontos + PESO.acao,
          executar: () => this.atalhos.executar(acao),
        });
      }
    }

    const ordenados = q ? itens.sort((a, b) => b.pontos - a.pontos) : itens;
    const saida = ordenados.slice(0, LIMITE);

    if (this.consultaDeTexto()) {
      const limiteTexto = f === 'texto' ? 200 : 30;
      for (const o of this.ocorrenciasTexto().slice(0, limiteTexto)) {
        saida.push({
          id: `t:${o.caminho}:${o.linha}`,
          tipo: 'texto',
          pedacos: marcar(o.texto, ocorrencias(q, o.texto)),
          detalhe: `${nomeBase(o.relativo)}:${o.linha}`,
          pontos: 0,
          caminho: o.caminho,
          linha: o.linha,
        });
      }
    }
    return saida;
  });

  protected readonly selecionado = computed(() => this.resultados()[this.indiceSelecionado()] ?? null);

  protected readonly contagem = computed(() => {
    const total = this.busca.totalIndice().toLocaleString('pt-BR');
    return this.busca.indexando() && !this.busca.indice() ? 'indexando…' : `${this.resultados().length} / ${total}`;
  });

  protected readonly mensagemVazia = computed(() => {
    if (!this.projeto.raiz()) return 'nenhum projeto aberto (␣ o)';
    if (this.busca.filtro() === 'texto' && this.busca.consulta().trim().length < 2) return 'digite ao menos 2 letras';
    return this.busca.indexando() && !this.busca.indice() ? 'indexando o projeto…' : 'nada encontrado';
  });

  protected readonly rodapePrevia = computed(() => {
    const item = this.selecionado();
    if (!item?.caminho) return null;
    if (item.nome) return { usos: this.usos(), texto: 'procurando usos…' };
    const raiz = this.projeto.raiz();
    const rel = raiz && item.caminho.startsWith(raiz) ? item.caminho.slice(raiz.length + 1) : item.caminho;
    return { usos: null, texto: rel.replace(/\\/g, '/') };
  });

  constructor() {
    // Foco no campo ao abrir.
    effect(() => {
      const campo = this.campo();
      if (campo) queueMicrotask(() => campo.nativeElement.focus());
    });

    // Volta ao primeiro resultado quando a consulta ou o filtro mudam.
    effect(() => {
      this.busca.consulta();
      this.busca.filtro();
      this.indiceSelecionado.set(0);
    });

    // Busca de texto no disco, com uma pausa para não buscar a cada tecla.
    effect((aoLimpar) => {
      const q = this.consultaDeTexto();
      const raiz = this.projeto.raiz();
      if (!q || !raiz) {
        this.ocorrenciasTexto.set([]);
        return;
      }
      let valido = true;
      const t = setTimeout(async () => {
        const achados = await ponte.buscarTexto(raiz, q, 200).catch(() => []);
        if (valido) this.ocorrenciasTexto.set(achados);
      }, 150);
      aoLimpar(() => {
        valido = false;
        clearTimeout(t);
      });
    });

    // Prévia do item selecionado.
    effect((aoLimpar) => {
      const item = this.selecionado();
      const q = this.busca.consulta().trim();
      let valido = true;
      aoLimpar(() => (valido = false));
      if (!item?.caminho) {
        this.previa.set(null);
        return;
      }
      void untracked(() => this.montarPrevia(item, q)).then((p) => valido && this.previa.set(p));
    });

    // Usos do símbolo selecionado (por enquanto, ocorrências do nome; com o jdtls, usos de verdade).
    effect((aoLimpar) => {
      const item = this.selecionado();
      const raiz = this.projeto.raiz();
      this.usos.set(null);
      if (!item?.nome || !raiz) return;
      const chave = `${item.caminho}:${item.linha}`;
      const pronto = this.cacheUsos.get(chave);
      if (pronto) {
        this.usos.set(pronto);
        return;
      }
      let valido = true;
      const t = setTimeout(async () => {
        const achados = await ponte.buscarTexto(raiz, item.nome!, 500).catch(() => []);
        const palavra = new RegExp(`\\b${item.nome!.replace(/[$]/g, '\\$')}\\b`);
        const fora = achados.filter(
          (o) => palavra.test(o.texto) && !(o.caminho === item.caminho && o.linha === item.linha),
        );
        const usos = {
          total: fora.length,
          lugares: fora.slice(0, 3).map((o) => `${nomeBase(o.relativo).replace(/\.[^.]+$/, '')}:${o.linha}`),
        };
        this.cacheUsos.set(chave, usos);
        if (valido) this.usos.set(usos);
      }, 200);
      aoLimpar(() => {
        valido = false;
        clearTimeout(t);
      });
    });

    // Novo índice = arquivos podem ter mudado.
    effect(() => {
      this.busca.indice();
      this.cacheArquivos.clear();
      this.cacheUsos.clear();
    });
  }

  protected escolherFiltro(f: Filtro): void {
    this.busca.filtro.set(f);
    this.campo()?.nativeElement.focus();
  }

  protected teclar(e: KeyboardEvent): void {
    const ctrl = e.ctrlKey || e.metaKey;
    const tecla = e.key.toLowerCase();
    if (e.key === 'Escape') {
      this.busca.fechar();
    } else if (e.key === 'ArrowDown' || (ctrl && (tecla === 'n' || tecla === 'j'))) {
      this.mover(1);
    } else if (e.key === 'ArrowUp' || (ctrl && (tecla === 'p' || tecla === 'k'))) {
      this.mover(-1);
    } else if (e.key === 'PageDown') {
      this.mover(10);
    } else if (e.key === 'PageUp') {
      this.mover(-10);
    } else if (e.key === 'Tab') {
      this.busca.proximoFiltro(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Enter') {
      const item = this.selecionado();
      if (item) void this.abrir(item);
    } else if (ctrl && tecla === 'u') {
      const nome = this.selecionado()?.nome;
      if (nome) this.busca.abrir('texto', nome);
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  protected async abrir(item: Item): Promise<void> {
    if (item.executar) {
      this.busca.fechar();
      item.executar();
      return;
    }
    if (!item.caminho) return;
    this.busca.fechar(false);
    await this.editor.abrir(item.caminho, item.linha);
  }

  private mover(passo: number): void {
    const total = this.resultados().length;
    if (!total) return;
    const atual = this.indiceSelecionado();
    // Nas pontas, um passo simples dá a volta; um salto (PageUp/Down) para na ponta.
    const novo = Math.abs(passo) === 1 ? (atual + passo + total) % total : Math.max(0, Math.min(total - 1, atual + passo));
    this.indiceSelecionado.set(novo);
    queueMicrotask(() =>
      this.lista()?.nativeElement.querySelector(`#busca-item-${novo}`)?.scrollIntoView({ block: 'nearest' }),
    );
  }

  private async montarPrevia(item: Item, consulta: string): Promise<Previa | null> {
    let conteudo = this.cacheArquivos.get(item.caminho!);
    if (conteudo === undefined) {
      try {
        conteudo = await ponte.lerArquivo(item.caminho!);
      } catch {
        return null;
      }
      this.cacheArquivos.set(item.caminho!, conteudo);
    }
    const previa = await montarPrevia({
      conteudo,
      linguagem: this.editor.linguagemDe(item.caminho!),
      linha: item.linha,
      marcas: (texto, alvo) => {
        if (!alvo) return {};
        const termo = item.nome && item.tipo !== 'texto' ? casarNome(consulta, item.nome) : consulta;
        const casado = ocorrencias(termo, texto);
        if (!item.nome) return { casado };
        const i = texto.search(new RegExp(`\\b${item.nome.replace(/[$]/g, '\\$')}\\b`));
        return { casado, definicao: i >= 0 ? Array.from({ length: item.nome.length }, (_, k) => i + k) : [] };
      },
    });
    return { ...previa, arquivo: nomeBase(item.caminho!) };
  }
}

/** Parte do nome que a consulta casou como trecho contínuo (para sublinhar na prévia). */
function casarNome(consulta: string, nome: string): string {
  const i = nome.toLowerCase().indexOf(consulta.toLowerCase());
  return i >= 0 && consulta ? nome.slice(i, i + consulta.length) : '';
}
