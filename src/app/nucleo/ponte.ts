/**
 * Ponte entre a interface e o núcleo em Rust.
 *
 * Dentro do app (npm run tauri dev) as chamadas vão para o Rust.
 * No navegador puro (npm start) não há núcleo: devolvemos dados de exemplo,
 * para dar pra trabalhar no visual sem compilar o Rust.
 */
import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { exemplo, RAIZ_EXEMPLO } from './exemplo';
import type { OpcoesTexto } from '../busca/texto';

export const noApp = (): boolean => isTauri();

export interface Entrada {
  nome: string;
  caminho: string;
  pasta: boolean;
}

export interface ArquivoIndice {
  caminho: string;
  /** Relativo à raiz do projeto, sempre com "/". */
  relativo: string;
}

export interface Simbolo {
  nome: string;
  tipo: 'classe' | 'metodo';
  /** Tipos dos parâmetros do método, ex.: "Long, Long". */
  detalhe: string;
  /** Classe do método, ou pacote da classe. */
  conteiner: string;
  caminho: string;
  linha: number;
}

export interface Indice {
  arquivos: ArquivoIndice[];
  simbolos: Simbolo[];
}

export interface Ocorrencia {
  caminho: string;
  relativo: string;
  linha: number;
  texto: string;
}

export interface SaidaGit {
  codigo: number;
  saida: string;
  erro: string;
}

export interface UsuarioGithub {
  login: string;
  nome: string | null;
  avatar: string | null;
}

export interface RepositorioGithub {
  nome: string;
  dono: string;
  descricao: string | null;
  privado: boolean;
  url_clone: string;
  atualizado: string;
}

export interface Mudancas {
  criados: string[];
  removidos: string[];
  alterados: string[];
  /** .git/HEAD mudou (trocou de branch). */
  git: boolean;
}

export interface Jdk {
  home: string;
  versao: string;
  maior: number;
}

export interface EstadoJava {
  jdk: Jdk | null;
  jdtlsInstalado: boolean;
  versaoJdtls: string;
  javaMinimo: number;
}

export type ProgressoJdtls =
  | { fase: 'baixando'; baixado: number; total: number | null }
  | { fase: 'verificando' }
  | { fase: 'extraindo' }
  | { fase: 'pronto' };

export interface ArquivoTema {
  caminho: string;
  conteudo: string;
}

export const ponte = {
  async pastaInicial(): Promise<string | null> {
    return noApp() ? invoke<string | null>('pasta_inicial') : RAIZ_EXEMPLO;
  },

  async lerPasta(caminho: string): Promise<Entrada[]> {
    return noApp() ? invoke<Entrada[]>('ler_pasta', { caminho }) : exemplo.lerPasta(caminho);
  },

  async lerArquivo(caminho: string): Promise<string> {
    return noApp() ? invoke<string>('ler_arquivo', { caminho }) : exemplo.lerArquivo(caminho);
  },

  async gravarArquivo(caminho: string, conteudo: string): Promise<void> {
    if (noApp()) await invoke('gravar_arquivo', { caminho, conteudo });
    else exemplo.gravarArquivo(caminho, conteudo);
  },

  async branchAtual(raiz: string): Promise<string | null> {
    return noApp() ? invoke<string | null>('branch_atual', { raiz }) : 'develop';
  },

  /** Roda `git <args>` na pasta (sem pasta: `clone`). No modo navegador não há git. */
  async git(pasta: string | null, args: string[], entrada?: string): Promise<SaidaGit> {
    if (!noApp()) return { codigo: 128, saida: '', erro: 'git só dentro do app' };
    return invoke<SaidaGit>('git', { pasta, args, entrada: entrada ?? null });
  },

  /** Conta do GitHub (a credencial fica no núcleo; aqui só chega o usuário). */
  github: {
    async conta(interativo: boolean): Promise<UsuarioGithub | null> {
      return noApp() ? invoke<UsuarioGithub | null>('github_conta', { interativo }) : null;
    },
    token: (token: string) => invoke<UsuarioGithub>('github_token', { token }),
    desconectar: () => invoke<void>('github_desconectar'),
    repositorios: () => invoke<RepositorioGithub[]>('github_repositorios'),
    /** Pedido à API REST do GitHub como a conta conectada (só /repos/... e /user...). */
    api: <T = unknown>(metodo: 'GET' | 'POST' | 'PATCH', caminho: string, corpo?: unknown) =>
      invoke<T>('github_api', { metodo, caminho, corpo: corpo ?? null }),
    /** Abre um endereço do github.com no navegador padrão. */
    abrirNoNavegador: (url: string) => invoke<void>('abrir_no_navegador', { url }),
  },

  /** Lista os arquivos do projeto e as declarações Java (classes e métodos). */
  async indexar(raiz: string): Promise<Indice> {
    return noApp() ? invoke<Indice>('busca_indexar', { raiz }) : exemplo.indexar();
  },

  /**
   * Busca no conteúdo dos arquivos. Sem opções: literal, smart case, todos os arquivos.
   * Rejeita com a mensagem de erro se a regex ou a máscara forem inválidas.
   */
  async buscarTexto(raiz: string, consulta: string, limite = 200, opcoes: OpcoesTexto = {}): Promise<Ocorrencia[]> {
    return noApp()
      ? invoke<Ocorrencia[]>('busca_texto', { raiz, consulta, limite, opcoes })
      : exemplo.buscarTexto(consulta, limite, opcoes);
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

  /** Passa a observar a pasta do projeto (para de observar o anterior). */
  async observarProjeto(raiz: string): Promise<void> {
    if (noApp()) await invoke('projeto_observar', { raiz });
  },

  /** Arquivos criados/removidos/alterados fora do editor, em lote. */
  async aoAlterarArquivos(fn: (m: Mudancas) => void): Promise<UnlistenFn> {
    if (!noApp()) return () => {};
    return listen<Mudancas>('arquivos-alterados', (e) => fn(e.payload));
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

  /** Java: JDK, instalação do jdtls e o canal LSP (só dentro do app). */
  java: {
    async estado(jdk: string | null): Promise<EstadoJava | null> {
      return noApp() ? invoke<EstadoJava>('java_estado', { jdk }) : null;
    },
    async jdks(): Promise<Jdk[]> {
      return noApp() ? invoke<Jdk[]>('java_jdks') : [];
    },
    async instalar(aoProgresso: (p: ProgressoJdtls) => void): Promise<void> {
      const canal = new Channel<ProgressoJdtls>();
      canal.onmessage = aoProgresso;
      await invoke('jdtls_instalar', { progresso: canal });
    },
    async iniciar(raiz: string, jdk: string | null, aoReceber: (mensagem: string) => void, aoEncerrar: () => void) {
      const mensagens = new Channel<string>();
      mensagens.onmessage = aoReceber;
      const fim = new Channel<null>();
      fim.onmessage = aoEncerrar;
      return invoke<{ id: number; pid: number; preferencias: string }>('lsp_iniciar', { raiz, mensagens, fim, jdk });
    },
    enviar: (id: number, mensagem: string) => invoke<void>('lsp_enviar', { id, mensagem }),
    parar: (id: number) => invoke<void>('lsp_parar', { id }),
  },

  /** IA (Claude): a chave fica no núcleo; aqui só vão o corpo do pedido e os eventos do stream. */
  ia: {
    temChave: async (): Promise<boolean> => (noApp() ? invoke<boolean>('ia_tem_chave') : true),
    definirChave: (chave: string) => invoke<void>('ia_definir_chave', { chave }),
    esquecerChave: () => invoke<void>('ia_esquecer_chave'),
    /** Manda o pedido à Messages API (com stream) e entrega o JSON de cada evento SSE. */
    async mensagem(corpo: unknown, aoEvento: (dados: string) => void): Promise<void> {
      if (!noApp()) return exemplo.iaMensagem(corpo, aoEvento);
      const eventos = new Channel<string>();
      eventos.onmessage = aoEvento;
      await invoke<void>('ia_mensagem', { corpo, eventos });
    },
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
