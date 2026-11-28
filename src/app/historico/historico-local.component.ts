import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { EditorService } from '../editor/editor.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { ponte, VersaoLocal } from '../nucleo/ponte';
import { ProjetoService } from '../nucleo/projeto.service';
import { ComparacaoComponent } from './comparacao.component';
import { HistoricoService } from './historico.service';

interface Item {
  versao: VersaoLocal;
  /** Título do dia, na primeira versão dele. */
  dia: string | null;
  hora: string;
}

/**
 * Histórico local (mockup 47). Teclado: j/k escolhem a versão, ]c / [c andam nas mudanças,
 * ⏎ volta o arquivo para ela, t restaura só o trecho, p alterna este arquivo / projeto todo, esc sai.
 */
@Component({
  selector: 'sd-historico-local',
  imports: [ComparacaoComponent],
  template: `
    <section class="painel historico" aria-label="Histórico local">
      <div class="painel-faixa">
        <span class="rotulo">HISTÓRICO LOCAL</span>
        @if (arquivo(); as a) { <span>{{ nome(a) }}</span><span class="suave">{{ pasta(a) }}</span> }
        @else { <span class="suave">projeto todo</span> }
        <span class="espaco"></span>
        <span class="mdv-modos" role="group" aria-label="O que listar">
          <button [class.sel]="!projetoTodo()" [attr.aria-pressed]="!projetoTodo()" [disabled]="!historico.alvo()" (click)="projetoTodo.set(false)">este arquivo</button>
          <button [class.sel]="projetoTodo()" [attr.aria-pressed]="projetoTodo()" (click)="projetoTodo.set(true)">projeto todo</button>
        </span>
        <kbd>Alt+Shift+Z</kbd><kbd>esc</kbd>
      </div>
      <div class="historico-corpo">
        <div class="historico-lado">
          <div #lista class="historico-lista" role="listbox" tabindex="0" (keydown)="teclar($event)">
            @for (i of itens(); track i.versao.hash + i.versao.quando; let n = $index) {
              @if (i.dia) { <div class="historico-dia rotulo">{{ i.dia }}</div> }
              <div class="historico-item" role="option" [class.sel]="n === indice()" [attr.aria-selected]="n === indice()" (click)="indice.set(n)">
                <span class="quando suave">{{ i.hora }}</span>
                <span class="texto">{{ i.versao.motivo }}<small class="suave">{{ projetoTodo() ? i.versao.caminho : tamanhoDe(i.versao) }}</small></span>
                <span class="contas">
                  @if (i.versao.mais || i.versao.menos) { <span class="git-mais">+{{ i.versao.mais }}</span> <span class="git-menos">−{{ i.versao.menos }}</span> }
                </span>
              </div>
            } @empty {
              <p class="suave historico-vazio">{{ carregando() ? 'lendo…' : 'Nenhuma versão guardada ainda. O Seedy guarda ao salvar e antes de operações que mexem no arquivo.' }}</p>
            }
          </div>
          <div class="historico-nota suave">guardado por 7 dias, fora do projeto e fora do Git</div>
        </div>
        <div class="historico-diff">
          @if (conteudos(); as c) {
            <div class="historico-lados suave">
              <span><span class="git-menos">−</span> {{ rotuloDaVersao() }}</span>
              <span><span class="git-mais">+</span> {{ c.apagado ? 'o arquivo não existe mais' : 'como está agora' }}</span>
            </div>
            <sd-comparacao [antes]="c.antes" [depois]="c.depois" [caminho]="c.caminho" />
          } @else {
            <p class="suave historico-vazio">Escolha uma versão.</p>
          }
          <div class="historico-pe suave">
            <span><span class="destaque-texto">j k</span> versões</span><span><span class="destaque-texto">]c [c</span> mudanças</span>
            <span class="espaco"></span>
            <button class="botao" [disabled]="!conteudos() || conteudos()!.apagado" (click)="restaurarTrecho()">restaurar só este trecho <kbd>t</kbd></button>
            <button class="botao destaque" [disabled]="!conteudos()" (click)="restaurar()">
              {{ conteudos()?.apagado ? 'recriar o arquivo' : 'voltar o arquivo para ' + horaAtual() }} <kbd>⏎</kbd>
            </button>
          </div>
        </div>
      </div>
    </section>
  `,
})
export class HistoricoLocalComponent {
  protected readonly historico = inject(HistoricoService);
  private readonly editor = inject(EditorService);
  private readonly projeto = inject(ProjetoService);
  private readonly mensagens = inject(MensagensService);
  private readonly lista = viewChild.required<ElementRef<HTMLDivElement>>('lista');
  private readonly comparacao = viewChild(ComparacaoComponent);

  protected readonly projetoTodo = signal(false);
  private readonly versoes = signal<VersaoLocal[]>([]);
  protected readonly carregando = signal(true);
  protected readonly indice = signal(0);
  private readonly recarregar = signal(0);
  protected readonly conteudos = signal<{ antes: string; depois: string; caminho: string; apagado: boolean } | null>(null);
  private teclaAnterior = '';

  /** Caminho relativo do arquivo olhado (null no projeto todo). */
  protected readonly arquivo = computed(() => (this.projetoTodo() ? null : this.relativo(this.historico.alvo()?.caminho)));

  protected readonly itens = computed<Item[]>(() => {
    let diaAnterior = '';
    return this.versoes().map((versao) => {
      const quando = new Date(versao.quando);
      const dia = rotuloDoDia(quando);
      const item = { versao, dia: dia === diaAnterior ? null : dia, hora: quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) };
      diaAnterior = dia;
      return item;
    });
  });

  constructor() {
    this.projetoTodo.set(!this.historico.alvo());
    // A lista: ao abrir, ao trocar o que se lista e depois de restaurar.
    effect((aoLimpar) => {
      const raiz = this.projeto.raiz();
      const caminho = this.projetoTodo() ? null : (this.historico.alvo()?.caminho ?? null);
      this.recarregar();
      let valido = true;
      aoLimpar(() => (valido = false));
      if (!raiz) return;
      untracked(() => this.carregando.set(true));
      void this.historico.gravado().then(() => ponte.historico.listar(raiz, caminho)).then((lista) => {
        if (!valido) return;
        this.versoes.set(lista);
        this.indice.set(0);
        this.carregando.set(false);
        setTimeout(() => this.lista().nativeElement.focus());
      });
    });
    // O conteúdo da versão escolhida, contra o que está agora.
    effect((aoLimpar) => {
      const v = this.itens()[this.indice()]?.versao;
      const raiz = this.projeto.raiz();
      let valido = true;
      aoLimpar(() => (valido = false));
      if (!v || !raiz) return void this.conteudos.set(null);
      untracked(() => void this.ler(raiz, v).then((c) => valido && this.conteudos.set(c)));
    });
  }

  private async ler(raiz: string, v: VersaoLocal) {
    const caminho = this.absoluto(v.caminho);
    const antes = await ponte.historico.ler(raiz, v.hash).catch(() => '');
    const buffer = this.editor.bufferDe(caminho);
    const agora = buffer ? buffer.modelo.getValue() : await ponte.lerArquivo(caminho).catch(() => null);
    // Compara sem o \r, para o fim de linha não marcar o arquivo inteiro.
    const semCr = (t: string) => t.replace(/\r\n/g, '\n');
    return { antes: semCr(antes), depois: semCr(agora ?? ''), caminho, apagado: agora === null };
  }

  protected nome(rel: string): string {
    return rel.slice(rel.lastIndexOf('/') + 1);
  }

  protected pasta(rel: string): string {
    return rel.slice(0, Math.max(0, rel.lastIndexOf('/')));
  }

  protected tamanhoDe(v: VersaoLocal): string {
    return v.tamanho < 1024 ? `${v.tamanho} bytes` : `${(v.tamanho / 1024).toFixed(1).replace('.', ',')} KB`;
  }

  protected horaAtual(): string {
    return this.itens()[this.indice()]?.hora ?? '';
  }

  protected rotuloDaVersao(): string {
    const v = this.itens()[this.indice()]?.versao;
    return v ? `${rotuloDoDia(new Date(v.quando)).toLowerCase()}, ${this.horaAtual()} · ${v.motivo}` : '';
  }

  protected async restaurar(): Promise<void> {
    const c = this.conteudos();
    if (!c) return;
    await this.aplicar(c.caminho, c.antes, c.apagado, 'arquivo restaurado');
  }

  protected async restaurarTrecho(): Promise<void> {
    const c = this.conteudos();
    if (!c || c.apagado) return;
    const novo = this.comparacao()?.semAMudancaAtual();
    if (novo === null || novo === undefined) return this.mensagens.mostrar('não há diferença para restaurar');
    await this.aplicar(c.caminho, novo, false, 'trecho restaurado');
  }

  /** Grava pelo editor (o desfazer continua valendo) e guarda antes o que estava lá. */
  private async aplicar(caminho: string, texto: string, apagado: boolean, aviso: string): Promise<void> {
    try {
      if (apagado) {
        await ponte.gravarArquivo(caminho, texto);
        this.projeto.recarregar();
      }
      const buffer = await this.editor.abrir(caminho, undefined, undefined, false);
      if (!buffer) return;
      if (!apagado) {
        await this.historico.guardar(caminho, 'antes de restaurar', buffer.modelo.getValue());
        const m = buffer.modelo;
        m.pushEditOperations([], [{ range: m.getFullModelRange(), text: texto.replace(/\n/g, m.getEOL()) }], () => null);
        await this.editor.salvar(buffer.caminho, false);
      }
      this.mensagens.mostrar(`${this.nome(this.relativo(caminho) ?? caminho)}: ${aviso}`);
      this.recarregar.update((n) => n + 1);
    } catch (e) {
      this.mensagens.erro(String(e));
    }
  }

  private relativo(caminho: string | undefined): string | null {
    const raiz = this.projeto.raiz();
    if (!raiz || !caminho) return null;
    return caminho.slice(raiz.length).split(/[\\/]/).filter(Boolean).join('/');
  }

  private absoluto(rel: string): string {
    const raiz = this.projeto.raiz() ?? '';
    const sep = raiz.includes('\\') ? '\\' : '/';
    return [raiz.replace(/[\\/]+$/, ''), ...rel.split('/')].join(sep);
  }

  protected teclar(e: KeyboardEvent): void {
    if (e.ctrlKey || e.altKey || e.metaKey || e.key === 'Shift') return;
    const combo = this.teclaAnterior + e.key;
    this.teclaAnterior = '';
    const n = this.itens().length;
    const mover = (d: number) => {
      this.indice.set(Math.max(0, Math.min(n - 1, this.indice() + d)));
      setTimeout(() => this.lista().nativeElement.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }));
    };
    if (e.key === 'j' || e.key === 'ArrowDown') mover(1);
    else if (e.key === 'k' || e.key === 'ArrowUp') mover(-1);
    else if (combo === ']c') this.comparacao()?.mudanca(1);
    else if (combo === '[c') this.comparacao()?.mudanca(-1);
    else if (e.key === ']' || e.key === '[') this.teclaAnterior = e.key;
    else if (e.key === 'Enter') void this.restaurar();
    else if (e.key === 't') void this.restaurarTrecho();
    else if (e.key === 'p' && this.historico.alvo()) this.projetoTodo.update((v) => !v);
    else if (e.key === 'Escape') this.historico.fechar();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
}

function rotuloDoDia(d: Date): string {
  const hoje = new Date();
  const dias = Math.round((new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  return dias === 0 ? 'HOJE' : dias === 1 ? 'ONTEM' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
