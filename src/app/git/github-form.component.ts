import { Component, effect, ElementRef, inject, viewChild } from '@angular/core';
import { GithubFormService } from './github-form.service';
import { GithubService } from './github.service';

/** Janela de criar pull request / issue (␣ P / ␣ I), no visual da janela de commit. */
@Component({
  selector: 'sd-github-form',
  template: `
    @if (f.aberta()) {
      <div class="busca github-janela" role="dialog" [attr.aria-label]="ehPr() ? 'Criar pull request' : 'Criar issue'" (keydown)="teclar($event)">
        <div class="painel-faixa">
          <span class="rotulo">{{ ehPr() ? 'PULL REQUEST' : 'ISSUE' }} · {{ f.repo()?.dono }}/{{ f.repo()?.nome }}</span>
          @if (github.usuario(); as u) { <span class="suave contagem">&#64;{{ u.login }}</span> }
        </div>
        <div class="github-corpo">
          @if (ehPr()) {
            <div class="github-linha">
              <span class="git-ref" data-tipo="local">{{ f.cabeca() }}</span>
              <span class="suave">→</span>
              <label class="github-base">
                <span class="suave">base</span>
                <select aria-label="Branch base" [value]="f.base()" (change)="f.base.set($any($event.target).value)">
                  @for (b of f.bases(); track b) { <option [value]="b" [selected]="b === f.base()">{{ b }}</option> }
                </select>
              </label>
            </div>
          }
          <input #campoTitulo class="github-titulo" type="text" spellcheck="false" aria-label="Título"
                 placeholder="título" [value]="f.titulo()" (input)="f.titulo.set($any($event.target).value)" />
          <textarea class="commit-mensagem github-descricao" spellcheck="false" aria-label="Descrição"
                    placeholder="descrição (markdown)" [value]="f.corpo()" (input)="f.corpo.set($any($event.target).value)"></textarea>
          <div class="github-opcoes">
            @if (ehPr()) {
              <label class="commit-opcao" title="alt+r">
                <input type="checkbox" [checked]="f.rascunho()" (change)="f.rascunho.set(!f.rascunho())" /> rascunho (draft)
              </label>
            } @else {
              <label class="commit-opcao" title="alt+m">
                <input type="checkbox" [checked]="f.paraMim()" (change)="f.paraMim.set(!f.paraMim())" /> atribuir a mim
              </label>
            }
            <label class="commit-opcao" title="alt+n">
              <input type="checkbox" [checked]="f.abrirDepois()" (change)="f.abrirDepois.set(!f.abrirDepois())" /> abrir no navegador depois
            </label>
            <span class="espaco"></span>
            <button class="botao destaque" [disabled]="f.enviando()" (click)="f.enviar()">
              {{ f.enviando() ? 'criando…' : ehPr() ? 'criar pull request' : 'criar issue' }} <kbd>ctrl ⏎</kbd>
            </button>
          </div>
        </div>
        <div class="busca-dicas">
          <span><span class="tecla">tab</span> campos</span>
          @if (ehPr()) {
            <span><span class="tecla">alt b</span> base</span>
            <span><span class="tecla">alt r</span> rascunho</span>
          } @else {
            <span><span class="tecla">alt m</span> atribuir a mim</span>
          }
          <span><span class="tecla">alt n</span> abrir depois</span>
          <span><span class="tecla">ctrl ⏎</span> criar</span>
          <span><span class="tecla">esc</span> fechar</span>
        </div>
      </div>
    }
  `,
})
export class GithubFormComponent {
  protected readonly f = inject(GithubFormService);
  protected readonly github = inject(GithubService);
  private readonly campoTitulo = viewChild<ElementRef<HTMLInputElement>>('campoTitulo');

  protected ehPr(): boolean {
    return this.f.tipo() === 'pr';
  }

  constructor() {
    effect(() => {
      if (!this.f.aberta()) return;
      queueMicrotask(() => {
        const c = this.campoTitulo()?.nativeElement;
        c?.focus();
        c?.select();
      });
    });
  }

  protected teclar(e: KeyboardEvent): void {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') this.f.fechar();
    else if (e.key === 'Enter' && ctrl) void this.f.enviar();
    else if (e.altKey && e.code === 'KeyN') this.f.abrirDepois.update((v) => !v);
    else if (e.altKey && e.code === 'KeyR' && this.ehPr()) this.f.rascunho.update((v) => !v);
    else if (e.altKey && e.code === 'KeyM' && !this.ehPr()) this.f.paraMim.update((v) => !v);
    else if (e.altKey && e.code === 'KeyB' && this.ehPr()) this.proximaBase(e.shiftKey ? -1 : 1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  /** alt+b / alt+shift+b: passa pelas bases sem tirar o foco do texto. */
  private proximaBase(passo: number): void {
    const bases = this.f.bases();
    if (!bases.length) return;
    const i = bases.indexOf(this.f.base());
    this.f.base.set(bases[(i + passo + bases.length) % bases.length]);
  }
}
