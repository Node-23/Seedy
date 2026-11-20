import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { ponte } from '../nucleo/ponte';
import { GitService } from '../git/git.service';
import { ContextoDoMerge, MergeService } from '../git/merge.service';
import { EscolhaService } from '../escolha/escolha.service';
import { MensagensService } from '../nucleo/mensagens.service';

/** Bloco de conteúdo da Messages API (texto, thinking, tool_use, tool_result...), guardado como veio. */
type BlocoDaApi = { type: string; [campo: string]: unknown };
interface MensagemDaApi {
  role: 'user' | 'assistant';
  content: BlocoDaApi[];
}

export interface PassoDeFerramenta {
  nome: string;
  detalhe: string;
  ok: boolean | null;
}

export type ItemDoChat =
  | { tipo: 'usuario'; texto: string }
  | { tipo: 'texto'; texto: string }
  | { tipo: 'ferramentas'; passos: PassoDeFerramenta[] }
  | { tipo: 'proposta'; conflito: number; linhas: string[]; antes: string[]; estado: 'pendente' | 'aplicada' | 'recusada' }
  | { tipo: 'erro'; texto: string };

const MODELO = 'claude-opus-5-5';
const MAX_VOLTAS = 12;
const LIMITE_DE_ARQUIVO = 200_000;

const SISTEMA = `Você ajuda a resolver conflitos de merge dentro do Seedy, uma IDE. O usuário vê três colunas: a versão dele ("seu"), o resultado que será gravado e a versão "deles"; cada conflito aparece no resultado como uma caixa numerada.

Entenda o que cada lado quis fazer. Quando o trecho não basta, leia o código relacionado com ler_arquivo e veja o motivo das mudanças com historico_git. Proponha a resolução com propor_resolucao: uma chamada por conflito, com o código exato que entra no lugar do conflito (sem marcadores de merge, com a indentação do arquivo), preservando o que cada lado queria sempre que isso fizer sentido.

Responda em português do Brasil, em poucas frases: o que cada lado mudou e por que a proposta junta os dois. Se não der para juntar com segurança, diga o que falta saber em vez de adivinhar. Quem decide é o usuário: ele aplica ou recusa cada proposta.`;

const FERRAMENTAS = [
  {
    name: 'ler_arquivo',
    description:
      'Lê um arquivo do repositório (só leitura). Use para ver o código que o trecho em conflito chama ou de que depende. O caminho é relativo à raiz do repositório, com "/".',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: { caminho: { type: 'string', description: 'Ex.: src/main/java/br/com/app/Pagamento.java' } },
      required: ['caminho'],
      additionalProperties: false,
    },
  },
  {
    name: 'historico_git',
    description:
      'Commits recentes que mexeram num arquivo, separados por lado: "<" são commits só do seu lado, ">" só do lado deles. Use para entender a intenção de cada mudança.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: { caminho: { type: 'string', description: 'Caminho relativo à raiz do repositório' } },
      required: ['caminho'],
      additionalProperties: false,
    },
  },
  {
    name: 'propor_resolucao',
    description:
      'Mostra ao usuário uma resolução para um conflito: o código substitui a caixa do conflito no resultado quando ele aplicar. Uma chamada por conflito.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        conflito: { type: 'integer', description: 'Número do conflito (o N de "conflito N")' },
        codigo: { type: 'string', description: 'Linhas que entram no lugar do conflito, exatamente como devem ficar no arquivo' },
      },
      required: ['conflito', 'codigo'],
      additionalProperties: false,
    },
  },
];

/**
 * Chat da IA no merge em três colunas (mockup 10): conversa sobre os conflitos do arquivo
 * aberto, com ferramentas só de leitura e propostas que o usuário aplica ou recusa.
 */
@Injectable({ providedIn: 'root' })
export class IaMergeService {
  private readonly merge = inject(MergeService);
  private readonly git = inject(GitService);
  private readonly escolha = inject(EscolhaService);
  private readonly mensagens = inject(MensagensService);

  readonly aberto = signal(false);
  readonly itens = signal<ItemDoChat[]>([]);
  readonly pensando = signal(false);
  /** Proposta que está na prévia do resultado, esperando aplicar/recusar. */
  readonly pendente = computed(() => {
    const itens = this.itens();
    for (let i = itens.length - 1; i >= 0; i--) {
      const it = itens[i];
      if (it.tipo === 'proposta' && it.estado === 'pendente') return it;
    }
    return null;
  });

  private historico: MensagemDaApi[] = [];
  /** Avisos para a IA sobre o que o usuário fez (aplicou, recusou), enviados com a próxima mensagem. */
  private avisos: string[] = [];
  /** Entradas de ferramenta que chegaram como JSON inválido (por id da chamada). */
  private readonly invalidos = new Map<string, string>();
  /** Cada conversa nova invalida os eventos de uma resposta antiga que ainda chegue. */
  private geracao = 0;

  constructor() {
    // Outro arquivo no merge (ou fim do merge): conversa nova.
    effect(() => {
      this.merge.arquivo();
      untracked(() => this.reiniciar());
    });
  }

  alternar(): void {
    this.aberto.update((v) => !v);
    if (!this.aberto()) this.merge.acoes?.focarResultado();
  }

  reiniciar(): void {
    this.geracao++;
    this.historico = [];
    this.avisos = [];
    this.invalidos.clear();
    this.itens.set([]);
    this.pensando.set(false);
    this.merge.previa.set(null);
  }

  /** Manda uma pergunta (ou pedido) e roda a resposta até o fim, com as ferramentas. */
  async enviar(texto: string): Promise<void> {
    const pergunta = texto.trim();
    if (!pergunta || this.pensando()) return;
    const contexto = this.merge.acoes?.contexto();
    if (!contexto) return;
    if (!(await this.garantirChave())) return;

    const blocos: BlocoDaApi[] = [];
    if (!this.historico.length) blocos.push({ type: 'text', text: textoDoContexto(contexto) });
    const estado = estadoDosConflitos(contexto);
    const notas = [...this.avisos, estado].filter(Boolean).join('\n');
    this.avisos = [];
    blocos.push({ type: 'text', text: notas ? `${notas}\n\n${pergunta}` : pergunta });
    this.historico.push({ role: 'user', content: blocos });
    this.adicionar({ tipo: 'usuario', texto: pergunta });
    await this.rodar();
  }

  /** Aplica a proposta pendente no resultado. */
  aplicar(): void {
    const p = this.pendente();
    if (!p) return;
    if (!this.merge.acoes?.aplicarIA(p.conflito, p.linhas)) {
      this.mensagens.erro(`o conflito ${p.conflito} já foi resolvido`);
      this.marcar(p, 'recusada');
      return;
    }
    this.marcar(p, 'aplicada');
    this.avisos.push(`(O usuário aplicou a proposta do conflito ${p.conflito}.)`);
    this.mensagens.mostrar(`conflito ${p.conflito} resolvido pela IA`);
  }

  recusar(): void {
    const p = this.pendente();
    if (!p) return;
    this.marcar(p, 'recusada');
    this.avisos.push(`(O usuário recusou a proposta do conflito ${p.conflito}.)`);
  }

  /** ^r: recusa a proposta e pede outra abordagem. */
  async outra(): Promise<void> {
    const p = this.pendente();
    if (!p) return;
    this.marcar(p, 'recusada');
    await this.enviar(`Não gostei da proposta para o conflito ${p.conflito}. Proponha outra abordagem.`);
  }

  // ---------- conversa ----------

  private async rodar(): Promise<void> {
    const minha = ++this.geracao;
    this.pensando.set(true);
    try {
      for (let volta = 0; volta < MAX_VOLTAS; volta++) {
        const resposta = await this.pedir(minha);
        if (minha !== this.geracao) return;
        this.historico.push({ role: 'assistant', content: resposta.conteudo });

        if (resposta.parada === 'refusal') {
          this.adicionar({ tipo: 'erro', texto: 'a IA recusou este pedido.' });
          return;
        }
        const chamadas = resposta.conteudo.filter((b) => b.type === 'tool_use');
        if (resposta.parada === 'max_tokens') {
          this.adicionar({ tipo: 'erro', texto: 'a resposta passou do limite de tamanho e foi cortada.' });
          // Uma ferramenta cortada no meio não roda; a conversa fica respondida para seguir depois.
          if (chamadas.length) this.historico.push({ role: 'user', content: chamadas.map((c) => resultado(c, 'cortado pelo limite de tamanho', true)) });
          return;
        }
        if (resposta.parada !== 'tool_use' || !chamadas.length) return;

        const passos: PassoDeFerramenta[] = chamadas.map((c) => ({ nome: String(c['name']), detalhe: detalheDe(c), ok: null }));
        let item: ItemDoChat = { tipo: 'ferramentas', passos: [...passos] };
        if (chamadas.some((c) => c['name'] !== 'propor_resolucao')) this.adicionar(item);
        const resultados: BlocoDaApi[] = [];
        for (let i = 0; i < chamadas.length; i++) {
          const r = await this.executar(chamadas[i]);
          passos[i] = { ...passos[i], ok: !r['is_error'] };
          const novo: ItemDoChat = { tipo: 'ferramentas', passos: [...passos] };
          this.substituir(item, novo);
          item = novo;
          resultados.push(r);
        }
        if (minha !== this.geracao) return;
        this.historico.push({ role: 'user', content: resultados });
      }
      this.adicionar({ tipo: 'erro', texto: 'a IA usou ferramentas demais nesta resposta; mande outra mensagem para continuar.' });
    } catch (e) {
      if (minha === this.geracao) this.adicionar({ tipo: 'erro', texto: String(e) });
      // A pergunta sem resposta sai do histórico (a próxima mensagem recomeça dali).
      while (this.historico.length && this.historico[this.historico.length - 1].role === 'user') this.historico.pop();
    } finally {
      if (minha === this.geracao) this.pensando.set(false);
    }
  }

  /** Um pedido à API com streaming: o texto aparece no chat enquanto chega. */
  private async pedir(minha: number): Promise<{ conteudo: BlocoDaApi[]; parada: string | null }> {
    const blocos: BlocoDaApi[] = [];
    const jsonParcial = new Map<number, string>();
    const itensDeTexto = new Map<number, ItemDoChat>();
    let parada: string | null = null;
    let fim = false;
    let erro: string | null = null;

    const aoEvento = (dados: string) => {
      if (minha !== this.geracao) return;
      let ev: Record<string, any>;
      try {
        ev = JSON.parse(dados);
      } catch {
        return;
      }
      switch (ev['type']) {
        case 'content_block_start': {
          const bloco = { ...ev['content_block'] } as BlocoDaApi;
          blocos[ev['index']] = bloco;
          if (bloco.type === 'tool_use') jsonParcial.set(ev['index'], '');
          if (bloco.type === 'text') {
            const item: ItemDoChat = { tipo: 'texto', texto: String(bloco['text'] ?? '') };
            itensDeTexto.set(ev['index'], item);
            this.adicionar(item);
          }
          break;
        }
        case 'content_block_delta': {
          const bloco = blocos[ev['index']];
          const d = ev['delta'];
          if (!bloco) break;
          if (d.type === 'text_delta') {
            bloco['text'] = String(bloco['text'] ?? '') + d.text;
            const antigo = itensDeTexto.get(ev['index']);
            if (antigo) {
              const novo: ItemDoChat = { tipo: 'texto', texto: String(bloco['text']) };
              this.substituir(antigo, novo);
              itensDeTexto.set(ev['index'], novo);
            }
          } else if (d.type === 'thinking_delta') bloco['thinking'] = String(bloco['thinking'] ?? '') + d.thinking;
          else if (d.type === 'signature_delta') bloco['signature'] = d.signature;
          else if (d.type === 'input_json_delta') jsonParcial.set(ev['index'], (jsonParcial.get(ev['index']) ?? '') + d.partial_json);
          else if (d.type === 'citations_delta') bloco['citations'] = [...((bloco['citations'] as unknown[]) ?? []), d.citation];
          break;
        }
        case 'content_block_stop': {
          const bloco = blocos[ev['index']];
          if (bloco?.type === 'tool_use') {
            const bruto = jsonParcial.get(ev['index']) ?? '';
            try {
              bloco['input'] = bruto ? JSON.parse(bruto) : {};
            } catch {
              // Entrada que não é JSON válido (o stream não valida): a ferramenta responde o erro.
              bloco['input'] = {};
              this.invalidos.set(String(bloco['id']), bruto);
            }
          }
          break;
        }
        case 'message_delta':
          parada = ev['delta']?.['stop_reason'] ?? parada;
          break;
        case 'message_stop':
          fim = true;
          break;
        case 'error':
          erro = ev['error']?.['message'] ?? 'erro na resposta da IA';
          break;
      }
    };

    await ponte.ia.mensagem(this.corpo(), aoEvento);
    // Os últimos eventos do canal podem chegar logo depois do fim do comando.
    for (let i = 0; i < 40 && !fim && !erro; i++) await new Promise((r) => setTimeout(r, 50));
    if (erro) throw new Error(erro);
    if (!fim) throw new Error('a resposta da IA terminou no meio');
    return { conteudo: limparParaEcoar(blocos.filter(Boolean)), parada };
  }

  private corpo(): unknown {
    return {
      model: MODELO,
      max_tokens: 64000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      // Recusa por segurança: o servidor tenta outro modelo na mesma chamada.
      fallbacks: 'default',
      cache_control: { type: 'ephemeral' },
      system: SISTEMA,
      tools: FERRAMENTAS,
      messages: this.historico,
    };
  }

  // ---------- ferramentas ----------

  private async executar(c: BlocoDaApi): Promise<BlocoDaApi> {
    const invalido = this.invalidos.get(String(c['id']));
    if (invalido !== undefined) return resultado(c, JSON.stringify({ INVALID_JSON: invalido }), true);
    const entrada = (c['input'] ?? {}) as Record<string, unknown>;
    try {
      switch (c['name']) {
        case 'ler_arquivo':
          return resultado(c, await this.lerArquivo(texto(entrada, 'caminho')));
        case 'historico_git':
          return resultado(c, await this.historicoGit(texto(entrada, 'caminho')));
        case 'propor_resolucao':
          return resultado(c, this.propor(entrada));
        default:
          return resultado(c, `ferramenta desconhecida: ${String(c['name'])}`, true);
      }
    } catch (e) {
      return resultado(c, (e as Error).message ?? String(e), true);
    }
  }

  private async lerArquivo(caminho: string): Promise<string> {
    const rel = relativoSeguro(caminho);
    const conteudo = await ponte.lerArquivo(this.git.absoluto(rel)).catch(() => {
      throw new Error(`arquivo não encontrado: ${rel}`);
    });
    if (conteudo.length <= LIMITE_DE_ARQUIVO) return conteudo;
    return `${conteudo.slice(0, LIMITE_DE_ARQUIVO)}\n[... arquivo cortado: mostrando ${LIMITE_DE_ARQUIVO} de ${conteudo.length} caracteres]`;
  }

  private async historicoGit(caminho: string): Promise<string> {
    const rel = relativoSeguro(caminho);
    const op = this.git.estado()?.operacao;
    const outro = op === 'cherry-pick' ? 'CHERRY_PICK_HEAD' : op === 'revert' ? 'REVERT_HEAD' : op ? 'MERGE_HEAD' : null;
    const formato = '--format=%m %h %an, %ar: %s';
    const args = outro ? ['log', '-n', '20', formato, '--left-right', `HEAD...${outro}`, '--', rel] : ['log', '-n', '15', formato, '--', rel];
    const saida = (await this.git.rodar(args)).trim();
    return saida || 'nenhum commit mexeu neste arquivo nesse intervalo';
  }

  private propor(entrada: Record<string, unknown>): string {
    const numero = entrada['conflito'];
    const codigo = entrada['codigo'];
    if (typeof numero !== 'number' || !Number.isInteger(numero)) throw new Error('"conflito" precisa ser um número inteiro');
    if (typeof codigo !== 'string') throw new Error('"codigo" precisa ser texto');
    const contexto = this.merge.acoes?.contexto();
    const alvo = contexto?.conflitos.find((c) => c.numero === numero);
    if (!alvo) throw new Error(`não existe o conflito ${numero} neste arquivo`);
    if (alvo.resolvido) throw new Error(`o conflito ${numero} já foi resolvido pelo usuário`);
    // Uma proposta nova do mesmo conflito substitui a anterior ainda pendente.
    const anterior = this.pendente();
    if (anterior) this.marcar(anterior, 'recusada');
    const linhas = codigo.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
    this.adicionar({ tipo: 'proposta', conflito: numero, linhas, antes: alvo.seu, estado: 'pendente' });
    this.merge.previa.set({ conflito: numero, linhas });
    return `Proposta do conflito ${numero} mostrada ao usuário; ele decide se aplica.`;
  }

  // ---------- chave ----------

  private async garantirChave(): Promise<boolean> {
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

  // ---------- itens do chat ----------

  private adicionar(item: ItemDoChat): void {
    this.itens.update((l) => [...l, item]);
  }

  private substituir(antigo: ItemDoChat, novo: ItemDoChat): void {
    this.itens.update((l) => l.map((it) => (it === antigo ? novo : it)));
  }

  private marcar(p: Extract<ItemDoChat, { tipo: 'proposta' }>, estado: 'aplicada' | 'recusada'): void {
    this.substituir(p, { ...p, estado });
    if (this.merge.previa()?.conflito === p.conflito) this.merge.previa.set(null);
  }
}

// ---------- montagem do texto para a IA ----------

function textoDoContexto(c: ContextoDoMerge): string {
  const abertos = c.conflitos.filter((k) => !k.resolvido);
  const resultado: string[] = [];
  const porLinha = new Map(abertos.map((k) => [k.linha, k.numero]));
  c.resultado.forEach((l, i) => {
    const n = porLinha.get(i + 1);
    if (n) resultado.push(`<<<<<<< conflito ${n} (resolvido no lugar desta marca)`);
    resultado.push(l);
  });
  const ultimo = porLinha.get(c.resultado.length + 1);
  if (ultimo) resultado.push(`<<<<<<< conflito ${ultimo} (resolvido no lugar desta marca)`);
  const conflitos = abertos
    .map(
      (k) =>
        `<conflito numero="${k.numero}">\n<base>\n${k.base.join('\n')}\n</base>\n<seu>\n${k.seu.join('\n')}\n</seu>\n<deles>\n${k.deles.join('\n')}\n</deles>\n</conflito>`,
    )
    .join('\n');
  return [
    `Arquivo em merge: ${c.arquivo} (${c.linguagem}). "Seu" é ${c.nomeSeu} (a versão do usuário); "deles" é ${c.nomeDeles}.`,
    `Resultado como está agora (o que só um lado mudou já entrou; cada marca é um conflito aberto):\n<resultado>\n${resultado.join('\n')}\n</resultado>`,
    `Conflitos abertos (base = antes dos dois lados):\n${conflitos}`,
  ].join('\n\n');
}

function estadoDosConflitos(c: ContextoDoMerge): string {
  const abertos = c.conflitos.filter((k) => !k.resolvido).map((k) => k.numero);
  if (!abertos.length) return '(Todos os conflitos deste arquivo já foram resolvidos.)';
  const atual = c.atual ? ` O usuário está olhando o conflito ${c.atual}.` : '';
  return `(Conflitos ainda abertos: ${abertos.join(', ')}.${atual})`;
}

/**
 * Depois de uma troca de modelo no meio da resposta (bloco "fallback"), o que veio antes
 * dele de thinking e tool_use não volta para a API; o bloco fica onde apareceu.
 */
function limparParaEcoar(blocos: BlocoDaApi[]): BlocoDaApi[] {
  const ultimo = blocos.map((b) => b.type).lastIndexOf('fallback');
  return ultimo < 0 ? blocos : blocos.filter((b, i) => i >= ultimo || !['thinking', 'redacted_thinking', 'tool_use'].includes(b.type));
}

function resultado(chamada: BlocoDaApi, conteudo: string, erro = false): BlocoDaApi {
  return { type: 'tool_result', tool_use_id: chamada['id'], content: conteudo, ...(erro ? { is_error: true } : {}) };
}

function texto(entrada: Record<string, unknown>, campo: string): string {
  const v = entrada[campo];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`"${campo}" precisa ser um texto`);
  return v.trim();
}

function relativoSeguro(caminho: string): string {
  const rel = caminho.replace(/\\/g, '/').replace(/^\.\//, '');
  if (/^([a-zA-Z]:|\/)/.test(rel) || rel.split('/').includes('..')) throw new Error('use um caminho relativo à raiz do repositório, sem ".."');
  return rel;
}

function detalheDe(c: BlocoDaApi): string {
  const e = (c['input'] ?? {}) as Record<string, unknown>;
  if (typeof e['caminho'] === 'string') return String(e['caminho']).split('/').pop() ?? '';
  if (typeof e['conflito'] === 'number') return `conflito ${e['conflito']}`;
  return '';
}
