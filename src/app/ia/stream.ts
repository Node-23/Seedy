import { ponte } from '../nucleo/ponte';

/** Bloco de conteúdo da Messages API (texto, thinking, tool_use, tool_result...), guardado como veio. */
export type BlocoDaApi = { type: string; [campo: string]: unknown };

export interface MensagemDaApi {
  role: 'user' | 'assistant';
  content: BlocoDaApi[];
}

export interface RespostaDoStream {
  conteudo: BlocoDaApi[];
  parada: string | null;
  /** Entradas de ferramenta que chegaram como JSON inválido (por id da chamada). */
  invalidos: Map<string, string>;
}

/**
 * Um pedido à Messages API com streaming (pelo núcleo, que guarda a chave). `aoTexto`
 * recebe o texto de cada bloco enquanto chega (índice do bloco, texto acumulado).
 */
export async function pedirComStream(corpo: unknown, aoTexto: (indice: number, texto: string) => void, valido: () => boolean): Promise<RespostaDoStream> {
  const blocos: BlocoDaApi[] = [];
  const jsonParcial = new Map<number, string>();
  const invalidos = new Map<string, string>();
  let parada: string | null = null;
  let fim = false;
  let erro: string | null = null;

  const aoEvento = (dados: string) => {
    if (!valido()) return;
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
        if (bloco.type === 'text') aoTexto(ev['index'], String(bloco['text'] ?? ''));
        break;
      }
      case 'content_block_delta': {
        const bloco = blocos[ev['index']];
        const d = ev['delta'];
        if (!bloco) break;
        if (d.type === 'text_delta') {
          bloco['text'] = String(bloco['text'] ?? '') + d.text;
          aoTexto(ev['index'], String(bloco['text']));
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
            // O stream não valida a entrada (eager_input_streaming): a ferramenta responde o erro.
            bloco['input'] = {};
            invalidos.set(String(bloco['id']), bruto);
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

  await ponte.ia.mensagem(corpo, aoEvento);
  // Os últimos eventos do canal podem chegar logo depois do fim do comando.
  for (let i = 0; i < 40 && !fim && !erro; i++) await new Promise((r) => setTimeout(r, 50));
  if (erro) throw new Error(erro);
  if (!fim) throw new Error('a resposta da IA terminou no meio');
  return { conteudo: limparParaEcoar(blocos.filter(Boolean)), parada, invalidos };
}

/**
 * Depois de uma troca de modelo no meio da resposta (bloco "fallback"), o que veio antes
 * dele de thinking e tool_use não volta para a API; o bloco fica onde apareceu.
 */
function limparParaEcoar(blocos: BlocoDaApi[]): BlocoDaApi[] {
  const ultimo = blocos.map((b) => b.type).lastIndexOf('fallback');
  return ultimo < 0 ? blocos : blocos.filter((b, i) => i >= ultimo || !['thinking', 'redacted_thinking', 'tool_use'].includes(b.type));
}

export function resultadoDeFerramenta(chamada: BlocoDaApi, conteudo: string, erro = false): BlocoDaApi {
  return { type: 'tool_result', tool_use_id: chamada['id'], content: conteudo, ...(erro ? { is_error: true } : {}) };
}
