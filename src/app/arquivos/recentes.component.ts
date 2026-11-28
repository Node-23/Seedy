import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { EditorService } from '../editor/editor.service';
import { GitService } from '../git/git.service';
import { ProjetoService } from '../nucleo/projeto.service';
import { RecentesDeArquivosService } from './recentes-arquivos.service';

interface Item {
  caminho: string;
  nome: string;
  onde: string;
  marca: string;
  git: string | null;
  sujo: boolean;
  biblioteca: boolean;
}

/**
 * Arquivos recentes (mockup 44). Teclado: escreva para filtrar, ↑↓ ou ^n ^p escolhem, ⏎ abre,
 * 2 a 9 abrem direto (com o filtro vazio), ^v abre ao lado, del tira da lista, esc fecha.
 */
@Component({
  selector: 'sd-recentes',
  template: `
    @if (r.aberto()) {
      <div class="veu" (mousedown)="r.fechar()"></div>
      <div class="painel recentes" role="dialog" aria-label="Arquivos recentes">
        <div class="painel-faixa"><span class="rotulo">ARQUIVOS RECENTES</span><span class="espaco"></span><kbd>Ctrl+E</kbd><kbd>esc</kbd></div>
        <input #campo class="novo-arquivo-nome recentes-filtro" placeholder="filtrar…" aria-label="Filtrar" spellcheck="false" autocomplete="off"
               [value]="filtro()" (input)="filtro.set(campo.value); indice.set(0)" (keydown)="teclar($event)">
        <div #lista class="recentes-lista" role="listbox">
          @for (i of itens(); track i.caminho; let n = $index) {
            <div class="recentes-item" role="option" [class.sel]="n === indice()" [attr.aria-selected]="n === indice()" [attr.data-git]="i.git"
                 (mousedown)="$event.preventDefault(); abrir(i)">
              <span class="menu-arvore-marca suave">{{ i.marca }}</span>
              <span class="nome" [class.suave]="i.biblioteca">{{ i.nome }}</span>
              @if (i.sujo) { <span class="marca-sujo" title="alterado e não salvo">●</span> }
              <span class="onde suave">{{ i.onde }}</span>
              <span class="espaco"></span>
              @if (!filtro() && n < 9) { <kbd>{{ n === 0 ? '⏎' : n + 1 }}</kbd> }
            </div>
          } @empty {
            <p class="suave recentes-vazio">{{ filtro() ? 'nada com esse nome' : 'nenhum outro arquivo aberto ainda' }}</p>
          }
        </div>
        <div class="completar-acoes suave">
          <span><span class="destaque-texto">↑↓</span> escolher</span><span><span class="destaque-texto">⏎</span> abrir</span>
          <span><span class="destaque-texto">^v</span> abrir ao lado</span><span><span class="destaque-texto">del</span> tirar da lista</span>
        </div>
      </div>
    }
  `,
})
export class RecentesComponent {
  protected readonly r = inject(RecentesDeArquivosService);
  private readonly editor = inject(EditorService);
  private readonly git = inject(GitService);
  private readonly projeto = inject(ProjetoService);
  private readonly campo = viewChild<ElementRef<HTMLInputElement>>('campo');
  private readonly caixa = viewChild<ElementRef<HTMLElement>>('lista');

  protected readonly filtro = signal('');
  protected readonly indice = signal(0);

  private readonly todos = computed<Item[]>(() => {
    const ativo = this.editor.ativo();
    const raiz = this.projeto.raiz() ?? '';
    return this.r.lista().flatMap((caminho): Item[] => {
      if (caminho === ativo) return [];
      const buffer = this.editor.buffers().find((b) => b.caminho === caminho);
      if (caminho.includes('://')) {
        if (!buffer) return [];
        return [{ caminho, nome: buffer.nome, onde: `${buffer.descricao ?? ''} · somente leitura`, marca: '☕', git: null, sujo: false, biblioteca: true }];
      }
      const dentro = (caminho.startsWith(raiz) ? caminho.slice(raiz.length) : caminho).split(/[\\/]/).filter(Boolean);
      const nome = dentro.pop() ?? caminho;
      const git = this.git.letraDe(caminho) ?? (this.git.ignorado(caminho) ? 'ignorado' : null);
      return [{ caminho, nome, onde: encurtar(dentro.join('/')), marca: marcaDe(nome), git, sujo: !!buffer && this.editor.sujo(buffer), biblioteca: false }];
    });
  });

  protected readonly itens = computed(() => {
    const termos = this.filtro().toLowerCase().split(/\s+/).filter(Boolean);
    return this.todos().filter((i) => termos.every((t) => `${i.onde}/${i.nome}`.toLowerCase().includes(t)));
  });

  constructor() {
    effect(() => {
      const campo = this.campo();
      if (!this.r.aberto() || !campo) return;
      untracked(() => {
        this.filtro.set('');
        this.indice.set(0);
        setTimeout(() => campo.nativeElement.focus());
      });
    });
  }

  protected abrir(i: Item, aoLado = false): void {
    this.r.aberto.set(false);
    if (i.biblioteca) {
      this.editor.ativo.set(i.caminho);
      queueMicrotask(() => this.editor.focar());
    } else if (aoLado) void this.editor.dividir(i.caminho);
    else void this.editor.abrir(i.caminho).then(() => this.editor.focar());
  }

  protected teclar(e: KeyboardEvent): void {
    const itens = this.itens();
    const ctrl = e.ctrlKey || e.metaKey;
    const mover = (d: number) => {
      if (!itens.length) return;
      this.indice.set((this.indice() + d + itens.length) % itens.length);
      setTimeout(() => this.caixa()?.nativeElement.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }));
    };
    const atual = itens[this.indice()];
    if (e.key === 'Escape') this.r.fechar();
    else if (e.key === 'ArrowDown' || (ctrl && e.key === 'n')) mover(1);
    else if (e.key === 'ArrowUp' || (ctrl && e.key === 'p')) mover(-1);
    else if (e.key === 'Enter' && atual) this.abrir(atual, e.shiftKey);
    else if (ctrl && e.key === 'v' && atual) this.abrir(atual, true);
    else if (e.key === 'Delete' && atual) {
      this.r.tirar(atual.caminho);
      this.indice.set(Math.max(0, Math.min(this.indice(), itens.length - 2)));
    } else if (!this.filtro() && !ctrl && /^[2-9]$/.test(e.key) && itens[Number(e.key) - 1]) this.abrir(itens[Number(e.key) - 1]);
    else return void e.stopPropagation();
    e.preventDefault();
    e.stopPropagation();
  }
}

/** Sem o começo que todo projeto Java repete (src/main/java/br/com/...). */
function encurtar(pasta: string): string {
  const partes = pasta.replace(/^src\/main\/(java|resources|webapp)\/?/, '').replace(/^src\/test\/(java|resources)\/?/, 'test/').split('/').filter(Boolean);
  return partes.length > 3 ? `…/${partes.slice(-3).join('/')}` : partes.join('/');
}

function marcaDe(nome: string): string {
  const ext = nome.slice(nome.lastIndexOf('.') + 1).toLowerCase();
  const marcas: Record<string, string> = { java: '☕', ts: 'TS', tsx: 'TS', js: 'JS', jsx: 'JS', json: '{}', html: '<>', jsp: 'JSP', css: '#', scss: '#', xml: 'XML', yml: 'YML', yaml: 'YML', sql: 'SQL', md: 'MD', properties: 'CFG' };
  return marcas[ext] ?? '▤';
}
