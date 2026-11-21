import { Component, inject } from '@angular/core';
import { EditorService } from '../editor/editor.service';
import { ProjetoService } from '../nucleo/projeto.service';
import { AtalhosService } from '../teclado/atalhos.service';
import { LayoutService } from '../layout/layout.service';
import { ponte } from '../nucleo/ponte';
import { GitService } from '../git/git.service';
import { MergeService } from '../git/merge.service';
import { CommitService } from '../git/commit.service';
import { ExecucaoService } from '../execucao/execucao.service';
import { CAMINHO_DO_LOGO } from '../marca/logo';
import { DockerService } from '../containers/docker.service';

/**
 * Barra de cima: menu, projeto, buffers abertos, RUN/DEBUG, ações da tela atual e controles
 * da janela. Os botões que abrem janelas e painéis ficam na barra de ícones à esquerda.
 */
@Component({
  selector: 'sd-barra-topo',
  template: `
    <header class="barra-topo" data-tauri-drag-region>
      <button class="botao-quadrado destaque grande logo" aria-label="Menu de atalhos" title="Atalhos (␣)" (click)="atalhos.abrirLider()">
        <svg width="28" height="28" viewBox="0 0 100 100" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" [attr.d]="logo"></path></svg>
      </button>
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
          <button class="botao" title="Voltar ao editor (esc)" (click)="voltarAoEditor()">← editor <kbd>esc</kbd></button>
          <button class="botao" title="Atualizar (ctrl+t)" [disabled]="!!git.ocupado()" (click)="git.pull()">↓ pull</button>
          <button class="botao" [class.destaque]="(git.estado()?.aFrente ?? 0) > 0" title="Enviar (ctrl+shift+k)"
                  [disabled]="!!git.ocupado()" (click)="git.push()">↑ push@if (git.estado()?.aFrente) { {{ git.estado()!.aFrente }}}</button>
          <button class="botao" title="Commit (ctrl+k)" (click)="commit.abrir()">commit <kbd>^k</kbd></button>
        </div>
      }
      @if (layout.tela() === 'containers') {
        <div class="ferramentas git-acoes">
          <button class="botao" title="docker compose up -d (u)" (click)="docker.compose('up')">▲ compose up <kbd>u</kbd></button>
          <button class="botao" title="docker compose down" (click)="docker.composeDown()">▼ down</button>
          <button class="botao" title="atualizar (r)" (click)="docker.atualizar(true)">↻ <kbd>r</kbd></button>
        </div>
      }
      @if (layout.tela() === 'editor' || layout.tela() === 'debug') {
        <!-- Configuração de execução + RUN / DEBUG; rodando, o botão pressionado vira o de parar (mockup 11). -->
        <div class="ferramentas execucao">
          <button class="botao execucao-config" title="o que o RUN/DEBUG roda (␣ r)" (click)="exec.escolherConfig()">
            @if (exec.atual()?.tipo === 'script') {
              <span class="destaque-texto forte">{{ '{}' }}</span>
            } @else if (exec.atual()?.tipo === 'main') {
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6l-5 6 5 6M16 6l5 6-5 6"></path></svg>
            } @else {
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="4" width="16" height="7" rx="2"></rect><rect x="4" y="13" width="16" height="7" rx="2"></rect><path d="M8 7.5h.01M8 16.5h.01"></path></svg>
            }
            <span>{{ exec.atual()?.nome ?? (exec.procurando() ? 'procurando…' : 'nada para rodar') }}</span>
            <span class="suave">▾</span>
          </button>
          @if (exec.rodando() && !exec.depurando()) {
            <!-- Rodando: o botão de rodar vira o de parar (como no IntelliJ). -->
            <button class="botao-quadrado parar" aria-label="Parar" title="Parar (ctrl+F2)" (click)="exec.parar()">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"></rect></svg>
            </button>
          } @else {
            <button class="botao-quadrado rodar" [disabled]="exec.rodando()" aria-label="Rodar" title="Rodar (shift+F10)" (click)="exec.rodar(false)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z"></path></svg>
            </button>
          }
          @if (exec.rodando() && exec.depurando()) {
            <!-- Depurando: o botão de depurar vira o de parar (a tela de debug: ␣ x). -->
            <button class="botao-quadrado parar" aria-label="Parar" title="Parar (ctrl+F2) · tela de debug: ␣ x" (click)="exec.parar()">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"></rect></svg>
            </button>
          } @else {
            <button class="botao-quadrado depurar" [disabled]="exec.rodando()" [class.ativo]="layout.tela() === 'debug'" aria-label="Depurar" title="Depurar (shift+F9) · tela de debug: ␣ x" (click)="depurar()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="7" y="7" width="10" height="13" rx="5"></rect><path d="M12 7V4M9 4.5l1.5 2.5M15 4.5l-1.5 2.5M7 12H3.5M20.5 12H17M7 16.5l-3 2M17 16.5l3 2M12 11v9"></path></svg>
            </button>
          }
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
  protected readonly git = inject(GitService);
  protected readonly merge = inject(MergeService);
  protected readonly commit = inject(CommitService);
  protected readonly janela = ponte.janela;
  protected readonly logo = CAMINHO_DO_LOGO;
  protected readonly docker = inject(DockerService);
  protected readonly exec = inject(ExecucaoService);

  /** DEBUG: já depurando, só mostra a tela de debug; senão, sobe em debug. */
  protected depurar(): void {
    if (this.exec.depurando()) this.layout.tela.set('debug');
    else void this.exec.rodar(true);
  }

  protected voltarAoEditor(): void {
    this.layout.tela.set('editor');
    queueMicrotask(() => this.editor.focar());
  }
}
