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

export type TipoServidor = 'wildfly' | 'tomcat';

/** Servidor de aplicação configurado para um projeto. */
export interface PerfilServidor {
  id: string;
  nome: string;
  tipo: TipoServidor;
  /** Pasta de instalação (JBOSS_HOME / CATALINA_HOME). */
  instalacao: string;
  /** JAVA_HOME do servidor (null = o do sistema). */
  jdk: string | null;
  portaHttp: number;
  portaDebug: number;
  opcoesJvm: string;
  variaveis: Record<string, string>;
  /** Caminho na URL ("/feira"; "/" = raiz). */
  contexto: string;
  /** Raiz do projeto e, relativas a ela, a pasta web e a das classes compiladas. */
  projeto: string;
  pastaWeb: string;
  pastaClasses: string;
}

/** Uma origem do deploy explodido (pasta inteira ou arquivo) e onde ela entra na aplicação. */
export interface FonteDeDeploy {
  origem: string;
  destino: string;
}

export interface InfoExecucao {
  versao: string;
  url: string;
  portaDebug: number | null;
  aplicacao: string;
  copiados: number;
  pid: number;
}

export type EventoServidor = { tipo: 'copiados'; arquivos: string[] } | { tipo: 'encerrado'; codigo: number | null };

export type AmbienteBanco = 'local' | 'homolog' | 'producao';
export type TipoBanco = 'postgres' | 'mysql' | 'oracle';

/** Conexão salva (a senha fica no cofre do sistema, não aqui). */
export interface PerfilBanco {
  id: string;
  nome: string;
  ambiente: AmbienteBanco;
  tipo: TipoBanco;
  host: string;
  porta: number;
  /** Banco (PostgreSQL/MySQL) ou serviço (Oracle). */
  banco: string;
  usuario: string;
  somenteLeitura: boolean;
  ssl: 'desligado' | 'exigir' | 'verificar';
  /** Destino do túnel SSH (Host do ~/.ssh/config ou usuario@servidor). */
  ssh: string | null;
}

export interface InfoTunel {
  alvo: string;
  destino: string;
  portaLocal: number;
  identidade: string | null;
}

export interface InfoConexao {
  versao: string;
  tunel: InfoTunel | null;
}

export interface ColunaSql {
  nome: string;
  tipo: string;
}

export interface ResultadoSql {
  colunas: ColunaSql[];
  /** null = NULL. */
  linhas: (string | null)[][];
  cortado: boolean;
  afetadas: number | null;
  ms: number;
}

export interface SchemaBanco {
  nome: string;
  tabelas: string[];
  views: string[];
  funcoes: string[];
}

export interface ColunaDeTabela {
  tabela: string;
  coluna: string;
  tipo: string;
}

export interface EntradaDoHistoricoSql {
  sql: string;
  quando: number;
  ms: number;
  linhas: number | null;
  erro: string | null;
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

/** Projeto web (Fase 6): Node no PATH e os servidores de linguagem já instalados. */
export interface EstadoWeb {
  node: string | null;
  instalado: boolean;
}

export type TipoServidorWeb = 'ts' | 'angular' | 'eslint';

/** Container do Docker já inspecionado (Fase 8). */
export interface ContainerDocker {
  id: string;
  nome: string;
  imagem: string;
  estado: string;
  status: string;
  criado: string;
  iniciado: string;
  portas: { container: number; host: number | null; protocolo: string }[];
  redes: { nome: string; ip: string; apelidos: string[] }[];
  ambiente: string[];
  composeProjeto: string | null;
  composeServico: string | null;
  composePasta: string | null;
  dependeDe: string[];
}

/** Conexões TCP abertas de um container para outro (medidas agora). */
export interface TrafegoDocker {
  de: string;
  para: string;
  porta: number;
  conexoes: number;
}

/** Pedido da janela de novo projeto (␣ N). */
export interface PedidoDeProjeto {
  modelo: 'spring' | 'maven' | 'war' | 'simples' | 'angular';
  nome: string;
  pasta: string;
  grupo: string;
  pacote: string;
  java: number;
  build: 'maven' | 'gradle';
  empacotamento: 'jar' | 'war';
  springBoot: string | null;
  dependencias: string[];
  git: boolean;
}

export interface ProjetoCriado {
  pasta: string;
  principal: string | null;
  aviso: string | null;
}

/** O pedaço do start.spring.io que a janela usa. */
export interface MetadadosSpring {
  bootVersion: { default: string; values: { id: string; name: string }[] };
  javaVersion: { default: string; values: { id: string; name: string }[] };
  dependencies: { values: { name: string; values: { id: string; name: string; description?: string }[] }[] };
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

// ---------- Fase 9: entender o sistema (arquitetura, regras e caminho dos métodos) ----------

/** tela, front, entrada, job, servico, repositorio, entidade, excecao, tratador, teste, outro. */
export type PapelComponente = 'tela' | 'front' | 'entrada' | 'job' | 'servico' | 'repositorio' | 'entidade' | 'excecao' | 'tratador' | 'teste' | 'outro';

export interface ChamadaAnalise {
  alvo: string;
  metodo: string;
  linha: number;
}

export interface DesvioAnalise {
  linha: number;
  condicao: string | null;
  acao: string;
  excecao: string | null;
  mensagem: string | null;
  status: number | null;
}

export interface MetodoAnalise {
  nome: string;
  linha: number;
  linhaFim: number;
  params: string[];
  anotacoes: string[];
  http: { verbo: string; rota: string } | null;
  agendado: string | null;
  chamadas: ChamadaAnalise[];
  desvios: DesvioAnalise[];
  httpSaida: { verbo: string; url: string; linha: number; alvo: ChamadaAnalise | null }[];
  gatilhos: { caminho: string; linha: number; evento: string; texto: string }[];
  usaExterno: boolean;
  /** Para que tela o método leva (router.navigate, forward do Struts). */
  navega: NavegacaoAnalise[];
}

export interface NavegacaoAnalise {
  rota: string;
  alvo: string | null;
  linha: number;
  texto: string;
}

export interface ComponenteAnalise {
  id: string;
  nome: string;
  caminho: string;
  relativo: string;
  linha: number;
  pacote: string;
  linguagem: 'java' | 'ts' | 'jsp';
  papel: PapelComponente;
  dominio: string;
  anotacoes: string[];
  usa: string[];
  estende: string | null;
  implementa: string[];
  rota: string | null;
  tabela: string | null;
  entidade: string | null;
  externo: string | null;
  seletor: string | null;
  template: string | null;
  metodos: MetodoAnalise[];
  /** Tela: links do template para outras telas (routerLink, href de JSP). */
  navega: NavegacaoAnalise[];
}

export interface LugarAnalise {
  caminho: string;
  relativo: string;
  linha: number;
  detalhe: string;
}

export type TipoRegra = 'excecao' | 'desvio' | 'validacao' | 'agendada' | 'permissao';

export interface RegraAnalise {
  chave: string;
  tipo: TipoRegra;
  componente: string;
  metodo: string | null;
  dominio: string;
  caminho: string;
  linha: number;
  linhaFim: number;
  condicao: string | null;
  mensagem: string | null;
  excecao: string | null;
  status: number | null;
  detalhe: string;
  apareceEm: LugarAnalise[];
  teste: LugarAnalise | null;
  /** Ids de todos os testes que citam a regra (mensagem, exceção ou validação). */
  testes: string[];
}

export type TipoDeTeste = 'unitario' | 'integracao' | 'api' | 'e2e';

/** Um teste do projeto, lido do código. */
export interface TesteInfo {
  id: string;
  classe: string;
  metodo: string;
  caminho: string;
  relativo: string;
  linha: number;
  tipo: TipoDeTeste;
  /** Confere um erro (exceção, 4xx, 5xx): é um cenário que dá errado. */
  esperaErro: boolean;
  componentes: string[];
  chamadas: string[];
  linguagem: 'java' | 'ts';
}

/** O resultado de um teste num relatório JUnit XML (Maven/Gradle). */
export interface ResultadoTeste {
  classe: string;
  metodo: string;
  estado: 'ok' | 'falhou' | 'ignorado';
  segundos: number;
  mensagem: string | null;
  detalhe: string | null;
  integracao: boolean;
}

export interface AnaliseArquitetura {
  tecnologias: string[];
  componentes: ComponenteAnalise[];
  regras: RegraAnalise[];
  testes: TesteInfo[];
  arquivos: number;
}

export const ponte = {
  /** Abre um link (http, https, mailto) no navegador do sistema. */
  async abrirLink(url: string): Promise<void> {
    if (noApp()) return invoke<void>('abrir_link', { url });
    window.open(url, '_blank', 'noopener');
  },

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

  /** seedy.json global (configurações); fora do app não existe. */
  async configCarregar(): Promise<ArquivoTema | null> {
    return noApp() ? invoke<ArquivoTema>('config_carregar') : null;
  },

  async aoAlterarConfig(fn: (config: ArquivoTema) => void): Promise<UnlistenFn> {
    if (!noApp()) return () => {};
    return listen<ArquivoTema>('config-alterada', (e) => fn(e.payload));
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

  async escolherPasta(titulo = 'Abrir projeto'): Promise<string | null> {
    if (!noApp()) return RAIZ_EXEMPLO;
    const { open } = await import('@tauri-apps/plugin-dialog');
    const escolha = await open({ directory: true, multiple: false, title: titulo });
    return typeof escolha === 'string' ? escolha : null;
  },

  /** Pergunta onde salvar um arquivo (ex.: exportar CSV). null = cancelou. */
  async escolherOndeSalvar(titulo: string, nomeSugerido: string, extensao: string): Promise<string | null> {
    if (!noApp()) return `${RAIZ_EXEMPLO}/${nomeSugerido}`;
    const { save } = await import('@tauri-apps/plugin-dialog');
    return save({ title: titulo, defaultPath: nomeSugerido, filters: [{ name: extensao.toUpperCase(), extensions: [extensao] }] });
  },

  /** Java: JDK, instalação do jdtls e o canal LSP (só dentro do app). */
  java: {
    async estado(jdk: string | null): Promise<EstadoJava | null> {
      return noApp() ? invoke<EstadoJava>('java_estado', { jdk }) : null;
    },
    async jdks(): Promise<Jdk[]> {
      return noApp() ? invoke<Jdk[]>('java_jdks') : [];
    },
    /** Plugin java-debug para o jdtls (baixado e conferido na primeira vez). */
    debugPlugin: () => invoke<string>('java_debug_plugin'),
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
    /** 'assinatura' = fala com o `claude` (Claude Code) instalado, com o login da conta; 'chave' = API. */
    modo: 'chave' as 'chave' | 'assinatura',
    /** Versão do Claude Code instalado (ou null). */
    claudeEstado: async (): Promise<string | null> => (noApp() ? invoke<string | null>('ia_claude_estado') : null),
    temChaveDaApi: async (): Promise<boolean> => (noApp() ? invoke<boolean>('ia_tem_chave') : true),
    /** Pode usar a IA agora? (chave da API ou Claude Code, conforme o modo) */
    temChave: async (): Promise<boolean> => (ponte.ia.modo === 'assinatura' ? (await ponte.ia.claudeEstado()) !== null : ponte.ia.temChaveDaApi()),
    definirChave: (chave: string) => invoke<void>('ia_definir_chave', { chave }),
    esquecerChave: () => invoke<void>('ia_esquecer_chave'),
    /** O uso da assinatura lido da conta (login do Claude Code): 5 horas e semana, com a porcentagem. */
    uso: async (): Promise<{ tipo: string; utilizacao: number | null; reiniciaEm: number | null; estado: string | null }[]> => (noApp() ? invoke('ia_uso') : []),
    /** Limites de uso da assinatura que o Claude Code informa (janela de 5 horas e semana). */
    async aoLimites(fn: (l: { tipo: string; utilizacao: number | null; reiniciaEm: number | null; estado: string | null }) => void): Promise<UnlistenFn> {
      if (!noApp()) return () => {};
      return listen<{ tipo: string; utilizacao: number | null; reiniciaEm: number | null; estado: string | null }>('ia-limites', (e) => fn(e.payload));
    },
    /** Manda o pedido à Messages API (com stream) e entrega o JSON de cada evento SSE. */
    async mensagem(corpo: unknown, aoEvento: (dados: string) => void): Promise<void> {
      if (!noApp()) return exemplo.iaMensagem(corpo, aoEvento);
      const eventos = new Channel<string>();
      eventos.onmessage = aoEvento;
      await invoke<void>('ia_mensagem', { corpo, eventos, modo: ponte.ia.modo });
    },
  },

  /** Servidores de aplicação (Fase 5): WildFly/JBoss e Tomcat. Só no app. */
  servidor: {
    perfis: async (): Promise<PerfilServidor[]> => (noApp() ? invoke<PerfilServidor[]>('servidor_perfis') : []),
    salvarPerfil: (perfil: PerfilServidor) => invoke<void>('servidor_salvar_perfil', { perfil }),
    apagarPerfil: (id: string) => invoke<void>('servidor_apagar_perfil', { id }),
    inspecionar: (instalacao: string) => invoke<{ tipo: TipoServidor; versao: string }>('servidor_inspecionar', { instalacao }),
    async iniciar(
      id: string,
      fontes: FonteDeDeploy[],
      debug: boolean,
      aoLer: (linhas: string[]) => void,
      aoEvento: (e: EventoServidor) => void,
    ): Promise<InfoExecucao> {
      const saida = new Channel<string[]>();
      saida.onmessage = aoLer;
      const eventos = new Channel<EventoServidor>();
      eventos.onmessage = aoEvento;
      return invoke<InfoExecucao>('servidor_iniciar', { id, fontes, debug, saida, eventos });
    },
    parar: (id: string) => invoke<void>('servidor_parar', { id }),
    redeploy: (id: string, fontes: FonteDeDeploy[]) => invoke<number>('servidor_redeploy', { id, fontes }),
    emExecucao: async (): Promise<{ id: string; url: string; portaDebug: number | null }[]> =>
      noApp() ? invoke<{ id: string; url: string; portaDebug: number | null }[]>('servidor_em_execucao') : [],
    abrirUrl: (url: string) => invoke<void>('servidor_abrir_url', { url }),
    /** Requisição à aplicação local (só http://localhost). */
    http: (metodo: string, url: string, corpo: string | null, tipo: string | null) =>
      invoke<{ status: number; tipo: string | null; corpo: string; ms: number }>('servidor_http', { metodo, url, corpo, tipo }),
  },

  /** Servidor MCP do Seedy (o Claude Code opera a IDE): as ferramentas rodam na interface. */
  mcp: {
    info: async (): Promise<{ url: string | null; comando: string | null }> =>
      noApp() ? invoke('mcp_info') : { url: null, comando: null },
    definirFerramentas: async (ferramentas: unknown[]) => {
      if (noApp()) await invoke('mcp_definir_ferramentas', { ferramentas });
    },
    responder: (id: number, resultado: string | null, erro: string | null) => invoke<void>('mcp_responder', { id, resultado, erro }),
    async aoChamar(fn: (c: { id: number; nome: string; argumentos: Record<string, unknown> }) => void): Promise<UnlistenFn> {
      if (!noApp()) return () => {};
      return listen<{ id: number; nome: string; argumentos: Record<string, unknown> }>('mcp-chamada', (e) => fn(e.payload));
    },
  },

  /** Fase 6 — Web: servidores de linguagem (TS, Angular, ESLint), Prettier e js-debug. */
  web: {
    estado: async (): Promise<EstadoWeb> => (noApp() ? invoke<EstadoWeb>('web_estado') : { node: null, instalado: false }),
    async instalar(aoProgresso: (linha: string) => void): Promise<void> {
      const progresso = new Channel<string>();
      progresso.onmessage = aoProgresso;
      return invoke<void>('web_instalar', { progresso });
    },
    async lspIniciar(tipo: TipoServidorWeb, raiz: string, aoReceber: (mensagem: string) => void, aoEncerrar: () => void): Promise<number> {
      const mensagens = new Channel<string>();
      mensagens.onmessage = aoReceber;
      const fim = new Channel<null>();
      fim.onmessage = aoEncerrar;
      return invoke<number>('lsp_web_iniciar', { tipo, raiz, mensagens, fim });
    },
    formatar: (raiz: string, caminho: string, texto: string) => invoke<string>('web_formatar', { raiz, caminho, texto }),
    navegadores: async (): Promise<string[]> => (noApp() ? invoke<string[]>('web_navegadores') : ['edge']),
    jsdebug: (reiniciar = false) => invoke<number>('jsdebug_iniciar', { reiniciar }),
  },

  /** Fase 8 — Containers: o CLI do Docker (listar, tráfego entre containers, uso, ações). */
  docker: {
    versao: () => invoke<string>('docker_versao'),
    listar: async (): Promise<ContainerDocker[]> => (noApp() ? invoke<ContainerDocker[]>('docker_listar') : []),
    trafego: async (): Promise<TrafegoDocker[]> => (noApp() ? invoke<TrafegoDocker[]>('docker_trafego') : []),
    uso: async (): Promise<{ nome: string; cpu: string; memoria: string }[]> => (noApp() ? invoke('docker_uso') : []),
    acao: (nome: string, acao: 'start' | 'stop' | 'restart') => invoke<void>('docker_acao', { nome, acao }),
  },

  /** Fase 9 — Entender o sistema: lê o código (Spring, Jakarta, Angular) e devolve componentes, chamadas e regras. */
  arquitetura: {
    analisar: async (raiz: string): Promise<AnaliseArquitetura> =>
      noApp() ? invoke<AnaliseArquitetura>('arquitetura_analisar', { raiz }) : exemplo.analiseArquitetura(),
  },

  /** Testes: o comando (Maven/Gradle) e o que os relatórios do último run mostram. */
  testes: {
    comando: async (raiz: string, tipo: string, filtro: string | null): Promise<string[]> =>
      noApp() ? invoke<string[]>('testes_comando', { raiz, tipo, filtro }) : ['mvn', 'test', '-B'],
    relatorios: async (raiz: string): Promise<ResultadoTeste[]> => (noApp() ? invoke<ResultadoTeste[]>('testes_relatorios', { raiz }) : exemplo.relatoriosDeTestes()),
  },

  /** Comandos do projeto (scripts do package.json, npm install) com a saída em lotes de linhas. */
  tarefa: {
    async iniciar(
      id: string,
      raiz: string,
      comando: string[],
      aoLer: (linhas: string[]) => void,
      aoTerminar: (codigo: number | null) => void,
      ambiente: Record<string, string> | null = null,
    ): Promise<number> {
      const saida = new Channel<string[]>();
      saida.onmessage = aoLer;
      const fim = new Channel<number | null>();
      fim.onmessage = aoTerminar;
      return invoke<number>('tarefa_iniciar', { id, raiz, comando, saida, fim, ambiente });
    },
    parar: (id: string) => invoke<void>('tarefa_parar', { id }),
  },

  /** Novo projeto (␣ N): modelos Java, Spring Boot (start.spring.io) e Angular (ng new). */
  novoProjeto: {
    async criar(pedido: PedidoDeProjeto, aoProgresso: (texto: string) => void): Promise<ProjetoCriado> {
      if (!noApp()) return exemplo.criarProjeto(pedido, aoProgresso);
      const progresso = new Channel<string>();
      progresso.onmessage = aoProgresso;
      return invoke<ProjetoCriado>('projeto_criar', { pedido, progresso });
    },
    springMetadados: async (): Promise<MetadadosSpring> =>
      noApp() ? (JSON.parse(await invoke<string>('spring_metadados')) as MetadadosSpring) : exemplo.springMetadados(),
  },

  /** Debug (DAP) do java-debug: só o transporte; o protocolo fica em depurador.service.ts. */
  dap: {
    async conectar(porta: number, aoReceber: (mensagem: string) => void, aoEncerrar: () => void): Promise<number> {
      const mensagens = new Channel<string>();
      mensagens.onmessage = aoReceber;
      const fim = new Channel<null>();
      fim.onmessage = aoEncerrar;
      return invoke<number>('dap_conectar', { porta, mensagens, fim });
    },
    enviar: (id: number, mensagem: string) => invoke<void>('dap_enviar', { id, mensagem }),
    fechar: (id: number) => invoke<void>('dap_fechar', { id }),
  },

  /** Banco de dados (Fase 3): perfis, sessões, consultas. Fora do app, dados de exemplo. */
  banco: {
    perfis: async (): Promise<PerfilBanco[]> => (noApp() ? invoke<PerfilBanco[]>('banco_perfis') : exemplo.bancoPerfis()),
    salvarPerfil: (perfil: PerfilBanco, senha: string | null) =>
      noApp() ? invoke<void>('banco_salvar_perfil', { perfil, senha }) : Promise.resolve(exemplo.bancoSalvar(perfil)),
    apagarPerfil: (id: string) => (noApp() ? invoke<void>('banco_apagar_perfil', { id }) : Promise.resolve(exemplo.bancoApagar(id))),
    temSenha: async (id: string): Promise<boolean> => (noApp() ? invoke<boolean>('banco_tem_senha', { id }) : true),
    /** Erro "SEM_SENHA" = não há senha guardada: pergunte e chame de novo com ela. */
    conectar: (id: string, senha: string | null, lembrar: boolean) =>
      noApp() ? invoke<InfoConexao>('banco_conectar', { id, senha, lembrar }) : Promise.resolve(exemplo.bancoConectar(id)),
    desconectar: (id: string) => (noApp() ? invoke<void>('banco_desconectar', { id }) : Promise.resolve()),
    consultar: (id: string, sql: string, limite: number) =>
      noApp() ? invoke<ResultadoSql>('banco_consultar', { id, sql, limite }) : exemplo.bancoConsultar(sql),
    exportarCsv: (id: string, sql: string, caminho: string) =>
      noApp() ? invoke<number>('banco_exportar_csv', { id, sql, caminho }) : Promise.resolve(4),
    catalogo: (id: string) => (noApp() ? invoke<SchemaBanco[]>('banco_catalogo', { id }) : Promise.resolve(exemplo.bancoCatalogo())),
    colunas: (id: string, schema: string) =>
      noApp() ? invoke<ColunaDeTabela[]>('banco_colunas', { id, schema }) : Promise.resolve(exemplo.bancoColunas()),
    historico: (id: string) => (noApp() ? invoke<EntradaDoHistoricoSql[]>('banco_historico', { id }) : Promise.resolve([])),
    console: (id: string) => (noApp() ? invoke<string>('banco_console', { id }) : Promise.resolve(exemplo.bancoConsole(id))),
  },

  terminal: {
    async abrir(
      pasta: string | null,
      colunas: number,
      linhas: number,
      aoReceber: (texto: string) => void,
      aoEncerrar: () => void,
      comando: string[] | null = null,
      shell: string[] | null = null,
    ): Promise<number> {
      const saida = new Channel<string>();
      saida.onmessage = aoReceber;
      const fim = new Channel<null>();
      fim.onmessage = aoEncerrar;
      return invoke<number>('terminal_abrir', { pasta, colunas, linhas, saida, fim, comando, shell });
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
