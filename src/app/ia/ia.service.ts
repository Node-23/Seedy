import { computed, effect, inject, Injectable, isDevMode, signal, untracked } from '@angular/core';
import { nomeBase, ponte } from '../nucleo/ponte';
import { EditorService } from '../editor/editor.service';
import { ProjetoService } from '../nucleo/projeto.service';
import { EscolhaService } from '../escolha/escolha.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { ServidorService } from '../servidor/servidor.service';
import { FERRAMENTAS, FerramentasService } from './ferramentas.service';
import { AnexosService } from './anexos.service';
import { AprovacoesService } from './aprovacoes.service';
import { RevisaoService } from './revisao.service';
import { ConfigService } from '../config/config.service';
import { BlocoDaApi, MensagemDaApi, pedirComStream, resultadoDeFerramenta } from './stream';

export interface PassoDaIa {
  rotulo: string;
  detalhe: string;
  ok: boolean | null;
}

export type ItemDaIa =
  | { tipo: 'usuario'; texto: string; anexos?: string[] }
  | { tipo: 'texto'; texto: string }
  | { tipo: 'ferramentas'; passos: PassoDaIa[] }
  | { tipo: 'proposta'; alteracao: number }
  | { tipo: 'erro'; texto: string };

const MAX_VOLTAS = 25;
const LIMITE_DA_CONVERSA = 400_000;
const chaveDaConversa = (raiz: string) => `seedy.ia.conversa:${raiz}`;

const SISTEMA = `Você é a IA do Seedy, a IDE do usuário para projetos Java web (Struts/JSP, JBoss/WildFly, Tomcat, bancos PostgreSQL/MySQL/Oracle). Você opera a IDE pelas ferramentas: abre e lê código, vê os erros do jdtls, configura, sobe e derruba o servidor de aplicação (servidor_criar, servidor_iniciar), roda comandos de build e de projeto com a aprovação do usuário (executar_comando), lê o log, faz requisições HTTP à aplicação local e consulta os bancos configurados (só leitura).

Quando o usuário relatar um erro, reproduza antes de corrigir sempre que der (servidor, requisição, log) e confirme a causa no código. Para mudar código use propor_edicao: o usuário vê o diff e aceita ou recusa; a ferramenta devolve a decisão. Não peça para o usuário colar arquivos: leia você mesmo.

Quando pedirem para rodar o sistema: leia o README e os arquivos de build, veja servidor_estado; sem servidor configurado, procure a instalação (cloud/, dev/, README) e use servidor_criar; compile com executar_comando se a pasta de classes não existir; suba com servidor_iniciar e confirme pelo log e por uma requisição. Não diga que falta ferramenta antes de tentar essas.

Responda em português do Brasil, curto e direto, citando arquivo:linha. Diga o que descobriu e o que propõe; não repita o conteúdo das ferramentas.`;

/** Painel de IA do mockup 06 (␣ a fora do merge): conversa que opera a IDE. */
@Injectable({ providedIn: 'root' })
export class IaService {
  private readonly config = inject(ConfigService);
  private readonly ferramentas = inject(FerramentasService);
  private readonly revisao = inject(RevisaoService);
  private readonly editor = inject(EditorService);
  private readonly projeto = inject(ProjetoService);
  private readonly escolha = inject(EscolhaService);
  private readonly mensagens = inject(MensagensService);
  private readonly servidor = inject(ServidorService);
  private readonly anexos = inject(AnexosService);
  private readonly aprovacoes = inject(AprovacoesService);

  readonly itens = signal<ItemDaIa[]>([]);
  readonly pensando = signal(false);
  /** Proposta esperando decisão nesta conversa (a statusline e o ⏎ do campo usam). */
  readonly pendente = computed(() => {
    const ids = new Set(this.itens().flatMap((i) => (i.tipo === 'proposta' ? [i.alteracao] : [])));
    return this.revisao.alteracoes().find((a) => ids.has(a.id) && a.estado === 'pendente') ?? null;
  });

  private historico: MensagemDaApi[] = [];
  private geracao = 0;

  /** Projeto da conversa atual: cada projeto tem a sua conversa (guardada ao sair, retomada ao voltar). */
  private raizDaConversa: string | null | undefined;
  private temporizadorDeSalvar: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    effect(() => {
      const raiz = this.projeto.raiz();
      untracked(() => {
        const trocou = this.raizDaConversa !== undefined && this.raizDaConversa !== raiz;
        const anterior = this.raizDaConversa;
        this.raizDaConversa = raiz;
        if (anterior === undefined) {
          // Abriu o Seedy já com um projeto: retoma a conversa dele.
          if (raiz && this.retomarConversa(raiz)) this.mensagens.mostrar(`conversa da IA retomada (${nomeBase(raiz)})`);
          return;
        }
        if (!trocou) return;
        clearTimeout(this.temporizadorDeSalvar);
        if (anterior && !this.pensando()) this.guardarConversa(anterior);
        this.limparMemoria();
        if (raiz && this.retomarConversa(raiz)) this.mensagens.mostrar(`conversa da IA retomada (${nomeBase(raiz)})`);
        else if (anterior) this.mensagens.mostrar('conversa da IA: projeto novo, começa do zero');
      });
    });
    // Guarda a conversa aos poucos (quando a IA termina de responder), para sobreviver a fechar o Seedy.
    effect(() => {
      this.itens();
      const pensando = this.pensando();
      untracked(() => {
        clearTimeout(this.temporizadorDeSalvar);
        const raiz = this.raizDaConversa;
        if (raiz && !pensando) this.temporizadorDeSalvar = setTimeout(() => this.guardarConversa(raiz), 800);
      });
    });
    this.revisao.aoProporDaIa = (id) => this.registrarProposta(id);
    if (isDevMode()) Object.assign(window, { seedyIa: this });
  }

  /** `/clear`: zera a conversa e apaga a que estava guardada deste projeto. */
  reiniciar(): void {
    this.limparMemoria();
    const raiz = this.raizDaConversa;
    if (raiz) {
      try {
        localStorage.removeItem(chaveDaConversa(raiz));
      } catch {
        /* sem armazenamento: nada guardado */
      }
    }
  }

  private limparMemoria(): void {
    this.geracao++;
    this.historico = [];
    this.itens.set([]);
    this.pensando.set(false);
  }

  /** Guarda a conversa do projeto (sem as propostas, que dependem da revisão da sessão). */
  private guardarConversa(raiz: string): void {
    const itens = this.itens().filter((i) => i.tipo !== 'proposta');
    try {
      if (!itens.length) return void localStorage.removeItem(chaveDaConversa(raiz));
      let h = this.historico;
      let texto = JSON.stringify({ itens, historico: h });
      // Conversa grande demais: fica com o final.
      while (texto.length > LIMITE_DA_CONVERSA && h.length > 2) {
        h = h.slice(Math.ceil(h.length / 4));
        while (h.length && !(h[0].role === 'user' && Array.isArray(h[0].content) && h[0].content.some((b) => b.type === 'text'))) h = h.slice(1);
        texto = JSON.stringify({ itens: itens.slice(-Math.max(10, Math.floor(itens.length / 2))), historico: h });
      }
      localStorage.setItem(chaveDaConversa(raiz), texto);
    } catch {
      /* sem armazenamento ou cheio: a conversa não é retomada depois */
    }
  }

  /** Volta a conversa guardada do projeto; true se havia uma. */
  private retomarConversa(raiz: string): boolean {
    try {
      const bruto = localStorage.getItem(chaveDaConversa(raiz));
      if (!bruto) return false;
      const c = JSON.parse(bruto) as { itens?: ItemDaIa[]; historico?: MensagemDaApi[] };
      if (!Array.isArray(c.itens) || !c.itens.length || !Array.isArray(c.historico)) return false;
      this.itens.set(c.itens);
      this.historico = c.historico;
      return true;
    } catch {
      return false;
    }
  }


  /**
   * Comandos do chat (`/clear`, `/limpar`, `/novo`): zeram a conversa, mesmo no meio de uma
   * resposta. Devolve true se o texto era um comando (e então não vai para a IA).
   */
  comando(texto: string): boolean {
    const c = texto.trim().toLowerCase();
    if (c === '/historico' || c === '/histórico') {
      this.adicionar({ tipo: 'texto', texto: this.aprovacoes.texto() });
      return true;
    }
    if (c !== '/clear' && c !== '/limpar' && c !== '/novo') return false;
    this.reiniciar();
    this.mensagens.mostrar('conversa zerada');
    return true;
  }

  async enviar(texto: string): Promise<void> {
    const pergunta = texto.trim();
    if (!pergunta || this.pensando()) return;
    if (!(await this.garantirChave())) return;
    const contexto = this.contexto();
    const anexos = this.anexos.lista();
    const completa = `${this.anexos.texto()}${pergunta}`;
    this.historico.push({ role: 'user', content: [{ type: 'text', text: contexto ? `${contexto}\n\n${completa}` : completa }] });
    this.adicionar({ tipo: 'usuario', texto: pergunta, ...(anexos.length ? { anexos: anexos.map((a) => a.rotulo) } : {}) });
    this.anexos.lista.set([]);
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
      model: this.config.atual().ia.modelo,
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
