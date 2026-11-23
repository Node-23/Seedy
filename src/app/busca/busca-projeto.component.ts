import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { BuscaProjetoService } from './busca-projeto.service';
import { emPedacos, montarPrevia, Pedaco, Previa } from './previa';
import { PreviaComponent } from './previa.component';
import { expressaoDeBusca, trechosEncontrados, Troca, trocarNaLinha } from './texto';
import { nomeBase, Ocorrencia, ponte } from '../nucleo/ponte';
import { ProjetoService } from '../nucleo/projeto.service';
import { EditorService } from '../editor/editor.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { monaco } from '../editor/monaco';

const LIMITE = 1000;

interface Resultado {
  ocorrencia: Ocorrencia;
  pedacos: Pedaco[];
  lugar: string;
  /** Entra na substituição (todas entram, até o usuário tirar com alt+x). */
  incluido: boolean;
}

const chave = (o: Ocorrencia) => `${o.caminho}:${o.linha}`;

function pedacosDaTroca(t: Troca, so?: 'sai' | 'entra'): Pedaco[] {
  return t.partes
    .filter((p) => !so || p.tipo === 'igual' || p.tipo === so)
    .map((p) => ({ texto: p.texto, classe: p.tipo === 'igual' ? '' : `trecho-${p.tipo}` }));
}

/**
 * Buscar no projeto (Ctrl+Shift+F), no jeito do "Find in Files" do IntelliJ:
 * campo com opções (Aa, W, .*) e máscara de arquivos em cima, resultados no
 * meio e a prévia do código embaixo.
 */
@Component({
  selector: 'sd-busca-projeto',
  imports: [PreviaComponent],
  template: `
    @if (servico.aberta()) {
      <div class="busca busca-projeto" [class.substituindo]="substituindo()" role="dialog"
           [attr.aria-label]="substituindo() ? 'Substituir no projeto' : 'Buscar no projeto'" (keydown)="teclar($event)">
        <div class="painel-faixa">
          <span class="rotulo">{{ substituindo() ? 'SUBSTITUIR NO PROJETO' : 'BUSCAR NO PROJETO' }}</span>
          <span class="contagem" [class.suave]="!erro()" [class.erro-texto]="!!erro()">{{ erro() ?? contagem() }}</span>
        </div>

        <label class="busca-campo">
          <span class="busca-prompt" aria-hidden="true">›</span>
          <input
            #campo
            type="text"
            spellcheck="false"
            autocomplete="off"
            aria-label="Texto a buscar"
            aria-controls="busca-projeto-resultados"
            [attr.aria-activedescendant]="resultados().length ? 'busca-projeto-item-' + indiceSelecionado() : null"
            [value]="servico.consulta()"
            (input)="servico.consulta.set($any($event.target).value)"
          />
          <span class="opcoes-busca" role="group" aria-label="Opções">
            <button class="opcao" tabindex="-1" [class.ativo]="servico.opcoes().diferenciar" [attr.aria-pressed]="servico.opcoes().diferenciar"
                    title="Diferenciar maiúsculas (alt c)" (mousedown)="$event.preventDefault()" (click)="servico.alternar('diferenciar')">Aa</button>
            <button class="opcao" tabindex="-1" [class.ativo]="servico.opcoes().palavra" [attr.aria-pressed]="servico.opcoes().palavra"
                    title="Palavra inteira (alt w)" (mousedown)="$event.preventDefault()" (click)="servico.alternar('palavra')">W</button>
            <button class="opcao" tabindex="-1" [class.ativo]="servico.opcoes().regex" [attr.aria-pressed]="servico.opcoes().regex"
                    title="Expressão regular (alt r)" (mousedown)="$event.preventDefault()" (click)="servico.alternar('regex')">.*</button>
          </span>
        </label>

        @if (substituindo()) {
          <label class="busca-campo campo-substituir">
            <span class="busca-prompt" aria-hidden="true">↳</span>
            <input
              type="text"
              spellcheck="false"
              autocomplete="off"
              aria-label="Substituir por"
              [placeholder]="servico.opcoes().regex ? 'substituir por  ($1, $2… são os grupos)' : 'substituir por'"
              [value]="servico.substituicao()"
              (input)="servico.substituicao.set($any($event.target).value)"
            />
            <span class="suave contagem">{{ incluidas() }} de {{ ocorrencias().length }} {{ ocorrencias().length === 1 ? 'linha' : 'linhas' }}</span>
          </label>
        }

        <div class="busca-filtros">
          <label class="campo-mascara">
            <span class="suave">arquivos</span>
            <input
              type="text"
              spellcheck="false"
              autocomplete="off"
              aria-label="Máscara de arquivos"
              placeholder="todos  (ex.: *.java, *.xml, !*Test.java)"
              [value]="servico.opcoes().mascara"
              (input)="servico.mudar({ mascara: $any($event.target).value })"
            />
          </label>
          <span class="espaco"></span>
          <span class="suave">{{ substituindo() ? 'tab passa pelos campos' : 'tab vai para a máscara' }}</span>
        </div>

        <ul #lista id="busca-projeto-resultados" class="busca-projeto-resultados" role="listbox" aria-label="Resultados">
          @for (r of resultados(); track r.ocorrencia.caminho + ':' + r.ocorrencia.linha; let i = $index) {
            <li class="busca-projeto-item" role="option" [id]="'busca-projeto-item-' + i" [class.selecionado]="i === indiceSelecionado()"
                [class.excluido]="substituindo() && !r.incluido"
                [attr.aria-selected]="i === indiceSelecionado()" (mousedown)="$event.preventDefault()"
                (click)="indiceSelecionado.set(i)" (dblclick)="abrir(r.ocorrencia)">
              @if (substituindo()) {
                <span class="marca-escolha" [class.marcada]="r.incluido" aria-hidden="true" (click)="alternarInclusao(i); $event.stopPropagation()">{{ r.incluido ? '✓' : '' }}</span>
              }
              <span class="busca-rotulo">@for (p of r.pedacos; track $index) {<span [class]="p.classe">{{ p.texto }}</span>}</span>
              <span class="espaco"></span>
              <span class="suave busca-detalhe">{{ r.lugar }}</span>
            </li>
          } @empty {
            <li class="busca-vazio suave">{{ mensagemVazia() }}</li>
          }
        </ul>

        <div class="busca-previa">
          @if (previa(); as p) {
            <div class="busca-previa-topo suave"><span>{{ caminhoSelecionado() }}</span><span>linha {{ p.linha }}</span></div>
            <sd-previa [previa]="p" />
          }
        </div>

        <div class="busca-dicas">
          <span><span class="tecla">↑↓</span> navegar</span>
          <span><span class="tecla">⏎</span> abrir</span>
          <span><span class="tecla">⇧⏎</span> ao lado</span>
          @if (substituindo()) {
            <span><span class="tecla">alt x</span> incluir/tirar</span>
            <span><span class="tecla">ctrl ⏎</span> substituir</span>
          }
          <span title="alt c: maiúsculas · alt w: palavra inteira · alt r: regex"><span class="tecla">alt c·w·r</span> opções</span>
          <span><span class="tecla">esc</span> fechar</span>
          <span class="espaco"></span>
          <span>{{ substituindo() ? 'ctrl+shift+r' : 'ctrl+shift+f' }} abre de qualquer lugar</span>
        </div>
      </div>
    }
  `,
})
export class BuscaProjetoComponent {
  protected readonly servico = inject(BuscaProjetoService);
  private readonly projeto = inject(ProjetoService);
  private readonly editor = inject(EditorService);
  private readonly mensagens = inject(MensagensService);
  private readonly campo = viewChild<ElementRef<HTMLInputElement>>('campo');
  private readonly lista = viewChild<ElementRef<HTMLUListElement>>('lista');

  private readonly ocorrencias = signal<Ocorrencia[]>([]);
  private readonly buscando = signal(false);
  protected readonly erro = signal<string | null>(null);
  protected readonly indiceSelecionado = signal(0);
  protected readonly previa = signal<Previa | null>(null);
  private readonly cacheArquivos = new Map<string, string>();

  /** Expressão para sublinhar (a mesma regra do núcleo); null se inválida. */
  private readonly expressao = computed(() => {
    const q = this.servico.consulta();
    if (!q) return null;
    try {
      return expressaoDeBusca(q, this.servico.opcoes());
    } catch {
      return null;
    }
  });

  protected readonly substituindo = computed(() => this.servico.modo() === 'substituir');
  /** Linhas tiradas da substituição (alt+x), por "caminho:linha". */
  private readonly excluidas = signal(new Set<string>());
  /** Muda depois de substituir, para refazer a busca. */
  private readonly rodada = signal(0);

  protected readonly resultados = computed<Resultado[]>(() => {
    const re = this.expressao();
    const substituindo = this.substituindo();
    const subst = this.servico.substituicao();
    const comRegex = this.servico.opcoes().regex;
    const excluidas = this.excluidas();
    return this.ocorrencias().map((o) => ({
      ocorrencia: o,
      // Substituindo: a linha "antes e depois" (o que sai riscado, o que entra em verde).
      pedacos: !re
        ? [{ texto: o.texto, classe: '' }]
        : substituindo
          ? pedacosDaTroca(trocarNaLinha(o.texto, re, subst, comRegex))
          : marcar(o.texto, trechosEncontrados(re, o.texto)),
      lugar: `${nomeBase(o.relativo)}:${o.linha}`,
      incluido: !excluidas.has(chave(o)),
    }));
  });

  protected readonly incluidas = computed(() => this.resultados().filter((r) => r.incluido).length);

  protected readonly contagem = computed(() => {
    if (this.buscando() && !this.ocorrencias().length) return 'buscando…';
    const lista = this.ocorrencias();
    if (!this.servico.consulta()) return '';
    const arquivos = new Set(lista.map((o) => o.caminho)).size;
    const n = lista.length >= LIMITE ? `${LIMITE}+` : String(lista.length);
    return `${n} ${lista.length === 1 ? 'resultado' : 'resultados'} em ${arquivos} ${arquivos === 1 ? 'arquivo' : 'arquivos'}`;
  });

  protected readonly mensagemVazia = computed(() => {
    if (!this.projeto.raiz()) return 'nenhum projeto aberto (Alt+Shift+O)';
    if (!this.servico.consulta()) return 'digite o texto a buscar';
    return this.buscando() ? 'buscando…' : 'nada encontrado';
  });

  protected readonly caminhoSelecionado = computed(
    () => this.ocorrencias()[this.indiceSelecionado()]?.relativo ?? '',
  );

  constructor() {
    // Foco no campo, com o texto selecionado (digitar já substitui), a cada abertura.
    effect(() => {
      this.servico.aberturas();
      const campo = this.campo();
      if (campo) queueMicrotask(() => campo.nativeElement.select());
    });

    // Busca no disco, com uma pausa para não buscar a cada tecla.
    effect((aoLimpar) => {
      const q = this.servico.consulta();
      const opcoes = this.servico.opcoes();
      const raiz = this.projeto.raiz();
      this.rodada();
      if (!this.servico.aberta()) return;
      this.erro.set(null);
      this.indiceSelecionado.set(0);
      this.excluidas.set(new Set());
      if (!q || !raiz) {
        this.ocorrencias.set([]);
        return;
      }
      let valido = true;
      this.buscando.set(true);
      const t = setTimeout(async () => {
        try {
          const achados = await ponte.buscarTexto(raiz, q, LIMITE, opcoes);
          if (valido) this.ocorrencias.set(achados);
        } catch (e) {
          if (valido) {
            this.ocorrencias.set([]);
            this.erro.set(String(e));
          }
        } finally {
          if (valido) this.buscando.set(false);
        }
      }, 200);
      aoLimpar(() => {
        valido = false;
        clearTimeout(t);
      });
    });

    // Prévia do resultado selecionado, com todos os trechos encontrados sublinhados.
    effect((aoLimpar) => {
      const o = this.ocorrencias()[this.indiceSelecionado()];
      const re = this.expressao();
      this.substituindo();
      this.servico.substituicao();
      this.excluidas();
      let valido = true;
      aoLimpar(() => (valido = false));
      if (!o) {
        this.previa.set(null);
        return;
      }
      void untracked(() => this.montarPrevia(o, re)).then((p) => valido && this.previa.set(p));
    });

    // Arquivos podem ter mudado entre uma abertura e outra.
    effect(() => {
      if (this.servico.aberta()) this.cacheArquivos.clear();
    });
  }

  protected teclar(e: KeyboardEvent): void {
    const ctrl = e.ctrlKey || e.metaKey;
    const tecla = e.key.toLowerCase();
    if (e.key === 'Escape') {
      this.servico.fechar();
    } else if (e.key === 'ArrowDown' || (ctrl && (tecla === 'n' || tecla === 'j'))) {
      this.mover(1);
    } else if (e.key === 'ArrowUp' || (ctrl && (tecla === 'p' || tecla === 'k'))) {
      this.mover(-1);
    } else if (e.key === 'PageDown') {
      this.mover(10);
    } else if (e.key === 'PageUp') {
      this.mover(-10);
    } else if (e.key === 'Enter' && ctrl && this.substituindo()) {
      void this.substituir();
    } else if (e.key === 'Enter' && e.shiftKey) {
      const o = this.ocorrencias()[this.indiceSelecionado()];
      if (o) void this.abrir(o, true);
    } else if (e.key === 'Enter') {
      const o = this.ocorrencias()[this.indiceSelecionado()];
      if (o) void this.abrir(o);
    } else if (e.altKey && e.code === 'KeyX' && this.substituindo()) {
      this.alternarInclusao(this.indiceSelecionado());
      this.mover(1);
    } else if (e.altKey && (e.code === 'KeyC' || e.code === 'KeyW' || e.code === 'KeyR')) {
      this.servico.alternar(e.code === 'KeyC' ? 'diferenciar' : e.code === 'KeyW' ? 'palavra' : 'regex');
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  protected async abrir(o: Ocorrencia, aoLado = false): Promise<void> {
    this.servico.fechar(false);
    if (aoLado) await this.editor.dividir(o.caminho, o.linha);
    else await this.editor.abrir(o.caminho, o.linha);
  }

  protected alternarInclusao(i: number): void {
    const o = this.ocorrencias()[i];
    if (!o) return;
    const s = new Set(this.excluidas());
    if (s.has(chave(o))) s.delete(chave(o));
    else s.add(chave(o));
    this.excluidas.set(s);
  }

  /**
   * Aplica a substituição nas linhas incluídas. Buffer aberto: edita o modelo (dá
   * para desfazer) e salva se não tinha outras edições. Arquivo fechado: grava direto.
   */
  private async substituir(): Promise<void> {
    const re = this.expressao();
    if (!re) return;
    const subst = this.servico.substituicao();
    const comRegex = this.servico.opcoes().regex;
    const porArquivo = new Map<string, Set<number>>();
    for (const r of this.resultados()) {
      if (!r.incluido) continue;
      const linhas = porArquivo.get(r.ocorrencia.caminho) ?? new Set<number>();
      linhas.add(r.ocorrencia.linha);
      porArquivo.set(r.ocorrencia.caminho, linhas);
    }
    if (!porArquivo.size) return;

    let trocas = 0;
    let arquivos = 0;
    for (const [caminho, linhas] of porArquivo) {
      try {
        const b = this.editor.bufferDe(caminho);
        if (b && !b.somenteLeitura) {
          const tinhaEdicao = this.editor.sujo(b);
          const edicoes: monaco.editor.IIdentifiedSingleEditOperation[] = [];
          for (const n of linhas) {
            if (n > b.modelo.getLineCount()) continue;
            const atual = b.modelo.getLineContent(n);
            const { nova } = trocarNaLinha(atual, re, subst, comRegex);
            if (nova === atual) continue;
            edicoes.push({ range: new monaco.Range(n, 1, n, atual.length + 1), text: nova });
          }
          if (!edicoes.length) continue;
          b.modelo.pushEditOperations([], edicoes, () => null);
          if (!tinhaEdicao) await this.editor.salvar(b.caminho, false);
          trocas += edicoes.length;
          arquivos++;
        } else {
          const conteudo = await ponte.lerArquivo(caminho);
          const fimDeLinha = conteudo.includes('\r\n') ? '\r\n' : '\n';
          const todas = conteudo.split(/\r?\n/);
          let mudou = 0;
          for (const n of linhas) {
            const atual = todas[n - 1];
            if (atual === undefined) continue;
            const { nova } = trocarNaLinha(atual, re, subst, comRegex);
            if (nova === atual) continue;
            todas[n - 1] = nova;
            mudou++;
          }
          if (!mudou) continue;
          await ponte.gravarArquivo(caminho, todas.join(fimDeLinha));
          trocas += mudou;
          arquivos++;
        }
      } catch (e) {
        this.mensagens.erro(`não consegui substituir em ${nomeBase(caminho)}: ${e}`);
      }
    }
    this.cacheArquivos.clear();
    this.mensagens.mostrar(
      `${trocas} ${trocas === 1 ? 'linha trocada' : 'linhas trocadas'} em ${arquivos} ${arquivos === 1 ? 'arquivo' : 'arquivos'}`,
    );
    this.rodada.update((n) => n + 1);
  }

  private mover(passo: number): void {
    const total = this.ocorrencias().length;
    if (!total) return;
    const atual = this.indiceSelecionado();
    const novo = Math.abs(passo) === 1 ? (atual + passo + total) % total : Math.max(0, Math.min(total - 1, atual + passo));
    this.indiceSelecionado.set(novo);
    queueMicrotask(() =>
      this.lista()?.nativeElement.querySelector(`#busca-projeto-item-${novo}`)?.scrollIntoView({ block: 'nearest' }),
    );
  }

  private async montarPrevia(o: Ocorrencia, re: RegExp | null): Promise<Previa | null> {
    let conteudo = this.cacheArquivos.get(o.caminho);
    if (conteudo === undefined) {
      try {
        conteudo = await ponte.lerArquivo(o.caminho);
      } catch {
        return null;
      }
      this.cacheArquivos.set(o.caminho, conteudo);
    }
    const previa = await montarPrevia({
      conteudo,
      linguagem: this.editor.linguagemDe(o.caminho),
      linha: o.linha,
      linhasAntes: 4,
      marcas: (texto) => ({ casado: re ? trechosEncontrados(re, texto) : [] }),
    });
    // Linha tirada da substituição (alt+x): a prévia mostra que ela fica como está.
    if (!this.substituindo() || !re || this.excluidas().has(chave(o))) return previa;
    // Substituindo: a linha vira duas, a de antes (−) e a de depois (+).
    const i = previa.linhas.findIndex((l) => l.alvo);
    const original = conteudo.split(/\r?\n/)[o.linha - 1];
    if (i < 0 || original === undefined) return previa;
    const troca = trocarNaLinha(original, re, this.servico.substituicao(), this.servico.opcoes().regex);
    const linhas = [...previa.linhas];
    linhas.splice(
      i,
      1,
      { numero: o.linha, alvo: true, tipo: 'sai', pedacos: pedacosDaTroca(troca, 'sai') },
      { numero: o.linha, alvo: false, tipo: 'entra', pedacos: pedacosDaTroca(troca, 'entra') },
    );
    return { ...previa, linhas };
  }
}

function marcar(texto: string, posicoes: number[]): Pedaco[] {
  const marcadas = new Set(posicoes);
  return emPedacos(texto, (i) => (marcadas.has(i) ? 'casado' : ''));
}
