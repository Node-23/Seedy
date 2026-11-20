/**
 * Ponte entre a interface e o núcleo em Rust.
 *
 * Dentro do app (npm run tauri dev) as chamadas vão para o Rust.
 * No navegador puro (npm start) não há núcleo: devolvemos dados de exemplo,
 * para dar pra trabalhar no visual sem compilar o Rust.
 */
import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

export const noApp = (): boolean => isTauri();

export interface Entrada {
  nome: string;
  caminho: string;
  pasta: boolean;
}

export interface ArquivoTema {
  caminho: string;
  conteudo: string;
}

const RAIZ_EXEMPLO = '/exemplo/feirinha-verde';
const ARQUIVOS_EXEMPLO: Record<string, Entrada[]> = {
  [RAIZ_EXEMPLO]: [
    { nome: 'src', caminho: `${RAIZ_EXEMPLO}/src`, pasta: true },
    { nome: 'pom.xml', caminho: `${RAIZ_EXEMPLO}/pom.xml`, pasta: false },
  ],
  [`${RAIZ_EXEMPLO}/src`]: [
    { nome: 'FeiraService.java', caminho: `${RAIZ_EXEMPLO}/src/FeiraService.java`, pasta: false },
  ],
};
const CONTEUDO_EXEMPLO: Record<string, string> = {
  [`${RAIZ_EXEMPLO}/pom.xml`]: '<project>\n  <!-- modo navegador: dados de exemplo -->\n</project>\n',
  [`${RAIZ_EXEMPLO}/src/FeiraService.java`]:
    '@Service\npublic class FeiraService {\n\n    private static final int LIMITE_BANCAS = 120;\n\n    // Modo navegador: abra no app para editar arquivos de verdade\n    public String saudacao() {\n        return "Olá, Seedy";\n    }\n}\n',
};

export const ponte = {
  async pastaInicial(): Promise<string | null> {
    return noApp() ? invoke<string | null>('pasta_inicial') : RAIZ_EXEMPLO;
  },

  async lerPasta(caminho: string): Promise<Entrada[]> {
    return noApp() ? invoke<Entrada[]>('ler_pasta', { caminho }) : (ARQUIVOS_EXEMPLO[caminho] ?? []);
  },

  async lerArquivo(caminho: string): Promise<string> {
    return noApp() ? invoke<string>('ler_arquivo', { caminho }) : (CONTEUDO_EXEMPLO[caminho] ?? '');
  },

  async gravarArquivo(caminho: string, conteudo: string): Promise<void> {
    if (noApp()) await invoke('gravar_arquivo', { caminho, conteudo });
    else CONTEUDO_EXEMPLO[caminho] = conteudo;
  },

  async branchAtual(raiz: string): Promise<string | null> {
    return noApp() ? invoke<string | null>('branch_atual', { raiz }) : 'develop';
  },

  async temaCarregar(): Promise<ArquivoTema | null> {
    return noApp() ? invoke<ArquivoTema>('tema_carregar') : null;
  },

  async temaPadrao(): Promise<string | null> {
    return noApp() ? invoke<string>('tema_padrao') : null;
  },

  async fonteBytes(caminho: string): Promise<ArrayBuffer> {
    return invoke<ArrayBuffer>('fonte_bytes', { caminho });
  },

  async aoAlterarTema(fn: (tema: ArquivoTema) => void): Promise<UnlistenFn> {
    if (!noApp()) return () => {};
    return listen<ArquivoTema>('tema-alterado', (e) => fn(e.payload));
  },

  async escolherPasta(): Promise<string | null> {
    if (!noApp()) return RAIZ_EXEMPLO;
    const { open } = await import('@tauri-apps/plugin-dialog');
    const escolha = await open({ directory: true, multiple: false, title: 'Abrir projeto' });
    return typeof escolha === 'string' ? escolha : null;
  },

  terminal: {
    async abrir(
      pasta: string | null,
      colunas: number,
      linhas: number,
      aoReceber: (texto: string) => void,
      aoEncerrar: () => void,
    ): Promise<number> {
      const saida = new Channel<string>();
      saida.onmessage = aoReceber;
      const fim = new Channel<null>();
      fim.onmessage = aoEncerrar;
      return invoke<number>('terminal_abrir', { pasta, colunas, linhas, saida, fim });
    },
    escrever: (id: number, dados: string) => invoke('terminal_escrever', { id, dados }),
    redimensionar: (id: number, colunas: number, linhas: number) =>
      invoke('terminal_redimensionar', { id, colunas, linhas }),
    fechar: (id: number) => invoke('terminal_fechar', { id }),
  },

  janela: {
    async minimizar() {
      if (noApp()) (await import('@tauri-apps/api/window')).getCurrentWindow().minimize();
    },
    async maximizar() {
      if (noApp()) (await import('@tauri-apps/api/window')).getCurrentWindow().toggleMaximize();
    },
    async fechar() {
      if (noApp()) (await import('@tauri-apps/api/window')).getCurrentWindow().close();
    },
  },
};

/** Nome do arquivo ou pasta no fim de um caminho (aceita / e \). */
export function nomeBase(caminho: string): string {
  const partes = caminho.split(/[\\/]/).filter(Boolean);
  return partes[partes.length - 1] ?? caminho;
}
