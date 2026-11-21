import { computed, inject, Injectable, signal } from '@angular/core';
import { EditorService } from '../editor/editor.service';
import { EntenderService, RegraVisivel } from '../entender/entender.service';
import { EscolhaService } from '../escolha/escolha.service';
import { IaService } from '../ia/ia.service';
import { LayoutService } from '../layout/layout.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { ComponenteAnalise, ponte, TesteInfo } from '../nucleo/ponte';
import { ProjetoService } from '../nucleo/projeto.service';
import { CoberturaDaRegra } from './cobertura';
import { TestesService } from './testes.service';

/** "Feira lotada" → "FeiraLotada"; sem acento, só letras e números. */
export function nomeDeCenario(texto: string): string {
  const limpo = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .trim();
  return limpo
    .split(/\s+/)
    .slice(0, 6)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join('');
}

/** Estado do menu do botão direito numa regra. */
export interface MenuDaRegra {
  x: number;
  y: number;
  regra: RegraVisivel;
}

/**
 * O que se faz com os testes de uma regra de negócio: ir até eles, rodar, escrever um teste
 * (à mão ou com a IA) e pedir à IA os cenários que faltam (erros, limites, nulos).
 */
@Injectable({ providedIn: 'root' })
export class TestesDaRegraService {
  private readonly testes = inject(TestesService);
  private readonly entender = inject(EntenderService);
  private readonly editor = inject(EditorService);
  private readonly escolha = inject(EscolhaService);
  private readonly ia = inject(IaService);
  private readonly layout = inject(LayoutService);
  private readonly projeto = inject(ProjetoService);
  private readonly mensagens = inject(MensagensService);

  readonly menu = signal<MenuDaRegra | null>(null);

  readonly itensDoMenu = computed(() => {
    const m = this.menu();
    if (!m) return [];
    const cob = this.cobertura(m.regra);
    const meus = this.testesDaRegra(m.regra);
    const doMetodo = this.testesDoMetodo(m.regra);
    const tem = meus.length > 0;
    const itens: { id: string; rotulo: string; dica: string; tecla: string; desabilitado?: boolean; separador?: boolean; icone: string }[] = [];
    if (tem) {
      itens.push({ id: 'ir', rotulo: meus.length === 1 ? 'ir para o teste' : `ir para os testes (${meus.length})`, dica: meus.length === 1 ? meus[0].metodo : '', tecla: 'g', icone: '⇢' });
      itens.push({ id: 'rodar', rotulo: 'rodar os testes desta regra', dica: '', tecla: 'r', icone: '▶' });
    } else {
      itens.push({ id: 'ia', rotulo: 'criar teste com a IA', dica: '', tecla: 'i', icone: '✦' });
      itens.push({ id: 'manual', rotulo: 'criar teste manualmente', dica: '', tecla: 'm', icone: '✎' });
      if (doMetodo.length) itens.push({ id: 'irMetodo', rotulo: `ver os testes do método (${doMetodo.length})`, dica: 'não cobrem este erro', tecla: 'g', icone: '⇢' });
    }
    itens.push({ id: 'cenarios', rotulo: 'sugerir cenários de erro', dica: '', tecla: 's', icone: '⚠' });
    if (tem) itens.push({ id: 'ia', rotulo: 'criar outro teste com a IA', dica: '', tecla: 'i', icone: '✦' }, { id: 'manual', rotulo: 'criar outro teste manualmente', dica: '', tecla: 'm', icone: '✎' });
    itens.push(
      { id: 'codigo', rotulo: 'ver no código', dica: '⏎', tecla: '', icone: '⇢', separador: true, desabilitado: !m.regra.codigo },
      { id: 'caminho', rotulo: 'caminho do método', dica: 'c', tecla: 'c', icone: '⇢', desabilitado: !m.regra.codigo?.metodo },
      { id: 'editar', rotulo: 'editar a regra', dica: 'e', tecla: 'e', icone: '✎' },
    );
    void cob;
    return itens;
  });

  cobertura(r: RegraVisivel): CoberturaDaRegra | null {
    return r.codigo ? (this.testes.cobertura().get(r.codigo.chave) ?? null) : null;
  }

  /** Os testes que cobrem o cenário da própria regra (o desvio que ela descreve; na agendada, o caminho feliz). */
  testesDaRegra(r: RegraVisivel): TesteInfo[] {
    const cob = this.cobertura(r);
    if (!cob) return [];
    return (cob.cenarios.find((c) => c.id === r.codigo?.chave) ?? cob.cenarios.find((c) => c.tipo === 'feliz'))?.testes ?? [];
  }

  /** Todos os que passam pelo método da regra (cobrem o método, não necessariamente este cenário). */
  testesDoMetodo(r: RegraVisivel): TesteInfo[] {
    return this.cobertura(r)?.testes ?? [];
  }

  abrirMenu(x: number, y: number, regra: RegraVisivel): void {
    this.menu.set({ x, y, regra });
  }

  fecharMenu(): void {
    this.menu.set(null);
  }

  async executar(id: string): Promise<void> {
    const m = this.menu();
    this.menu.set(null);
    if (!m) return;
    await this.fazer(id, m.regra);
  }

  async fazer(id: string, r: RegraVisivel): Promise<void> {
    switch (id) {
      case 'ir': return this.irParaTeste(r);
      case 'irMetodo': return this.irParaTeste(r, true);
      case 'rodar': return this.rodar(r);
      case 'ia': return this.criarComIa(r);
      case 'manual': return this.criarManual(r);
      case 'cenarios': return this.sugerirCenarios(r);
      case 'codigo': if (r.codigo) this.entender.abrirNoEditor(r.codigo.caminho, r.codigo.linha); return;
      case 'caminho': if (r.codigo?.metodo) void this.entender.acompanhar(r.codigo.componente, r.codigo.metodo); return;
      case 'editar': return void this.entender.editarRegra(r);
    }
  }

  // ---------- ir e rodar ----------

  async irParaTeste(r: RegraVisivel, doMetodo = false): Promise<void> {
    const lista = doMetodo || !this.testesDaRegra(r).length ? this.testesDoMetodo(r) : this.testesDaRegra(r);
    if (!lista.length) return this.mensagens.alerta('esta regra ainda não tem teste: ␣ t cria um');
    const alvo =
      lista.length === 1
        ? lista[0]
        : await this.escolha.escolherUm<TesteInfo>(
            'TESTES DESTA REGRA',
            lista.map((t) => ({ rotulo: `${this.icone(t)} ${t.classe}.${t.metodo}`, detalhe: `${t.tipo}${t.esperaErro ? ' · erro' : ''}`, valor: t })),
            '⏎ abre o teste no código',
          );
    if (!alvo) return;
    this.entender.abrirNoEditor(alvo.caminho, alvo.linha);
  }

  private icone(t: TesteInfo): string {
    const e = this.testes.estadoDe(t);
    return e === 'ok' ? '✓' : e === 'falhou' ? '✗' : e === 'ignorado' ? '○' : '·';
  }

  async rodar(r: RegraVisivel): Promise<void> {
    const proprios = this.testesDaRegra(r);
    const java = (proprios.length ? proprios : this.testesDoMetodo(r)).filter((t) => t.linguagem === 'java');
    if (!java.length) return this.mensagens.alerta('esta regra não tem teste de Java para rodar');
    this.mensagens.mostrar(`rodando ${java.length} ${java.length === 1 ? 'teste' : 'testes'}…`);
    await this.testes.rodar('todos', [...new Set(java.map((t) => t.classe))].join(','));
    this.mensagens.mostrar('testes rodados: o resultado já está nos cards');
  }

  // ---------- criar teste ----------

  /** Pergunta como criar (manual ou IA) e faz. */
  async criar(r: RegraVisivel): Promise<void> {
    const como = await this.escolha.escolherUm<'ia' | 'manual'>(
      `ESCREVER TESTE · ${r.id}`,
      [
        { rotulo: '✦ com a IA', detalhe: 'ela lê a regra e o código e propõe o teste como diff', valor: 'ia' },
        { rotulo: '✎ manualmente', detalhe: 'abre a classe de teste com um método vazio para você preencher', valor: 'manual' },
      ],
    );
    if (como === 'ia') await this.criarComIa(r);
    else if (como === 'manual') await this.criarManual(r);
  }

  private componenteDe(r: RegraVisivel): ComponenteAnalise | null {
    return r.codigo ? (this.entender.componentes().get(r.codigo.componente) ?? null) : null;
  }

  private nomeDoMetodoDeTeste(r: RegraVisivel): string {
    const c = r.codigo;
    const base = c?.mensagem ?? c?.condicao ?? r.titulo;
    const slug = nomeDeCenario(base) || 'Cenario';
    const erro = c && ['excecao', 'desvio', 'permissao', 'validacao'].includes(c.tipo);
    return `${erro ? 'nao' : 'deve'}${slug}`.replace(/^nao(Nao|Sem)/, 'nao');
  }

  /** Abre (ou cria) a classe de teste do componente e deixa lá um método vazio com o nome do cenário. */
  async criarManual(r: RegraVisivel): Promise<void> {
    const comp = this.componenteDe(r);
    const raiz = this.projeto.raiz();
    if (!comp || !raiz) return this.mensagens.alerta('esta regra não está ligada a um componente do código');
    const nome = this.nomeDoMetodoDeTeste(r);
    const cenario = r.codigo?.mensagem ?? r.codigo?.condicao ?? r.titulo;
    const existente = this.testes.testes().find((t) => t.linguagem === (comp.linguagem === 'ts' ? 'ts' : 'java') && t.componentes.includes(comp.id) && (comp.linguagem === 'ts' || t.classe === `${comp.nome}Test`));
    try {
      const { caminho, linha } = comp.linguagem === 'ts' ? await this.escreverSpec(comp, existente?.caminho ?? null, nome, cenario, r) : await this.escreverJunit(comp, existente?.caminho ?? null, nome, cenario, r);
      this.entender.abrirNoEditor(caminho, linha);
      this.mensagens.mostrar(`teste ${nome} criado: escreva o cenário e rode com ␣ E`);
    } catch (e) {
      this.mensagens.erro(String(e));
    }
  }

  private async escreverJunit(comp: ComponenteAnalise, arquivo: string | null, nome: string, cenario: string, r: RegraVisivel): Promise<{ caminho: string; linha: number }> {
    const metodo = (usaImport: boolean) =>
      `\n    ${usaImport ? '@Test' : '@org.junit.jupiter.api.Test'}\n    void ${nome}() {\n        // Regra ${r.id}: ${r.titulo}\n        // Cenário: ${cenario}\n        org.junit.jupiter.api.Assertions.fail("escrever este teste");\n    }\n`;
    if (arquivo) {
      const texto = await ponte.lerArquivo(arquivo);
      const fim = texto.lastIndexOf('}');
      if (fim < 0) throw new Error('não entendi a classe de teste');
      const novo = texto.slice(0, fim).replace(/\s*$/, '\n') + metodo(texto.includes('org.junit.jupiter.api.Test')) + '}\n';
      await ponte.gravarArquivo(arquivo, novo);
      const linha = novo.slice(0, novo.indexOf(`void ${nome}()`)).split('\n').length;
      return { caminho: arquivo, linha };
    }
    const sep = comp.caminho.includes('\\') ? '\\' : '/';
    const origem = comp.caminho.split(/[\\/]/).join('/');
    const destino = origem.includes('/src/main/') ? origem.replace('/src/main/', '/src/test/') : null;
    if (!destino) throw new Error('não achei a pasta src/test deste módulo');
    const caminho = destino.replace(/\.java$/, 'Test.java').split('/').join(sep);
    const pacote = comp.pacote ? `package ${comp.pacote};\n\n` : '';
    const conteudo = `${pacote}import org.junit.jupiter.api.Test;\n\nclass ${comp.nome}Test {\n${metodo(true)}}\n`;
    await ponte.gravarArquivo(caminho, conteudo);
    return { caminho, linha: conteudo.slice(0, conteudo.indexOf(`void ${nome}()`)).split('\n').length };
  }

  private async escreverSpec(comp: ComponenteAnalise, arquivo: string | null, nome: string, cenario: string, r: RegraVisivel): Promise<{ caminho: string; linha: number }> {
    const titulo = (r.codigo?.mensagem ?? cenario).replace(/'/g, '’');
    const caso = `\n  it('${nome}: ${titulo}', () => {\n    // Regra ${r.id}: ${r.titulo}\n    // TODO: escrever este teste\n    expect(true).toBe(false);\n  });\n`;
    if (arquivo) {
      const texto = await ponte.lerArquivo(arquivo);
      const fim = texto.lastIndexOf('});');
      if (fim < 0) throw new Error('não entendi o arquivo de teste');
      const novo = texto.slice(0, fim).replace(/\s*$/, '\n') + caso + texto.slice(fim);
      await ponte.gravarArquivo(arquivo, novo);
      return { caminho: arquivo, linha: novo.slice(0, novo.indexOf(`it('${nome}`)).split('\n').length + 1 };
    }
    const caminho = comp.caminho.replace(/\.ts$/, '.spec.ts');
    const conteudo = `describe('${comp.nome}', () => {${caso}});\n`;
    await ponte.gravarArquivo(caminho, conteudo);
    return { caminho, linha: 3 };
  }

  // ---------- IA ----------

  private contexto(r: RegraVisivel): string {
    const c = r.codigo;
    const cob = this.cobertura(r);
    const cen = cob?.cenarios.map((x) => `- ${x.estado === 'sem' ? '[sem teste]' : x.estado === 'falhou' ? '[teste falhando]' : '[coberto]'} ${x.tipo === 'feliz' ? 'caminho feliz' : x.rotulo}`).join('\n') ?? '';
    const exemplo = this.testes.testes().find((t) => c && t.componentes.includes(c.componente));
    return [
      `Regra ${r.id}: ${r.titulo}`,
      r.descricao,
      c ? `Código: ${c.componente}${c.metodo ? '.' + c.metodo : ''} (${c.caminho}:${c.linha})` : '',
      cen ? `Cenários desta regra:\n${cen}` : '',
      exemplo ? `Teste existente do mesmo componente, para seguir o estilo: ${exemplo.relativo}:${exemplo.linha}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private async paraAIa(texto: string): Promise<void> {
    this.entender.fechar();
    this.layout.tela.set('editor');
    this.layout.mostrar('ia');
    await this.ia.enviar(texto);
  }

  async criarComIa(r: RegraVisivel): Promise<void> {
    const cob = this.cobertura(r);
    const faltam = cob?.cenarios.filter((c) => c.estado === 'sem').map((c) => (c.tipo === 'feliz' ? 'caminho feliz' : c.rotulo)).join('; ') || 'o cenário desta regra';
    await this.paraAIa(
      `Escreva o teste desta regra de negócio, cobrindo: ${faltam}.\n\n${this.contexto(r)}\n\nLeia o código e o teste de exemplo antes. Siga o framework e o estilo do projeto (JUnit/Mockito no Java, Jasmine/Jest no Angular), use o nome do método para dizer o cenário e proponha o teste com propor_edicao (se a classe de teste já existir, acrescente o método; senão crie o arquivo na pasta de testes). Depois diga como rodar.`,
    );
  }

  async sugerirCenarios(r: RegraVisivel): Promise<void> {
    await this.paraAIa(
      `Que cenários faltam testar nesta regra de negócio? Pense nos que dão errado (erros, recusas, 4xx e 5xx), nos limites (valor exato, zero, vazio, nulo, o último e o primeiro), em duplicidade, permissão e concorrência.\n\n${this.contexto(r)}\n\nLeia o código antes de responder. Liste só o que ainda não está nos cenários acima, do mais arriscado ao menos, com uma linha cada e o nome sugerido para o teste. Não altere arquivos; pergunte se devo escrever algum.`,
    );
  }
}
