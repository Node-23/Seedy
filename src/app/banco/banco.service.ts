import { computed, inject, Injectable, isDevMode, signal } from '@angular/core';
import {
  ColunaDeTabela,
  InfoConexao,
  nomeBase,
  PerfilBanco,
  ponte,
  ResultadoSql,
  SchemaBanco,
} from '../nucleo/ponte';
import { EditorService } from '../editor/editor.service';
import { EscolhaService } from '../escolha/escolha.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { monaco } from '../editor/monaco';
import { apelidos, escreve, instrucaoNoCursor, instrucoes, PALAVRAS_SQL } from './sql';
import { haQuanto } from '../git/tempo';

/** O que a grade de resultado mostra para um arquivo .sql. */
export interface EstadoDoResultado {
  sql: string;
  perfilId: string;
  executando: boolean;
  resultado: ResultadoSql | null;
  erro: string | null;
}

const LIMITE_DE_LINHAS = 1000;
const CHAVE_DAS_ASSOCIACOES = 'seedy.sql-conexoes';
export const NOME_DO_AMBIENTE: Record<string, string> = { local: 'Local', homolog: 'Homolog', producao: 'Produção' };

/**
 * Banco de dados (Fase 3, mockup 03): conexões salvas, sessões abertas, qual conexão
 * cada arquivo .sql usa, executar (ctrl+⏎), explain, exportar CSV e histórico.
 */
@Injectable({ providedIn: 'root' })
export class BancoService {
  private readonly editor = inject(EditorService);
  private readonly escolha = inject(EscolhaService);
  private readonly mensagens = inject(MensagensService);

  readonly perfis = signal<PerfilBanco[]>([]);
  /** Sessões abertas (por id do perfil). */
  readonly sessoes = signal(new Map<string, InfoConexao>());
  readonly conectando = signal<string | null>(null);
  readonly catalogos = signal(new Map<string, SchemaBanco[]>());
  /** Colunas por perfil (do schema padrão), para a árvore e o autocompletar. */
  readonly colunas = signal(new Map<string, ColunaDeTabela[]>());
  /** Arquivo .sql → conexão que ele usa. */
  readonly associacoes = signal(new Map<string, string>(this.lerAssociacoes()));
  readonly resultados = signal(new Map<string, EstadoDoResultado>());
  /** Perfil em edição no formulário (null = fechado). */
  /** Perfil aberto no editor; `senha` vem preenchida quando o perfil nasce de um container (Fase 8). */
  readonly editando = signal<{ perfil: PerfilBanco; novo: boolean; senha?: string } | null>(null);

  /** O arquivo ativo é .sql? */
  readonly ehSql = computed(() => {
    const b = this.editor.bufferAtivo();
    return !!b && !b.somenteLeitura && /\.sql$/i.test(b.caminho);
  });
  /** Conexão do arquivo .sql ativo. */
  readonly perfilAtivo = computed(() => {
    const b = this.editor.bufferAtivo();
    if (!b || !this.ehSql()) return null;
    const id = this.associacoes().get(b.caminho);
    return this.perfis().find((p) => p.id === id) ?? null;
  });
  readonly sessaoAtiva = computed(() => {
    const p = this.perfilAtivo();
    return p ? (this.sessoes().get(p.id) ?? null) : null;
  });
  readonly resultadoAtivo = computed(() => {
    const b = this.editor.bufferAtivo();
    return b ? (this.resultados().get(b.caminho) ?? null) : null;
  });

  constructor() {
    void this.carregar();
    this.registrarAutocompletar();
    if (isDevMode()) Object.assign(window, { seedyBanco: this });
  }

  async carregar(): Promise<void> {
    try {
      this.perfis.set(await ponte.banco.perfis());
    } catch (e) {
      this.mensagens.erro(`conexões: ${e}`);
    }
  }

  perfil(id: string): PerfilBanco | undefined {
    return this.perfis().find((p) => p.id === id);
  }

  conectado(id: string): boolean {
    return this.sessoes().has(id);
  }

  // ---------- perfis ----------

  novo(): void {
    this.editando.set({
      novo: true,
      perfil: {
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        nome: '',
        ambiente: 'local',
        tipo: 'postgres',
        host: 'localhost',
        porta: 5432,
        banco: '',
        usuario: '',
        somenteLeitura: false,
        ssl: 'desligado',
        ssh: null,
      },
    });
  }

  editar(id: string): void {
    const p = this.perfil(id);
    if (p) this.editando.set({ novo: false, perfil: { ...p } });
  }

  /** Grava o perfil (senha: texto = guarda no cofre; null = não mexe) e, se pedido, conecta. */
  async salvar(perfil: PerfilBanco, senha: string | null, conectar: boolean): Promise<boolean> {
    try {
      await ponte.banco.salvarPerfil(perfil, senha);
    } catch (e) {
      this.mensagens.erro(String(e));
      return false;
    }
    await this.carregar();
    this.editando.set(null);
    // Mudou o perfil: a sessão antiga não vale mais.
    if (this.conectado(perfil.id)) await this.desconectar(perfil.id);
    if (conectar) await this.conectar(perfil.id);
    else this.mensagens.mostrar(`conexão ${perfil.nome} salva`);
    return true;
  }

  async apagar(id: string): Promise<void> {
    const p = this.perfil(id);
    if (!p) return;
    const ok = await this.escolha.escolherUm(`APAGAR A CONEXÃO ${p.nome.toUpperCase()}?`, [
      { rotulo: 'Apagar', detalhe: 'o perfil, a senha guardada e o histórico', valor: true },
      { rotulo: 'Cancelar', valor: false },
    ]);
    if (!ok) return;
    await ponte.banco.apagarPerfil(id);
    this.esquecerSessao(id);
    await this.carregar();
  }

  // ---------- sessões ----------

  /** Conecta (perguntando a senha se não houver uma guardada). true = conectado. */
  async conectar(id: string, senha: string | null = null): Promise<boolean> {
    const p = this.perfil(id);
    if (!p || this.conectando()) return false;
    this.conectando.set(id);
    this.mensagens.mostrar(`conectando em ${p.nome}${p.ssh ? ` (túnel ssh ${p.ssh})` : ''}…`);
    try {
      const info = await ponte.banco.conectar(id, senha, false);
      this.sessoes.update((m) => new Map(m).set(id, info));
      this.mensagens.mostrar(`conectado: ${p.nome} · ${info.versao}${p.somenteLeitura ? ' · somente leitura' : ''}`);
      void this.carregarCatalogo(id);
      return true;
    } catch (e) {
      const erro = String(e);
      if (erro.includes('SEM_SENHA')) {
        this.conectando.set(null);
        return this.pedirSenhaEConectar(p);
      }
      this.mensagens.erro(erro);
      return false;
    } finally {
      if (this.conectando() === id) this.conectando.set(null);
    }
  }

  private async pedirSenhaEConectar(p: PerfilBanco): Promise<boolean> {
    const senha = await this.escolha.perguntar(`SENHA DE ${p.usuario}@${p.nome.toUpperCase()}`, {
      senha: true,
      dica: 'para guardar no cofre do sistema, edite a conexão (e)',
    });
    if (senha === null) return false;
    return this.conectar(p.id, senha);
  }

  async desconectar(id: string): Promise<void> {
    await ponte.banco.desconectar(id).catch(() => undefined);
    this.esquecerSessao(id);
  }

  private esquecerSessao(id: string): void {
    this.sessoes.update((m) => {
      const n = new Map(m);
      n.delete(id);
      return n;
    });
  }

  async carregarCatalogo(id: string): Promise<void> {
    const p = this.perfil(id);
    if (!p) return;
    try {
      const [cat, cols] = await Promise.all([ponte.banco.catalogo(id), ponte.banco.colunas(id, this.schemaPadrao(p))]);
      this.catalogos.update((m) => new Map(m).set(id, cat));
      this.colunas.update((m) => new Map(m).set(id, cols));
    } catch (e) {
      this.mensagens.erro(`catálogo: ${e}`);
    }
  }

  schemaPadrao(p: PerfilBanco): string {
    return p.tipo === 'postgres' ? 'public' : p.tipo === 'mysql' ? p.banco : p.usuario.toUpperCase();
  }

  // ---------- arquivos .sql ----------

  /** Abre o console da conexão (um .sql dela) no editor. */
  async abrirConsole(id: string): Promise<void> {
    const caminho = await ponte.banco.console(id);
    this.associar(caminho, id);
    await this.editor.abrir(caminho);
    if (!this.conectado(id)) await this.conectar(id);
  }

  associar(caminho: string, id: string): void {
    this.associacoes.update((m) => new Map(m).set(caminho, id));
    try {
      localStorage.setItem(CHAVE_DAS_ASSOCIACOES, JSON.stringify([...this.associacoes()]));
    } catch {
      /* sem armazenamento: vale só nesta sessão */
    }
  }

  private lerAssociacoes(): [string, string][] {
    try {
      return JSON.parse(localStorage.getItem(CHAVE_DAS_ASSOCIACOES) ?? '[]');
    } catch {
      return [];
    }
  }

  /** Escolhe a conexão do .sql ativo. */
  async escolherConexao(): Promise<string | null> {
    const b = this.editor.bufferAtivo();
    if (!b || !this.ehSql()) {
      this.mensagens.alerta('abra um arquivo .sql (ou o console de uma conexão)');
      return null;
    }
    if (!this.perfis().length) {
      this.novo();
      return null;
    }
    const id = await this.escolha.escolherUm(
      `CONEXÃO DE ${nomeBase(b.caminho).toUpperCase()}`,
      this.perfis().map((p) => ({
        rotulo: p.nome,
        detalhe: `${NOME_DO_AMBIENTE[p.ambiente] ?? p.ambiente} · ${p.tipo} · ${p.banco}${this.conectado(p.id) ? ' · conectado' : ''}`,
        valor: p.id,
      })),
    );
    if (id) this.associar(b.caminho, id);
    return id;
  }

  // ---------- executar ----------

  /** ctrl+⏎: a seleção, ou a instrução sob o cursor. */
  async executarNoCursor(explicar = false): Promise<void> {
    const ed = this.editor.instancia;
    const m = ed?.getModel();
    const b = this.editor.bufferAtivo();
    if (!ed || !m || !b || !this.ehSql()) return;
    const sel = ed.getSelection();
    let texto: string;
    let faixa: monaco.IRange;
    if (sel && !sel.isEmpty()) {
      texto = m.getValueInRange(sel);
      faixa = sel;
    } else {
      const pos = ed.getPosition() ?? { lineNumber: 1, column: 1 };
      const inst = instrucaoNoCursor(m.getValue(), m.getOffsetAt(pos));
      if (!inst) {
        this.mensagens.alerta('nada para executar');
        return;
      }
      texto = inst.texto;
      const a = m.getPositionAt(inst.inicio);
      const f = m.getPositionAt(inst.fim);
      faixa = new monaco.Range(a.lineNumber, a.column, f.lineNumber, f.column);
    }
    piscar(ed, faixa);
    await this.executar(b.caminho, explicar ? this.comoExplain(texto) : texto);
  }

  private comoExplain(texto: string): string {
    const p = this.perfilAtivo();
    const t = texto.trim().replace(/;\s*$/, '');
    if (p?.tipo === 'oracle') return `EXPLAIN PLAN FOR ${t};\nSELECT plan_table_output FROM TABLE(DBMS_XPLAN.DISPLAY())`;
    return `EXPLAIN ${t}`;
  }

  async executar(caminho: string, sql: string): Promise<void> {
    let id = this.associacoes().get(caminho) ?? null;
    if (!id || !this.perfil(id)) id = await this.escolherConexao();
    const p = id ? this.perfil(id) : undefined;
    if (!id || !p) return;
    if (!this.conectado(id) && !(await this.conectar(id))) return;

    // Produção com escrita liberada: confirma antes de alterar.
    const escritas = instrucoes(sql).filter((i) => escreve(i.texto));
    if (p.ambiente === 'producao' && !p.somenteLeitura && escritas.length) {
      const ok = await this.escolha.escolherUm(
        'ALTERAR O BANCO DE PRODUÇÃO?',
        [
          { rotulo: 'Executar em Produção', detalhe: escritas[0].texto.replace(/\s+/g, ' ').slice(0, 90), valor: true },
          { rotulo: 'Cancelar', valor: false },
        ],
        `${escritas.length} ${escritas.length === 1 ? 'instrução altera' : 'instruções alteram'} ${p.nome}`,
      );
      if (!ok) return;
    }

    this.definirResultado(caminho, { sql, perfilId: id, executando: true, resultado: this.resultados().get(caminho)?.resultado ?? null, erro: null });
    try {
      const r = await ponte.banco.consultar(id, sql, LIMITE_DE_LINHAS);
      this.definirResultado(caminho, { sql, perfilId: id, executando: false, resultado: r, erro: null });
      const onde = `${NOME_DO_AMBIENTE[p.ambiente] ?? p.nome}${p.somenteLeitura ? ' (somente leitura)' : ''}`;
      this.mensagens.mostrar(r.afetadas !== null && !r.colunas.length ? `${r.afetadas} ${r.afetadas === 1 ? 'linha alterada' : 'linhas alteradas'} em ${onde}` : `consulta executada em ${onde}`);
      // DDL muda a árvore.
      if (instrucoes(sql).some((i) => /^\s*(create|drop|alter|rename)\b/i.test(i.texto))) void this.carregarCatalogo(id);
    } catch (e) {
      const erro = String(e);
      this.definirResultado(caminho, { sql, perfilId: id, executando: false, resultado: null, erro });
      if (/conexão fechada|connection|closed|broken pipe|reset/i.test(erro)) this.esquecerSessao(id);
    }
  }

  private definirResultado(caminho: string, estado: EstadoDoResultado): void {
    this.resultados.update((m) => new Map(m).set(caminho, estado));
  }

  /** Exporta o resultado inteiro da última consulta do arquivo ativo para CSV. */
  async exportarCsv(): Promise<void> {
    const b = this.editor.bufferAtivo();
    const r = this.resultadoAtivo();
    if (!b || !r?.resultado?.colunas.length) {
      this.mensagens.mostrar('execute uma consulta antes de exportar');
      return;
    }
    const destino = await ponte.escolherOndeSalvar('Exportar CSV', nomeBase(b.caminho).replace(/\.sql$/i, '.csv'), 'csv');
    if (!destino) return;
    this.mensagens.mostrar('exportando…');
    try {
      const n = await ponte.banco.exportarCsv(r.perfilId, r.sql, destino);
      this.mensagens.mostrar(`${n} ${n === 1 ? 'linha exportada' : 'linhas exportadas'} para ${nomeBase(destino)}`);
    } catch (e) {
      this.mensagens.erro(String(e));
    }
  }

  /** Histórico da conexão do arquivo ativo: a escolhida vai para o editor (no cursor). */
  async historico(): Promise<void> {
    const p = this.perfilAtivo();
    const ed = this.editor.instancia;
    if (!p || !ed) {
      this.mensagens.mostrar('o histórico é da conexão do .sql aberto');
      return;
    }
    const h = await ponte.banco.historico(p.id);
    if (!h.length) {
      this.mensagens.alerta(`nada executado ainda em ${p.nome}`);
      return;
    }
    const agora = Date.now() / 1000;
    const sql = await this.escolha.escolherUm(
      `HISTÓRICO · ${p.nome.toUpperCase()}`,
      h.map((e) => ({
        rotulo: e.sql.replace(/\s+/g, ' ').slice(0, 110),
        detalhe: `${haQuanto(e.quando, agora)} · ${e.erro ? 'erro' : `${e.linhas ?? 0} linhas · ${e.ms} ms`}`,
        valor: e.sql,
      })),
      '⏎ insere no editor',
    );
    if (!sql) return;
    const pos = ed.getPosition() ?? { lineNumber: 1, column: 1 };
    ed.executeEdits('historico', [{ range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column), text: `${sql};\n` }]);
    ed.focus();
  }

  // ---------- autocompletar ----------

  private registrarAutocompletar(): void {
    monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: ['.', ' '],
      provideCompletionItems: (modelo, pos) => {
        const id = this.associacoes().get(nomeDeArquivo(modelo.uri)) ?? this.perfilAtivo()?.id;
        const cat = id ? this.catalogos().get(id) : undefined;
        const cols = id ? (this.colunas().get(id) ?? []) : [];
        const palavra = modelo.getWordUntilPosition(pos);
        const faixa = new monaco.Range(pos.lineNumber, palavra.startColumn, pos.lineNumber, palavra.endColumn);
        const antes = modelo.getValueInRange(new monaco.Range(pos.lineNumber, 1, pos.lineNumber, palavra.startColumn));
        const K = monaco.languages.CompletionItemKind;

        // "alias." → colunas da tabela daquele apelido.
        const ponto = /([A-Za-z_][\w$]*)\.$/.exec(antes);
        if (ponto) {
          const tabela = apelidos(modelo.getValue()).get(ponto[1].toLowerCase()) ?? ponto[1];
          return {
            suggestions: cols
              .filter((c) => c.tabela.toLowerCase() === tabela.toLowerCase())
              .map((c, i) => ({ label: c.coluna, kind: K.Field, detail: c.tipo, insertText: c.coluna, range: faixa, sortText: String(i).padStart(4, '0') })),
          };
        }
        const sugestoes: monaco.languages.CompletionItem[] = [];
        for (const s of cat ?? []) {
          for (const t of s.tabelas) sugestoes.push({ label: t, kind: K.Struct, detail: `tabela · ${s.nome}`, insertText: t, range: faixa, sortText: `1${t}` });
          for (const v of s.views) sugestoes.push({ label: v, kind: K.Interface, detail: `view · ${s.nome}`, insertText: v, range: faixa, sortText: `1${v}` });
          for (const f of s.funcoes) sugestoes.push({ label: f, kind: K.Function, detail: `função · ${s.nome}`, insertText: `${f}(`, range: faixa, sortText: `2${f}` });
        }
        // Colunas das tabelas que já aparecem na consulta.
        const usadas = new Set([...apelidos(modelo.getValue()).values()].map((t) => t.toLowerCase()));
        for (const c of cols) {
          if (usadas.has(c.tabela.toLowerCase())) sugestoes.push({ label: c.coluna, kind: K.Field, detail: `${c.tabela} · ${c.tipo}`, insertText: c.coluna, range: faixa, sortText: `0${c.coluna}` });
        }
        for (const k of PALAVRAS_SQL) sugestoes.push({ label: k, kind: K.Keyword, insertText: k, range: faixa, sortText: `3${k}` });
        return { suggestions: sugestoes };
      },
    });
  }
}

function nomeDeArquivo(uri: monaco.Uri): string {
  return uri.fsPath.replace(/^([a-z]):/, (_, l: string) => `${l.toUpperCase()}:`);
}

/** Destaca rapidamente o trecho que foi executado. */
function piscar(ed: monaco.editor.IStandaloneCodeEditor, faixa: monaco.IRange): void {
  const d = ed.createDecorationsCollection([{ range: faixa, options: { className: 'sql-executado' } }]);
  setTimeout(() => d.clear(), 450);
}
