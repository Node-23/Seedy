import { HistoricoService } from '../historico/historico.service';
import { computed, inject, Injectable, signal } from '@angular/core';
import { nomeBase, ponte } from '../nucleo/ponte';
import { EditorService } from '../editor/editor.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { AutomaticoService } from './automatico.service';
import { DiffService } from '../git/diff.service';

export type OrigemDaAlteracao = 'ia' | 'claude-code' | 'disco';

/** Uma alteração de código para o usuário revisar (aceitar/recusar ou manter/desfazer). */
export interface Alteracao {
  id: number;
  caminho: string;
  /** null = o arquivo não existia. */
  antes: string | null;
  depois: string;
  origem: OrigemDaAlteracao;
  motivo: string;
  /**
   * pendente: proposta esperando decisão (ainda não gravada).
   * aplicada: já está no disco (veio de fora) — dá para desfazer.
   */
  estado: 'pendente' | 'aceita' | 'recusada' | 'aplicada' | 'desfeita';
  quando: number;
}

interface Espera {
  resolver: (r: { aceita: boolean; comentario: string }) => void;
}

/** Quanto tempo depois da última ação da IA as mudanças do disco ainda contam como dela. */
const JANELA_DA_IA_MS = 10 * 60 * 1000;

/**
 * Painel de revisão (Fase 7): toda alteração da IA vira diff para aceitar ou recusar.
 * Propostas (do painel de IA ou do Claude Code pelo MCP) esperam a decisão; edições que
 * o Claude Code faz direto no disco aparecem já aplicadas, com a opção de desfazer.
 */
@Injectable({ providedIn: 'root' })
export class RevisaoService {
  private readonly editor = inject(EditorService);
  private readonly historico = inject(HistoricoService);
  private readonly mensagens = inject(MensagensService);
  private readonly diff = inject(DiffService);
  private readonly automatico = inject(AutomaticoService);

  readonly alteracoes = signal<Alteracao[]>([]);
  readonly aberta = signal(false);
  readonly pendentes = computed(() => this.alteracoes().filter((a) => a.estado === 'pendente' || a.estado === 'aplicada').length);

  /** O painel de IA do Seedy mostra as propostas dele como cartões na conversa. */
  aoProporDaIa: ((id: number) => void) | null = null;

  private seq = 0;
  private readonly esperas = new Map<number, Espera>();
  /** Última vez que uma IA (MCP ou painel) agiu: liga a captura de mudanças do disco. */
  private ultimaAcaoDaIa = 0;

  constructor() {
    // O Claude Code edita direto no disco: com a IA ativa, cada recarregamento vira revisão.
    this.editor.aoRecarregar((b, antes, depois) => {
      if (Date.now() - this.ultimaAcaoDaIa > JANELA_DA_IA_MS) return;
      this.adicionar({ caminho: b.caminho, antes, depois, origem: 'disco', motivo: 'alterado fora do Seedy enquanto a IA trabalhava', estado: 'aplicada' });
    });
  }

  /** Avisa que uma IA acabou de agir (chamada do MCP ou do painel). */
  iaAtiva(): void {
    this.ultimaAcaoDaIa = Date.now();
  }

  /**
   * Proposta de edição: entra na lista e espera o usuário. Resolve com a decisão (e um
   * comentário, que a IA recebe de volta).
   */
  async propor(caminho: string, depois: string, origem: OrigemDaAlteracao, motivo: string): Promise<{ aceita: boolean; comentario: string }> {
    this.iaAtiva();
    const antes = await this.conteudoAtual(caminho);
    if (antes === depois) return { aceita: true, comentario: 'o arquivo já estava com esse conteúdo' };
    const a = this.adicionar({ caminho, antes, depois, origem, motivo, estado: 'pendente' });
    // Modo automático: grava na hora (continua na lista de revisão, onde dá para desfazer).
    if (this.automatico.ligado()) {
      await this.aceitar(a.id);
      const feita = this.alteracoes().find((x) => x.id === a.id);
      return feita?.estado === 'aceita'
        ? { aceita: true, comentario: 'aplicada automaticamente (modo automático); o usuário revisa depois' }
        : { aceita: false, comentario: 'não consegui gravar o arquivo' };
    }
    // Do painel de IA: o cartão aparece na conversa; do Claude Code: abre a janela de revisão.
    if (origem === 'ia' && this.aoProporDaIa) {
      this.aoProporDaIa(a.id);
      this.mensagens.mostrar(`proposta da IA para ${nomeBase(caminho)}: ⏎ aplica no painel · esc recusa`);
    } else {
      this.aberta.set(true);
      this.mensagens.mostrar(`proposta do Claude Code para ${nomeBase(caminho)}: ⏎ aceita · d recusa`);
    }
    return new Promise((resolver) => this.esperas.set(a.id, { resolver }));
  }

  /** Aceita (proposta) ou mantém (mudança que veio do disco). */
  async aceitar(id: number): Promise<void> {
    const a = this.alteracoes().find((x) => x.id === id);
    if (!a) return;
    if (a.estado === 'pendente') {
      try {
        await this.historico.guardar(a.caminho, 'antes da proposta da IA');
        await this.gravar(a.caminho, a.depois);
      } catch (e) {
        this.mensagens.erro(`não consegui gravar ${nomeBase(a.caminho)}: ${e}`);
        return;
      }
      this.mudar(id, 'aceita');
      this.esperas.get(id)?.resolver({ aceita: true, comentario: 'aceita e gravada pelo usuário' });
      this.esperas.delete(id);
      this.mensagens.mostrar(`${nomeBase(a.caminho)}: alteração aceita`);
    } else if (a.estado === 'aplicada') {
      this.mudar(id, 'aceita');
    }
  }

  /** Recusa (proposta) ou desfaz (mudança que veio do disco). */
  async recusar(id: number, comentario = ''): Promise<void> {
    const a = this.alteracoes().find((x) => x.id === id);
    if (!a) return;
    if (a.estado === 'pendente') {
      this.mudar(id, 'recusada');
      this.esperas.get(id)?.resolver({ aceita: false, comentario: comentario || 'recusada pelo usuário' });
      this.esperas.delete(id);
    } else if (a.estado === 'aplicada') {
      try {
        if (a.antes === null) {
          this.mensagens.mostrar('o arquivo era novo: apague-o pela árvore se não quiser mantê-lo');
          return;
        }
        await this.historico.guardar(a.caminho, 'antes de desfazer a IA');
        await this.gravar(a.caminho, a.antes);
        this.mudar(id, 'desfeita');
        this.mensagens.mostrar(`${nomeBase(a.caminho)}: alteração desfeita`);
      } catch (e) {
        this.mensagens.erro(String(e));
      }
    }
  }

  verDiff(id: number): void {
    const a = this.alteracoes().find((x) => x.id === id);
    if (!a) return;
    this.diff.abrir({
      titulo: `${nomeBase(a.caminho)} · ${a.estado === 'pendente' ? 'proposta' : 'alteração'} (${a.origem === 'ia' ? 'IA do Seedy' : 'Claude Code'})`,
      antes: a.antes ?? '',
      depois: a.depois,
      rotuloAntes: 'antes',
      rotuloDepois: a.estado === 'pendente' ? 'proposta' : 'agora',
      caminho: a.caminho,
    });
  }

  limparResolvidas(): void {
    this.alteracoes.update((l) => l.filter((a) => a.estado === 'pendente' || a.estado === 'aplicada'));
  }

  // ---------- internos ----------

  private adicionar(a: Omit<Alteracao, 'id' | 'quando'>): Alteracao {
    const nova: Alteracao = { ...a, id: ++this.seq, quando: Date.now() };
    this.alteracoes.update((l) => [...l, nova]);
    return nova;
  }

  private mudar(id: number, estado: Alteracao['estado']): void {
    this.alteracoes.update((l) => l.map((a) => (a.id === id ? { ...a, estado } : a)));
  }

  /** O que o arquivo tem agora: o buffer (se aberto) ou o disco; null se não existe. */
  private async conteudoAtual(caminho: string): Promise<string | null> {
    const b = this.editor.bufferDe(caminho);
    if (b) return b.modelo.getValue();
    return ponte.lerArquivo(caminho).catch(() => null);
  }

  /** Grava pelo buffer (se aberto: o desfazer do editor continua valendo) ou direto no disco. */
  private async gravar(caminho: string, conteudo: string): Promise<void> {
    const b = this.editor.bufferDe(caminho);
    if (b) {
      b.modelo.pushEditOperations([], [{ range: b.modelo.getFullModelRange(), text: conteudo }], () => null);
      await this.editor.salvar(caminho, false);
    } else {
      await ponte.gravarArquivo(caminho, conteudo);
    }
  }
}
