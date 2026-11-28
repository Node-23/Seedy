import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { EditorService } from '../editor/editor.service';
import { ArquivosService, juntar } from './arquivos.service';
import { arquivoDoTipo, classeJava, conteudoJava, ITENS, pacoteDe, problemaNoNome, TIPOS_JAVA } from './modelos';

/**
 * Nome do que vai ser criado (mockups 41 e 42), do que é colado sobre um que já existe ou renomeado;
 * e a confirmação de apagar.
 * Teclado: ↑↓ tipo (Java), ⏎ cria, esc cancela.
 */
@Component({
  selector: 'sd-novo-arquivo',
  template: `
    @if (a.dialogo(); as d) {
      <div class="veu" (mousedown)="a.fechar()"></div>
      @if (d.tipo === 'apagar') {
      <div #confirmar class="painel novo-arquivo" role="alertdialog" aria-label="Apagar" tabindex="-1" (keydown)="teclar($event)">
        <div class="painel-faixa"><span class="rotulo erro-texto">APAGAR</span><span class="suave">vai para a Lixeira</span><span class="espaco"></span><kbd>esc</kbd></div>
        <div class="novo-arquivo-corpo">
          <b>{{ a.relativa(d.origem!.caminho).replace(barraNoFim, d.origem!.pasta ? '/' : '') }}</b>
          <div class="novo-arquivo-caminho suave">
            {{ d.origem!.pasta ? 'a pasta e tudo o que está dentro dela' : 'o arquivo' }}; dá para recuperar pela Lixeira do sistema
            @if (alterados()) { <br><span class="erro-texto">{{ alterados() }} com alterações não salvas: elas serão perdidas</span> }
            @if (erro()) { <br><span class="erro-texto">{{ erro() }}</span> }
          </div>
        </div>
        <div class="completar-acoes">
          <span class="espaco"></span>
          <button class="botao" (click)="a.fechar()">cancelar <kbd>esc</kbd></button>
          <button class="botao destaque" (click)="confirmar_()">apagar <kbd>⏎</kbd></button>
        </div>
      </div>
      } @else {
      <div class="painel novo-arquivo" role="dialog" [attr.aria-label]="titulo()">
        <div class="painel-faixa"><span class="rotulo">{{ titulo() }}</span><span class="suave">em {{ onde() }}</span><span class="espaco"></span><kbd>esc</kbd></div>
        <div class="novo-arquivo-corpo">
          <input #campo class="novo-arquivo-nome" spellcheck="false" autocomplete="off" [attr.aria-label]="titulo()" [placeholder]="exemplo()"
                 [value]="nome()" (input)="nome.set(campo.value); erro.set('')" (keydown)="teclar($event)">
          @if (d.tipo === 'java') {
            <div class="novo-arquivo-tipos" role="listbox" aria-label="Tipo">
              @for (t of tiposJava; track t.tipo; let i = $index) {
                <div class="menu-gutter-item" role="option" [class.sel]="i === tipoJava()" [attr.aria-selected]="i === tipoJava()" (mousedown)="$event.preventDefault(); tipoJava.set(i)">
                  <span class="menu-arvore-marca suave">{{ t.marca }}</span><span>{{ t.rotulo }}</span>
                </div>
              }
            </div>
            <pre class="novo-arquivo-previa">{{ plano().conteudo || ' ' }}</pre>
          }
          <div class="novo-arquivo-caminho suave">
            @if (erro() || (nome() && plano().problema)) { <span class="erro-texto">{{ erro() || plano().problema }}</span> }
            @else if (plano().caminho) { {{ d.tipo === 'renomear' ? 'vai ficar' : 'vai criar' }} <b>{{ a.relativa(plano().caminho).replace(barraNoFim, '') }}</b> }
            @else { escreva o nome }
            <br>{{ dica() }}
          </div>
        </div>
        <div class="completar-acoes">
          @if (d.tipo === 'java') { <span class="suave"><span class="destaque-texto">↑↓</span> tipo</span> }
          <span class="espaco"></span>
          <button class="botao" (click)="a.fechar()">cancelar <kbd>esc</kbd></button>
          <button class="botao destaque" (click)="confirmar_()">{{ d.tipo === 'colar' ? 'colar' : d.tipo === 'renomear' ? 'renomear' : d.tipo === 'pasta' ? 'criar' : 'criar e abrir' }} <kbd>⏎</kbd></button>
        </div>
      </div>
      }
    }
  `,
})
export class NovoArquivoComponent {
  protected readonly a = inject(ArquivosService);
  private readonly editor = inject(EditorService);
  private readonly campo = viewChild<ElementRef<HTMLInputElement>>('campo');
  private readonly caixaDeApagar = viewChild<ElementRef<HTMLElement>>('confirmar');

  /** Quantos dos arquivos a apagar estão com alterações por salvar. */
  protected readonly alterados = computed(() => {
    const alvo = this.a.dialogo()?.origem;
    const n = alvo ? this.a.abertosEm(alvo).filter((b) => this.editor.sujo(b)).length : 0;
    return n ? `${n} ${n === 1 ? 'arquivo aberto' : 'arquivos abertos'}` : '';
  });

  protected readonly tiposJava = TIPOS_JAVA;
  protected readonly barraNoFim = /\/$/;
  protected readonly nome = signal('');
  protected readonly erro = signal('');
  protected readonly tipoJava = signal(0);

  protected readonly titulo = computed(() => {
    const t = this.a.dialogo()?.tipo;
    if (t === 'java') return 'NOVA CLASSE JAVA';
    if (t === 'arquivo') return 'NOVO ARQUIVO';
    if (t === 'pasta') return 'NOVA PASTA';
    if (t === 'colar') return 'COLAR COM OUTRO NOME';
    if (t === 'renomear') return 'RENOMEAR';
    return `NOVO · ${(ITENS.find((i) => i.tipo === t)?.rotulo ?? '').toUpperCase()}`;
  });

  protected readonly onde = computed(() => {
    const d = this.a.dialogo();
    if (!d) return '';
    const pacote = d.tipo === 'java' ? pacoteDe(d.pasta) : null;
    return pacote || this.a.relativa(d.pasta);
  });

  /** O que será criado com o nome digitado até agora. */
  protected readonly plano = computed(() => {
    const d = this.a.dialogo();
    const nome = this.nome().trim();
    const nada = { caminho: '', conteudo: '' as string | null, problema: '' };
    if (!d || !nome) return nada;
    if (d.tipo === 'java') {
      const c = classeJava(nome, pacoteDe(d.pasta));
      if (typeof c === 'string') return { ...nada, problema: c };
      return {
        caminho: juntar(d.pasta, [...c.subpastas, `${c.nome}.java`].join('/')),
        conteudo: conteudoJava(TIPOS_JAVA[this.tipoJava()].tipo, c.nome, c.pacote),
        problema: '',
      };
    }
    const problema = problemaNoNome(nome);
    if (problema) return { ...nada, problema };
    if (d.tipo === 'pasta') {
      // Numa pasta de fontes Java, o ponto também separa pastas (é um pacote).
      return { caminho: juntar(d.pasta, pacoteDe(d.pasta) !== null ? nome.replace(/\./g, '/') : nome), conteudo: null, problema: '' };
    }
    if (d.tipo === 'colar' || d.tipo === 'renomear') return { caminho: juntar(d.pasta, nome), conteudo: '', problema: '' };
    if (d.tipo === 'apagar') return nada;
    const { arquivo, conteudo } = arquivoDoTipo(d.tipo, nome);
    return { caminho: juntar(d.pasta, arquivo), conteudo, problema: '' };
  });

  protected exemplo(): string {
    const t = this.a.dialogo()?.tipo;
    return t === 'java' ? 'ReservaService' : t === 'pasta' ? 'dto' : t === 'angular' ? 'feira-lista' : t === 'arquivo' ? 'limites.yml' : 'nome';
  }

  protected dica(): string {
    const d = this.a.dialogo();
    if (!d) return '';
    if (d.tipo === 'java') return 'com ponto, cria o pacote junto: dto.ReservaRequest';
    if (d.tipo === 'pasta') return '/ cria uma pasta dentro da outra';
    if (d.tipo === 'colar') return 'já existe um com esse nome nesta pasta';
    if (d.tipo === 'renomear') return !d.origem!.pasta && /\.java$/.test(d.origem!.caminho) ? 'numa classe Java, as referências no projeto mudam junto (pelo jdtls)' : '';
    if (d.tipo === 'arquivo') return 'escreva o nome com a extensão · / cria as pastas do caminho';
    return '/ cria as pastas do caminho';
  }

  constructor() {
    effect(() => {
      const d = this.a.dialogo();
      const campo = this.campo();
      const apagar = this.caixaDeApagar();
      untracked(() => {
        if (d?.tipo === 'apagar' && apagar) {
          this.erro.set('');
          setTimeout(() => apagar.nativeElement.focus());
        }
        if (!d || !campo) return;
        this.nome.set(d.sugestao ?? '');
        this.erro.set('');
        this.tipoJava.set(0);
        setTimeout(() => {
          campo.nativeElement.focus();
          // No colar, só o nome (sem a extensão) fica selecionado para trocar.
          const ponto = campo.nativeElement.value.lastIndexOf('.');
          campo.nativeElement.setSelectionRange(0, ponto > 0 ? ponto : campo.nativeElement.value.length);
        });
      });
    });
  }

  protected teclar(e: KeyboardEvent): void {
    const java = this.a.dialogo()?.tipo === 'java';
    const total = TIPOS_JAVA.length;
    if (e.key === 'Escape') this.a.fechar();
    else if (e.key === 'Enter') void this.confirmar_();
    else if (java && e.key === 'ArrowDown') this.tipoJava.set((this.tipoJava() + 1) % total);
    else if (java && e.key === 'ArrowUp') this.tipoJava.set((this.tipoJava() + total - 1) % total);
    else return void e.stopPropagation();
    e.preventDefault();
    e.stopPropagation();
  }

  private ocupado = false;

  protected async confirmar_(): Promise<void> {
    const d = this.a.dialogo();
    if (!d || this.ocupado) return;
    const p = this.plano();
    if (d.tipo !== 'apagar') {
      if (!p.caminho) return this.erro.set(p.problema || 'escreva um nome');
      if (d.tipo === 'renomear' && /[\\/]/.test(this.nome())) return this.erro.set('renomear só muda o nome: não use /');
    }
    this.ocupado = true;
    try {
      const nome = this.nome().trim();
      const falha =
        d.tipo === 'apagar' ? await this.a.apagar(d.origem!)
        : d.tipo === 'renomear' ? await this.a.renomear(d.origem!, nome)
        : d.tipo === 'colar' ? await this.a.colarComo(d.origem!, d.pasta, nome)
        : await this.a.criar(p.caminho, p.conteudo);
      if (falha) this.erro.set(falha);
    } finally {
      this.ocupado = false;
    }
  }
}
