import { inject, Injectable, Injector } from '@angular/core';
import { AprovacoesService } from './aprovacoes.service';
import { motivoSensivel } from './comandos-sensiveis';
import { EnvService } from '../execucao/env.service';
import { JdkProjetoService } from '../execucao/jdk-projeto.service';
import { FERRAMENTAS_IDE, FerramentasIdeService } from './ferramentas-ide.service';
import { TestesService, FiltroDeTipo } from '../testes/testes.service';
import { DockerService } from '../containers/docker.service';
import { ConfigDeExecucao, ExecucaoService } from '../execucao/execucao.service';
import { aceitaBreakpoint, DepuradorService } from '../servidor/depurador.service';
import { ScriptsService } from '../web/scripts.service';

import { LinhaDeLog } from '../servidor/log';
import { ponte } from '../nucleo/ponte';
import { ProjetoService } from '../nucleo/projeto.service';
import { EditorService } from '../editor/editor.service';
import { JdtlsService } from '../java/jdtls.service';
import { ServidorService } from '../servidor/servidor.service';
import { BancoService, NOME_DO_AMBIENTE } from '../banco/banco.service';
import { escreve, instrucoes } from '../banco/sql';
import { monaco } from '../editor/monaco';
import { OrigemDaAlteracao, RevisaoService } from './revisao.service';
import { AutomaticoService } from './automatico.service';
import { EscolhaService } from '../escolha/escolha.service';

/** Definição de ferramenta no formato da Messages API (o MCP usa `inputSchema`). */
export interface DefinicaoDeFerramenta {
  name: string;
  /** Rótulo curto que a tela mostra (como no mockup 06: servidor.iniciar, log.ler...). */
  rotulo: string;
  description: string;
  input_schema: Record<string, unknown>;
}

const objeto = (props: Record<string, unknown>, obrigatorios: string[] = []) => ({
  type: 'object',
  properties: props,
  required: obrigatorios,
  additionalProperties: false,
});
const texto = (description: string) => ({ type: 'string', description });

const FERRAMENTAS_BASE: DefinicaoDeFerramenta[] = [
  {
    name: 'abrir_arquivo',
    rotulo: 'codigo.abrir',
    description: 'Abre um arquivo do projeto no editor do usuário (opcionalmente numa linha) e devolve o trecho em volta, numerado.',
    input_schema: objeto({ caminho: texto('Relativo à raiz do projeto, com "/"'), linha: { type: 'integer' } }, ['caminho']),
  },
  {
    name: 'ler_arquivo',
    rotulo: 'codigo.ler',
    description: 'Lê um arquivo do projeto (numerado), sem abrir no editor. Use inicio/fim para arquivos grandes.',
    input_schema: objeto({ caminho: texto('Relativo à raiz do projeto'), inicio: { type: 'integer' }, fim: { type: 'integer' } }, ['caminho']),
  },
  {
    name: 'buscar_no_projeto',
    rotulo: 'codigo.buscar',
    description: 'Busca um texto (ou regex) nos arquivos do projeto e devolve arquivo:linha: trecho.',
    input_schema: objeto({ texto: texto('O que buscar'), mascara: texto('Ex.: *.java, *.jsp, !*Test.java'), regex: { type: 'boolean' } }, ['texto']),
  },
  {
    name: 'erros_de_compilacao',
    rotulo: 'java.erros',
    description: 'Erros e avisos de compilação do Java (jdtls) agora, de todo o projeto ou de um arquivo.',
    input_schema: objeto({ caminho: texto('Opcional: só este arquivo') }),
  },
  {
    name: 'propor_edicao',
    rotulo: 'codigo.propor',
    description:
      'Propõe uma alteração num arquivo: o usuário vê o diff e aceita ou recusa; a resposta diz a decisão. Mande `conteudo` (o arquivo inteiro novo) ou `trecho_antigo` + `trecho_novo` (troca exata, uma ocorrência). Arquivo novo: só `conteudo`.',
    input_schema: objeto(
      {
        caminho: texto('Relativo à raiz do projeto'),
        motivo: texto('Uma frase dizendo o que a mudança faz'),
        conteudo: texto('Conteúdo completo novo do arquivo'),
        trecho_antigo: texto('Trecho atual, exatamente como está'),
        trecho_novo: texto('Trecho que entra no lugar'),
      },
      ['caminho', 'motivo'],
    ),
  },
  {
    name: 'servidor_estado',
    rotulo: 'servidor.estado',
    description: 'Servidores de aplicação do projeto (WildFly/JBoss, Tomcat): qual está rodando, URL, porta de debug, contagem de erros.',
    input_schema: objeto({}),
  },
  {
    name: 'servidor_iniciar',
    rotulo: 'servidor.iniciar',
    description: 'Sobe o servidor de aplicação do projeto (com a aplicação montada) e espera ele subir.',
    input_schema: objeto({ debug: { type: 'boolean', description: 'Subir em modo debug' } }),
  },
  {
    name: 'servidor_parar',
    rotulo: 'servidor.parar',
    description: 'Para o servidor de aplicação.',
    input_schema: objeto({}),
  },
  {
    name: 'servidor_redeploy',
    rotulo: 'servidor.redeploy',
    description: 'Refaz a aplicação no servidor (classes e jars) e manda recarregar. JSP e estáticos já vão sozinhos ao salvar.',
    input_schema: objeto({}),
  },
  {
    name: 'log_do_servidor',
    rotulo: 'log.ler',
    description: 'Últimas linhas da saída do servidor, com stack traces.',
    input_schema: objeto({ filtro: { type: 'string', enum: ['todos', 'avisos', 'erros'] }, ultimas: { type: 'integer', description: 'Padrão 80' } }),
  },
  {
    name: 'http',
    rotulo: 'http',
    description: 'Requisição HTTP à aplicação local. Caminho começando com "/" vai para o servidor que está rodando (ex.: /feira/reserva.do).',
    input_schema: objeto(
      { metodo: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] }, caminho: texto('"/app/pagina" ou http://localhost:8080/...'), corpo: texto('Corpo (POST/PUT)'), tipo: texto('Content-Type do corpo') },
      ['metodo', 'caminho'],
    ),
  },
  {
    name: 'servidor_criar',
    rotulo: 'servidor.criar',
    description:
      'Configura um servidor de aplicação (Tomcat ou WildFly/JBoss) para este projeto, apontando para uma instalação que já existe no disco (pasta do CATALINA_HOME ou JBOSS_HOME). Use quando servidor_estado disser que não há servidor configurado; procure a instalação no projeto (cloud/, dev/, docs, README) antes de perguntar.',
    input_schema: objeto(
      {
        instalacao: texto('Pasta de instalação (a que tem bin/ e conf/ no Tomcat, ou bin/ e standalone/ no WildFly)'),
        nome: texto('Nome do servidor no Seedy (opcional)'),
        tipo: { type: 'string', enum: ['tomcat', 'wildfly'], description: 'Opcional: detectado pela pasta' },
        portaHttp: { type: 'number', description: 'Porta HTTP (padrão 8080)' },
        contexto: texto('Caminho da aplicação na URL (ex.: /feira; padrão: nome do projeto)'),
      },
      ['instalacao'],
    ),
  },
  {
    name: 'executar_comando',
    rotulo: 'comando',
    description:
      'Roda um comando de shell na raiz do projeto (build, instalação de dependências, scripts do README) e devolve a saída e o código de saída. O usuário vê o comando e aprova cada execução (comandos sensíveis, como apagar em massa, git push --force ou baixar e executar um script, pedem aprovação direta mesmo no modo automático: explique por que precisa deles). Para subir o servidor de aplicação use servidor_iniciar, não este. Comando que não termina (modo watch, servidor) precisa de deixar_rodando: ele devolve a saída dos primeiros segundos e continua em segundo plano.',
    input_schema: objeto(
      {
        comando: texto('Comando completo (ex.: "mvn -q -DskipTests package")'),
        segundos: { type: 'number', description: 'Quanto esperar pelo fim (padrão 120, máximo 600)' },
        deixar_rodando: { type: 'boolean', description: 'Não matar o comando depois de esperar' },
      },
      ['comando'],
    ),
  },
  {
    name: 'banco_conexoes',
    rotulo: 'banco.conexoes',
    description: 'Conexões de banco configuradas no Seedy (nome, ambiente, tipo, se está conectada).',
    input_schema: objeto({}),
  },
  {
    name: 'banco_consultar',
    rotulo: 'banco.consultar',
    description: 'Consulta um banco configurado. Só leitura: SELECT/WITH/EXPLAIN; qualquer alteração é recusada aqui (para alterar use banco_executar, com a aprovação do usuário).',
    input_schema: objeto({ conexao: texto('Nome da conexão'), sql: texto('Consulta') }, ['conexao', 'sql']),
  },
  // ---------- testes ----------
  {
    name: 'testes_resumo',
    rotulo: 'testes.resumo',
    description:
      'Estado dos testes do projeto (tela de testes): quantos passaram/falharam/ignorados, os que falharam com a mensagem, e a cobertura das regras de negócio (regras sem teste e cenários de erro sem teste), com base no último run.',
    input_schema: objeto({}),
  },
  {
    name: 'testes_rodar',
    rotulo: 'testes.rodar',
    description:
      'Roda os testes pelo Maven/Gradle (o mesmo botão da tela de testes), espera terminar e devolve o resultado. Sem argumentos roda todos; `filtro` é uma classe ou classe#metodo; `so_falhas` repete só os que falharam. O usuário aprova a execução (a não ser no modo automático).',
    input_schema: objeto({
      tipo: { type: 'string', enum: ['todos', 'unitario', 'integracao', 'api', 'e2e'], description: 'Padrão: todos' },
      filtro: texto('Classe ou classe#metodo'),
      so_falhas: { type: 'boolean' },
      depurar: { type: 'boolean', description: 'Roda só o teste de `filtro` (Classe#metodo) com o depurador anexado: espera parar num breakpoint e devolve o estado do debug (use debug_controle depois)' },
      segundos: { type: 'number', description: 'Quanto esperar pelo fim (padrão 600, máximo 1800); passou disso, os testes são cancelados' },
    }),
  },
  {
    name: 'testes_parar',
    rotulo: 'testes.parar',
    description: 'Cancela os testes que estão rodando (o botão de parar da tela de testes).',
    input_schema: objeto({}),
  },
  // ---------- containers ----------
  {
    name: 'containers_listar',
    rotulo: 'containers.listar',
    description: 'Containers do Docker (nome, imagem, estado, portas publicadas, serviço do compose e do que depende).',
    input_schema: objeto({}),
  },
  {
    name: 'container_acao',
    rotulo: 'container.acao',
    description: 'Inicia, para ou reinicia um container pelo nome. O usuário aprova (a não ser no modo automático).',
    input_schema: objeto({ nome: texto('Nome do container'), acao: { type: 'string', enum: ['iniciar', 'parar', 'reiniciar'] } }, ['nome', 'acao']),
  },
  {
    name: 'container_logs',
    rotulo: 'container.logs',
    description: 'Últimas linhas do log de um container.',
    input_schema: objeto({ nome: texto('Nome do container'), ultimas: { type: 'integer', description: 'Padrão 100' } }, ['nome']),
  },
  {
    name: 'docker_compose',
    rotulo: 'docker.compose',
    description:
      'Roda `docker compose up -d` ou `down` na pasta do compose do projeto. `down` remove os containers e sempre pede confirmação ao usuário, mesmo no modo automático.',
    input_schema: objeto({ acao: { type: 'string', enum: ['up', 'down'] } }, ['acao']),
  },
  // ---------- rodar e depurar ----------
  {
    name: 'execucoes',
    rotulo: 'executar.lista',
    description:
      'As configurações de execução do projeto (as do botão de rodar: servidor, classe main, scripts npm), qual está escolhida, se está rodando e se há um debug ativo.',
    input_schema: objeto({}),
  },
  {
    name: 'rodar',
    rotulo: 'executar.rodar',
    description:
      'Aperta o botão de rodar (ou o de debug, com debug=true) numa configuração de execução: sobe o servidor, a classe main ou o script, como o usuário faria. Devolve o estado e o começo da saída. Use `execucoes` para ver os nomes; sem `config` usa a escolhida. O usuário aprova (a não ser no modo automático).',
    input_schema: objeto({ config: texto('Nome ou id da configuração (opcional)'), debug: { type: 'boolean', description: 'Rodar com o depurador' } }),
  },
  {
    name: 'parar',
    rotulo: 'executar.parar',
    description: 'Aperta o botão de parar: encerra a configuração que está rodando (e o debug dela).',
    input_schema: objeto({ config: texto('Nome ou id da configuração (opcional)') }),
  },
  {
    name: 'saida_da_execucao',
    rotulo: 'executar.saida',
    description: 'Últimas linhas da saída da configuração de execução (classe main, script ou servidor), com o estado e o código de saída.',
    input_schema: objeto({ config: texto('Nome ou id da configuração (opcional)'), filtro: { type: 'string', enum: ['todos', 'avisos', 'erros'] }, ultimas: { type: 'integer', description: 'Padrão 80' } }),
  },
  {
    name: 'debug_breakpoints',
    rotulo: 'debug.breakpoints',
    description: 'Lista, adiciona ou remove breakpoints (Java, TS e JS). `adicionar` pode levar uma condição (expressão Java que precisa dar true).',
    input_schema: objeto(
      {
        acao: { type: 'string', enum: ['listar', 'adicionar', 'remover'] },
        caminho: texto('Relativo à raiz do projeto'),
        linha: { type: 'integer' },
        condicao: texto('Opcional: só para quando for true'),
      },
      ['acao'],
    ),
  },
  {
    name: 'debug_estado',
    rotulo: 'debug.estado',
    description: 'Estado do debug: se há sessão, se está pausada (onde, por quê), a pilha, as variáveis do frame atual e as expressões já avaliadas.',
    input_schema: objeto({}),
  },
  {
    name: 'debug_controle',
    rotulo: 'debug.controle',
    description:
      'Controla o debug pausado: continuar, passar (step over), entrar (step into), sair (step out) ou ate_linha (roda até um arquivo e linha). Espera parar de novo (ou terminar) e devolve o estado.',
    input_schema: objeto(
      { acao: { type: 'string', enum: ['continuar', 'passar', 'entrar', 'sair', 'ate_linha'] }, caminho: texto('Só para ate_linha'), linha: { type: 'integer', description: 'Só para ate_linha' } },
      ['acao'],
    ),
  },
  {
    name: 'debug_avaliar',
    rotulo: 'debug.avaliar',
    description: 'Avalia uma expressão Java no frame atual (o debug precisa estar pausado) e devolve o resultado.',
    input_schema: objeto({ expressao: texto('Expressão Java') }, ['expressao']),
  },
];

/** Todas as ferramentas: as de base daqui e as da IDE (TODO, git, arquitetura...). */
export const FERRAMENTAS: DefinicaoDeFerramenta[] = [...FERRAMENTAS_BASE, ...FERRAMENTAS_IDE];

const LIMITE_DE_TEXTO = 60_000;

/**
 * As ferramentas que a IA usa para operar o Seedy — as mesmas no painel de IA (API) e
 * no servidor MCP (Claude Code no terminal).
 */
@Injectable({ providedIn: 'root' })
export class FerramentasService {
  private readonly projeto = inject(ProjetoService);
  private readonly editor = inject(EditorService);
  private readonly jdtls = inject(JdtlsService);
  private readonly servidor = inject(ServidorService);
  private readonly banco = inject(BancoService);
  private readonly revisao = inject(RevisaoService);
  private readonly escolha = inject(EscolhaService);
  private readonly automatico = inject(AutomaticoService);
  private readonly injetor = inject(Injector);
  private readonly aprovacoes = inject(AprovacoesService);

  // Estes serviços dependem (direta ou indiretamente) da IA, que usa as ferramentas: pegos só na hora de usar.
  private testesSvc = () => this.injetor.get(TestesService);
  private dockerSvc = () => this.injetor.get(DockerService);
  private execSvc = () => this.injetor.get(ExecucaoService);
  private depSvc = () => this.injetor.get(DepuradorService);
  private scriptsSvc = () => this.injetor.get(ScriptsService);
  private envSvc = () => this.injetor.get(EnvService);
  private jdkSvc = () => this.injetor.get(JdkProjetoService);

  rotulo(nome: string): string {
    return FERRAMENTAS.find((f) => f.name === nome)?.rotulo ?? nome;
  }

  /** Executa a ferramenta; erro vira exceção com mensagem para a IA. */
  async executar(nome: string, entrada: Record<string, unknown>, origem: OrigemDaAlteracao): Promise<string> {
    this.revisao.iaAtiva();
    switch (nome) {
      case 'abrir_arquivo':
        return this.abrir(this.caminho(entrada), num(entrada['linha']));
      case 'ler_arquivo':
        return this.ler(this.caminho(entrada), num(entrada['inicio']), num(entrada['fim']));
      case 'buscar_no_projeto':
        return this.buscar(str(entrada, 'texto'), opc(entrada, 'mascara'), entrada['regex'] === true);
      case 'erros_de_compilacao':
        return this.erros(entrada['caminho'] ? this.caminho(entrada) : null);
      case 'propor_edicao':
        return this.propor(entrada, origem);
      case 'servidor_estado':
        return this.estadoDoServidor();
      case 'servidor_criar':
        return this.criarServidor(entrada);
      case 'executar_comando':
        return this.executarComando(str(entrada, 'comando'), num(entrada['segundos']) ?? undefined, entrada['deixar_rodando'] === true);
      case 'servidor_iniciar':
        return this.iniciarServidor(entrada['debug'] === true);
      case 'servidor_parar':
        await this.servidor.parar();
        return 'pedido de parar enviado';
      case 'servidor_redeploy':
        await this.servidor.redeploy();
        return 'redeploy pedido; veja log_do_servidor em alguns segundos';
      case 'log_do_servidor':
        return this.log(opc(entrada, 'filtro') ?? 'todos', num(entrada['ultimas']) ?? 80);
      case 'http':
        return this.http(str(entrada, 'metodo'), str(entrada, 'caminho'), opc(entrada, 'corpo'), opc(entrada, 'tipo'));
      case 'banco_conexoes':
        return this.conexoes();
      case 'banco_consultar':
        return this.consultar(str(entrada, 'conexao'), str(entrada, 'sql'));
      case 'testes_resumo':
        return this.testesResumo();
      case 'testes_rodar':
        return this.testesRodar(entrada);
      case 'testes_parar':
        return this.testesParar();
      case 'containers_listar':
        return this.containersListar();
      case 'container_acao':
        return this.containerAcao(str(entrada, 'nome'), str(entrada, 'acao'));
      case 'container_logs':
        return this.containerLogs(str(entrada, 'nome'), num(entrada['ultimas']) ?? 100);
      case 'docker_compose':
        return this.compose(str(entrada, 'acao'));
      case 'execucoes':
        return this.execucoes();
      case 'rodar':
        return this.rodar(opc(entrada, 'config'), entrada['debug'] === true);
      case 'parar':
        return this.pararConfig(opc(entrada, 'config'));
      case 'saida_da_execucao': {
        const c = this.escolherConfig(opc(entrada, 'config'));
        if (!c) throw new Error('nenhuma configuração de execução');
        return `${c.nome}: ${this.estadoDaConfig(c)}\n${this.saidaDaConfig(c, opc(entrada, 'filtro') ?? 'todos', num(entrada['ultimas']) ?? 80)}`;
      }
      case 'debug_breakpoints':
        return this.breakpoints(entrada);
      case 'debug_estado':
        return this.estadoDoDebug();
      case 'debug_controle':
        return this.controlarDebug(entrada);
      case 'debug_avaliar':
        return this.avaliarNoDebug(str(entrada, 'expressao'));
      default:
        if (this.injetor.get(FerramentasIdeService).conhece(nome)) return this.injetor.get(FerramentasIdeService).executar(nome, entrada, this, origem);
        throw new Error(`ferramenta desconhecida: ${nome}`);
    }
  }

  // ---------- código ----------

  /** Caminho dentro do projeto (relativo ou absoluto); fora dele é recusado. */
  caminho(entrada: Record<string, unknown>): string {
    const raiz = this.projeto.raiz();
    if (!raiz) throw new Error('nenhum projeto aberto no Seedy');
    const bruto = str(entrada, 'caminho').replace(/\\/g, '/');
    const sep = raiz.includes('\\') ? '\\' : '/';
    const raizN = raiz.replace(/\\/g, '/').replace(/\/$/, '');
    const abs = /^([a-zA-Z]:|\/)/.test(bruto) ? bruto : `${raizN}/${bruto.replace(/^\.\//, '')}`;
    const partes: string[] = [];
    for (const p of abs.split('/')) {
      if (p === '..') partes.pop();
      else if (p !== '.' && p !== '') partes.push(p);
    }
    const final = (abs.startsWith('/') ? '/' : '') + partes.join('/');
    if (!final.toLowerCase().startsWith(raizN.toLowerCase() + '/') && final.toLowerCase() !== raizN.toLowerCase()) {
      throw new Error(`fora do projeto: ${bruto}`);
    }
    return final.replace(/\//g, sep);
  }

  relativo(caminho: string): string {
    const raiz = (this.projeto.raiz() ?? '').replace(/\\/g, '/');
    return caminho.replace(/\\/g, '/').replace(raiz + '/', '');
  }

  private async abrir(caminho: string, linha: number | null): Promise<string> {
    const b = await this.editor.abrir(caminho, linha ?? undefined);
    if (!b) throw new Error(`não consegui abrir ${this.relativo(caminho)}`);
    const linhas = b.modelo.getLinesContent();
    const centro = linha ?? 1;
    const ini = Math.max(1, centro - 30);
    const fim = Math.min(linhas.length, centro + 30);
    return `aberto no editor: ${this.relativo(caminho)} (${linhas.length} linhas)\n${numerar(linhas, ini, fim)}`;
  }

  private async ler(caminho: string, inicio: number | null, fim: number | null): Promise<string> {
    const b = this.editor.bufferDe(caminho);
    const conteudo = b ? b.modelo.getValue() : await ponte.lerArquivo(caminho).catch(() => {
      throw new Error(`arquivo não encontrado: ${this.relativo(caminho)}`);
    });
    const linhas = conteudo.split(/\r?\n/);
    const ini = Math.max(1, inicio ?? 1);
    const ate = Math.min(linhas.length, fim ?? linhas.length);
    return cortar(`${this.relativo(caminho)} (${linhas.length} linhas${b && this.editor.sujo(b) ? ', com edições não salvas' : ''})\n${numerar(linhas, ini, ate)}`);
  }

  private async buscar(consulta: string, mascara: string | null, regex: boolean): Promise<string> {
    const raiz = this.projeto.raiz();
    if (!raiz) throw new Error('nenhum projeto aberto');
    const r = await ponte.buscarTexto(raiz, consulta, 100, { mascara: mascara ?? undefined, regex });
    if (!r.length) return 'nada encontrado';
    return r.map((o) => `${o.relativo}:${o.linha}: ${o.texto.trim()}`).join('\n');
  }

  private erros(caminho: string | null): string {
    const alvo = caminho ? monaco.Uri.file(caminho).toString() : null;
    const linhas: string[] = [];
    for (const [uri, diags] of this.jdtls.todosOsDiagnosticos()) {
      if (alvo && uri !== alvo) continue;
      const rel = this.relativo(monaco.Uri.parse(uri).fsPath);
      for (const d of diags) {
        if (d.severity && d.severity > 2) continue;
        linhas.push(`${rel}:${d.range.start.line + 1}: [${d.severity === 1 ? 'erro' : 'aviso'}] ${d.message}`);
      }
    }
    if (!this.jdtls.pronto()) linhas.unshift('(o jdtls ainda não está pronto: a lista pode estar incompleta)');
    return linhas.length ? cortar(linhas.join('\n')) : 'nenhum erro ou aviso de compilação';
  }

  private async propor(entrada: Record<string, unknown>, origem: OrigemDaAlteracao): Promise<string> {
    const caminho = this.caminho(entrada);
    const motivo = opc(entrada, 'motivo') ?? '';
    let novo = opc(entrada, 'conteudo');
    const antigo = opc(entrada, 'trecho_antigo');
    if (novo === null) {
      if (antigo === null) throw new Error('mande `conteudo` ou `trecho_antigo` + `trecho_novo`');
      const trechoNovo = opc(entrada, 'trecho_novo') ?? '';
      const b = this.editor.bufferDe(caminho);
      const atual = b ? b.modelo.getValue() : await ponte.lerArquivo(caminho);
      const ocorrencias = atual.split(antigo).length - 1;
      if (ocorrencias === 0) throw new Error('trecho_antigo não encontrado no arquivo (leia o arquivo de novo e copie exatamente)');
      if (ocorrencias > 1) throw new Error(`trecho_antigo aparece ${ocorrencias} vezes: inclua mais contexto para ser único`);
      novo = atual.replace(antigo, () => trechoNovo);
    }
    const r = await this.revisao.propor(caminho, novo, origem, motivo);
    return r.aceita ? `aceita: ${this.relativo(caminho)} foi gravado (${r.comentario})` : `recusada pelo usuário: ${r.comentario}`;
  }

  // ---------- servidor ----------

  private estadoDoServidor(): string {
    const perfis = this.servidor.doProjeto();
    if (!perfis.length) return 'nenhum servidor configurado neste projeto (o usuário cria com Alt+4 → n)';
    return perfis
      .map((p) => {
        const e = this.servidor.execucoes().get(p.id);
        const fase = e?.fase ?? 'parado';
        const extra = e && e.fase !== 'parado' ? ` · ${e.info?.url ?? ''}${e.info?.portaDebug ? ` · debug :${e.info.portaDebug}` : ''} · ${e.erros} erros, ${e.avisos} avisos` : '';
        return `${p.nome} (${p.tipo}, :${p.portaHttp}${p.contexto}) — ${fase}${extra}${p.id === this.servidor.perfilAtual()?.id ? ' [selecionado]' : ''}`;
      })
      .join('\n');
  }

  private async criarServidor(entrada: Record<string, unknown>): Promise<string> {
    const tipo = entrada['tipo'] === 'tomcat' ? 'tomcat' : entrada['tipo'] === 'wildfly' ? 'wildfly' : undefined;
    const p = await this.servidor.criarPerfil({
      instalacao: str(entrada, 'instalacao'),
      nome: opc(entrada, 'nome') ?? undefined,
      tipo,
      portaHttp: num(entrada['portaHttp']) ?? undefined,
      contexto: opc(entrada, 'contexto') ?? undefined,
    });
    return `servidor "${p.nome}" (${p.tipo}) configurado: instalação ${p.instalacao}, porta ${p.portaHttp}, contexto ${p.contexto}, web ${p.pastaWeb}, classes ${p.pastaClasses}. Agora use servidor_iniciar (compile o projeto antes se ${p.pastaClasses} não existir).`;
  }

  /** Roda um comando de shell na raiz do projeto, depois que o usuário aprova. */
  private async executarComando(comando: string, segundos: number | undefined, deixar: boolean): Promise<string> {
    const raiz = this.projeto.raiz();
    if (!raiz) throw new Error('nenhum projeto aberto');
    const sensivel = motivoSensivel(comando);
    const decisao = sensivel
      ? await this.autorizar(
          `⚠ COMANDO SENSÍVEL: ${sensivel}`,
          'Rodar mesmo assim',
          comando,
          true,
          '⚠ vale até no automático',
        )
      : await this.autorizar('A IA QUER RODAR UM COMANDO', 'Rodar', comando);
    if (!decisao) return sensivel ? 'o usuário recusou o comando sensível; não rodou' : 'o usuário recusou o comando; não rodou';
    const espera = Math.max(5, Math.min(600, segundos ?? 120)) * 1000;
    const id = `ia-cmd-${Date.now()}`;
    const windows = /win/i.test(navigator.platform);
    const argv = windows ? ['cmd.exe', '/C', comando] : ['sh', '-c', comando];
    let saida: string[] = [];
    let codigo: number | null | undefined;
    const dotenv = await this.envSvc().variaveis();
    if (dotenv === null) return 'o usuário cancelou a escolha do .env; o comando não rodou';
    const jdk = await this.jdkSvc().ambiente();
    const env = { ...jdk.ambiente, ...dotenv };
    await ponte.tarefa.iniciar(
      id,
      raiz,
      argv,
      (linhas) => (saida = [...saida, ...linhas].slice(-1500)),
      (c) => (codigo = c),
      Object.keys(env).length ? env : null,
    );
    const fim = Date.now() + espera;
    while (codigo === undefined && Date.now() < fim) await new Promise((r) => setTimeout(r, 300));
    if (codigo === undefined) {
      if (!deixar) await ponte.tarefa.parar(id).catch(() => undefined);
      return `${deixar ? 'ainda rodando em segundo plano' : 'passou do tempo e o comando foi encerrado'} depois de ${espera / 1000} s. Saída até agora:\n${cortar(saida.join('\n'))}`;
    }
    return `saiu com código ${codigo}.\n${cortar(saida.join('\n'))}`;
  }

  private async iniciarServidor(debug: boolean): Promise<string> {
    const p = this.servidor.perfilAtual();
    if (!p) throw new Error('nenhum servidor configurado neste projeto');
    const atual = this.servidor.execucoes().get(p.id);
    if (atual && atual.fase !== 'parado') return `${p.nome} já está ${atual.fase} (${atual.info?.url ?? ''})`;
    await this.servidor.iniciar(debug, p.id);
    for (let i = 0; i < 240; i++) {
      const e = this.servidor.execucoes().get(p.id);
      if (!e || e.fase === 'parado') return `${p.nome} não subiu:\n${this.log('erros', 40)}`;
      if (e.fase === 'rodando' && e.subiuEm !== null) return `${p.nome} subiu em ${(e.subiuEm / 1000).toFixed(1)} s: ${e.info?.url ?? ''}${e.erros ? ` (${e.erros} erros no log)` : ''}`;
      await new Promise((r) => setTimeout(r, 500));
    }
    return `${p.nome} ainda subindo depois de 2 minutos; veja log_do_servidor`;
  }

  private log(filtro: string, ultimas: number): string {
    const e = this.servidor.execucaoAtual();
    if (!e) return 'o servidor não rodou ainda nesta sessão';
    const linhas = e.linhas.filter((l) => (filtro === 'erros' ? l.nivel === 'erro' : filtro === 'avisos' ? l.nivel === 'erro' || l.nivel === 'aviso' : true));
    const fim = linhas.slice(-Math.max(1, Math.min(500, ultimas)));
    return fim.length ? cortar(fim.map((l) => l.texto).join('\n')) : `nenhuma linha (${filtro})`;
  }

  private async http(metodo: string, caminho: string, corpo: string | null, tipo: string | null): Promise<string> {
    let url = caminho;
    if (caminho.startsWith('/')) {
      const base = this.servidor.execucaoAtual()?.info?.url;
      if (!base) throw new Error('nenhum servidor rodando: inicie com servidor_iniciar ou passe a URL completa');
      url = new URL(caminho, base).toString();
    }
    const r = await ponte.servidor.http(metodo, url, corpo, tipo);
    return cortar(`${metodo} ${url} → ${r.status} (${r.ms} ms${r.tipo ? `, ${r.tipo}` : ''})\n\n${r.corpo}`);
  }

  // ---------- autorização ----------

  /** O usuário aprova (ou o modo automático dispensa); `forcar` pergunta sempre. */
  async autorizar(titulo: string, rotulo: string, detalhe: string, forcar = false, dica?: string): Promise<boolean> {
    if (this.automatico.ligado() && !forcar) {
      this.aprovacoes.registrar(titulo, detalhe, 'automático');
      return true;
    }
    const ok = !!(await this.escolha.escolherUm(
      titulo,
      [
        { rotulo, detalhe, valor: true },
        { rotulo: 'Recusar', detalhe: 'não roda e a IA é avisada', valor: false },
      ],
      dica,
    ));
    this.aprovacoes.registrar(titulo, detalhe, ok ? 'aprovado' : 'recusado');
    return ok;
  }

  /** Roda um processo na raiz do projeto e espera o fim (ou o tempo), devolvendo a saída. */
  private async tarefa(argv: string[], segundos: number): Promise<{ codigo: number | null | undefined; saida: string }> {
    const raiz = this.projeto.raiz() ?? '.';
    const id = `ia-tarefa-${Date.now()}`;
    let saida: string[] = [];
    let codigo: number | null | undefined;
    const env = { ...(await this.jdkSvc().ambiente()).ambiente, ...((await this.envSvc().variaveis()) ?? {}) };
    await ponte.tarefa.iniciar(id, raiz, argv, (l) => (saida = [...saida, ...l].slice(-1500)), (c) => (codigo = c), Object.keys(env).length ? env : null);
    const fim = Date.now() + segundos * 1000;
    while (codigo === undefined && Date.now() < fim) await new Promise((r) => setTimeout(r, 300));
    if (codigo === undefined) await ponte.tarefa.parar(id).catch(() => undefined);
    return { codigo, saida: saida.join('\n') };
  }

  // ---------- testes ----------

  private testesResumo(): string {
    const t = this.testesSvc();
    const tot = t.totais();
    if (!tot.todos) return 'nenhum teste encontrado no projeto (a análise ainda pode estar lendo o código)';
    const linhas = [
      `${tot.todos} testes: ${tot.ok} passaram, ${tot.falhou} falharam, ${tot.ignorado} ignorados, ${tot.semResultado} sem resultado (nunca rodaram)`,
      `por tipo: unitários ${tot.unitario}, integração ${tot.integracao}, API ${tot.api}, e2e ${tot.e2e}`,
    ];
    const ult = t.ultimaExecucao();
    if (ult) linhas.push(`último run: ${ult.segundos.toFixed(1)} s, código ${ult.codigo}`);
    if (t.rodando()) linhas.push(`rodando agora: ${t.rodando()}`);
    const falhas = t.testes().filter((x) => t.estadoDe(x) === 'falhou');
    if (falhas.length) {
      linhas.push('', 'FALHARAM:');
      for (const f of falhas.slice(0, 30)) {
        const r = t.resultadoDe(f);
        linhas.push(`- ${f.classe}#${f.metodo} (${f.relativo}:${f.linha})${r?.mensagem ? `: ${r.mensagem.split('\n')[0].slice(0, 300)}` : ''}`);
      }
    }
    const resumo = t.resumoDaCobertura();
    if (resumo.regras) {
      linhas.push('', `REGRAS DE NEGÓCIO: ${resumo.comTeste} de ${resumo.regras} com teste (${resumo.passando} passando, ${resumo.falhando} falhando, ${resumo.semTeste} sem teste); cenários de erro: ${resumo.errosCobertos} de ${resumo.errosTotal} com teste`);
      const sem = [...t.cobertura().values()].filter((c) => c.estado === 'sem' || c.estado === 'so-feliz');
      for (const c of sem.slice(0, 25)) linhas.push(`- ${c.chave}: ${c.estado === 'sem' ? 'sem nenhum teste' : 'só o caminho feliz (falta o cenário de erro)'}`);
    }
    return cortar(linhas.join('\n'));
  }

  private async testesRodar(entrada: Record<string, unknown>): Promise<string> {
    const t = this.testesSvc();
    if (!this.projeto.raiz()) throw new Error('nenhum projeto aberto');
    if (t.rodando()) throw new Error('já há testes rodando; espere ou use testes_resumo');
    const tipoBruto = opc(entrada, 'tipo') ?? 'todos';
    const tipo = (['todos', 'unitario', 'integracao', 'api', 'e2e'].includes(tipoBruto) ? tipoBruto : 'todos') as FiltroDeTipo;
    const filtro = opc(entrada, 'filtro');
    const soFalhas = entrada['so_falhas'] === true;
    const alvo = soFalhas ? 'só os que falharam' : filtro ? `${filtro} (${tipo})` : `todos (${tipo})`;
    if (!(await this.autorizar('A IA QUER RODAR OS TESTES', 'Rodar', alvo))) return 'o usuário recusou; os testes não rodaram';
    if (entrada['depurar'] === true) {
      const alvoDebug = t.testes().find((x) => x.linguagem === 'java' && `${x.classe}#${x.metodo}` === filtro);
      if (!alvoDebug) throw new Error('para depurar, passe em "filtro" um teste exato: Classe#metodo (veja testes_resumo)');
      await t.depurarTeste(alvoDebug);
      // Espera parar num breakpoint (ou o teste terminar sem parar).
      const limiteDebug = Date.now() + Math.max(20, Math.min(300, num(entrada['segundos']) ?? 120)) * 1000;
      await new Promise((r) => setTimeout(r, 1000));
      while (Date.now() < limiteDebug && t.rodando() && !this.depSvc().pausado()) await new Promise((r) => setTimeout(r, 500));
      if (this.depSvc().pausado()) return `${this.estadoDoDebug()}\n(o teste continua suspenso: use debug_controle; \`continuar\` até o fim)`;
      if (t.rodando()) return 'o teste ainda não chegou a um breakpoint (confira debug_breakpoints); ele segue rodando com o depurador anexado';
      return `o teste terminou sem parar em nenhum breakpoint.\n${this.testesResumo()}`;
    }
    if (soFalhas) await t.rodarFalhas();
    else await t.rodar(tipo, filtro);
    // O Maven pode baixar o mundo na primeira vez: espera até o limite (padrão 10 minutos).
    const limite = Math.max(10, Math.min(1800, num(entrada['segundos']) ?? 600));
    const fim = Date.now() + limite * 1000;
    await new Promise((r) => setTimeout(r, 500));
    while (t.rodando() && Date.now() < fim) await new Promise((r) => setTimeout(r, 500));
    if (t.rodando()) {
      await t.parar();
      return `passou de ${limite} s e os testes foram cancelados. Saída até agora:\n${cortar(t.saida().slice(-60).join('\n'))}`;
    }
    return `${this.testesResumo()}\n\nSAÍDA (final):\n${cortar(t.saida().slice(-60).join('\n'))}`;
  }

  private async testesParar(): Promise<string> {
    const t = this.testesSvc();
    if (!t.rodando()) return 'não há testes rodando';
    await t.parar();
    await new Promise((r) => setTimeout(r, 1000));
    return `testes cancelados. Saída até agora:\n${cortar(t.saida().slice(-30).join('\n'))}`;
  }

  // ---------- containers ----------

  private async containersListar(): Promise<string> {
    const d = this.dockerSvc();
    await d.atualizar(true);
    if (d.erro() && !d.containers().length) return `Docker indisponível: ${d.erro()}`;
    if (!d.containers().length) return 'nenhum container';
    return d
      .containers()
      .map((c) => {
        const portas = c.portas.filter((p) => p.host).map((p) => `${p.host}→${p.container}`).join(', ');
        return `${c.nome} — ${c.imagem} — ${c.estado}${portas ? ` — portas ${portas}` : ''}${c.composeServico ? ` — compose: ${c.composeServico}` : ''}${c.dependeDe.length ? ` — depende de ${c.dependeDe.join(', ')}` : ''}`;
      })
      .join('\n');
  }

  private async containerAcao(nome: string, acao: string): Promise<string> {
    const d = this.dockerSvc();
    await d.atualizar(false);
    const c = d.containers().find((x) => x.nome === nome);
    if (!c) throw new Error(`container "${nome}" não existe; veja containers_listar`);
    if (!['iniciar', 'parar', 'reiniciar'].includes(acao)) throw new Error('acao: iniciar, parar ou reiniciar');
    if (!(await this.autorizar('A IA QUER MEXER NUM CONTAINER', acao[0].toUpperCase() + acao.slice(1), c.nome))) return 'o usuário recusou; nada foi feito';
    if (acao === 'reiniciar') await d.reiniciar(c.nome);
    else if ((acao === 'parar') === (c.estado === 'running')) await d.iniciarOuParar(c.nome);
    else return `${c.nome} já está ${c.estado}`;
    const depois = d.containers().find((x) => x.nome === nome);
    return `${nome}: ${depois?.estado ?? 'desconhecido'}`;
  }

  private async containerLogs(nome: string, ultimas: number): Promise<string> {
    const n = Math.max(1, Math.min(1000, ultimas));
    const r = await this.tarefa(['docker', 'logs', '--tail', String(n), '--timestamps', nome], 30);
    return r.codigo ? `docker logs falhou (código ${r.codigo}):\n${cortar(r.saida)}` : cortar(r.saida) || 'sem linhas';
  }

  private async compose(acao: string): Promise<string> {
    if (acao !== 'up' && acao !== 'down') throw new Error('acao: up ou down');
    const d = this.dockerSvc();
    const detalhe = acao === 'down' ? 'para e remove os containers do compose (os volumes ficam)' : 'docker compose up -d';
    if (!(await this.autorizar(acao === 'down' ? 'A IA QUER DERRUBAR O COMPOSE' : 'A IA QUER SUBIR O COMPOSE', acao === 'down' ? 'Derrubar' : 'Subir', detalhe, acao === 'down'))) {
      return 'o usuário recusou; nada foi feito';
    }
    if (!this.projeto.raiz()) throw new Error('nenhum projeto aberto');
    const r = await this.tarefa(['docker', 'compose', ...(acao === 'up' ? ['up', '-d'] : ['down'])], 300);
    await d.atualizar(false);
    return `docker compose ${acao}: código ${r.codigo ?? 'sem fim'}\n${cortar(r.saida)}`;
  }

  // ---------- rodar e depurar ----------

  private escolherConfig(nome: string | null): ConfigDeExecucao | null {
    const e = this.execSvc();
    if (nome) {
      const alvo = nome.toLowerCase();
      const c = e.configs().find((x) => x.id.toLowerCase() === alvo || x.nome.toLowerCase() === alvo) ?? e.configs().find((x) => x.nome.toLowerCase().includes(alvo));
      if (!c) throw new Error(`configuração "${nome}" não existe; veja execucoes`);
      e.escolher(c.id);
      return c;
    }
    return e.atual();
  }

  private estadoDaConfig(c: ConfigDeExecucao): string {
    const e = this.execSvc();
    if (c.tipo === 'servidor') {
      const x = this.servidor.execucoes().get(c.perfilId);
      return x && x.fase !== 'parado' ? `${x.fase}${x.info?.url ? ` em ${x.info.url}` : ''}${x.debug ? ' (debug)' : ''}` : 'parado';
    }
    if (c.tipo === 'script') {
      const x = this.scriptsSvc().execucoes().get(c.script);
      return !x ? 'parado' : x.fase === 'rodando' ? `rodando${x.url ? ` em ${x.url}` : ''}` : `terminou (código ${x.codigo})`;
    }
    const m = e.main();
    if (!m || m.config.id !== c.id) return 'parado';
    return m.fase === 'parado' ? `terminou${m.codigo !== null ? ` (código ${m.codigo})` : ''}` : `${m.fase}${m.debug ? ' (debug)' : ''}`;
  }

  private execucoes(): string {
    const e = this.execSvc();
    const lista = e.configs();
    if (!lista.length) return e.procurando() ? 'procurando as classes main…' : 'nenhuma configuração de execução (sem classe main, servidor ou script npm)';
    const dep = this.depSvc().sessao();
    return [
      ...lista.map((c) => `${c.id === e.atual()?.id ? '* ' : '  '}${c.nome} [${c.tipo}] — ${this.estadoDaConfig(c)}`),
      dep ? `debug ativo: ${dep.nome}${this.depSvc().pausado() ? ' (pausado)' : ''}` : 'sem sessão de debug',
    ].join('\n');
  }

  private saidaDaConfig(c: ConfigDeExecucao, filtro: string, ultimas: number): string {
    const e = this.execSvc();
    let linhas: LinhaDeLog[] = [];
    if (c.tipo === 'servidor') linhas = this.servidor.execucoes().get(c.perfilId)?.linhas ?? [];
    else if (c.tipo === 'script') linhas = this.scriptsSvc().execucoes().get(c.script)?.linhas ?? [];
    else if (e.main()?.config.id === c.id) linhas = e.main()!.linhas;
    const f = linhas.filter((l) => (filtro === 'erros' ? l.nivel === 'erro' : filtro === 'avisos' ? l.nivel === 'erro' || l.nivel === 'aviso' : true));
    const fim = f.slice(-Math.max(1, Math.min(500, ultimas)));
    return fim.length ? cortar(fim.map((l) => l.texto).join('\n')) : `nenhuma linha (${filtro})`;
  }

  private async rodar(nome: string | null, debug: boolean): Promise<string> {
    const e = this.execSvc();
    if (!this.projeto.raiz()) throw new Error('nenhum projeto aberto');
    await e.procurarMains();
    const c = this.escolherConfig(nome);
    if (!c) throw new Error(this.jdtls.pronto() ? 'nenhuma configuração para rodar (sem classe main, servidor ou script)' : 'o jdtls ainda está carregando o projeto; tente de novo em instantes');
    if (!(await this.autorizar(debug ? 'A IA QUER DEPURAR' : 'A IA QUER RODAR', debug ? 'Depurar' : 'Rodar', `${c.nome} (${c.tipo})`))) return 'o usuário recusou; nada rodou';
    await e.rodar(debug);
    // Dá alguns segundos para subir e mostra o começo da saída.
    const fim = Date.now() + 20_000;
    await new Promise((r) => setTimeout(r, 1500));
    while (Date.now() < fim && /subindo/.test(this.estadoDaConfig(c))) await new Promise((r) => setTimeout(r, 500));
    return `${c.nome}: ${this.estadoDaConfig(c)}\n${this.saidaDaConfig(c, 'todos', 40)}`;
  }

  private async pararConfig(nome: string | null): Promise<string> {
    const c = this.escolherConfig(nome);
    if (!c) throw new Error('nada para parar');
    await this.execSvc().parar();
    await new Promise((r) => setTimeout(r, 1500));
    return `${c.nome}: ${this.estadoDaConfig(c)}`;
  }

  private breakpoints(entrada: Record<string, unknown>): string {
    const d = this.depSvc();
    const acao = str(entrada, 'acao');
    if (acao === 'listar') {
      const todos = [...d.breakpoints().entries()].flatMap(([arq, ls]) => ls.map((l) => `${this.relativo(arq)}:${l}${d.condicao(arq, l) ? `  se ${d.condicao(arq, l)}` : ''}`));
      return todos.length ? todos.join('\n') : 'nenhum breakpoint';
    }
    const caminho = this.caminho(entrada);
    const linha = num(entrada['linha']);
    if (!linha || linha < 1) throw new Error('"linha" é obrigatória');
    if (!aceitaBreakpoint(caminho)) throw new Error('breakpoints só em arquivos .java, .ts e .js');
    const tem = (d.breakpoints().get(caminho) ?? []).includes(linha);
    if (acao === 'adicionar') {
      if (!tem) d.alternar(caminho, linha);
      const cond = opc(entrada, 'condicao');
      if (cond !== null) d.definirCondicao(caminho, linha, cond);
      return `breakpoint em ${this.relativo(caminho)}:${linha}${cond ? ` se ${cond}` : ''}`;
    }
    if (acao === 'remover') {
      d.remover(caminho, linha);
      return tem ? `breakpoint removido de ${this.relativo(caminho)}:${linha}` : 'não havia breakpoint nessa linha';
    }
    throw new Error('acao: listar, adicionar ou remover');
  }

  private estadoDoDebug(): string {
    const d = this.depSvc();
    const s = d.sessao();
    if (!s) return 'sem sessão de debug (use rodar com debug=true)';
    const linhas = [`sessão: ${s.nome} (${s.tipo})${s.semDebug ? ' — rodando sem debug, breakpoints não valem' : ''}`];
    const p = d.pausado();
    if (!p) return `${linhas[0]}\nrodando (não pausado)`;
    linhas.push(`PAUSADO: ${p.motivo}${p.texto ? ` — ${p.texto}` : ''}`);
    const frames = d.frames();
    if (frames.length) {
      linhas.push('', 'PILHA:');
      frames.slice(0, 15).forEach((f, i) => linhas.push(`${i === 0 ? '→' : ' '} ${f.name} — ${f.source?.path ? this.relativo(f.source.path) : (f.source?.name ?? '?')}:${f.line}${f.id === d.frameAtual() ? ' [frame atual]' : ''}`));
    }
    const vars = d.variaveis().filter((n) => n.nivel === 0).slice(0, 40);
    if (vars.length) {
      linhas.push('', 'VARIÁVEIS (frame atual):');
      for (const n of vars) linhas.push(`  ${n.v.name}${n.v.type ? ` (${n.v.type})` : ''} = ${n.v.value}`);
    }
    return cortar(linhas.join('\n'));
  }

  private async controlarDebug(entrada: Record<string, unknown>): Promise<string> {
    const d = this.depSvc();
    if (!d.sessao()) throw new Error('sem sessão de debug');
    const acao = str(entrada, 'acao');
    if (!d.pausado()) throw new Error('a execução não está pausada (veja debug_estado)');
    switch (acao) {
      case 'continuar':
        d.continuar();
        break;
      case 'passar':
        d.passar();
        break;
      case 'entrar':
        d.entrar();
        break;
      case 'sair':
        d.sair();
        break;
      case 'ate_linha': {
        const linha = num(entrada['linha']);
        if (!linha) throw new Error('"linha" é obrigatória');
        await d.ateALinha(this.caminho(entrada), linha);
        break;
      }
      default:
        throw new Error('acao: continuar, passar, entrar, sair ou ate_linha');
    }
    // Espera retomar e parar de novo (ou a sessão acabar); `continuar` pode levar mais.
    const fim = Date.now() + (acao === 'continuar' || acao === 'ate_linha' ? 30_000 : 10_000);
    await new Promise((r) => setTimeout(r, 400));
    while (Date.now() < fim && d.sessao() && !d.pausado()) await new Promise((r) => setTimeout(r, 300));
    if (!d.sessao()) return 'a sessão de debug terminou';
    if (!d.pausado()) return 'continua rodando (não parou em nenhum breakpoint ainda)';
    await new Promise((r) => setTimeout(r, 500)); // deixa a pilha e as variáveis chegarem
    return this.estadoDoDebug();
  }

  private async avaliarNoDebug(expressao: string): Promise<string> {
    const d = this.depSvc();
    if (!d.pausado()) throw new Error('a execução não está pausada (veja debug_estado)');
    await d.avaliar(expressao);
    const r = d.avaliacoes().at(-1);
    if (!r || r.expressao !== expressao.trim()) return 'não consegui avaliar';
    return r.erro ? `erro: ${r.resultado}` : `${expressao} = ${r.resultado}`;
  }

  // ---------- banco ----------

  private conexoes(): string {
    const perfis = this.banco.perfis();
    if (!perfis.length) return 'nenhuma conexão configurada (o usuário cria com Alt+Shift+D → n)';
    return perfis
      .map((p) => `${p.nome} — ${NOME_DO_AMBIENTE[p.ambiente] ?? p.ambiente}, ${p.tipo}, ${p.banco}${p.somenteLeitura ? ', somente leitura' : ''}${this.banco.conectado(p.id) ? ', conectada' : ''}`)
      .join('\n');
  }

  private async consultar(conexao: string, sql: string): Promise<string> {
    const p = this.banco.perfis().find((x) => x.nome.toLowerCase() === conexao.toLowerCase() || x.id === conexao);
    if (!p) throw new Error(`conexão "${conexao}" não existe; veja banco_conexoes`);
    // A IA só lê: qualquer instrução que altere é recusada aqui, antes do banco.
    const escrita = instrucoes(sql).find((i) => escreve(i.texto));
    if (escrita) throw new Error('só leitura: a IA não altera o banco (peça ao usuário para executar a alteração)');
    if (!this.banco.conectado(p.id) && !(await this.banco.conectar(p.id))) throw new Error(`não consegui conectar em ${p.nome}`);
    const r = await ponte.banco.consultar(p.id, sql, 100);
    if (!r.colunas.length) return `executado (${r.ms} ms)`;
    const cab = r.colunas.map((c) => `${c.nome}${c.tipo ? ` (${c.tipo})` : ''}`).join(' | ');
    const corpo = r.linhas.map((l) => l.map((v) => (v === null ? 'NULL' : v)).join(' | ')).join('\n');
    return cortar(`${p.nome} · ${r.linhas.length}${r.cortado ? '+' : ''} linhas · ${r.ms} ms\n${cab}\n${corpo}`);
  }
}

function str(e: Record<string, unknown>, campo: string): string {
  const v = e[campo];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`"${campo}" é obrigatório (texto)`);
  return v;
}

function opc(e: Record<string, unknown>, campo: string): string | null {
  const v = e[campo];
  return typeof v === 'string' ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : null;
}

function numerar(linhas: string[], ini: number, fim: number): string {
  const largura = String(fim).length;
  const saida: string[] = [];
  for (let i = ini; i <= fim; i++) saida.push(`${String(i).padStart(largura)}  ${linhas[i - 1] ?? ''}`);
  return saida.join('\n');
}

function cortar(t: string): string {
  return t.length > LIMITE_DE_TEXTO ? `${t.slice(0, LIMITE_DE_TEXTO)}\n[... cortado em ${LIMITE_DE_TEXTO} de ${t.length} caracteres]` : t;
}

