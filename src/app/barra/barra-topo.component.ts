import { Component, inject } from '@angular/core';
import { EditorService } from '../editor/editor.service';
import { ProjetoService } from '../nucleo/projeto.service';
import { AtalhosService } from '../teclado/atalhos.service';
import { LayoutService } from '../layout/layout.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { ponte } from '../nucleo/ponte';
import { BuscaService } from '../busca/busca.service';
import { GitService } from '../git/git.service';
import { MergeService } from '../git/merge.service';
import { CommitService } from '../git/commit.service';

/** Barra de cima: menu, projeto, buffers abertos, ferramentas e controles da janela. */
@Component({
  selector: 'sd-barra-topo',
  template: `
    <header class="barra-topo" data-tauri-drag-region>
      <button class="botao-quadrado destaque grande" aria-label="Menu de atalhos" title="Atalhos (␣)" (click)="atalhos.abrirLider()">{{ '{ }' }}</button>
      <button class="chip-projeto" title="Abrir outro projeto (␣ o)" (click)="projeto.escolher()">
        <span class="forte">{{ projeto.nome() ?? 'abrir projeto' }}</span>
        @if (layout.tela() === 'merge') {
          <span class="suave">merge: {{ merge.deles() || git.estado()?.operacao }} → {{ projeto.branch() }}</span>
        } @else if (projeto.branch()) { <span class="suave">{{ projeto.branch() }}</span> }
      </button>

      @if (layout.tela() === 'editor') {
      <nav class="buffers" aria-label="Buffers abertos" data-tauri-drag-region>
        @for (b of editor.buffers(); track b.caminho; let i = $index) {
          <div class="buffer" [class.ativo]="b.caminho === editor.ativo()">
            <button class="buffer-nome" (click)="editor.ativo.set(b.caminho)">
              {{ i + 1 }} {{ b.nome }}@if (editor.sujo(b)) {<span class="sujo"> ●</span>}
            </button>
            <button class="buffer-fechar" [attr.aria-label]="'Fechar ' + b.nome" (click)="editor.fechar(b.caminho)">×</button>
          </div>
        }
      </nav>
      }

      <div class="espaco" data-tauri-drag-region></div>

      @if (layout.tela() === 'git') {
        <div class="ferramentas git-acoes">
          <button class="botao" title="Atualizar (ctrl+t)" [disabled]="!!git.ocupado()" (click)="git.pull()">↓ pull</button>
          <button class="botao" [class.destaque]="(git.estado()?.aFrente ?? 0) > 0" title="Enviar (ctrl+shift+k)"
                  [disabled]="!!git.ocupado()" (click)="git.push()">↑ push@if (git.estado()?.aFrente) { {{ git.estado()!.aFrente }}}</button>
          <button class="botao" title="Commit (ctrl+k)" (click)="commit.abrir()">commit <kbd>^k</kbd></button>
        </div>
      } @else if (layout.tela() === 'editor') {
      <div class="ferramentas">
        <button class="botao-quadrado" [class.ligado]="busca.aberta()" aria-label="Buscar arquivo" title="Buscar arquivo (ctrl+p) · no projeto: ctrl+shift+f" (click)="busca.abrir('arquivos')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>
        </button>
        <button class="botao-quadrado" [class.ligado]="layout.tela() === 'git'" aria-label="Git" title="Git (␣ g)" (click)="layout.tela.set('git')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="6" cy="5" r="2.5"></circle><circle cx="6" cy="19" r="2.5"></circle><circle cx="18" cy="8" r="2.5"></circle><path d="M6 7.5v9M18 10.5v1a4 4 0 0 1-4 4H8.5"></path></svg>
        </button>
        <button class="botao-quadrado" aria-label="Banco de dados (em breve)" title="Banco — em breve" (click)="emBreve('banco')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="3"></ellipse><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"></path></svg>
        </button>
        <button class="botao-quadrado" aria-label="Servidor (em breve)" title="Servidor (JBoss/Tomcat) — em breve" (click)="emBreve('servidor')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="4" width="16" height="7" rx="2"></rect><rect x="4" y="13" width="16" height="7" rx="2"></rect><path d="M8 7.5h.01M8 16.5h.01"></path></svg>
        </button>
        <button class="botao-quadrado" [class.ligado]="layout.disposicao().visiveis.terminal" aria-label="Terminal" title="Terminal (alt f12)" (click)="layout.alternar('terminal')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7l5 5-5 5M12 18h7"></path></svg>
        </button>
        <button class="botao-quadrado destaque-texto" aria-label="IA (em breve)" title="IA — em breve" (click)="emBreve('IA')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"></path></svg>
        </button>
      </div>

      }
      <div class="janela">
        <button aria-label="Minimizar" (click)="janela.minimizar()">–</button>
        <button aria-label="Maximizar" (click)="janela.maximizar()">□</button>
        <button aria-label="Fechar" (click)="janela.fechar()">×</button>
      </div>
    </header>
  `,
})
export class BarraTopoComponent {
  protected readonly editor = inject(EditorService);
  protected readonly projeto = inject(ProjetoService);
  protected readonly atalhos = inject(AtalhosService);
  protected readonly layout = inject(LayoutService);
  protected readonly busca = inject(BuscaService);
  protected readonly git = inject(GitService);
  protected readonly merge = inject(MergeService);
  protected readonly commit = inject(CommitService);
  private readonly mensagens = inject(MensagensService);
  protected readonly janela = ponte.janela;

  protected emBreve(o: string): void {
    this.mensagens.mostrar(`${o}: em breve`);
  }
}
