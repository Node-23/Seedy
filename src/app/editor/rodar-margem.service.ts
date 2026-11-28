import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { ExecucaoService } from '../execucao/execucao.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { chaveDoResultado } from '../testes/cobertura';
import { TestesService } from '../testes/testes.service';
import { EditorService } from './editor.service';
import { acharExecutaveis, Executavel, executavelEm } from './executaveis';
import { monaco } from './monaco';

export interface ItemDoMenuRodar {
  id: 'rodar' | 'depurar' | 'classe' | 'tela';
  marca: string;
  rotulo: string;
  dica: string;
}

/**
 * ▶ na margem de testes e de `main` (mockup 46): clique abre o menu; Ctrl+Shift+F10 roda e
 * Ctrl+Shift+F9 depura o que está sob o cursor. Vermelho quando o teste falhou no último run.
 */
@Injectable({ providedIn: 'root' })
export class RodarMargemService {
  private readonly editor = inject(EditorService);
  private readonly testes = inject(TestesService);
  private readonly execucao = inject(ExecucaoService);
  private readonly mensagens = inject(MensagensService);

  readonly menu = signal<{ x: number; y: number; alvo: Executavel; caminho: string } | null>(null);
  private leuRelatorios = false;

  readonly itens = computed<ItemDoMenuRodar[]>(() => {
    const alvo = this.menu()?.alvo;
    if (!alvo) return [];
    const oQue = alvo.tipo === 'teste' ? 'este teste' : alvo.tipo === 'classe' ? 'a classe de teste' : `${alvo.classe}.main`;
    return [
      { id: 'rodar', marca: '▶', rotulo: `Rodar ${oQue}`, dica: 'Ctrl+Shift+F10' },
      { id: 'depurar', marca: '🐞', rotulo: `Depurar ${oQue}`, dica: 'Ctrl+Shift+F9' },
      ...(alvo.tipo === 'teste' ? [{ id: 'classe' as const, marca: '▶▶', rotulo: 'Rodar a classe toda', dica: 'c' }] : []),
      ...(alvo.tipo !== 'main' ? [{ id: 'tela' as const, marca: '⚗', rotulo: 'Ver na tela de testes', dica: 't' }] : []),
    ];
  });

  /** Mantém os ▶ de um editor; devolve como achar o alvo de uma linha e como desligar. */
  ligar(instancia: monaco.editor.IStandaloneCodeEditor): { em(linha: number): Executavel | null; atualizar(): void; dispose(): void } {
    const colecao = instancia.createDecorationsCollection();
    let achados: Executavel[] = [];
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const atualizar = () => {
      const modelo = instancia.getModel();
      achados = modelo && modelo.getLanguageId() === 'java' && modelo.uri.scheme === 'file' ? acharExecutaveis(modelo.getLinesContent()) : [];
      if (achados.some((x) => x.tipo !== 'main') && !this.leuRelatorios) {
        this.leuRelatorios = true;
        void this.testes.lerRelatorios();
      }
      const resultados = this.testes.resultados();
      const falhou = (x: Executavel) =>
        x.tipo === 'teste'
          ? resultados.get(chaveDoResultado(x.classe, x.metodo!))?.estado === 'falhou'
          : x.tipo === 'classe' && [...resultados.values()].some((r) => r.classe === x.classe && r.estado === 'falhou');
      colecao.set(
        achados.map((x) => ({
          range: new monaco.Range(x.linha, 1, x.linha, 1),
          options: {
            glyphMarginClassName: `rodar-glifo${x.tipo === 'classe' ? ' classe' : ''}${falhou(x) ? ' falhou' : ''}`,
            glyphMargin: { position: monaco.editor.GlyphMarginLane.Right },
            glyphMarginHoverMessage: { value: x.tipo === 'main' ? 'rodar ou depurar a main' : 'rodar ou depurar o teste' },
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        })),
      );
    };
    const depois = () => {
      clearTimeout(temporizador);
      temporizador = setTimeout(atualizar, 300);
    };
    const ouvintes = [instancia.onDidChangeModelContent(depois), instancia.onDidChangeModel(atualizar)];
    return {
      em: (linha) => achados.find((x) => x.linha === linha) ?? null,
      atualizar,
      dispose: () => {
        clearTimeout(temporizador);
        ouvintes.forEach((o) => o.dispose());
        colecao.clear();
      },
    };
  }

  abrir(x: number, y: number, alvo: Executavel): void {
    const caminho = this.editor.ativo();
    if (caminho) this.menu.set({ x, y, alvo, caminho });
  }

  fechar(): void {
    this.menu.set(null);
    queueMicrotask(() => this.editor.focar());
  }

  async escolher(id: ItemDoMenuRodar['id']): Promise<void> {
    const m = this.menu();
    if (!m) return;
    this.fechar();
    if (id === 'tela') return this.mostrarNaTela(m.alvo);
    const alvo = id === 'classe' ? { ...m.alvo, tipo: 'classe' as const, metodo: null } : m.alvo;
    await this.executar(alvo, id === 'depurar');
  }

  /** Ctrl+Shift+F10 (roda) e Ctrl+Shift+F9 (depura) o que está sob o cursor. */
  async noCursor(depurar: boolean): Promise<void> {
    const modelo = this.editor.bufferAtivo()?.modelo;
    const linha = this.editor.instancia?.getPosition()?.lineNumber;
    const alvo = modelo?.getLanguageId() === 'java' && linha ? executavelEm(acharExecutaveis(modelo.getLinesContent()), linha) : null;
    if (!alvo) return this.mensagens.alerta('aqui não há teste nem main para rodar');
    await this.executar(alvo, depurar);
  }

  private async executar(alvo: Executavel, depurar: boolean): Promise<void> {
    const sujos = this.editor.buffers().filter((b) => this.editor.sujo(b));
    if (sujos.length) await this.editor.salvarTodos();
    if (alvo.tipo === 'main') {
      await this.execucao.procurarMains();
      const config = this.execucao.mains().find((x) => x.mainClass === alvo.completa.replace(/\$/g, '.'));
      if (!config) return this.mensagens.alerta(`o jdtls ainda não achou a main de ${alvo.classe}`);
      this.execucao.escolher(config.id);
      return this.execucao.rodar(depurar);
    }
    if (this.testes.rodando()) return this.mensagens.alerta('já há testes rodando: espere ou pare (◼)');
    const filtro = alvo.metodo ? `${alvo.classe}#${alvo.metodo}` : alvo.classe;
    const tipo = /(IT|IntegrationTest)$/.test(alvo.classe) ? 'todos' : 'unitario';
    if (depurar) {
      this.mensagens.mostrar(`depurando ${filtro}: o depurador anexa quando o teste subir`);
      return this.testes.rodar(tipo, filtro, false, false, filtro);
    }
    // A saída e o resultado aparecem na tela de testes.
    await this.mostrarNaTela(alvo);
    await this.testes.rodar(tipo, filtro);
  }

  private async mostrarNaTela(alvo: Executavel): Promise<void> {
    await this.testes.abrir();
    const teste = this.testes.testes().find((t) => t.classe === alvo.classe && (!alvo.metodo || t.metodo === alvo.metodo));
    if (teste) this.testes.selecionado.set(teste.id);
  }

  constructor() {
    // Mudou o resultado de um teste: os editores repintam (cada um chama atualizar no seu efeito).
    effect(() => {
      this.testes.resultados();
      untracked(() => this.versao.update((v) => v + 1));
    });
  }

  readonly versao = signal(0);
}
