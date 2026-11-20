import { Injectable, signal } from '@angular/core';
import { ponte } from '../nucleo/ponte';
import { MensagensService } from '../nucleo/mensagens.service';
import { inject } from '@angular/core';
import padrao from './tema-padrao.json';

export interface Fonte {
  familia: string;
  /** Caminho de um .ttf/.otf/.woff2. Relativo = dentro da pasta de configuração do Seedy. */
  arquivo: string | null;
  tamanho: number;
}

export interface Tema {
  nome: string;
  fontes: {
    interface: Fonte;
    codigo: Fonte & { alturaLinha: number; ligaduras: boolean };
    reserva: string;
  };
  cores: Record<
    | 'fundo' | 'painel' | 'painelElevado' | 'selecao' | 'borda' | 'sombra'
    | 'texto' | 'textoSuave' | 'destaque' | 'textoSobreDestaque'
    | 'sucesso' | 'sucessoFundo' | 'aviso' | 'erro' | 'erroFundo' | 'rosa',
    string
  >;
  sintaxe: Record<'padrao' | 'definicao' | 'string' | 'constante' | 'comentario', string>;
  forma: Record<'raio' | 'raioPequeno' | 'espessuraBorda' | 'deslocamentoSombra' | 'espaco', number>;
  terminal: { ansi: string[] };
}

export const TEMA_PADRAO = padrao as Tema;

/** Junta o tema do usuário com o padrão: o que faltar no arquivo vem do padrão. */
function completar(parcial: Partial<Tema>): Tema {
  const p = TEMA_PADRAO;
  return {
    nome: parcial.nome ?? p.nome,
    fontes: {
      interface: { ...p.fontes.interface, ...parcial.fontes?.interface },
      codigo: { ...p.fontes.codigo, ...parcial.fontes?.codigo },
      reserva: parcial.fontes?.reserva ?? p.fontes.reserva,
    },
    cores: { ...p.cores, ...parcial.cores },
    sintaxe: { ...p.sintaxe, ...parcial.sintaxe },
    forma: { ...p.forma, ...parcial.forma },
    terminal: { ansi: parcial.terminal?.ansi?.length === 16 ? parcial.terminal.ansi : p.terminal.ansi },
  };
}

function kebab(nome: string): string {
  return nome.replace(/[A-Z]/g, (l) => '-' + l.toLowerCase());
}

/**
 * Carrega o tema (cores, fontes e forma), aplica como variáveis CSS e
 * recarrega sozinho quando o arquivo tema.json é salvo.
 */
@Injectable({ providedIn: 'root' })
export class TemaService {
  private readonly mensagens = inject(MensagensService);

  readonly tema = signal<Tema>(TEMA_PADRAO);
  /** Caminho do tema.json do usuário (só existe dentro do app). */
  readonly caminho = signal<string | null>(null);

  private fontesCarregadas = new Set<string>();

  async iniciar(): Promise<void> {
    this.aplicar(TEMA_PADRAO);
    const arquivo = await ponte.temaCarregar();
    if (arquivo) this.receber(arquivo.caminho, arquivo.conteudo, false);
    await ponte.aoAlterarTema((a) => this.receber(a.caminho, a.conteudo, true));
  }

  private receber(caminho: string, conteudo: string, avisar: boolean): void {
    this.caminho.set(caminho);
    try {
      const tema = completar(JSON.parse(conteudo));
      this.aplicar(tema);
      if (avisar) this.mensagens.mostrar(`tema "${tema.nome}" aplicado`);
    } catch (e) {
      this.mensagens.erro(`tema.json inválido, mantive o tema anterior (${(e as Error).message})`);
    }
  }

  private aplicar(tema: Tema): void {
    const raiz = document.documentElement.style;
    for (const [nome, valor] of Object.entries(tema.cores)) raiz.setProperty(`--${kebab(nome)}`, valor);
    for (const [nome, valor] of Object.entries(tema.sintaxe)) raiz.setProperty(`--sintaxe-${kebab(nome)}`, valor);
    for (const [nome, valor] of Object.entries(tema.forma)) raiz.setProperty(`--${kebab(nome)}`, `${valor}px`);

    const reserva = tema.fontes.reserva;
    raiz.setProperty('--fonte-interface', `"${tema.fontes.interface.familia}", ${reserva}`);
    raiz.setProperty('--fonte-codigo', `"${tema.fontes.codigo.familia}", ${reserva}`);
    raiz.setProperty('--tamanho-interface', `${tema.fontes.interface.tamanho}px`);

    this.tema.set(tema);
    void this.carregarFonte(tema.fontes.interface);
    void this.carregarFonte(tema.fontes.codigo);
  }

  /** Fontes que vêm de arquivo (ex.: a Inky Mono) são registradas na hora. */
  private async carregarFonte(fonte: Fonte): Promise<void> {
    if (!fonte.arquivo) return;
    const chave = `${fonte.familia}|${fonte.arquivo}`;
    if (this.fontesCarregadas.has(chave)) return;
    try {
      const bytes = await ponte.fonteBytes(fonte.arquivo);
      const face = await new FontFace(fonte.familia, bytes).load();
      document.fonts.add(face);
      this.fontesCarregadas.add(chave);
      // Força a releitura das variáveis para o Monaco e o terminal medirem a fonte nova.
      this.tema.set({ ...this.tema() });
    } catch (e) {
      this.mensagens.erro(`não consegui carregar a fonte ${fonte.familia}: ${e}`);
    }
  }
}
