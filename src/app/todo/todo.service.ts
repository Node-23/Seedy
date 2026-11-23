import { computed, effect, inject, Injectable, isDevMode, signal, untracked } from '@angular/core';
import { monaco } from '../editor/monaco';
import { EditorService } from '../editor/editor.service';
import { LayoutService } from '../layout/layout.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { ProjetoService } from '../nucleo/projeto.service';
import { ponte } from '../nucleo/ponte';
import { EntenderService } from '../entender/entender.service';
import { DockerService } from '../containers/docker.service';
import { BancoService } from '../banco/banco.service';
import { nomeCurto } from '../entender/desenho';
import { Card, escreverTodo, Ligacao, lerTodo } from './todo';

/**
 * TODO do projeto (mockup 20, Alt+6): um painel por cima das telas com cards que se ligam a
 * código, regras, caminhos, blocos da arquitetura, containers e conexões de banco. Os cards
 * ficam em `.seedy/todo.md`. `l` liga ao card o que está em foco na tela de baixo.
 */
@Injectable({ providedIn: 'root' })
export class TodoService {
  private readonly layout = inject(LayoutService);
  private readonly projeto = inject(ProjetoService);
  private readonly editor = inject(EditorService);
  private readonly mensagens = inject(MensagensService);
  private readonly entender = inject(EntenderService);
  private readonly docker = inject(DockerService);
  private readonly banco = inject(BancoService);

  readonly aberto = signal(false);
  readonly cards = signal<Card[]>([]);
  readonly selecionado = signal<number | null>(null);
  readonly abertos = computed(() => this.cards().filter((c) => !c.feito));
  readonly feitos = computed(() => this.cards().filter((c) => c.feito));
  /** Ordem da navegação (j/k): abertos e depois feitos. */
  readonly ordem = computed(() => [...this.abertos(), ...this.feitos()]);
  readonly atual = computed(() => this.ordem().find((c) => c.id === this.selecionado()) ?? this.abertos()[0] ?? null);

  private decoracoes = new Map<monaco.editor.ITextModel, string[]>();

  constructor() {
    effect(() => {
      this.projeto.raiz();
      untracked(() => void this.carregar());
    });
    effect(() => {
      const m = this.projeto.mudancas();
      if (m && [...m.alterados, ...m.criados].some((c) => /[\\/]\.seedy[\\/]todo\.md$/.test(c))) untracked(() => void this.carregar());
    });
    // Linhas ligadas a um card aberto ganham a marca "☐ TODO: …" no editor.
    effect(() => {
      const cards = this.abertos();
      const buffers = this.editor.buffers();
      untracked(() => this.marcar(cards, buffers.map((b) => ({ caminho: b.caminho, modelo: b.modelo }))));
    });
    if (isDevMode()) Object.assign(window, { seedyTodo: this });
  }

  // ---------- arquivo ----------

  private arquivo(): string | null {
    const raiz = this.projeto.raiz();
    if (!raiz) return null;
    const sep = raiz.includes('\\') ? '\\' : '/';
    return `${raiz.replace(/[\\/]+$/, '')}${sep}.seedy${sep}todo.md`;
  }

  async carregar(): Promise<void> {
    const caminho = this.arquivo();
    const texto = caminho ? await ponte.lerArquivo(caminho).catch(() => null) : null;
    this.cards.set(texto ? lerTodo(texto) : []);
  }

  private async salvar(cards: Card[]): Promise<void> {
    this.cards.set(cards);
    const caminho = this.arquivo();
    if (!caminho) return;
    await ponte.gravarArquivo(caminho, escreverTodo(cards)).catch((e) => this.mensagens.erro(String(e)));
  }

  // ---------- painel ----------

  alternar(): void {
    this.aberto.set(!this.aberto());
    if (!this.aberto()) this.voltarFoco();
  }

  fechar(): void {
    this.aberto.set(false);
    this.voltarFoco();
  }

  private voltarFoco(): void {
    if (this.layout.tela() === 'editor') queueMicrotask(() => this.editor.focar());
  }

  // ---------- cards ----------

  async criar(titulo: string): Promise<void> {
    const t = titulo.trim();
    if (!t) return;
    const id = Math.max(0, ...this.cards().map((c) => c.id)) + 1;
    await this.salvar([{ id, titulo: t, nota: '', feito: false, ligacoes: [] }, ...this.cards()]);
    this.selecionado.set(id);
  }

  async atualizar(id: number, mudanca: Partial<Card>): Promise<void> {
    await this.salvar(this.cards().map((c) => (c.id === id ? { ...c, ...mudanca } : c)));
  }

  async alternarFeito(c: Card): Promise<void> {
    await this.atualizar(c.id, { feito: !c.feito });
  }

  async apagar(c: Card): Promise<void> {
    const ordem = this.ordem();
    const i = ordem.indexOf(c);
    await this.salvar(this.cards().filter((x) => x.id !== c.id));
    const prox = ordem[i + 1] ?? ordem[i - 1];
    this.selecionado.set(prox && prox.id !== c.id ? prox.id : null);
    this.mensagens.mostrar(`card apagado: ${c.titulo}`);
  }

  async desligar(c: Card, l: Ligacao): Promise<void> {
    await this.atualizar(c.id, { ligacoes: c.ligacoes.filter((x) => x !== l) });
  }

  // ---------- ligar o que está em foco ----------

  /** O que está em foco na tela de baixo (o que `l` liga ao card). */
  readonly emFoco = computed<Ligacao | null>(() => {
    const tela = this.layout.tela();
    if (tela === 'entender') {
      const e = this.entender;
      if (e.aba() === 'regras') {
        const r = e.regraAtual();
        return r?.chave ? { tipo: 'regra', alvo: r.chave, rotulo: `${r.id} ${r.titulo}` } : null;
      }
      if (e.aba() === 'caminho') {
        const sel = e.noSel();
        const no = e.desenhoCaminho()?.blocos.find((b) => b.id === sel);
        const alvo = no?.comp && no.metodo ? `${no.comp}.${no.metodo}` : e.foco() ? `${e.foco()!.comp}.${e.foco()!.metodo}` : null;
        return alvo ? { tipo: 'caminho', alvo, rotulo: `caminho ${nomeCurto(alvo.slice(0, alvo.lastIndexOf('.')))}.${alvo.slice(alvo.lastIndexOf('.') + 1)}` } : null;
      }
      const id = e.selecionado();
      if (!id) return null;
      const c = e.componentes().get(id);
      return { tipo: 'bloco', alvo: id, rotulo: c?.papel === 'entidade' ? `${c.tabela ?? c.nome} (tabela)` : nomeCurto(id) };
    }
    if (tela === 'containers') {
      const c = this.docker.atual();
      return c ? { tipo: 'container', alvo: c.nome, rotulo: `container ${c.composeServico ?? c.nome}` } : null;
    }
    if (tela === 'editor' && this.layout.visivel('conexoes') && this.banco.perfilAtivo()) {
      const p = this.banco.perfilAtivo()!;
      return { tipo: 'banco', alvo: p.id, rotulo: `banco ${p.nome}` };
    }
    if (tela === 'editor' || tela === 'debug') {
      const b = this.editor.bufferAtivo();
      const raiz = this.projeto.raiz();
      if (!b || b.somenteLeitura || !raiz) return null;
      const linha = this.editor.cursor().linha;
      const rel = relativo(raiz, b.caminho);
      const metodo = this.entender.metodoEm(b.caminho, linha);
      return { tipo: 'codigo', alvo: `${rel}:${linha}`, rotulo: `${b.nome}:${linha}${metodo ? ` · ${metodo.metodo.nome}` : ''}` };
    }
    return null;
  });

  async ligarEmFoco(): Promise<void> {
    const l = this.emFoco();
    const c = this.atual();
    if (!l) {
      this.mensagens.alerta('nada em foco para ligar (abra um arquivo, regra, bloco ou container)');
      return;
    }
    if (!c) {
      await this.criar(l.rotulo);
      const novo = this.atual();
      if (novo) await this.atualizar(novo.id, { ligacoes: [l] });
      return;
    }
    if (c.ligacoes.some((x) => x.tipo === l.tipo && x.alvo === l.alvo)) {
      this.mensagens.mostrar('já está ligado a este card');
      return;
    }
    await this.atualizar(c.id, { ligacoes: [...c.ligacoes, l] });
  }

  // ---------- abrir uma ligação ----------

  async abrirLigacao(l: Ligacao): Promise<void> {
    this.aberto.set(false);
    const raiz = this.projeto.raiz();
    switch (l.tipo) {
      case 'codigo': {
        const m = /^(.*):(\d+)$/.exec(l.alvo);
        if (!raiz || !m) return;
        this.layout.tela.set('editor');
        const sep = raiz.includes('\\') ? '\\' : '/';
        await this.editor.abrir(`${raiz.replace(/[\\/]+$/, '')}${sep}${m[1].split('/').join(sep)}`, Number(m[2]));
        return;
      }
      case 'regra': {
        await this.entender.abrir('regras');
        const r = this.entender.regras().find((x) => x.chave === l.alvo);
        if (!r) return this.mensagens.alerta('a regra não está mais no código');
        this.entender.dominioSel.set(r.dominio);
        this.entender.regraSel.set(r.id);
        return;
      }
      case 'caminho': {
        const i = l.alvo.lastIndexOf('.');
        await this.entender.acompanhar(l.alvo.slice(0, i), l.alvo.slice(i + 1));
        return;
      }
      case 'bloco':
        await this.entender.abrir('arquitetura');
        this.entender.irParaBloco(l.alvo);
        return;
      case 'container':
        this.layout.tela.set('containers');
        this.docker.escolher(l.alvo);
        return;
      case 'banco':
        this.layout.tela.set('editor');
        this.layout.mostrar('conexoes');
        return;
    }
  }

  // ---------- marcas no editor ----------

  private marcar(cards: Card[], buffers: { caminho: string; modelo: monaco.editor.ITextModel }[]): void {
    const raiz = this.projeto.raiz();
    for (const b of buffers) {
      if (b.modelo.isDisposed()) continue;
      const rel = raiz ? relativo(raiz, b.caminho) : '';
      const novas: monaco.editor.IModelDeltaDecoration[] = [];
      for (const c of cards) {
        for (const l of c.ligacoes) {
          const m = l.tipo === 'codigo' ? /^(.*):(\d+)$/.exec(l.alvo) : null;
          const linha = m ? Number(m[2]) : 0;
          if (!m || m[1] !== rel || linha < 1 || linha > b.modelo.getLineCount()) continue;
          novas.push({
            range: new monaco.Range(linha, 1, linha, b.modelo.getLineMaxColumn(linha)),
            options: { isWholeLine: true, after: { content: `   ☐ TODO: ${c.titulo}`, inlineClassName: 'todo-marca' }, linesDecorationsClassName: 'todo-margem' },
          });
        }
      }
      this.decoracoes.set(b.modelo, b.modelo.deltaDecorations(this.decoracoes.get(b.modelo) ?? [], novas));
    }
    for (const modelo of [...this.decoracoes.keys()]) if (modelo.isDisposed()) this.decoracoes.delete(modelo);
  }
}

function relativo(raiz: string, caminho: string): string {
  const r = raiz.replace(/\\/g, '/').replace(/\/+$/, '');
  const c = caminho.replace(/\\/g, '/');
  return c.toLowerCase().startsWith(r.toLowerCase() + '/') ? c.slice(r.length + 1) : c;
}
