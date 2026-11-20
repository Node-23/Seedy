import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { BancoService, NOME_DO_AMBIENTE } from './banco.service';
import { LayoutService } from '../layout/layout.service';
import { EditorService } from '../editor/editor.service';
import { monaco } from '../editor/monaco';
import { PerfilBanco } from '../nucleo/ponte';

type No =
  | { tipo: 'perfil'; chave: string; nivel: number; perfil: PerfilBanco }
  | { tipo: 'banco'; chave: string; nivel: number; perfil: PerfilBanco }
  | { tipo: 'schema'; chave: string; nivel: number; perfil: PerfilBanco; schema: string }
  | { tipo: 'grupo'; chave: string; nivel: number; perfil: PerfilBanco; schema: string; grupo: 'tabelas' | 'views' | 'funcoes'; total: number }
  | { tipo: 'objeto'; chave: string; nivel: number; perfil: PerfilBanco; schema: string; grupo: 'tabelas' | 'views' | 'funcoes'; nome: string }
  | { tipo: 'coluna'; chave: string; nivel: number; perfil: PerfilBanco; nome: string; detalhe: string };

const ROTULO_DO_GRUPO = { tabelas: 'tabelas', views: 'views', funcoes: 'funções' };

/**
 * Conexões (mockup 03): perfis salvos e, conectado, a árvore do banco. Teclado:
 * j/k anda, l/⏎ abre (conecta), h fecha, ⏎ numa tabela consulta as primeiras linhas,
 * n nova conexão, e editar, x desconectar, r recarregar, del apagar.
 */
@Component({
  selector: 'sd-conexoes',
  template: `
    <section class="painel arvore conexoes" aria-label="Conexões">
      <div class="painel-faixa">
        <span class="rotulo">CONEXÕES</span>
        <kbd>␣ d</kbd>
      </div>
      <div #lista class="arvore-lista" role="tree" tabindex="0" (keydown)="teclar($event)"
           [attr.aria-activedescendant]="'con-' + selecionado()">
        @for (no of nos(); track no.chave; let i = $index) {
          <div class="arvore-item conexao-item" role="treeitem" [id]="'con-' + i"
               [attr.data-tipo]="no.tipo"
               [attr.data-ambiente]="no.tipo === 'perfil' ? no.perfil.ambiente : null"
               [attr.aria-expanded]="expansivel(no) ? abertos().has(no.chave) : null"
               [class.selecionado]="i === selecionado()"
               [class.ativo]="i === selecionado() && focado()"
               [style.padding-left.px]="12 + no.nivel * 14"
               (click)="selecionado.set(i); ativar(no)">
            @if (expansivel(no)) { <span class="seta">{{ abertos().has(no.chave) ? '▾' : '▸' }}</span> } @else { <span class="seta"></span> }
            @switch (no.tipo) {
              @case ('perfil') {
                <span class="bolinha-ambiente" [class.conectada]="banco.conectado(no.perfil.id)" aria-hidden="true">●</span>
                <span class="nome">{{ no.perfil.nome }}</span>
                @if (banco.conectando() === no.perfil.id) { <span class="suave">…</span> }
                @else if (no.perfil.ssh) { <span class="detalhe-conexao">🔒 ssh</span> }
                @else { <span class="detalhe-conexao suave">{{ no.perfil.host }}</span> }
              }
              @case ('grupo') { <span class="nome">{{ rotuloDoGrupo(no.grupo) }}</span><span class="suave">{{ no.total }}</span> }
              @case ('coluna') { <span class="nome">{{ no.nome }}</span><span class="suave detalhe-conexao">{{ no.detalhe }}</span> }
              @case ('banco') { <span class="nome">{{ no.perfil.banco || no.perfil.usuario }}</span> }
              @case ('schema') { <span class="nome">{{ no.schema }}</span> }
              @case ('objeto') { <span class="nome">{{ no.nome }}</span> }
            }
          </div>
        } @empty {
          <p class="suave arvore-vazia">Nenhuma conexão ainda.<br /><button class="botao" (click)="banco.novo()">+ nova conexão</button></p>
        }
      </div>

      @if (tunel(); as t) {
        <div class="cartao-tunel">
          <div class="cartao-tunel-titulo"><span class="rotulo destaque-texto">TÚNEL SSH</span><span class="git-mais">● ativo</span></div>
          <div>{{ t.alvo }} → {{ t.destino }}</div>
          <div class="suave">porta local {{ t.portaLocal }}@if (t.identidade) { · chave {{ t.identidade }} }</div>
        </div>
      }
      <button class="botao conexoes-nova" (click)="banco.novo()">+ nova conexão <kbd>n</kbd></button>
    </section>
  `,
})
export class ConexoesComponent {
  protected readonly banco = inject(BancoService);
  private readonly layout = inject(LayoutService);
  private readonly editor = inject(EditorService);
  private readonly lista = viewChild.required<ElementRef<HTMLElement>>('lista');

  protected readonly selecionado = signal(0);
  protected readonly abertos = signal(new Set<string>());
  protected readonly focado = signal(false);

  protected readonly nos = computed<No[]>(() => {
    const saida: No[] = [];
    const abertos = this.abertos();
    for (const perfil of this.banco.perfis()) {
      const chave = `p:${perfil.id}`;
      saida.push({ tipo: 'perfil', chave, nivel: 0, perfil });
      if (!abertos.has(chave) || !this.banco.conectado(perfil.id)) continue;
      const cb = `${chave}/b`;
      saida.push({ tipo: 'banco', chave: cb, nivel: 1, perfil });
      if (!abertos.has(cb)) continue;
      const colunas = this.banco.colunas().get(perfil.id) ?? [];
      for (const s of this.banco.catalogos().get(perfil.id) ?? []) {
        const cs = `${cb}/${s.nome}`;
        saida.push({ tipo: 'schema', chave: cs, nivel: 2, perfil, schema: s.nome });
        if (!abertos.has(cs)) continue;
        for (const grupo of ['tabelas', 'views', 'funcoes'] as const) {
          const itens = s[grupo];
          if (!itens.length) continue;
          const cg = `${cs}/${grupo}`;
          saida.push({ tipo: 'grupo', chave: cg, nivel: 3, perfil, schema: s.nome, grupo, total: itens.length });
          if (!abertos.has(cg)) continue;
          for (const nome of itens) {
            const co = `${cg}/${nome}`;
            saida.push({ tipo: 'objeto', chave: co, nivel: 4, perfil, schema: s.nome, grupo, nome });
            if (!abertos.has(co) || grupo === 'funcoes') continue;
            for (const c of colunas.filter((c) => c.tabela === nome)) {
              saida.push({ tipo: 'coluna', chave: `${co}/${c.coluna}`, nivel: 5, perfil, nome: c.coluna, detalhe: c.tipo });
            }
          }
        }
      }
    }
    return saida;
  });

  /** Túnel da conexão selecionada (ou da que o .sql ativo usa). */
  protected readonly tunel = computed(() => {
    const no = this.nos()[this.selecionado()];
    const id = no?.perfil.id ?? this.banco.perfilAtivo()?.id;
    return id ? (this.banco.sessoes().get(id)?.tunel ?? null) : null;
  });

  constructor() {
    effect(() => {
      const pedido = this.layout.pedidoDeFoco();
      if (pedido?.id === 'conexoes') untracked(() => queueMicrotask(() => this.lista().nativeElement.focus()));
    });
    // Conectou: abre a conexão e o banco na árvore (como no mockup).
    effect(() => {
      const ids = [...this.banco.sessoes().keys()];
      untracked(() => {
        const s = new Set(this.abertos());
        for (const id of ids) {
          if (!s.has(`p:${id}`)) {
            s.add(`p:${id}`);
            s.add(`p:${id}/b`);
          }
        }
        this.abertos.set(s);
      });
    });
    // Selecionado não pode passar do fim da lista.
    effect(() => {
      const n = this.nos().length;
      untracked(() => {
        if (this.selecionado() >= n) this.selecionado.set(Math.max(0, n - 1));
      });
    });
  }

  ngAfterViewInit(): void {
    const el = this.lista().nativeElement;
    el.addEventListener('focus', () => this.focado.set(true));
    el.addEventListener('blur', () => this.focado.set(false));
  }

  protected rotuloDoGrupo(g: keyof typeof ROTULO_DO_GRUPO): string {
    return ROTULO_DO_GRUPO[g];
  }

  protected expansivel(no: No): boolean {
    return no.tipo !== 'coluna' && !(no.tipo === 'objeto' && no.grupo === 'funcoes');
  }

  protected async ativar(no: No): Promise<void> {
    if (no.tipo === 'objeto' && no.grupo !== 'funcoes') {
      await this.consultarTabela(no.perfil, no.schema, no.nome);
      return;
    }
    if (no.tipo === 'perfil' && !this.banco.conectado(no.perfil.id)) {
      if (await this.banco.conectar(no.perfil.id)) this.abrir(no.chave);
      return;
    }
    if (this.expansivel(no)) this.alternar(no.chave);
  }

  /** ⏎ numa tabela: o console da conexão ganha um SELECT das primeiras linhas, e roda. */
  private async consultarTabela(p: PerfilBanco, schema: string, tabela: string): Promise<void> {
    const padrao = this.banco.schemaPadrao(p);
    const nome = schema === padrao ? tabela : `${schema}.${tabela}`;
    const sql = p.tipo === 'oracle' ? `SELECT * FROM ${nome} FETCH FIRST 100 ROWS ONLY;` : `SELECT * FROM ${nome} LIMIT 100;`;
    await this.banco.abrirConsole(p.id);
    const m = this.editor.bufferAtivo()?.modelo;
    if (!m) return;
    const ultima = m.getLineCount();
    const prefixo = m.getLineContent(ultima).trim() ? '\n' : '';
    const fim = m.getLineMaxColumn(ultima);
    m.pushEditOperations([], [{ range: new monaco.Range(ultima, fim, ultima, fim), text: `${prefixo}${sql}\n` }], () => null);
    const linha = m.getLineCount() - 1;
    // O editor troca para o modelo do console no próximo ciclo.
    for (let i = 0; i < 20 && this.editor.instancia?.getModel() !== m; i++) await new Promise((r) => setTimeout(r, 25));
    const ed = this.editor.instancia;
    if (!ed || ed.getModel() !== m) return;
    ed.setPosition({ lineNumber: linha, column: 1 });
    ed.revealLine(linha);
    await this.banco.executarNoCursor();
  }

  private abrir(chave: string): void {
    this.abertos.update((s) => new Set(s).add(chave));
  }

  private alternar(chave: string): void {
    this.abertos.update((s) => {
      const n = new Set(s);
      if (n.has(chave)) n.delete(chave);
      else n.add(chave);
      return n;
    });
  }

  protected teclar(e: KeyboardEvent): void {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const nos = this.nos();
    const no = nos[this.selecionado()];
    const ir = (i: number) => {
      this.selecionado.set(Math.max(0, Math.min(nos.length - 1, i)));
      queueMicrotask(() => document.getElementById('con-' + this.selecionado())?.scrollIntoView({ block: 'nearest' }));
    };
    switch (e.key) {
      case 'j':
      case 'ArrowDown':
        ir(this.selecionado() + 1);
        break;
      case 'k':
      case 'ArrowUp':
        ir(this.selecionado() - 1);
        break;
      case 'Enter':
      case 'l':
      case 'ArrowRight':
        if (no) {
          if ((e.key === 'l' || e.key === 'ArrowRight') && this.abertos().has(no.chave)) ir(this.selecionado() + 1);
          else void this.ativar(no);
        }
        break;
      case 'h':
      case 'ArrowLeft':
        if (no && this.abertos().has(no.chave)) this.alternar(no.chave);
        else if (no) {
          // Vai para o pai.
          for (let i = this.selecionado() - 1; i >= 0; i--) if (nos[i].nivel < no.nivel) return void ir(i);
        }
        break;
      case 'n':
        this.banco.novo();
        break;
      case 'e':
        if (no) this.banco.editar(no.perfil.id);
        break;
      case 'x':
        if (no) void this.banco.desconectar(no.perfil.id);
        break;
      case 'r':
        if (no && this.banco.conectado(no.perfil.id)) void this.banco.carregarCatalogo(no.perfil.id);
        break;
      case 'c':
        if (no) void this.banco.abrirConsole(no.perfil.id);
        break;
      case 'Delete':
        if (no?.tipo === 'perfil') void this.banco.apagar(no.perfil.id);
        break;
      case 'Escape':
        this.editor.focar();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  protected nomeDoAmbiente(a: string): string {
    return NOME_DO_AMBIENTE[a] ?? a;
  }
}
