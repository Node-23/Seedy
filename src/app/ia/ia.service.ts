import { computed, inject, Injectable, isDevMode, signal } from '@angular/core';
import { nomeBase, ponte } from '../nucleo/ponte';
import { EditorService } from '../editor/editor.service';
import { ProjetoService } from '../nucleo/projeto.service';
import { EscolhaService } from '../escolha/escolha.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { ServidorService } from '../servidor/servidor.service';
import { FERRAMENTAS, FerramentasService } from './ferramentas.service';
import { RevisaoService } from './revisao.service';
import { BlocoDaApi, MensagemDaApi, pedirComStream, resultadoDeFerramenta } from './stream';

export interface PassoDaIa {
  rotulo: string;
  detalhe: string;
  ok: boolean | null;
}

export type ItemDaIa =
  | { tipo: 'usuario'; texto: string }
  | { tipo: 'texto'; texto: string }
  | { tipo: 'ferramentas'; passos: PassoDaIa[] }
  | { tipo: 'proposta'; alteracao: number }
  | { tipo: 'erro'; texto: string };

const MODELO = 'claude-opus-5-5';
const MAX_VOLTAS = 25;

const SISTEMA = `Você é a IA do Seedy, a IDE do usuário para projetos Java web (Struts/JSP, JBoss/WildFly, Tomcat, bancos PostgreSQL/MySQL/Oracle). Você opera a IDE pelas ferramentas: abre e lê código, vê os erros do jdtls, sobe e derruba o servidor de aplicação, lê o log, faz requisições HTTP à aplicação local e consulta os bancos configurados (só leitura).

Quando o usuário relatar um erro, reproduza antes de corrigir sempre que der (servidor, requisição, log) e confirme a causa no código. Para mudar código use propor_edicao: o usuário vê o diff e aceita ou recusa; a ferramenta devolve a decisão. Não peça para o usuário colar arquivos: leia você mesmo.

Responda em português do Brasil, curto e direto, citando arquivo:linha. Diga o que descobriu e o que propõe; não repita o conteúdo das ferramentas.`;

/** Painel de IA do mockup 06 (␣ a fora do merge): conversa que opera a IDE. */
@Injectable({ providedIn: 'root' })
export class IaService {
  private readonly ferramentas = inject(FerramentasService);
  private readonly revisao = inject(RevisaoService);
  private readonly editor = inject(EditorService);
  private readonly projeto = inject(ProjetoService);
  private readonly escolha = inject(EscolhaService);
  private readonly mensagens = inject(MensagensService);
  private readonly servidor = inject(ServidorService);

  readonly itens = signal<ItemDaIa[]>([]);
  readonly pensando = signal(false);
  /** Proposta esperando decisão nesta conversa (a statusline e o ⏎ do campo usam). */
  readonly pendente = computed(() => {
    const ids = new Set(this.itens().flatMap((i) => (i.tipo === 'proposta' ? [i.alteracao] : [])));
    return this.revisao.alteracoes().find((a) => ids.has(a.id) && a.estado === 'pendente') ?? null;
  });

  private historico: MensagemDaApi[] = [];
  private geracao = 0;

  constructor() {
    this.revisao.aoProporDaIa = (id) => this.registrarProposta(id);
    if (isDevMode()) Object.assign(window, { seedyIa: this });
  }

  reiniciar(): void {
    this.geracao++;
    this.historico = [];
    this.itens.set([]);
    this.pensando.set(false);
  }

  async enviar(texto: string): Promise<void> {
    const pergunta = texto.trim();
    if (!pergunta || this.pensando()) return;
    if (!(await this.garantirChave())) return;
    const contexto = this.contexto();
    this.historico.push({ role: 'user', content: [{ type: 'text', text: contexto ? `${contexto}\n\n${pergunta}` : pergunta }] });
    this.adicionar({ tipo: 'usuario', texto: pergunta });
    await this.rodar();
  }

  /** Situação da IDE agora (vai junto de cada mensagem, curto). */
  private contexto(): string {
    const partes: string[] = [];
    const raiz = this.projeto.raiz();
    if (raiz) partes.push(`Projeto: ${nomeBase(raiz)} (${raiz})`);
    const b = this.editor.bufferAtivo();
    if (b && raiz) {
      const rel = b.caminho.replace(/\\/g, '/').replace(raiz.replace(/\\/g, '/') + '/', '');
      partes.push(`Arquivo ativo: ${rel}, linha ${this.editor.cursor().linha}${this.editor.sujo(b) ? ' (com edições não salvas)' : ''}`);
    }
    const e = this.servidor.execucaoAtual();
    if (e && e.fase !== 'parado') partes.push(`Servidor: ${this.servidor.perfilAtual()?.nome} ${e.fase} em ${e.info?.url ?? '?'} (${e.erros} erros no log)`);
    return partes.length ? `(${partes.join(' · ')})` : '';
  }

  private async rodar(): Promise<void> {
    const minha = ++this.geracao;
    this.pensando.set(true);
    try {
      for (let volta = 0; volta < MAX_VOLTAS; volta++) {
        const itensDeTexto = new Map<number, ItemDaIa>();
        const r = await pedirComStream(
          this.corpo(),
          (i, t) => {
            const antigo = itensDeTexto.get(i);
            const novo: ItemDaIa = { tipo: 'texto', texto: t };
            if (antigo) this.substituir(antigo, novo);
            else this.adicionar(novo);
            itensDeTexto.set(i, novo);
          },
          () => minha === this.geracao,
        );
        if (minha !== this.geracao) return;
        this.historico.push({ role: 'assistant', content: r.conteudo });
        if (r.parada === 'refusal') return this.adicionar({ tipo: 'erro', texto: 'a IA recusou este pedido.' });
        const chamadas = r.conteudo.filter((b) => b.type === 'tool_use');
        if (r.parada === 'max_tokens') {
          this.adicionar({ tipo: 'erro', texto: 'a resposta passou do limite de tamanho e foi cortada.' });
          if (chamadas.length) this.historico.push({ role: 'user', content: chamadas.map((c) => resultadoDeFerramenta(c, 'cortado pelo limite de tamanho', true)) });
          return;
        }
        if (r.parada !== 'tool_use' || !chamadas.length) return;

        const passos: PassoDaIa[] = chamadas.map((c) => ({ rotulo: this.ferramentas.rotulo(String(c['name'])), detalhe: detalheDe(c), ok: null }));
        let item: ItemDaIa = { tipo: 'ferramentas', passos: [...passos] };
        this.adicionar(item);
        const resultados: BlocoDaApi[] = [];
        for (let i = 0; i < chamadas.length; i++) {
          const c = chamadas[i];
          let resultado: BlocoDaApi;
          const invalido = r.invalidos.get(String(c['id']));
          if (invalido !== undefined) resultado = resultadoDeFerramenta(c, JSON.stringify({ INVALID_JSON: invalido }), true);
          else {
            try {
              const saida = await this.ferramentas.executar(String(c['name']), (c['input'] ?? {}) as Record<string, unknown>, 'ia');
              resultado = resultadoDeFerramenta(c, saida);
              passos[i] = { ...passos[i], detalhe: passos[i].detalhe || resumo(saida) };
            } catch (e) {
              resultado = resultadoDeFerramenta(c, (e as Error).message ?? String(e), true);
            }
          }
          passos[i] = { ...passos[i], ok: !resultado['is_error'] };
          const novo: ItemDaIa = { tipo: 'ferramentas', passos: [...passos] };
          this.substituir(item, novo);
          item = novo;
          resultados.push(resultado);
        }
        if (minha !== this.geracao) return;
        this.historico.push({ role: 'user', content: resultados });
      }
      this.adicionar({ tipo: 'erro', texto: 'a IA usou ferramentas demais nesta resposta; mande outra mensagem para continuar.' });
    } catch (e) {
      if (minha === this.geracao) this.adicionar({ tipo: 'erro', texto: String(e) });
      while (this.historico.length && this.historico[this.historico.length - 1].role === 'user') this.historico.pop();
    } finally {
      if (minha === this.geracao) this.pensando.set(false);
    }
  }

  /** O cartão da proposta entra na conversa assim que a revisão a registra. */
  registrarProposta(id: number): void {
    this.adicionar({ tipo: 'proposta', alteracao: id });
  }

  private corpo(): unknown {
    return {
      model: MODELO,
      max_tokens: 64000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      fallbacks: 'default',
      cache_control: { type: 'ephemeral' },
      system: SISTEMA,
      tools: FERRAMENTAS.map((f) => ({ name: f.name, description: f.description, input_schema: f.input_schema, eager_input_streaming: true })),
      messages: this.historico,
    };
  }

  async garantirChave(): Promise<boolean> {
    if (await ponte.ia.temChave()) return true;
    const chave = await this.escolha.perguntar('CHAVE DA API DA ANTHROPIC', {
      placeholder: 'sk-ant-…',
      senha: true,
      dica: 'fica no arquivo ia.chave da pasta de configuração do Seedy (ou use ANTHROPIC_API_KEY)',
    });
    if (!chave) return false;
    try {
      await ponte.ia.definirChave(chave);
      return true;
    } catch (e) {
      this.mensagens.erro(String(e));
      return false;
    }
  }

  private adicionar(item: ItemDaIa): void {
    this.itens.update((l) => [...l, item]);
  }

  private substituir(antigo: ItemDaIa, novo: ItemDaIa): void {
    this.itens.update((l) => l.map((i) => (i === antigo ? novo : i)));
  }
}

function detalheDe(c: BlocoDaApi): string {
  const e = (c['input'] ?? {}) as Record<string, unknown>;
  const v = e['caminho'] ?? e['sql'] ?? e['texto'] ?? e['conexao'] ?? (e['debug'] ? 'debug' : '');
  return typeof v === 'string' ? (v.split(/[\\/]/).pop() ?? v).slice(0, 60) : '';
}

function resumo(saida: string): string {
  return saida.split('\n')[0].slice(0, 60);
}
