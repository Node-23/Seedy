import { inject, Injectable, Injector } from '@angular/core';
import { monaco } from '../editor/monaco';
import { EditorService } from '../editor/editor.service';
import { BookmarksService } from '../editor/bookmarks.service';
import { JdtlsService } from '../java/jdtls.service';
import { ProjetoService } from '../nucleo/projeto.service';
import { ponte, PerfilServidor } from '../nucleo/ponte';
import { TodoService } from '../todo/todo.service';
import { Ligacao, TipoLigacao } from '../todo/todo';
import { EntenderService, RegraVisivel } from '../entender/entender.service';
import { TestesService } from '../testes/testes.service';
import { GitService } from '../git/git.service';
import { GithubService } from '../git/github.service';
import { GithubFormService } from '../git/github-form.service';
import { ServidorService } from '../servidor/servidor.service';
import { DockerService } from '../containers/docker.service';
import { BancoService } from '../banco/banco.service';
import type { FerramentasService } from './ferramentas.service';
import { escreve as sqlEscreve, instrucoes as sqlInstrucoes } from '../banco/sql';
import { EnvService } from '../execucao/env.service';
import { OrigemDaAlteracao, RevisaoService } from './revisao.service';
import { caminhoDaUri, EdicaoDeWorkspaceLsp, EdicaoLsp, edicoesPorArquivo, paraEdicao, uriMonaco } from '../java/conversao';
import { EscopoDaMemoria, MemoriaService, prepararNota } from './memoria.service';

/** Definição de ferramenta (o mesmo formato de `FERRAMENTAS`). */
export interface DefinicaoIde {
  name: string;
  rotulo: string;
  description: string;
  input_schema: Record<string, unknown>;
}

const objeto = (props: Record<string, unknown>, obrigatorios: string[] = []) => ({ type: 'object', properties: props, required: obrigatorios, additionalProperties: false });
const texto = (description: string) => ({ type: 'string', description });
const TIPOS_DE_LIGACAO: TipoLigacao[] = ['codigo', 'regra', 'caminho', 'bloco', 'container', 'banco'];
const LIMITE = 60_000;

const LIGACAO = {
  type: 'array',
  description: 'Ligações do card. codigo: alvo "caminho/relativo.java:linha"; regra: id da regra (R12, de regras_listar); caminho: "Componente.metodo"; bloco: id do componente; container: nome; banco: id da conexão.',
  items: objeto({ tipo: { type: 'string', enum: TIPOS_DE_LIGACAO }, alvo: texto('Alvo da ligação'), rotulo: texto('Texto que o card mostra (opcional)') }, ['tipo', 'alvo']),
};

export const FERRAMENTAS_IDE: DefinicaoIde[] = [
  // ---------- TODO ----------
  { name: 'todo_listar', rotulo: 'todo.listar', description: 'Cards do TODO do projeto (.seedy/todo.md): id, título, nota, se está feito e as ligações com código, regras, containers e bancos.', input_schema: objeto({ estado: { type: 'string', enum: ['abertos', 'feitos', 'todos'], description: 'Padrão: abertos' } }) },
  { name: 'todo_criar', rotulo: 'todo.criar', description: 'Cria um card no TODO, com nota e ligações opcionais (ex.: ao arquivo e linha onde está o problema).', input_schema: objeto({ titulo: texto('Título curto'), nota: texto('Detalhes (opcional)'), ligacoes: LIGACAO }, ['titulo']) },
  { name: 'todo_atualizar', rotulo: 'todo.atualizar', description: 'Muda o título, a nota ou o estado (feito) de um card e pode acrescentar ligações.', input_schema: objeto({ id: { type: 'integer' }, titulo: texto('Novo título'), nota: texto('Nova nota'), feito: { type: 'boolean' }, ligacoes: LIGACAO }, ['id']) },
  { name: 'todo_apagar', rotulo: 'todo.apagar', description: 'Apaga um card do TODO. Sempre pede confirmação ao usuário.', input_schema: objeto({ id: { type: 'integer' } }, ['id']) },
  // ---------- bookmarks ----------
  { name: 'bookmarks_listar', rotulo: 'bookmarks.listar', description: 'Bookmarks do projeto (arquivo, linha e o texto da linha).', input_schema: objeto({}) },
  { name: 'bookmark_alternar', rotulo: 'bookmark.alternar', description: 'Marca ou desmarca uma linha com bookmark.', input_schema: objeto({ caminho: texto('Relativo à raiz do projeto'), linha: { type: 'integer' } }, ['caminho', 'linha']) },
  // ---------- navegar pelo código ----------
  { name: 'ir_para_definicao', rotulo: 'codigo.definicao', description: 'Onde está declarado o símbolo (Java, pelo jdtls) numa posição do arquivo; abre o arquivo no editor. Coluna começa em 1.', input_schema: objeto({ caminho: texto('Relativo à raiz'), linha: { type: 'integer' }, coluna: { type: 'integer' } }, ['caminho', 'linha', 'coluna']) },
  { name: 'usos_do_simbolo', rotulo: 'codigo.usos', description: 'Onde o símbolo (Java) de uma posição é usado, em todo o projeto. Coluna começa em 1.', input_schema: objeto({ caminho: texto('Relativo à raiz'), linha: { type: 'integer' }, coluna: { type: 'integer' } }, ['caminho', 'linha', 'coluna']) },
  { name: 'refatorar_java', rotulo: 'java.refatorar', description: 'Refactors de Java pelo jdtls: `renomear` um símbolo (classe, método, campo ou variável) em todo o projeto, ou `organizar_imports` de um arquivo. Cada arquivo alterado vira um diff para o usuário aceitar ou recusar (revisão ␣ y), e a resposta diz o que foi decidido. Prefira isto a editar vários arquivos à mão. Linha e coluna começam em 1 e apontam para o nome do símbolo.', input_schema: objeto({ acao: { type: 'string', enum: ['renomear', 'organizar_imports'] }, caminho: texto('Relativo à raiz'), linha: { type: 'integer', description: 'Só para renomear' }, coluna: { type: 'integer', description: 'Só para renomear' }, novo_nome: texto('Só para renomear') }, ['acao', 'caminho']) },
  { name: 'buscar_simbolo', rotulo: 'codigo.simbolo', description: 'Procura classes, métodos e campos Java pelo nome em todo o projeto (jdtls).', input_schema: objeto({ nome: texto('Parte do nome') }, ['nome']) },
  // ---------- arquitetura e regras ----------
  { name: 'arquitetura_resumo', rotulo: 'arquitetura.resumo', description: 'A arquitetura do projeto lida do código: tecnologias, quantos componentes por papel (tela, entrada, serviço, repositório, entidade...) e por domínio, e a lista deles com o arquivo.', input_schema: objeto({ papel: { type: 'string', description: 'Opcional: só este papel (tela, front, entrada, job, servico, repositorio, entidade, excecao, tratador, teste, outro)' }, dominio: texto('Opcional: só este domínio') }) },
  { name: 'arquitetura_componente', rotulo: 'arquitetura.componente', description: 'Detalhe de um componente: papel, arquivo, o que ele usa e quem o usa, e os métodos (rota HTTP, chamadas, desvios).', input_schema: objeto({ nome: texto('Nome do componente (ou parte dele) ou o id') }, ['nome']) },
  { name: 'regras_listar', rotulo: 'regras.listar', description: 'Regras de negócio do projeto (as de .seedy/regras.md e as achadas no código): id, domínio, título, descrição, chave, onde está no código e a cobertura de testes de cada uma. Nas outras ferramentas, use o id (R12).', input_schema: objeto({ dominio: texto('Opcional'), busca: texto('Opcional: texto no título, descrição ou componente'), cobertura: { type: 'string', enum: ['todas', 'sem', 'so-feliz', 'falhando'], description: 'Padrão: todas' } }) },
  { name: 'regra_cenarios', rotulo: 'regra.cenarios', description: 'Os cenários de uma regra (o caminho feliz e cada erro que ela barra) e quais testes os cobrem. Use antes de escrever testes: o que está "sem" teste é o que falta. Depois escreva o teste com propor_edicao.', input_schema: objeto({ regra: texto('Id (R12), chave ou parte do título') }, ['regra']) },
  // ---------- git ----------
  { name: 'git_estado', rotulo: 'git.estado', description: 'Branch atual, à frente/atrás do remoto, operação em andamento (merge, rebase...) e os arquivos alterados (M, A, D, ?, C = conflito; [stage] = no índice).', input_schema: objeto({}) },
  { name: 'git_diff', rotulo: 'git.diff', description: 'Diff do que mudou (sem commit). Sem caminho, de tudo; `staged` mostra só o que está no índice.', input_schema: objeto({ caminho: texto('Opcional: relativo à raiz'), staged: { type: 'boolean' } }) },
  { name: 'git_log', rotulo: 'git.log', description: 'Últimos commits da branch atual (hash curto, autor, data, assunto).', input_schema: objeto({ limite: { type: 'integer', description: 'Padrão 20, máximo 100' } }) },
  { name: 'git_commit', rotulo: 'git.commit', description: 'Faz commit dos arquivos (sem `arquivos`, de todas as alterações). O usuário aprova a mensagem (a não ser no modo automático).', input_schema: objeto({ mensagem: texto('Mensagem do commit'), arquivos: { type: 'array', items: { type: 'string' }, description: 'Relativos à raiz; padrão: todos os alterados' } }, ['mensagem']) },
  { name: 'git_push', rotulo: 'git.push', description: 'Envia a branch atual ao remoto (cria o upstream na primeira vez). Sempre pede confirmação, mesmo no modo automático.', input_schema: objeto({}) },
  { name: 'git_pull', rotulo: 'git.pull', description: 'Traz as mudanças do remoto para a branch atual. O usuário aprova.', input_schema: objeto({}) },
  { name: 'git_branches', rotulo: 'git.branches', description: 'Lista as branches locais (a atual, o upstream, à frente/atrás).', input_schema: objeto({}) },
  { name: 'git_branch', rotulo: 'git.branch', description: 'Cria uma branch (e vai para ela), troca de branch ou apaga uma branch local. O usuário aprova.', input_schema: objeto({ acao: { type: 'string', enum: ['criar', 'trocar', 'apagar'] }, nome: texto('Nome da branch') }, ['acao', 'nome']) },
  // ---------- GitHub ----------
  { name: 'github_pull_request', rotulo: 'github.pr', description: 'Abre um pull request da branch atual (enviada antes, se preciso) para a base. Precisa da conta GitHub conectada. Sempre pede confirmação.', input_schema: objeto({ titulo: texto('Título'), corpo: texto('Descrição'), base: texto('Branch de destino (padrão: a principal)'), rascunho: { type: 'boolean' } }, ['titulo']) },
  { name: 'github_issue', rotulo: 'github.issue', description: 'Abre uma issue no repositório do projeto. Precisa da conta GitHub conectada. Sempre pede confirmação.', input_schema: objeto({ titulo: texto('Título'), corpo: texto('Descrição') }, ['titulo']) },
  // ---------- jdtls e JDK ----------
  { name: 'jdtls_estado', rotulo: 'jdtls.estado', description: 'Estado do jdtls (servidor de linguagem Java): se está pronto, o projeto que atende e o JDK dele.', input_schema: objeto({}) },
  { name: 'jdtls_reiniciar', rotulo: 'jdtls.reiniciar', description: 'Reinicia o jdtls (útil quando o classpath ou os erros estão desatualizados).', input_schema: objeto({}) },
  { name: 'jdks_listar', rotulo: 'jdk.listar', description: 'JDKs instalados na máquina (versão e pasta) e qual roda o jdtls.', input_schema: objeto({}) },
  { name: 'jdk_escolher', rotulo: 'jdk.escolher', description: 'Escolhe o JDK que roda o jdtls (precisa ser a versão mínima ou mais nova) e reinicia o jdtls. O usuário aprova.', input_schema: objeto({ pasta: texto('Pasta do JDK (jdks_listar)') }, ['pasta']) },
  // ---------- banco: escrita ----------
  { name: 'banco_executar', rotulo: 'banco.executar', description: 'ALTERA um banco configurado (INSERT, UPDATE, DELETE, DDL). O usuário vê as instruções e aprova SEMPRE, até no modo automático. Recusado em conexão somente leitura e em Produção, e UPDATE/DELETE sem WHERE. Para ler use banco_consultar. Devolve as linhas afetadas.', input_schema: objeto({ conexao: texto('Nome da conexão'), sql: texto('Uma ou mais instruções') }, ['conexao', 'sql']) },
  // ---------- .env ----------
  { name: 'env_listar', rotulo: 'env.listar', description: 'Os arquivos .env da raiz do projeto, qual está em uso e os NOMES das variáveis que ele define (nunca os valores). O RUN, o DEBUG, os testes e executar_comando já usam o .env sozinhos.', input_schema: objeto({}) },
  // ---------- memória ----------
  { name: 'memoria_ler', rotulo: 'memoria.ler', description: 'As notas que já foram guardadas na memória: do projeto e globais (as globais valem para todos os projetos).', input_schema: objeto({ escopo: { type: 'string', enum: ['projeto', 'global', 'todas'], description: 'Padrão: todas' } }) },
  { name: 'memoria_salvar', rotulo: 'memoria.salvar', description: 'Guarda uma nota na memória para as próximas conversas. O usuário SEMPRE aprova antes, mesmo no modo automático. Use para o que é durável e não dá para ler do código (comando que roda o sistema, convenção, armadilha, preferência corrigida pelo usuário). Uma frase só, até 400 caracteres; nunca senhas, chaves ou tokens. Escopo "projeto" para o que vale só aqui, "global" para o que vale em qualquer projeto.', input_schema: objeto({ nota: texto('A nota, numa frase'), escopo: { type: 'string', enum: ['projeto', 'global'] } }, ['nota', 'escopo']) },
  { name: 'memoria_apagar', rotulo: 'memoria.apagar', description: 'Apaga da memória as notas que contêm o trecho (útil quando uma nota ficou desatualizada). O usuário SEMPRE aprova antes.', input_schema: objeto({ trecho: texto('Trecho do texto da nota'), escopo: { type: 'string', enum: ['projeto', 'global'] } }, ['trecho', 'escopo']) },
  // ---------- servidor de aplicação e container → banco ----------
  { name: 'servidor_editar', rotulo: 'servidor.editar', description: 'Altera a configuração de um servidor de aplicação já criado (portas, opções da JVM, JDK, contexto, pastas, variáveis de ambiente, nome). Só os campos enviados mudam. O usuário aprova.', input_schema: objeto({ servidor: texto('Nome do servidor (servidor_estado); sem isso, o selecionado'), nome: texto('Novo nome'), portaHttp: { type: 'integer' }, portaDebug: { type: 'integer' }, opcoesJvm: texto('Ex.: -Xms256m -Xmx1024m'), jdk: texto('JAVA_HOME do servidor; vazio = o do sistema'), contexto: texto('Ex.: /feira'), pastaWeb: texto('Relativa ao projeto'), pastaClasses: texto('Relativa ao projeto'), variaveis: { type: 'object', additionalProperties: { type: 'string' }, description: 'Variáveis de ambiente (substitui todas)' } }) },
  { name: 'container_ligar_banco', rotulo: 'container.banco', description: 'Cria no Seedy uma conexão de banco a partir de um container PostgreSQL ou MySQL (host, porta publicada, usuário, senha e banco vêm do container). A senha vai para o cofre do sistema. O usuário aprova.', input_schema: objeto({ nome: texto('Nome do container'), conexao: texto('Nome da conexão (padrão: o serviço do compose ou o nome do container)') }, ['nome']) },
];

/**
 * As ferramentas "da IDE" da IA: TODO, bookmarks, navegação, arquitetura e regras, Git, GitHub,
 * jdtls e JDK, servidor e banco. `FerramentasService` delega para cá o que não é dele.
 * Os serviços são pegos na hora do uso (vários dependem da própria IA).
 */
@Injectable({ providedIn: 'root' })
export class FerramentasIdeService {
  private readonly injetor = inject(Injector);
  private readonly projeto = inject(ProjetoService);

  private baseSvc!: FerramentasService;
  private readonly base = () => this.baseSvc;
  private readonly todo = () => this.injetor.get(TodoService);
  private readonly bookmarks = () => this.injetor.get(BookmarksService);
  private readonly editor = () => this.injetor.get(EditorService);
  private readonly jdtls = () => this.injetor.get(JdtlsService);
  private readonly entender = () => this.injetor.get(EntenderService);
  private readonly testes = () => this.injetor.get(TestesService);
  private readonly git = () => this.injetor.get(GitService);
  private readonly github = () => this.injetor.get(GithubService);
  private readonly githubForm = () => this.injetor.get(GithubFormService);
  private readonly servidor = () => this.injetor.get(ServidorService);
  private readonly docker = () => this.injetor.get(DockerService);
  private readonly banco = () => this.injetor.get(BancoService);
  private readonly memoria = () => this.injetor.get(MemoriaService);
  private readonly env = () => this.injetor.get(EnvService);
  private readonly revisao = () => this.injetor.get(RevisaoService);

  conhece(nome: string): boolean {
    return FERRAMENTAS_IDE.some((f) => f.name === nome);
  }

  async executar(nome: string, e: Record<string, unknown>, base: FerramentasService, origem: OrigemDaAlteracao = 'ia'): Promise<string> {
    this.baseSvc = base;
    switch (nome) {
      case 'todo_listar':
        return this.todoListar(opc(e, 'estado') ?? 'abertos');
      case 'todo_criar':
        return this.todoCriar(str(e, 'titulo'), opc(e, 'nota'), await this.ligacoes(e['ligacoes']));
      case 'todo_atualizar':
        return this.todoAtualizar(e);
      case 'todo_apagar':
        return this.todoApagar(inteiro(e, 'id'));
      case 'bookmarks_listar':
        return this.bookmarksListar();
      case 'bookmark_alternar':
        return this.bookmarkAlternar(str(e, 'caminho'), inteiro(e, 'linha'));
      case 'ir_para_definicao':
        return this.definicao(str(e, 'caminho'), inteiro(e, 'linha'), inteiro(e, 'coluna'));
      case 'usos_do_simbolo':
        return this.usos(str(e, 'caminho'), inteiro(e, 'linha'), inteiro(e, 'coluna'));
      case 'refatorar_java':
        return this.refatorar(e, origem);
      case 'buscar_simbolo':
        return this.simbolos(str(e, 'nome'));
      case 'arquitetura_resumo':
        return this.arquiteturaResumo(opc(e, 'papel'), opc(e, 'dominio'));
      case 'arquitetura_componente':
        return this.arquiteturaComponente(str(e, 'nome'));
      case 'regras_listar':
        return this.regrasListar(opc(e, 'dominio'), opc(e, 'busca'), opc(e, 'cobertura') ?? 'todas');
      case 'regra_cenarios':
        return this.regraCenarios(str(e, 'regra'));
      case 'git_estado':
        return this.gitEstado();
      case 'git_diff':
        return this.gitDiff(opc(e, 'caminho'), e['staged'] === true);
      case 'git_log':
        return this.gitLog(Math.max(1, Math.min(100, Math.floor(Number(e['limite'])) || 20)));
      case 'git_commit':
        return this.gitCommit(str(e, 'mensagem'), Array.isArray(e['arquivos']) ? (e['arquivos'] as unknown[]).map(String) : null);
      case 'git_push':
        return this.gitOperacao('PUSH', 'Enviar', 'envia a branch atual ao remoto', true, () => this.git().push());
      case 'git_pull':
        return this.gitOperacao('PULL', 'Trazer', 'traz as mudanças do remoto', false, () => this.git().pull());
      case 'git_branches':
        return this.gitBranches();
      case 'git_branch':
        return this.gitBranch(str(e, 'acao'), str(e, 'nome'));
      case 'github_pull_request':
        return this.githubPr(str(e, 'titulo'), opc(e, 'corpo') ?? '', opc(e, 'base'), e['rascunho'] === true);
      case 'github_issue':
        return this.githubIssue(str(e, 'titulo'), opc(e, 'corpo') ?? '');
      case 'jdtls_estado':
        return this.jdtlsEstado();
      case 'jdtls_reiniciar':
        await this.jdtls().reiniciar();
        return 'jdtls reiniciado; o projeto é recarregado em instantes (veja jdtls_estado)';
      case 'jdks_listar':
        return this.jdksListar();
      case 'jdk_escolher':
        return this.jdkEscolher(str(e, 'pasta'));
      case 'banco_executar':
        return this.bancoExecutar(str(e, 'conexao'), str(e, 'sql'));
      case 'env_listar':
        return this.envListar();
      case 'memoria_ler':
        return this.memoriaLer(opc(e, 'escopo') ?? 'todas');
      case 'memoria_salvar':
        return this.memoriaSalvar(str(e, 'nota'), str(e, 'escopo'));
      case 'memoria_apagar':
        return this.memoriaApagar(str(e, 'trecho'), str(e, 'escopo'));
      case 'servidor_editar':
        return this.servidorEditar(e);
      case 'container_ligar_banco':
        return this.ligarContainerAoBanco(str(e, 'nome'), opc(e, 'conexao'));
      default:
        throw new Error(`ferramenta desconhecida: ${nome}`);
    }
  }

  // ---------- TODO ----------

  private async ligacoes(v: unknown): Promise<Ligacao[]> {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) throw new Error('"ligacoes" é uma lista de {tipo, alvo, rotulo}');
    const regras = v.some((x) => (x as Record<string, unknown>)?.['tipo'] === 'regra') ? await this.regrasVisiveis() : [];
    return v.map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      const tipo = String(o['tipo']) as TipoLigacao;
      if (!TIPOS_DE_LIGACAO.includes(tipo)) throw new Error(`tipo de ligação inválido: ${String(o['tipo'])} (use ${TIPOS_DE_LIGACAO.join(', ')})`);
      let alvo = str(o, 'alvo');
      let rotulo = opc(o, 'rotulo');
      if (tipo === 'regra' && !alvo.includes(':')) {
        // O id legível (R12) vira a chave técnica que o arquivo do TODO guarda.
        const r = regras.find((x) => x.id.toLowerCase() === alvo.toLowerCase());
        if (!r?.chave) throw new Error(`regra "${alvo}" não encontrada ou sem ligação com o código; veja regras_listar`);
        rotulo = rotulo ?? `${r.id} ${r.titulo}`;
        alvo = r.chave;
      }
      return { tipo, alvo, rotulo: rotulo ?? alvo };
    });
  }

  private textoDoCard(c: { id: number; titulo: string; nota: string; feito: boolean; ligacoes: Ligacao[] }): string {
    const lig = c.ligacoes.map((l) => `    -> ${l.tipo}: ${l.alvo}${l.rotulo !== l.alvo ? ` (${l.rotulo})` : ''}`).join('\n');
    return `#${c.id} [${c.feito ? 'x' : ' '}] ${c.titulo}${c.nota ? `\n    ${c.nota.replace(/\n/g, '\n    ')}` : ''}${lig ? `\n${lig}` : ''}`;
  }

  private todoListar(estado: string): string {
    const t = this.todo();
    const lista = estado === 'feitos' ? t.feitos() : estado === 'todos' ? t.ordem() : t.abertos();
    return lista.length ? cortar(lista.map((c) => this.textoDoCard(c)).join('\n')) : `nenhum card (${estado})`;
  }

  private async todoCriar(titulo: string, nota: string | null, ligacoes: Ligacao[]): Promise<string> {
    if (!this.projeto.raiz()) throw new Error('nenhum projeto aberto');
    const t = this.todo();
    await t.criar(titulo);
    const novo = t.cards().find((c) => c.titulo === titulo.replace(/\s+/g, ' ').trim());
    if (!novo) throw new Error('não consegui criar o card');
    if (nota || ligacoes.length) await t.atualizar(novo.id, { ...(nota ? { nota } : {}), ligacoes });
    return `card #${novo.id} criado: ${novo.titulo}`;
  }

  private async todoAtualizar(e: Record<string, unknown>): Promise<string> {
    const t = this.todo();
    const id = inteiro(e, 'id');
    const c = t.cards().find((x) => x.id === id);
    if (!c) throw new Error(`card #${id} não existe; veja todo_listar`);
    const mudanca: Partial<typeof c> = {};
    if (opc(e, 'titulo')) mudanca.titulo = opc(e, 'titulo')!.replace(/\s+/g, ' ').trim();
    if (opc(e, 'nota') !== null) mudanca.nota = opc(e, 'nota')!;
    if (typeof e['feito'] === 'boolean') mudanca.feito = e['feito'] as boolean;
    const novas = (await this.ligacoes(e['ligacoes'])).filter((l) => !c.ligacoes.some((x) => x.tipo === l.tipo && x.alvo === l.alvo));
    if (novas.length) mudanca.ligacoes = [...c.ligacoes, ...novas];
    await t.atualizar(id, mudanca);
    const depois = t.cards().find((x) => x.id === id) ?? c;
    return `atualizado:\n${this.textoDoCard(depois)}`;
  }

  private async todoApagar(id: number): Promise<string> {
    const t = this.todo();
    const c = t.cards().find((x) => x.id === id);
    if (!c) throw new Error(`card #${id} não existe; veja todo_listar`);
    if (!(await this.base().autorizar('A IA QUER APAGAR UM CARD DO TODO', 'Apagar', c.titulo, true))) return 'o usuário recusou; o card ficou';
    await t.apagar(c);
    return `card #${id} apagado`;
  }

  // ---------- bookmarks ----------

  private bookmarksListar(): string {
    const marcas = [...this.bookmarks().marcas()].sort((a, b) => a.caminho.localeCompare(b.caminho) || a.linha - b.linha);
    return marcas.length ? marcas.map((m) => `${m.caminho}:${m.linha}  ${m.texto}`).join('\n') : 'nenhum bookmark';
  }

  private async bookmarkAlternar(caminho: string, linha: number): Promise<string> {
    const abs = this.base().caminho({ caminho });
    const b = await this.editor().abrir(abs, linha);
    if (!b) throw new Error(`não consegui abrir ${caminho}`);
    if (linha > b.modelo.getLineCount()) throw new Error(`o arquivo só tem ${b.modelo.getLineCount()} linhas`);
    const antes = this.bookmarks().marcas().length;
    await this.bookmarks().alternar(linha, abs);
    const depois = this.bookmarks().marcas().length;
    return depois > antes ? `bookmark em ${caminho}:${linha}` : `bookmark removido de ${caminho}:${linha}`;
  }

  // ---------- navegar pelo código ----------

  private async lsp<T>(metodo: string, params: unknown): Promise<T> {
    const c = this.jdtls().cliente();
    if (!c) throw new Error('o jdtls ainda não está pronto (veja jdtls_estado)');
    return c.pedir<T>(metodo, params);
  }

  private async posicao(caminho: string, linha: number, coluna: number): Promise<{ textDocument: { uri: string }; position: { line: number; character: number } }> {
    const abs = this.base().caminho({ caminho });
    if (!/\.java$/i.test(abs)) throw new Error('só para arquivos Java');
    const b = await this.editor().abrir(abs, linha);
    if (!b) throw new Error(`não consegui abrir ${caminho}`);
    await new Promise((r) => setTimeout(r, 300)); // o jdtls recebe o arquivo aberto
    return { textDocument: { uri: this.jdtls().uriLsp(monaco.Uri.file(abs)) }, position: { line: Math.max(0, linha - 1), character: Math.max(0, coluna - 1) } };
  }

  private relativoDoProjeto(caminho: string): string {
    const raiz = (this.projeto.raiz() ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
    const c = caminho.replace(/\\/g, '/');
    return raiz && c.toLowerCase().startsWith(raiz.toLowerCase() + '/') ? c.slice(raiz.length + 1) : c;
  }

  private lugar(l: { uri?: string; targetUri?: string; range?: { start: { line: number } }; targetSelectionRange?: { start: { line: number } } }): string {
    const uri = l.uri ?? l.targetUri ?? '';
    const linha = (l.range ?? l.targetSelectionRange)?.start.line ?? 0;
    const arq = uri.startsWith('file:') ? this.relativoDoProjeto(monaco.Uri.parse(uri).fsPath) : uri.replace(/^jdt:\/\//, 'biblioteca: ');
    return `${arq}:${linha + 1}`;
  }

  private async definicao(caminho: string, linha: number, coluna: number): Promise<string> {
    const r = await this.lsp<any>('textDocument/definition', await this.posicao(caminho, linha, coluna));
    const lista: any[] = Array.isArray(r) ? r : r ? [r] : [];
    if (!lista.length) return 'nenhuma definição nessa posição (confira a linha e a coluna, que começam em 1)';
    return lista.map((l) => this.lugar(l)).join('\n');
  }

  private async usos(caminho: string, linha: number, coluna: number): Promise<string> {
    const p = await this.posicao(caminho, linha, coluna);
    const r = await this.lsp<any[] | null>('textDocument/references', { ...p, context: { includeDeclaration: false } });
    if (!r?.length) return 'nenhum uso encontrado (confira a linha e a coluna, que começam em 1)';
    return cortar(`${r.length} usos:\n${r.slice(0, 200).map((l) => this.lugar(l)).join('\n')}`);
  }

  /** Renomear e organizar imports: o jdtls devolve as edições e cada arquivo vira uma proposta (diff) para aprovar. */
  private async refatorar(e: Record<string, unknown>, origem: OrigemDaAlteracao): Promise<string> {
    const acao = str(e, 'acao');
    const caminhoRel = str(e, 'caminho');
    let edicao: EdicaoDeWorkspaceLsp | null = null;
    let motivo = '';
    if (acao === 'renomear') {
      const novo = str(e, 'novo_nome');
      if (!/^[A-Za-z_$][\w$]*$/.test(novo)) throw new Error('novo_nome precisa ser um identificador Java válido');
      const p = await this.posicao(caminhoRel, inteiro(e, 'linha'), inteiro(e, 'coluna'));
      edicao = await this.lsp<EdicaoDeWorkspaceLsp | null>('textDocument/rename', { ...p, newName: novo }).catch((erro) => {
        throw new Error(`o jdtls não conseguiu renomear: ${(erro as Error).message ?? erro}`);
      });
      motivo = `renomear para ${novo}`;
    } else if (acao === 'organizar_imports') {
      const p = await this.posicao(caminhoRel, 1, 1);
      const abs = this.base().caminho({ caminho: caminhoRel });
      const modelo = this.editor().bufferDe(abs)?.modelo;
      const ultima = Math.max(0, (modelo?.getLineCount() ?? 1) - 1);
      const acoes = await this.lsp<{ edit?: EdicaoDeWorkspaceLsp }[] | null>('textDocument/codeAction', {
        textDocument: p.textDocument,
        range: { start: { line: 0, character: 0 }, end: { line: ultima, character: 0 } },
        context: { diagnostics: [], only: ['source.organizeImports'] },
      });
      edicao = acoes?.find((a) => a.edit)?.edit ?? null;
      motivo = 'organizar os imports';
    } else {
      throw new Error('acao: renomear ou organizar_imports');
    }
    const porArquivo = edicao ? edicoesPorArquivo(edicao) : new Map<string, EdicaoLsp[]>();
    if (!porArquivo.size) return acao === 'renomear' ? 'o jdtls não achou o que renomear nessa posição (linha e coluna começam em 1 e apontam para o nome)' : 'os imports já estão organizados';
    const revisao = this.revisao();
    const linhas: string[] = [];
    for (const [uri, edits] of porArquivo) {
      const abs = caminhoDaUri(uriMonaco(uri));
      const atual = this.editor().bufferDe(abs)?.modelo.getValue() ?? (await ponte.lerArquivo(abs));
      const modelo = monaco.editor.createModel(atual);
      modelo.applyEdits(edits.map(paraEdicao).map((x) => ({ range: x.range, text: x.text })));
      const novo = modelo.getValue();
      modelo.dispose();
      const r = await revisao.propor(abs, novo, origem, `${motivo} (${edits.length} ${edits.length === 1 ? 'alteração' : 'alterações'})`);
      linhas.push(`${this.relativoDoProjeto(abs)}: ${r.aceita ? 'aceito' : 'recusado'}`);
    }
    return `${motivo}: ${porArquivo.size} ${porArquivo.size === 1 ? 'arquivo' : 'arquivos'}\n${linhas.join('\n')}`;
  }

  private async simbolos(nome: string): Promise<string> {
    const r = await this.lsp<any[] | null>('workspace/symbol', { query: nome });
    if (!r?.length) return 'nenhum símbolo com esse nome';
    const tipos: Record<number, string> = { 5: 'classe', 6: 'método', 8: 'campo', 9: 'construtor', 10: 'enum', 11: 'interface', 12: 'função', 13: 'variável', 14: 'constante', 23: 'struct' };
    return cortar(r.slice(0, 80).map((s) => `${tipos[s.kind] ?? 'símbolo'} ${s.containerName ? `${s.containerName}.` : ''}${s.name} — ${this.lugar(s.location)}`).join('\n'));
  }

  // ---------- arquitetura e regras ----------

  private async analise(): Promise<NonNullable<ReturnType<EntenderService['analise']>>> {
    const e = this.entender();
    if (!this.projeto.raiz()) throw new Error('nenhum projeto aberto');
    if (!e.analise()) {
      if (!e.analisando()) await e.analisar();
      for (let i = 0; i < 120 && e.analisando(); i++) await new Promise((r) => setTimeout(r, 500));
    }
    const a = e.analise();
    if (!a) throw new Error(e.erro() ?? 'a análise do projeto ainda não terminou');
    return a;
  }

  private async arquiteturaResumo(papel: string | null, dominio: string | null): Promise<string> {
    const a = await this.analise();
    const contar = (f: (c: (typeof a.componentes)[number]) => string) => {
      const m = new Map<string, number>();
      for (const c of a.componentes) m.set(f(c), (m.get(f(c)) ?? 0) + 1);
      return [...m.entries()].sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${n}`).join(', ');
    };
    const lista = a.componentes.filter((c) => (!papel || c.papel === papel) && (!dominio || c.dominio.toLowerCase() === dominio.toLowerCase()));
    return cortar(
      [
        `${a.arquivos} arquivos analisados · tecnologias: ${a.tecnologias.join(', ') || 'nenhuma detectada'}`,
        `${a.componentes.length} componentes · por papel: ${contar((c) => c.papel)}`,
        `por domínio: ${contar((c) => c.dominio)}`,
        '',
        ...lista.slice(0, 250).map((c) => `${c.nome} [${c.papel}, ${c.dominio}]${c.rota ? ` ${c.rota}` : ''}${c.tabela ? ` tabela ${c.tabela}` : ''} — ${c.relativo}:${c.linha}`),
        lista.length > 250 ? `… e mais ${lista.length - 250} (use os filtros papel e dominio)` : '',
      ].join('\n'),
    );
  }

  private async arquiteturaComponente(nome: string): Promise<string> {
    const a = await this.analise();
    const n = nome.toLowerCase();
    const achados = a.componentes.filter((c) => c.id === nome || c.nome.toLowerCase() === n);
    const c = achados[0] ?? a.componentes.find((x) => x.nome.toLowerCase().includes(n));
    if (!c) throw new Error(`componente "${nome}" não encontrado; veja arquitetura_resumo`);
    const nomes = new Map(a.componentes.map((x) => [x.id, x.nome]));
    const quemUsa = a.componentes.filter((x) => x.usa.includes(c.id)).map((x) => x.nome);
    const linhas = [
      `${c.nome} [${c.papel}, domínio ${c.dominio}] — ${c.relativo}:${c.linha}`,
      c.rota ? `rota: ${c.rota}` : '',
      c.tabela ? `tabela: ${c.tabela}` : '',
      c.estende ? `estende ${nomes.get(c.estende) ?? c.estende}` : '',
      c.implementa.length ? `implementa ${c.implementa.map((i) => nomes.get(i) ?? i).join(', ')}` : '',
      c.anotacoes.length ? `anotações: ${c.anotacoes.join(' ')}` : '',
      `usa: ${c.usa.map((u) => nomes.get(u) ?? u).join(', ') || '—'}`,
      `usado por: ${quemUsa.join(', ') || '—'}`,
      'MÉTODOS:',
      ...c.metodos.map((m) => {
        const chamadas = [...new Set(m.chamadas.map((x) => `${nomes.get(x.alvo) ?? x.alvo}.${x.metodo}`))].slice(0, 8).join(', ');
        return `- ${m.nome}(${m.params.join(', ')}) l.${m.linha}${m.http ? ` [${m.http.verbo} ${m.http.rota}]` : ''}${m.desvios.length ? ` · ${m.desvios.length} desvios` : ''}${chamadas ? ` · chama ${chamadas}` : ''}`;
      }),
    ];
    return cortar(linhas.filter((l) => l !== '').join('\n'));
  }

  private async regrasVisiveis(): Promise<RegraVisivel[]> {
    await this.analise();
    const e = this.entender();
    if (!e.arquivo().regras.length) await e.carregarRegras();
    return e.regras();
  }

  private async regrasListar(dominio: string | null, busca: string | null, cobertura: string): Promise<string> {
    const regras = await this.regrasVisiveis();
    const cob = this.testes().cobertura();
    const b = busca?.toLowerCase();
    const lista = regras.filter((r) => {
      if (dominio && r.dominio.toLowerCase() !== dominio.toLowerCase()) return false;
      if (b && !`${r.titulo} ${r.descricao} ${r.codigo?.componente ?? ''}`.toLowerCase().includes(b)) return false;
      const c = cob.get(r.chave)?.estado ?? 'sem';
      return cobertura === 'todas' || c === cobertura;
    });
    if (!lista.length) return 'nenhuma regra com esses filtros';
    return cortar(
      lista
        .slice(0, 150)
        .map((r) => {
          const c = cob.get(r.chave);
          const onde = r.codigo ? `${r.codigo.caminho.replace(/\\/g, '/').replace((this.projeto.raiz() ?? '').replace(/\\/g, '/') + '/', '')}:${r.codigo.linha}` : 'sem código ligado';
          return `${r.id} [${r.dominio}] ${r.titulo} — ${onde} — testes: ${c ? NOME_COBERTURA[c.estado] : 'sem'}${r.descricao ? `\n    ${r.descricao.split('\n')[0].slice(0, 240)}` : ''}`;
        })
        .join('\n') + (lista.length > 150 ? `\n… e mais ${lista.length - 150}` : ''),
    );
  }

  private async regraCenarios(busca: string): Promise<string> {
    const regras = await this.regrasVisiveis();
    const b = busca.toLowerCase();
    const r = regras.find((x) => x.id.toLowerCase() === b || x.chave === busca) ?? regras.find((x) => x.titulo.toLowerCase().includes(b));
    if (!r) throw new Error(`regra "${busca}" não encontrada; veja regras_listar`);
    const c = this.testes().cobertura().get(r.chave);
    if (!c) return `${r.id} ${r.titulo}: sem cobertura calculada (a regra não está ligada ao código)`;
    return [
      `${r.id} ${r.titulo} — ${NOME_COBERTURA[c.estado]}`,
      r.codigo ? `código: ${r.codigo.componente}${r.codigo.metodo ? `.${r.codigo.metodo}` : ''} — ${r.codigo.caminho}:${r.codigo.linha}` : '',
      '',
      ...c.cenarios.map((s) => `- [${s.tipo}] ${s.rotulo}: ${s.estado === 'sem' ? 'SEM TESTE' : s.estado}${s.testes.length ? ` (${s.testes.map((t) => `${t.classe}#${t.metodo}`).join(', ')})` : ''}`),
    ].filter((l, i) => l !== '' || i === 2).join('\n');
  }

  // ---------- git ----------

  private repo(): GitService {
    const g = this.git();
    if (!g.ehRepositorio()) throw new Error('este projeto não é um repositório git');
    return g;
  }

  private async gitEstado(): Promise<string> {
    const g = this.repo();
    await g.atualizar();
    const e = g.estado()!;
    const alt = g.alterados();
    return [
      `branch ${e.branch ?? '(HEAD destacado)'}${e.upstream ? ` → ${e.upstream} (${e.aFrente} à frente, ${e.atras} atrás)` : ' (sem upstream)'}${e.operacao ? ` · EM ANDAMENTO: ${e.operacao}` : ''}`,
      alt.length ? `${alt.length} alterados:` : 'nada alterado',
      ...alt.slice(0, 200).map((a) => `${a.letra} ${a.relativo}${a.noIndice ? ' [stage]' : ''}${a.de ? ` (de ${a.de})` : ''}`),
    ].join('\n');
  }

  private async gitDiff(caminho: string | null, staged: boolean): Promise<string> {
    const g = this.repo();
    const args = ['diff', '--no-color', ...(staged ? ['--cached'] : []), ...(caminho ? ['--', caminho] : [])];
    const saida = await g.rodar(args);
    if (saida.trim()) return cortar(saida);
    const novos = g.alterados().filter((a) => a.letra === '?' && (!caminho || a.relativo === caminho)).map((a) => a.relativo);
    return novos.length ? `sem diff dos arquivos rastreados; arquivos novos (não rastreados): ${novos.join(', ')}` : 'sem diferenças';
  }

  private async gitLog(limite: number): Promise<string> {
    const g = this.repo();
    const commits = (await g.log(false, limite)).slice(0, limite);
    return commits.length ? commits.map((c) => `${c.hash.slice(0, 8)} ${new Date(c.data * 1000).toISOString().slice(0, 10)} ${c.autor}: ${c.assunto}`).join('\n') : 'sem commits';
  }

  private async gitCommit(mensagem: string, arquivos: string[] | null): Promise<string> {
    const g = this.repo();
    await g.atualizar();
    const alvo = arquivos?.length ? arquivos : g.alterados().map((a) => a.relativo);
    if (!alvo.length) return 'nada para commitar';
    if (g.conflitos().length) throw new Error('há conflitos de merge: resolva antes de commitar');
    const detalhe = `${mensagem}\n${alvo.length} ${alvo.length === 1 ? 'arquivo' : 'arquivos'}: ${alvo.slice(0, 8).join(', ')}${alvo.length > 8 ? '…' : ''}`;
    if (!(await this.base().autorizar('A IA QUER FAZER UM COMMIT', 'Commitar', detalhe))) return 'o usuário recusou; nenhum commit foi feito';
    const ok = await g.commit(alvo, mensagem, false);
    return ok ? `commit feito: ${mensagem}` : 'o commit falhou (veja o aviso do Seedy)';
  }

  private async gitOperacao(titulo: string, rotulo: string, detalhe: string, sempre: boolean, fazer: () => Promise<boolean>): Promise<string> {
    const g = this.repo();
    if (!(await this.base().autorizar(`A IA QUER FAZER ${titulo}`, rotulo, `${detalhe} (${g.estado()?.branch ?? ''})`, sempre))) return 'o usuário recusou; nada foi feito';
    return (await fazer()) ? `${titulo.toLowerCase()} feito` : `${titulo.toLowerCase()} falhou (veja o aviso do Seedy)`;
  }

  private async gitBranches(): Promise<string> {
    const b = await this.repo().branches();
    return b.locais.map((x) => `${x.atual ? '* ' : '  '}${x.nome}${x.upstream ? ` → ${x.upstream} (${x.aFrente}↑ ${x.atras}↓)` : ''}`).join('\n') || 'nenhuma branch';
  }

  private async gitBranch(acao: string, nome: string): Promise<string> {
    const g = this.repo();
    if (!/^[\w][\w./-]*$/.test(nome) || nome.includes('..')) throw new Error('nome de branch inválido');
    if (!['criar', 'trocar', 'apagar'].includes(acao)) throw new Error('acao: criar, trocar ou apagar');
    if (!(await this.base().autorizar('A IA QUER MEXER NAS BRANCHES', acao[0].toUpperCase() + acao.slice(1), nome, acao === 'apagar'))) return 'o usuário recusou; nada foi feito';
    const ok = acao === 'criar' ? await g.criarBranch(nome) : acao === 'trocar' ? await g.checkout(nome) : await g.apagarBranch(nome, false);
    return ok ? `branch ${nome}: ${acao === 'criar' ? 'criada' : acao === 'trocar' ? 'atual' : 'apagada'}` : `${acao} falhou (veja o aviso do Seedy)`;
  }

  // ---------- GitHub ----------

  private async githubPr(titulo: string, corpo: string, base: string | null, rascunho: boolean): Promise<string> {
    this.repo();
    if (!this.github().usuario()) throw new Error('conecte a conta do GitHub no Seedy primeiro (␣ G)');
    if (!(await this.base().autorizar('A IA QUER ABRIR UM PULL REQUEST', 'Abrir PR', `${titulo}\nde ${this.git().estado()?.branch} ${base ? `para ${base}` : ''}`, true))) return 'o usuário recusou; nenhum PR foi aberto';
    const f = this.githubForm();
    await f.abrir('pr');
    if (!f.aberta()) return 'não abri o formulário: veja o aviso do Seedy (branch principal, PR já existente ou envio recusado)';
    f.titulo.set(titulo);
    f.corpo.set(corpo);
    if (base) f.base.set(base);
    f.rascunho.set(rascunho);
    f.abrirDepois.set(false);
    const ok = await f.enviar();
    if (!ok) f.fechar();
    return ok ? `pull request aberto: ${titulo}` : 'o GitHub recusou o pull request (veja o aviso do Seedy)';
  }

  private async githubIssue(titulo: string, corpo: string): Promise<string> {
    this.repo();
    if (!this.github().usuario()) throw new Error('conecte a conta do GitHub no Seedy primeiro (␣ G)');
    if (!(await this.base().autorizar('A IA QUER ABRIR UMA ISSUE', 'Abrir issue', titulo, true))) return 'o usuário recusou; nenhuma issue foi aberta';
    const f = this.githubForm();
    await f.abrir('issue');
    if (!f.aberta()) return 'não abri o formulário: veja o aviso do Seedy';
    f.titulo.set(titulo);
    f.corpo.set(corpo);
    f.abrirDepois.set(false);
    const ok = await f.enviar();
    if (!ok) f.fechar();
    return ok ? `issue aberta: ${titulo}` : 'o GitHub recusou a issue (veja o aviso do Seedy)';
  }

  // ---------- jdtls e JDK ----------

  private async jdtlsEstado(): Promise<string> {
    const j = this.jdtls();
    const info = await ponte.java.estado(null).catch(() => null);
    return [`jdtls: ${j.pronto() ? 'pronto' : 'não está pronto (iniciando, parado ou projeto sem Java)'}`, `projeto: ${j.raiz() ?? '—'}`, `JDK: ${info?.jdk?.home ?? 'padrão'} · mínimo ${info?.javaMinimo ?? '?'}`].join('\n');
  }

  private async jdksListar(): Promise<string> {
    const todos = await ponte.java.jdks();
    if (!todos.length) return 'nenhum JDK encontrado';
    const atual = (await ponte.java.estado(null).catch(() => null))?.jdk?.home;
    return todos.map((j) => `Java ${j.versao} — ${j.home}${j.home === atual ? '  (roda o jdtls)' : ''}`).join('\n');
  }

  private async jdkEscolher(pasta: string): Promise<string> {
    const todos = await ponte.java.jdks();
    const jdk = todos.find((j) => j.home.replace(/[\\/]+$/, '').toLowerCase() === pasta.replace(/[\\/]+$/, '').toLowerCase());
    if (!jdk) throw new Error('JDK não encontrado; veja jdks_listar');
    const minimo = (await ponte.java.estado(null).catch(() => null))?.javaMinimo ?? 25;
    if (jdk.maior < minimo) throw new Error(`o jdtls precisa de JDK ${minimo} ou mais novo (este é o ${jdk.versao})`);
    if (!(await this.base().autorizar('A IA QUER TROCAR O JDK DO JDTLS', 'Trocar', `Java ${jdk.versao} — ${jdk.home}\no jdtls reinicia`))) return 'o usuário recusou; o JDK ficou';
    await this.jdtls().usarJdk(jdk.home);
    return `jdtls reiniciando com o Java ${jdk.versao}`;
  }

  // ---------- banco: escrita ----------

  private async bancoExecutar(conexao: string, sqlTexto: string): Promise<string> {
    const b = this.banco();
    const p = b.perfis().find((x) => x.nome.toLowerCase() === conexao.toLowerCase() || x.id === conexao);
    if (!p) throw new Error(`conexão "${conexao}" não existe; veja banco_conexoes`);
    if (p.somenteLeitura) throw new Error(`"${p.nome}" é somente leitura: peça ao usuário para desligar a opção no perfil, ou use banco_consultar`);
    if (p.ambiente === 'producao') throw new Error('a IA não altera banco de Produção: peça ao usuário para executar a alteração');
    const instrucoes = sqlInstrucoes(sqlTexto);
    if (!instrucoes.length) throw new Error('nada para executar');
    const escritas = instrucoes.filter((i) => sqlEscreve(i.texto));
    if (!escritas.length) throw new Error('só leitura: use banco_consultar');
    for (const i of escritas) {
      const t = i.texto.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
      if (/^(update|delete)\b/.test(t) && !/\bwhere\b/.test(t)) throw new Error('UPDATE/DELETE sem WHERE altera a tabela inteira: acrescente o WHERE (ou peça ao usuário para rodar)');
    }
    const resumo = instrucoes.map((i) => i.texto.trim().replace(/\s+/g, ' ').slice(0, 140)).slice(0, 6).join('\n');
    const destrutivo = escritas.some((i) => /^\s*(drop|truncate|alter)\b/i.test(i.texto.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ')));
    const ok = await this.base().autorizar(
      destrutivo ? 'A IA QUER ALTERAR A ESTRUTURA DO BANCO' : 'A IA QUER ALTERAR DADOS DO BANCO',
      'Executar',
      `${p.nome} (${p.ambiente}): ${resumo.split('\n')[0]}${instrucoes.length > 1 ? ` (+${instrucoes.length - 1})` : ''}`,
      true,
      '⚠ só você aprova, até no automático',
    );
    if (!ok) return 'o usuário recusou; o banco não foi alterado';
    if (!b.conectado(p.id) && !(await b.conectar(p.id))) throw new Error(`não consegui conectar em ${p.nome}`);
    const r = await ponte.banco.consultar(p.id, sqlTexto, 100);
    if (r.colunas.length) return `executado em ${p.nome} (${r.ms} ms), com resultado:\n${r.colunas.map((c) => c.nome).join(' | ')}\n${r.linhas.slice(0, 20).map((l) => l.map((v) => v ?? 'NULL').join(' | ')).join('\n')}`;
    return `executado em ${p.nome} (${r.ms} ms): ${r.afetadas ?? 0} ${r.afetadas === 1 ? 'linha afetada' : 'linhas afetadas'}`;
  }

  // ---------- .env ----------

  private async envListar(): Promise<string> {
    const e = this.env();
    await e.carregar();
    const lista = e.arquivos();
    if (!lista.length) return 'nenhum arquivo .env na raiz do projeto';
    const uso = e.emUso();
    return [
      ...lista.map((a) => `${a.nome}${a.modelo ? ' (modelo)' : ''} — ${a.variaveis} variáveis${uso?.nome === a.nome ? '  [em uso]' : ''}`),
      uso ? `variáveis de ${uso.nome} (só os nomes): ${e.nomes().join(', ') || '—'}` : e.escolhido().usar ? 'nenhum escolhido ainda: o Seedy pergunta ao usuário na primeira execução' : 'o .env está desligado neste projeto',
    ].join('\n');
  }

  // ---------- memória ----------

  private escopoDaMemoria(v: string): EscopoDaMemoria {
    if (v !== 'projeto' && v !== 'global') throw new Error('escopo: projeto ou global');
    return v;
  }

  private async memoriaLer(escopo: string): Promise<string> {
    const m = this.memoria();
    await m.carregar();
    const lista = (n: string[]) => (n.length ? n.map((x) => `- ${x}`).join('\n') : '(nenhuma nota)');
    const partes: string[] = [];
    if (escopo !== 'global') partes.push(`PROJETO:\n${lista(m.doProjeto())}`);
    if (escopo !== 'projeto') partes.push(`GLOBAL:\n${lista(m.global())}`);
    return partes.join('\n\n');
  }

  private async memoriaSalvar(nota: string, escopoBruto: string): Promise<string> {
    const escopo = this.escopoDaMemoria(escopoBruto);
    const m = this.memoria();
    const p = prepararNota(nota);
    if ('erro' in p) throw new Error(p.erro);
    if (escopo === 'projeto' && !m.arquivoDoProjeto()) throw new Error('nenhum projeto aberto: use o escopo global');
    const onde = escopo === 'global' ? 'em todos os projetos' : 'neste projeto';
    if (!(await this.base().autorizar('A IA QUER GUARDAR NA MEMÓRIA', 'Guardar', `${p.nota}\n(vale ${onde})`, true))) return 'o usuário recusou; nada foi guardado';
    const r = await m.salvar(escopo, p.nota);
    return r === 'repetida' ? 'já existia uma nota igual; nada mudou' : `guardado na memória (${escopo}): ${p.nota}`;
  }

  private async memoriaApagar(trecho: string, escopoBruto: string): Promise<string> {
    const escopo = this.escopoDaMemoria(escopoBruto);
    const m = this.memoria();
    const alvo = m.notas(escopo).filter((n) => n.toLowerCase().includes(trecho.trim().toLowerCase()));
    if (!alvo.length) return 'nenhuma nota contém esse trecho';
    if (!(await this.base().autorizar('A IA QUER APAGAR DA MEMÓRIA', 'Apagar', alvo.map((n) => `- ${n}`).join('\n'), true))) return 'o usuário recusou; as notas ficaram';
    const apagadas = await m.apagar(escopo, trecho);
    return `${apagadas.length} ${apagadas.length === 1 ? 'nota apagada' : 'notas apagadas'}`;
  }

  // ---------- servidor e banco ----------

  private async servidorEditar(e: Record<string, unknown>): Promise<string> {
    const s = this.servidor();
    const lista = s.doProjeto();
    const alvo = opc(e, 'servidor');
    const p = alvo ? lista.find((x) => x.nome.toLowerCase() === alvo.toLowerCase() || x.id === alvo) : s.perfilAtual();
    if (!p) throw new Error(alvo ? `servidor "${alvo}" não existe; veja servidor_estado` : 'nenhum servidor configurado neste projeto (servidor_criar)');
    const novo: PerfilServidor = { ...p, variaveis: { ...p.variaveis } };
    const mudou: string[] = [];
    const nm = opc(e, 'nome');
    if (nm?.trim()) (novo.nome = nm.trim()), mudou.push('nome');
    for (const campo of ['portaHttp', 'portaDebug'] as const) {
      if (e[campo] !== undefined) {
        const n = Number(e[campo]);
        if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${campo} inválida`);
        novo[campo] = n;
        mudou.push(campo);
      }
    }
    for (const campo of ['opcoesJvm', 'contexto', 'pastaWeb', 'pastaClasses'] as const) {
      const v = opc(e, campo);
      if (v !== null) {
        novo[campo] = campo === 'contexto' && v && !v.startsWith('/') ? `/${v}` : v;
        mudou.push(campo);
      }
    }
    if (opc(e, 'jdk') !== null) (novo.jdk = opc(e, 'jdk')!.trim() || null), mudou.push('jdk');
    if (e['variaveis'] && typeof e['variaveis'] === 'object') {
      novo.variaveis = Object.fromEntries(Object.entries(e['variaveis'] as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
      mudou.push('variaveis');
    }
    if (!mudou.length) return 'nada para mudar: mande ao menos um campo';
    if (s.execucoes().get(p.id)?.fase && s.execucoes().get(p.id)!.fase !== 'parado') mudou.push('(o servidor está rodando: reinicie para valer)');
    if (!(await this.base().autorizar('A IA QUER MUDAR UM SERVIDOR', 'Salvar', `${p.nome}: ${mudou.join(', ')}`))) return 'o usuário recusou; nada mudou';
    if (!(await s.salvar(novo))) throw new Error('não consegui salvar o servidor');
    return `${novo.nome} atualizado: ${mudou.join(', ')}`;
  }

  private async ligarContainerAoBanco(nome: string, conexao: string | null): Promise<string> {
    const d = this.docker();
    await d.atualizar(false);
    const r = d.perfilParaBanco(nome);
    if (typeof r === 'string') throw new Error(r);
    const perfil = { ...r.perfil, ...(conexao?.trim() ? { nome: conexao.trim() } : {}) };
    if (this.banco().perfis().some((p) => p.nome.toLowerCase() === perfil.nome.toLowerCase())) throw new Error(`já existe uma conexão chamada "${perfil.nome}"`);
    if (!(await this.base().autorizar('A IA QUER CRIAR UMA CONEXÃO DE BANCO', 'Criar', `${perfil.nome}: ${perfil.tipo} em localhost:${perfil.porta}, banco ${perfil.banco}, usuário ${perfil.usuario}${r.senha ? '\na senha vai para o cofre do sistema' : ''}`))) {
      return 'o usuário recusou; nenhuma conexão foi criada';
    }
    if (!(await this.banco().salvar(perfil, r.senha ?? null, null, false))) throw new Error('não consegui salvar a conexão');
    return `conexão "${perfil.nome}" criada (${perfil.tipo}, localhost:${perfil.porta}, banco ${perfil.banco}). Use banco_consultar com esse nome.`;
  }
}

const NOME_COBERTURA: Record<string, string> = { sem: 'sem teste', completa: 'completa', 'so-feliz': 'só o caminho feliz', 'so-erro': 'só o erro', falhando: 'falhando' };

function str(e: Record<string, unknown>, campo: string): string {
  const v = e[campo];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`"${campo}" é obrigatório (texto)`);
  return v;
}

function opc(e: Record<string, unknown>, campo: string): string | null {
  const v = e[campo];
  return typeof v === 'string' ? v : null;
}

function inteiro(e: Record<string, unknown>, campo: string): number {
  const v = Number(e[campo]);
  if (!Number.isInteger(v)) throw new Error(`"${campo}" é obrigatório (número inteiro)`);
  return v;
}

function cortar(t: string): string {
  return t.length > LIMITE ? `${t.slice(0, LIMITE)}\n[... cortado em ${LIMITE} de ${t.length} caracteres]` : t;
}
