import { inject, Injectable, Injector, signal } from '@angular/core';
import { ContainerDocker, TesteInfo } from '../nucleo/ponte';
import { ProjetoService } from '../nucleo/projeto.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { LayoutService } from '../layout/layout.service';
import { EditorService } from '../editor/editor.service';
import { BancoService } from '../banco/banco.service';
import { ServidorService } from '../servidor/servidor.service';
import { DockerService } from '../containers/docker.service';
import { EntenderService, RegraVisivel } from '../entender/entender.service';
import { TestesService } from '../testes/testes.service';
import { EndpointsService, EndpointInfo } from '../endpoints/endpoints.service';
import { TodoService } from '../todo/todo.service';
import { GitService } from '../git/git.service';
import { Card } from '../todo/todo';
import { NOMES_DO_TIPO } from '../testes/testes.service';
import { nomeCurto } from '../entender/desenho';

/** Algo que o usuário mandou para a conversa com a IA (container, regra, teste, card, trecho de código...). */
export interface Anexo {
  /** tipo:alvo — o mesmo item não entra duas vezes. */
  id: string;
  /** O que o chip mostra. */
  rotulo: string;
  icone: string;
  /** O que a IA recebe junto da próxima mensagem. */
  texto: string;
}

/** Menu de um item só ("✦ Mandar para a IA") aberto com o botão direito. */
/** Imagem colada ou arrastada para o chat: vai como bloco `image` da API junto da próxima mensagem. */
export interface ImagemAnexada {
  id: string;
  nome: string;
  /** image/png, image/jpeg, image/gif ou image/webp. */
  tipo: string;
  /** Base64 sem o prefixo `data:`. */
  dados: string;
  bytes: number;
  /** Miniatura (data URL pequena) para o chip e para a conversa. */
  miniatura: string;
}

export const TIPOS_DE_IMAGEM = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const LIMITE_DE_IMAGEM = 5 * 1024 * 1024;
export const MAX_IMAGENS = 4;
/** Lado maior: a API reduz o que passa disto, então reduzimos antes (menos bytes, mesma leitura). */
const LADO_MAXIMO = 1568;

const paraBase64 = (b: Blob) =>
  new Promise<string>((ok, erro) => {
    const l = new FileReader();
    l.onload = () => ok(String(l.result).split(',')[1] ?? '');
    l.onerror = () => erro(l.error);
    l.readAsDataURL(b);
  });

/** Menu de um item só ("✦ Mandar para a IA") aberto com o botão direito. */
export interface MenuDeAnexo {
  x: number;
  y: number;
  anexo: () => Anexo | null;
}

const LIMITE_DO_TEXTO = 6000;
const corta = (t: string) => (t.length > LIMITE_DO_TEXTO ? `${t.slice(0, LIMITE_DO_TEXTO)}\n[... cortado]` : t);

/**
 * Anexos da conversa com a IA (⌃⇧A manda o que está em foco; o botão direito faz o mesmo no item
 * clicado). Cada anexo vira um chip removível no painel da IA e um bloco de texto na próxima mensagem.
 * Os serviços de cada tela são pegos na hora do uso, porque vários dependem da própria IA.
 */
@Injectable({ providedIn: 'root' })
export class AnexosService {
  private readonly injetor = inject(Injector);
  private readonly projeto = inject(ProjetoService);
  private readonly mensagens = inject(MensagensService);
  private readonly layout = inject(LayoutService);
  private readonly editor = inject(EditorService);

  readonly lista = signal<Anexo[]>([]);
  readonly menu = signal<MenuDeAnexo | null>(null);
  readonly imagens = signal<ImagemAnexada[]>([]);

  /** Anexa uma imagem (colar, arrastar ou escolher arquivo). Devolve true se entrou. */
  async adicionarImagem(arquivo: Blob, nome = 'imagem'): Promise<boolean> {
    let tipo = arquivo.type;
    if (!TIPOS_DE_IMAGEM.includes(tipo)) {
      this.mensagens.alerta('imagem: só PNG, JPEG, GIF ou WebP');
      return false;
    }
    if (this.imagens().length >= MAX_IMAGENS) {
      this.mensagens.alerta(`imagem: no máximo ${MAX_IMAGENS} por mensagem`);
      return false;
    }
    try {
      let blob: Blob = arquivo;
      const bmp = await createImageBitmap(arquivo);
      const lado = Math.max(bmp.width, bmp.height);
      if (lado > LADO_MAXIMO && tipo !== 'image/gif') {
        const f = LADO_MAXIMO / lado;
        const c = document.createElement('canvas');
        c.width = Math.round(bmp.width * f);
        c.height = Math.round(bmp.height * f);
        c.getContext('2d')?.drawImage(bmp, 0, 0, c.width, c.height);
        const novo = await new Promise<Blob | null>((r) => c.toBlob(r, tipo === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.9));
        if (novo) {
          blob = novo;
          tipo = novo.type;
        }
      }
      if (blob.size > LIMITE_DE_IMAGEM) {
        this.mensagens.alerta(`imagem: ${(blob.size / 1048576).toFixed(1)} MB passa do limite de 5 MB`);
        return false;
      }
      const m = document.createElement('canvas');
      const f = Math.min(1, 96 / Math.max(bmp.width, bmp.height));
      m.width = Math.max(1, Math.round(bmp.width * f));
      m.height = Math.max(1, Math.round(bmp.height * f));
      m.getContext('2d')?.drawImage(bmp, 0, 0, m.width, m.height);
      bmp.close();
      const img: ImagemAnexada = { id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, nome, tipo, dados: await paraBase64(blob), bytes: blob.size, miniatura: m.toDataURL('image/jpeg', 0.7) };
      this.imagens.update((l) => [...l, img]);
      return true;
    } catch {
      this.mensagens.alerta('imagem: não consegui ler esse arquivo');
      return false;
    }
  }

  removerImagem(id: string): void {
    this.imagens.update((l) => l.filter((i) => i.id !== id));
  }

  // ---------- a lista ----------

  adicionar(a: Anexo | null): boolean {
    if (!a) {
      this.mensagens.alerta('nada em foco para mandar à IA (selecione um container, regra, teste, card ou abra um arquivo)');
      return false;
    }
    if (this.lista().some((x) => x.id === a.id)) {
      this.mensagens.mostrar(`já está na conversa: ${a.rotulo}`);
      return false;
    }
    this.lista.update((l) => [...l, a]);
    this.mensagens.mostrar(`mandado para a IA: ${a.rotulo} (Alt+A abre o chat)`);
    return true;
  }

  remover(id: string): void {
    this.lista.update((l) => l.filter((x) => x.id !== id));
  }

  limpar(): void {
    if (!this.lista().length) return;
    this.lista.set([]);
    this.mensagens.mostrar('anexos da IA limpos');
  }

  /** O texto dos anexos para ir antes da pergunta. */
  texto(): string {
    const l = this.lista();
    if (!l.length) return '';
    return `Anexado pelo usuário (${l.length}):\n\n${l.map((a) => `### ${a.rotulo}\n${a.texto}`).join('\n\n')}\n\n`;
  }

  abrirMenu(e: MouseEvent, anexo: () => Anexo | null): void {
    e.preventDefault();
    e.stopPropagation();
    this.menu.set({ x: e.clientX, y: e.clientY, anexo });
  }

  fecharMenu(): void {
    this.menu.set(null);
  }

  // ---------- o que está em foco ----------

  /** Todos os testes que falharam no último run, de uma vez (a tela de testes). */
  anexarFalhasDosTestes(): void {
    const t = this.injetor.get(TestesService);
    const falhas = t.testes().filter((x) => t.estadoDe(x) === 'falhou');
    if (!falhas.length) return void this.mensagens.alerta('nenhum teste falhou no último run');
    let novos = 0;
    for (const f of falhas.slice(0, 15)) {
      const a = this.doTeste(f);
      if (!this.lista().some((x) => x.id === a.id)) {
        this.lista.update((l) => [...l, a]);
        novos++;
      }
    }
    this.mensagens.mostrar(`${novos} ${novos === 1 ? 'teste que falhou foi mandado' : 'testes que falharam foram mandados'} para a IA${falhas.length > 15 ? ` (os 15 primeiros de ${falhas.length})` : ''}`);
  }

  /** ⌃⇧A: manda o que está em foco na tela de baixo. */
  anexarEmFoco(): void {
    this.adicionar(this.emFoco());
  }

  emFoco(): Anexo | null {
    const todo = this.injetor.get(TodoService);
    if (todo.aberto()) {
      const c = todo.atual();
      return c ? this.doCard(c) : null;
    }
    const tela = this.layout.tela();
    if (tela === 'entender') {
      const e = this.injetor.get(EntenderService);
      if (e.aba() === 'regras') {
        const r = e.regraAtual();
        return r ? this.daRegra(r) : null;
      }
      if (e.aba() === 'caminho') return e.foco() ? this.doCaminho(e.foco()!.comp, e.foco()!.metodo) : null;
      return e.selecionado() ? this.doBloco(e.selecionado()!) : null;
    }
    if (tela === 'containers') {
      const c = this.injetor.get(DockerService).atual();
      return c ? this.doContainer(c) : null;
    }
    if (tela === 'testes') {
      const t = this.injetor.get(TestesService).atual();
      return t ? this.doTeste(t) : null;
    }
    if (tela === 'endpoints') {
      const e = this.injetor.get(EndpointsService).atual();
      return e ? this.doEndpoint(e) : null;
    }
    if (tela === 'git') return this.doGit();
    if (this.layout.visivel('conexoes') && this.injetor.get(BancoService).perfilAtivo()) return this.doBanco();
    if (tela === 'editor' || tela === 'debug') return this.doCodigo();
    return null;
  }

  // ---------- construtores ----------

  doContainer(c: ContainerDocker): Anexo {
    const d = this.injetor.get(DockerService);
    const portas = c.portas.filter((p) => p.host).map((p) => `${p.host}→${p.container}`).join(', ');
    const logs = (d.logs().get(c.nome) ?? []).slice(-25).map((l) => l.texto).join('\n');
    const texto = [
      `container ${c.nome} — imagem ${c.imagem} — ${c.estado} (${c.status})`,
      portas ? `portas publicadas: ${portas}` : '',
      c.redes.length ? `redes: ${c.redes.map((r) => `${r.nome} ${r.ip}`).join(', ')}` : '',
      c.composeServico ? `compose: serviço ${c.composeServico}${c.composePasta ? ` em ${c.composePasta}` : ''}` : '',
      c.dependeDe.length ? `depende de: ${c.dependeDe.join(', ')}` : '',
      c.ambiente.length ? `ambiente:\n${c.ambiente.map((e) => `  ${d.ambienteVisivel(e)}`).join('\n')}` : '',
      logs ? `últimas linhas do log:\n${logs}` : '',
    ].filter(Boolean).join('\n');
    return { id: `container:${c.nome}`, rotulo: c.composeServico ?? c.nome, icone: '🐳', texto: corta(texto) };
  }

  doContainerPorNome(nome: string): Anexo | null {
    const c = this.injetor.get(DockerService).containers().find((x) => x.nome === nome);
    return c ? this.doContainer(c) : null;
  }

  daRegra(r: RegraVisivel): Anexo {
    const cob = this.injetor.get(TestesService).cobertura().get(r.chave);
    const raiz = (this.projeto.raiz() ?? '').replace(/\\/g, '/');
    const onde = r.codigo ? `${r.codigo.caminho.replace(/\\/g, '/').replace(`${raiz}/`, '')}:${r.codigo.linha}` : 'sem código ligado';
    const texto = [
      `regra ${r.id} [${r.dominio}] ${r.titulo}`,
      r.descricao ? r.descricao : '',
      `código: ${r.codigo ? `${r.codigo.componente}${r.codigo.metodo ? `.${r.codigo.metodo}` : ''} — ${onde}` : onde}`,
      r.chave ? `chave: ${r.chave}` : '',
      cob ? `cobertura de testes: ${cob.estado}\n${cob.cenarios.map((s) => `  - [${s.tipo}] ${s.rotulo}: ${s.estado === 'sem' ? 'SEM TESTE' : s.estado}${s.testes.length ? ` (${s.testes.map((t) => `${t.classe}#${t.metodo}`).join(', ')})` : ''}`).join('\n')}` : '',
    ].filter(Boolean).join('\n');
    return { id: `regra:${r.chave || r.id}`, rotulo: `${r.id} · ${r.titulo}`, icone: '§', texto: corta(texto) };
  }

  doBloco(id: string): Anexo | null {
    const e = this.injetor.get(EntenderService);
    const c = e.componentes().get(id);
    if (!c) return null;
    const nomes = new Map([...e.componentes().values()].map((x) => [x.id, x.nome]));
    const texto = [
      `componente ${c.nome} [${c.papel}, domínio ${c.dominio}] — ${c.relativo}:${c.linha}`,
      c.rota ? `rota: ${c.rota}` : '',
      c.tabela ? `tabela: ${c.tabela}` : '',
      `usa: ${c.usa.map((u) => nomes.get(u) ?? u).join(', ') || '—'}`,
      `métodos: ${c.metodos.map((m) => `${m.nome}${m.http ? ` [${m.http.verbo} ${m.http.rota}]` : ''}`).join(', ') || '—'}`,
    ].filter(Boolean).join('\n');
    return { id: `bloco:${id}`, rotulo: c.papel === 'entidade' ? `${c.tabela ?? c.nome} (tabela)` : nomeCurto(id), icone: '▦', texto };
  }

  doCaminho(comp: string, metodo: string): Anexo {
    const c = this.injetor.get(EntenderService).componentes().get(comp);
    const m = c?.metodos.find((x) => x.nome === metodo);
    const texto = [
      `caminho do método ${c?.nome ?? comp}.${metodo}${c ? ` — ${c.relativo}${m ? `:${m.linha}` : ''}` : ''}`,
      m ? `chama: ${[...new Set(m.chamadas.map((x) => `${x.alvo}.${x.metodo}`))].join(', ') || '—'}` : '',
      m?.desvios.length ? `desvios:\n${m.desvios.map((d) => `  l.${d.linha}: ${d.condicao ?? ''} → ${d.acao}${d.excecao ? ` ${d.excecao}` : ''}`).join('\n')}` : '',
    ].filter(Boolean).join('\n');
    return { id: `caminho:${comp}.${metodo}`, rotulo: `caminho ${c?.nome ?? nomeCurto(comp)}.${metodo}`, icone: '⇢', texto: corta(texto) };
  }

  doCard(c: Card): Anexo {
    const lig = c.ligacoes.map((l) => `  -> ${l.tipo}: ${l.alvo}${l.rotulo !== l.alvo ? ` (${l.rotulo})` : ''}`).join('\n');
    return { id: `todo:${c.id}`, rotulo: `#${c.id} TODO · ${c.titulo}`, icone: '☐', texto: `card #${c.id} do TODO (${c.feito ? 'feito' : 'aberto'}): ${c.titulo}${c.nota ? `\n${c.nota}` : ''}${lig ? `\n${lig}` : ''}` };
  }

  doTeste(t: TesteInfo): Anexo {
    const ts = this.injetor.get(TestesService);
    const r = ts.resultadoDe(t);
    const estado = ts.estadoDe(t);
    const texto = [
      `teste ${t.classe}#${t.metodo} — ${t.relativo}:${t.linha} — ${NOMES_DO_TIPO[t.tipo]}${t.esperaErro ? ' (cenário de erro)' : ''}`,
      `estado: ${estado}${r ? ` (${r.segundos.toFixed(2)} s)` : ''}`,
      r?.mensagem ? `falha:\n${r.mensagem}` : '',
    ].filter(Boolean).join('\n');
    return { id: `teste:${t.id}`, rotulo: `${t.classe}#${t.metodo}`, icone: estado === 'falhou' ? '✗' : '✓', texto: corta(texto) };
  }

  doEndpoint(e: EndpointInfo): Anexo {
    const s = this.injetor.get(EndpointsService);
    const h = e.http;
    const texto = [
      `endpoint ${e.verbo} ${s.urlRelativa(e)} — ${e.controller.nome}.${e.metodo.nome} (${e.controller.relativo}:${e.metodo.linha})`,
      h.acesso ? `acesso: ${h.acesso}` : 'sem restrição de acesso no código',
      h.params?.length ? `parâmetros:\n${h.params.map((p) => `  ${p.origem} ${p.nome}: ${p.tipo}${p.obrigatorio ? '' : ' (opcional)'}`).join('\n')}` : '',
      h.corpo?.length ? `corpo:\n${h.corpo.map((c) => `  ${c.nome}: ${c.tipo}${c.restricoes.length ? ` @${c.restricoes.join(' @')}` : ''}`).join('\n')}` : '',
      h.retorno ? `devolve: ${h.retorno}${h.status ? ` (${h.status})` : ''}` : '',
      `testes que passam por ele: ${s.testesDe(e).map((t) => `${t.classe}#${t.metodo}`).join(', ') || 'nenhum'}`,
    ].filter(Boolean).join('\n');
    return { id: `endpoint:${e.id}`, rotulo: `${e.verbo} ${s.urlRelativa(e)}`, icone: '🌐', texto: corta(texto) };
  }

  doBanco(): Anexo | null {
    const p = this.injetor.get(BancoService).perfilAtivo();
    if (!p) return null;
    return {
      id: `banco:${p.id}`,
      rotulo: `banco ${p.nome}`,
      icone: '⛁',
      texto: `conexão de banco "${p.nome}" — ${p.tipo}, ${p.host}:${p.porta}, banco ${p.banco}, usuário ${p.usuario}, ${p.ambiente}${p.somenteLeitura ? ', somente leitura' : ''}${p.ssh ? `, por túnel SSH ${p.ssh}` : ''}. Use banco_consultar com esse nome.`,
    };
  }

  doServidor(): Anexo | null {
    const s = this.injetor.get(ServidorService);
    const p = s.perfilAtual();
    if (!p) return null;
    const e = s.execucaoAtual();
    const log = (e?.linhas ?? []).slice(-25).map((l) => l.texto).join('\n');
    return {
      id: `servidor:${p.id}`,
      rotulo: `servidor ${p.nome}`,
      icone: '▶',
      texto: corta([`servidor ${p.nome} (${p.tipo}) :${p.portaHttp}${p.contexto} — ${e?.fase ?? 'parado'}${e?.info?.url ? ` em ${e.info.url}` : ''}`, log ? `últimas linhas do log:\n${log}` : ''].filter(Boolean).join('\n')),
    };
  }

  doGit(): Anexo | null {
    const g = this.injetor.get(GitService);
    const c = g.commitEmFoco();
    if (c) {
      const arquivos = c.arquivos.slice(0, 60).map((a) => `${a.letra} ${a.relativo} (+${a.mais} -${a.menos})`).join('\n');
      return {
        id: `commit:${c.hash}`,
        rotulo: `commit ${c.hash.slice(0, 8)} · ${c.mensagem.split('\n')[0].slice(0, 40)}`,
        icone: '●',
        texto: corta(`commit ${c.hash} de ${c.autor} em ${new Date(c.data * 1000).toISOString().slice(0, 10)}\n${c.mensagem}\narquivos (${c.arquivos.length}):\n${arquivos}\nPara ver o diff: git_diff ou executar_comando "git show ${c.hash.slice(0, 8)}".`),
      };
    }
    const e = g.estado();
    if (!e) return null;
    const alt = g.alterados();
    return {
      id: 'git:estado',
      rotulo: `git ${e.branch ?? '(HEAD destacado)'}`,
      icone: '⎇',
      texto: `git: branch ${e.branch ?? '(HEAD destacado)'}${e.upstream ? ` → ${e.upstream} (${e.aFrente} à frente, ${e.atras} atrás)` : ''}${e.operacao ? ` · ${e.operacao} em andamento` : ''}\n${alt.length ? `${alt.length} alterados:\n${alt.slice(0, 80).map((a) => `${a.letra} ${a.relativo}`).join('\n')}` : 'nada alterado'}`,
    };
  }

  /** A seleção do editor ou as linhas em volta do cursor. */
  doCodigo(): Anexo | null {
    const b = this.editor.bufferAtivo();
    const raiz = this.projeto.raiz();
    if (!b || !raiz) return null;
    const rel = b.caminho.replace(/\\/g, '/').replace(`${raiz.replace(/\\/g, '/')}/`, '');
    const sel = this.editor.instancia?.getSelection();
    const total = b.modelo.getLineCount();
    const temSelecao = !!sel && !sel.isEmpty();
    const linha = this.editor.cursor().linha;
    const ini = temSelecao ? sel!.startLineNumber : Math.max(1, linha - 8);
    const fim = temSelecao ? sel!.endLineNumber : Math.min(total, linha + 8);
    const linhas = b.modelo.getLinesContent().slice(ini - 1, fim).map((t, i) => `${String(ini + i).padStart(String(fim).length)}  ${t}`).join('\n');
    return {
      id: `codigo:${rel}:${ini}-${fim}`,
      rotulo: temSelecao ? `${b.nome}:${ini}-${fim}` : `${b.nome}:${linha}`,
      icone: '‹›',
      texto: corta(`${rel}, ${temSelecao ? `linhas ${ini}-${fim} (seleção)` : `em volta da linha ${linha}`}:\n${linhas}`),
    };
  }
}
