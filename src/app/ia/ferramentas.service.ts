import { inject, Injectable } from '@angular/core';
import { ponte } from '../nucleo/ponte';
import { ProjetoService } from '../nucleo/projeto.service';
import { EditorService } from '../editor/editor.service';
import { JdtlsService } from '../java/jdtls.service';
import { ServidorService } from '../servidor/servidor.service';
import { BancoService, NOME_DO_AMBIENTE } from '../banco/banco.service';
import { escreve, instrucoes } from '../banco/sql';
import { monaco } from '../editor/monaco';
import { OrigemDaAlteracao, RevisaoService } from './revisao.service';
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

export const FERRAMENTAS: DefinicaoDeFerramenta[] = [
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
      'Roda um comando de shell na raiz do projeto (build, instalação de dependências, scripts do README) e devolve a saída e o código de saída. O usuário vê o comando e aprova cada execução. Para subir o servidor de aplicação use servidor_iniciar, não este. Comando que não termina (modo watch, servidor) precisa de deixar_rodando: ele devolve a saída dos primeiros segundos e continua em segundo plano.',
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
    description: 'Consulta um banco configurado. Só leitura: SELECT/WITH/EXPLAIN; qualquer alteração é recusada.',
    input_schema: objeto({ conexao: texto('Nome da conexão'), sql: texto('Consulta') }, ['conexao', 'sql']),
  },
];

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
      default:
        throw new Error(`ferramenta desconhecida: ${nome}`);
    }
  }

  // ---------- código ----------

  /** Caminho dentro do projeto (relativo ou absoluto); fora dele é recusado. */
  private caminho(entrada: Record<string, unknown>): string {
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

  private relativo(caminho: string): string {
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
    if (!perfis.length) return 'nenhum servidor configurado neste projeto (o usuário cria com ␣ j → n)';
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
    const decisao = await this.escolha.escolherUm(
      'A IA QUER RODAR UM COMANDO',
      [
        { rotulo: 'Rodar', detalhe: comando, valor: true },
        { rotulo: 'Recusar', detalhe: 'o comando não roda e a IA é avisada', valor: false },
      ],
      `na pasta ${raiz}`,
    );
    if (!decisao) return 'o usuário recusou o comando; não rodou';
    const espera = Math.max(5, Math.min(600, segundos ?? 120)) * 1000;
    const id = `ia-cmd-${Date.now()}`;
    const windows = /win/i.test(navigator.platform);
    const argv = windows ? ['cmd.exe', '/C', comando] : ['sh', '-c', comando];
    let saida: string[] = [];
    let codigo: number | null | undefined;
    await ponte.tarefa.iniciar(
      id,
      raiz,
      argv,
      (linhas) => (saida = [...saida, ...linhas].slice(-1500)),
      (c) => (codigo = c),
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

  // ---------- banco ----------

  private conexoes(): string {
    const perfis = this.banco.perfis();
    if (!perfis.length) return 'nenhuma conexão configurada (o usuário cria com ␣ d → n)';
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

