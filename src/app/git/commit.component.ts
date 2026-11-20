import { Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { CommitService } from './commit.service';
import { ArquivoAlterado, GitService } from './git.service';
import { LinhaDeDiff, lerDiffUnificado } from './diff';
import { ponte } from '../nucleo/ponte';
import { EscolhaService } from '../escolha/escolha.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { PrateleiraService } from './prateleira.service';

/**
 * Commit (Ctrl+K): arquivos alterados com marca (entram no commit), mensagem e
 * a prévia do diff do arquivo selecionado.
 */
@Component({
  selector: 'sd-commit',
  template: `
    @if (servico.aberta()) {
      <div class="busca commit-janela" role="dialog" aria-label="Commit" (keydown)="teclar($event)">
        <div class="painel-faixa">
          <span class="rotulo">COMMIT · {{ git.estado()?.branch ?? 'HEAD destacado' }}</span>
          <span class="suave contagem">{{ incluidos().size }} de {{ arquivos().length }} {{ arquivos().length === 1 ? 'arquivo' : 'arquivos' }}</span>
        </div>
        <div class="commit-corpo">
          <ul #lista class="busca-resultados commit-arquivos" tabindex="0" role="listbox" aria-label="Arquivos alterados" aria-multiselectable="true"
              (keydown)="teclarLista($event)">
            @for (a of arquivos(); track a.relativo; let i = $index) {
              <li class="busca-item" role="option" [id]="'commit-arq-' + i" [class.selecionado]="i === sel()"
                  [attr.aria-selected]="incluidos().has(a.relativo)" (click)="sel.set(i)">
                <span class="marca-escolha" [class.marcada]="incluidos().has(a.relativo)" (click)="alternar(a); $event.stopPropagation()">
                  {{ incluidos().has(a.relativo) ? '✓' : '' }}
                </span>
                <span class="git-letra" [attr.data-letra]="a.letra">{{ a.letra === '?' ? 'U' : a.letra }}</span>
                <span class="busca-rotulo">{{ nome(a.relativo) }}</span>
                <span class="espaco"></span>
                <span class="suave busca-detalhe">{{ pasta(a.relativo) }}</span>
              </li>
            }
          </ul>
          <div class="commit-direita">
            <textarea #mensagem class="commit-mensagem" spellcheck="false" aria-label="Mensagem do commit"
                      placeholder="mensagem do commit (a 1ª linha é o resumo)"
                      [value]="texto()" (input)="texto.set($any($event.target).value)"></textarea>
            <label class="commit-opcao" title="alt+e">
              <input type="checkbox" [checked]="emendar()" (change)="alternarEmenda()" /> emendar o último commit
            </label>
            <div class="git-diff commit-diff">
              @for (l of diff(); track $index) {
                <div class="git-diff-linha" [attr.data-tipo]="l.tipo">
                  <span class="git-diff-sinal">{{ l.tipo === 'mais' ? '+' : l.tipo === 'menos' ? '−' : '' }}</span><span>{{ l.texto }}</span>
                </div>
              } @empty {
                <div class="suave">sem diferenças de texto</div>
              }
            </div>
          </div>
        </div>
        <div class="busca-dicas">
          <span><span class="tecla">↑↓</span> navegar</span>
          <span><span class="tecla">espaço</span> marcar</span>
          <span><span class="tecla">tab</span> mensagem</span>
          <span><span class="tecla">ctrl ⏎</span> commit</span>
          <span><span class="tecla">ctrl alt ⏎</span> e push</span>
          <span><span class="tecla">alt s</span> prateleira</span>
          <span><span class="tecla">alt d</span> descartar</span>
          <span><span class="tecla">esc</span> fechar</span>
        </div>
      </div>
    }
  `,
})
export class CommitComponent {
  protected readonly servico = inject(CommitService);
  protected readonly git = inject(GitService);
  private readonly escolha = inject(EscolhaService);
  private readonly mensagens = inject(MensagensService);
  private readonly prateleira = inject(PrateleiraService);
  private readonly lista = viewChild<ElementRef<HTMLElement>>('lista');
  private readonly campoMensagem = viewChild<ElementRef<HTMLTextAreaElement>>('mensagem');

  protected readonly arquivos = computed(() => this.git.alterados().filter((a) => a.letra !== 'C'));
  protected readonly incluidos = signal(new Set<string>());
  protected readonly sel = signal(0);
  protected readonly texto = signal('');
  protected readonly emendar = signal(false);
  protected readonly diff = signal<LinhaDeDiff[]>([]);
  private mensagemAntesDaEmenda = '';

  constructor() {
    // Ao abrir: todos os arquivos marcados, foco na mensagem.
    effect(() => {
      if (!this.servico.aberta()) return;
      this.incluidos.set(new Set(this.git.alterados().filter((a) => a.letra !== 'C').map((a) => a.relativo)));
      this.sel.set(0);
      this.emendar.set(false);
      queueMicrotask(() => this.campoMensagem()?.nativeElement.focus());
    });

    // Prévia do diff do arquivo selecionado (contra o HEAD).
    effect((aoLimpar) => {
      const a = this.arquivos()[this.sel()];
      let valido = true;
      aoLimpar(() => (valido = false));
      if (!a || !this.servico.aberta()) {
        this.diff.set([]);
        return;
      }
      void this.diffDe(a).then((d) => valido && this.diff.set(d.slice(0, 400)));
    });
  }

  protected nome(rel: string): string {
    return rel.split('/').pop() ?? rel;
  }

  protected pasta(rel: string): string {
    return rel.split('/').slice(0, -1).slice(-2).join('/');
  }

  protected alternar(a: ArquivoAlterado): void {
    const s = new Set(this.incluidos());
    if (s.has(a.relativo)) s.delete(a.relativo);
    else s.add(a.relativo);
    this.incluidos.set(s);
  }

  protected async alternarEmenda(): Promise<void> {
    const ligar = !this.emendar();
    this.emendar.set(ligar);
    if (ligar) {
      // Emendar: a mensagem do último commit vem para editar.
      this.mensagemAntesDaEmenda = this.texto();
      const ultima = await this.git.rodar(['log', '-1', '--format=%B']).catch(() => '');
      if (!this.texto().trim()) this.texto.set(ultima.trim());
    } else if (this.mensagemAntesDaEmenda !== undefined) {
      this.texto.set(this.mensagemAntesDaEmenda);
    }
  }

  protected teclar(e: KeyboardEvent): void {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      this.servico.fechar();
    } else if (e.key === 'Enter' && ctrl) {
      void this.commitar(e.altKey);
    } else if (e.altKey && e.code === 'KeyE') {
      void this.alternarEmenda();
    } else if (e.altKey && e.code === 'KeyD') {
      void this.descartar();
    } else if (e.altKey && e.code === 'KeyS') {
      void this.guardarNaPrateleira();
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  protected teclarLista(e: KeyboardEvent): void {
    const n = this.arquivos().length;
    if (e.key === 'ArrowDown' || e.key === 'j') this.sel.set(Math.min(n - 1, this.sel() + 1));
    else if (e.key === 'ArrowUp' || e.key === 'k') this.sel.set(Math.max(0, this.sel() - 1));
    else if (e.key === ' ') {
      const a = this.arquivos()[this.sel()];
      if (a) this.alternar(a);
    } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
      const todos = this.incluidos().size === n;
      this.incluidos.set(new Set(todos ? [] : this.arquivos().map((a) => a.relativo)));
    } else return;
    e.preventDefault();
    e.stopPropagation();
    queueMicrotask(() => document.getElementById('commit-arq-' + this.sel())?.scrollIntoView({ block: 'nearest' }));
  }

  private async commitar(eEnviar: boolean): Promise<void> {
    const msg = this.texto().trim();
    const arquivos = [...this.incluidos()];
    if (!msg) {
      this.mensagens.erro('escreva a mensagem do commit');
      this.campoMensagem()?.nativeElement.focus();
      return;
    }
    if (!arquivos.length && !this.emendar()) {
      this.mensagens.erro('marque ao menos um arquivo');
      return;
    }
    // Arquivo apagado entra pelo caminho antigo também (renomeado).
    const comOrigens = [...arquivos, ...this.arquivos().filter((a) => a.de && this.incluidos().has(a.relativo)).map((a) => a.de!)];
    const ok = await this.git.commit(comOrigens, msg, this.emendar());
    if (!ok) return;
    this.texto.set('');
    this.servico.fechar();
    if (eEnviar) await this.git.push();
  }

  /** alt+s: guarda os arquivos marcados na prateleira (o shelf do IntelliJ). */
  private async guardarNaPrateleira(): Promise<void> {
    const arquivos = [...this.incluidos()];
    if (!arquivos.length) {
      this.mensagens.erro('marque ao menos um arquivo');
      return;
    }
    const sugestao = this.texto().trim().split(/\r?\n/)[0] || `mudanças em ${this.git.estado()?.branch ?? 'HEAD'}`;
    const nome = await this.escolha.perguntar('GUARDAR NA PRATELEIRA', {
      valor: sugestao,
      dica: `${arquivos.length} ${arquivos.length === 1 ? 'arquivo sai da árvore de trabalho e fica guardado' : 'arquivos saem da árvore de trabalho e ficam guardados'}`,
    });
    if (!nome) return;
    const ok = await this.prateleira.guardar(nome, arquivos);
    if (ok && !this.arquivos().length) this.servico.fechar();
  }

  private async descartar(): Promise<void> {
    const a = this.arquivos()[this.sel()];
    if (!a) return;
    const sim = await this.escolha.escolherUm(`DESCARTAR ${this.nome(a.relativo).toUpperCase()}?`, [
      { rotulo: 'Descartar', detalhe: a.letra === '?' ? 'apaga o arquivo novo' : 'volta ao que está no último commit', valor: true },
      { rotulo: 'Cancelar', valor: false },
    ]);
    if (!sim) return;
    await this.git.descartar(a.letra === '?' ? [] : [a.relativo], a.letra === '?' ? [a.relativo] : []);
    if (!this.git.alterados().length) this.servico.fechar();
  }

  private async diffDe(a: ArquivoAlterado): Promise<LinhaDeDiff[]> {
    if (a.letra === '?') {
      // Arquivo novo, ainda fora do git: tudo é "+".
      const conteudo = await ponte.lerArquivo(a.caminho).catch(() => '');
      return conteudo.split(/\r?\n/).map((texto, i) => ({ tipo: 'mais' as const, texto, novo: i + 1 }));
    }
    const t = await this.git.rodar(['diff', 'HEAD', '-M', '--', ...(a.de ? [a.de] : []), a.relativo]).catch(() => '');
    return lerDiffUnificado(t);
  }
}
