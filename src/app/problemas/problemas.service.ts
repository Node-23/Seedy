import { computed, inject, Injectable, signal } from '@angular/core';
import { monaco } from '../editor/monaco';
import { EditorService } from '../editor/editor.service';
import { JdtlsService } from '../java/jdtls.service';
import { LayoutService } from '../layout/layout.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { ProjetoService } from '../nucleo/projeto.service';

export interface Problema {
  uri: string;
  linha: number;
  coluna: number;
  erro: boolean;
  mensagem: string;
}

export interface ArquivoComProblemas {
  uri: string;
  nome: string;
  pasta: string;
  problemas: Problema[];
}

export type FiltroDeProblemas = 'tudo' | 'erros' | 'atual';

/**
 * Os erros e avisos do projeto inteiro (mockup 45): os do jdtls vêm dele (inclusive de arquivos
 * fechados); os da web (TypeScript, Angular, ESLint), dos marcadores dos arquivos abertos.
 */
@Injectable({ providedIn: 'root' })
export class ProblemasService {
  private readonly editor = inject(EditorService);
  private readonly jdtls = inject(JdtlsService);
  private readonly layout = inject(LayoutService);
  private readonly mensagens = inject(MensagensService);
  private readonly projeto = inject(ProjetoService);

  /** Muda quando os marcadores mudam (o jdtls e os servidores web os gravam no Monaco). */
  private readonly versao = signal(0);
  readonly filtro = signal<FiltroDeProblemas>('tudo');

  readonly todos = computed<Problema[]>(() => {
    this.versao();
    this.jdtls.versaoDosDiagnosticos();
    const raiz = this.projeto.raiz();
    if (!raiz) return [];
    const base = monaco.Uri.file(raiz).toString().toLowerCase();
    const doProjeto = (uri: string) => uri.toLowerCase().startsWith(`${base}/`);
    const saida: Problema[] = [];
    for (const [uri, lista] of this.jdtls.todosOsDiagnosticos()) {
      if (!doProjeto(uri)) continue;
      for (const d of lista) {
        const severidade = d.severity ?? 1;
        if (severidade > 2) continue;
        saida.push({ uri, linha: d.range.start.line + 1, coluna: d.range.start.character + 1, erro: severidade === 1, mensagem: d.message });
      }
    }
    for (const m of monaco.editor.getModelMarkers({})) {
      const uri = m.resource.toString();
      if (m.owner === 'jdtls' || m.severity < monaco.MarkerSeverity.Warning || !doProjeto(uri)) continue;
      saida.push({ uri, linha: m.startLineNumber, coluna: m.startColumn, erro: m.severity === monaco.MarkerSeverity.Error, mensagem: m.message });
    }
    return saida.sort((a, b) => a.uri.localeCompare(b.uri) || a.linha - b.linha || a.coluna - b.coluna);
  });

  readonly erros = computed(() => this.todos().filter((p) => p.erro).length);
  readonly avisos = computed(() => this.todos().length - this.erros());

  readonly arquivos = computed<ArquivoComProblemas[]>(() => {
    const filtro = this.filtro();
    const ativo = this.editor.bufferAtivo()?.modelo.uri.toString().toLowerCase();
    const raiz = this.projeto.raiz() ?? '';
    const grupos = new Map<string, ArquivoComProblemas>();
    for (const p of this.todos()) {
      if (filtro === 'erros' && !p.erro) continue;
      if (filtro === 'atual' && p.uri.toLowerCase() !== ativo) continue;
      let g = grupos.get(p.uri);
      if (!g) {
        const caminho = this.caminhoDe(p.uri);
        const dentro = (caminho.toLowerCase().startsWith(raiz.toLowerCase()) ? caminho.slice(raiz.length) : caminho).split(/[\\/]/).filter(Boolean);
        const nome = dentro.pop() ?? this.projeto.nome() ?? 'projeto';
        grupos.set(p.uri, (g = { uri: p.uri, nome, pasta: dentro.join('/'), problemas: [] }));
      }
      g.problemas.push(p);
    }
    // Quem tem erro vem primeiro.
    return [...grupos.values()].sort((a, b) => Number(b.problemas.some((p) => p.erro)) - Number(a.problemas.some((p) => p.erro)));
  });

  constructor() {
    monaco.editor.onDidChangeMarkers(() => this.versao.update((v) => v + 1));
  }

  private caminhoDe(uri: string): string {
    return monaco.Uri.parse(uri).fsPath.replace(/^([a-z]):/, (_, l: string) => `${l.toUpperCase()}:`);
  }

  async ir(p: Problema): Promise<void> {
    this.layout.tela.set('editor');
    await this.editor.abrir(this.caminhoDe(p.uri), p.linha, p.coluna);
  }

  /** F8 / Shift+F8: o próximo (ou anterior) erro ou aviso a partir do cursor, dando a volta. */
  async proximo(passo: 1 | -1): Promise<void> {
    const lista = this.todos();
    // Havendo erros, o F8 anda só neles; sem erros, nos avisos.
    const alvos = lista.some((p) => p.erro) ? lista.filter((p) => p.erro) : lista;
    if (!alvos.length) return this.mensagens.mostrar('nenhum erro ou aviso no projeto');
    const uri = this.editor.bufferAtivo()?.modelo.uri.toString() ?? '';
    const pos = this.editor.instancia?.getPosition() ?? { lineNumber: 0, column: 0 };
    const depois = (p: Problema) => p.uri.localeCompare(uri) || p.linha - pos.lineNumber || p.coluna - pos.column;
    const achado = passo > 0 ? alvos.find((p) => depois(p) > 0) ?? alvos[0] : [...alvos].reverse().find((p) => depois(p) < 0) ?? alvos[alvos.length - 1];
    await this.ir(achado);
    this.mensagens.mostrar(`${alvos.indexOf(achado) + 1}/${alvos.length}: ${achado.mensagem.split('\n')[0]}`);
  }
}
