import { computed, inject, Injectable } from '@angular/core';
import { BuscaService } from '../busca/busca.service';
import { EntenderService } from '../entender/entender.service';
import { TestesService } from '../testes/testes.service';
import { BancoService } from '../banco/banco.service';

export interface Carga {
  id: string;
  /** O que está sendo carregado, para a barra de status. */
  rotulo: string;
  detalhe: string;
}

/**
 * Tudo o que o Seedy está carregando em segundo plano ao abrir um projeto (leitura do código,
 * índice da busca, relatórios de teste...). A barra de status mostra o que é, para as telas não
 * parecerem vazias enquanto o trabalho não termina.
 */
@Injectable({ providedIn: 'root' })
export class CarregamentoService {
  private readonly entender = inject(EntenderService);
  private readonly testes = inject(TestesService);
  private readonly busca = inject(BuscaService);
  private readonly banco = inject(BancoService);

  readonly cargas = computed<Carga[]>(() => {
    const l: Carga[] = [];
    if (this.entender.analisando()) l.push({ id: 'analise', rotulo: 'lendo o código', detalhe: 'arquitetura, regras de negócio e testes do projeto' });
    if (this.testes.lendoRelatorios()) l.push({ id: 'relatorios', rotulo: 'lendo relatórios de teste', detalhe: 'resultado do último mvn/gradle test' });
    if (this.testes.preparando()) l.push({ id: 'maven', rotulo: 'preparando os testes', detalhe: 'sem Maven instalado, o Seedy baixa o Maven na primeira vez' });
    if (this.testes.rodando()) l.push({ id: 'testes', rotulo: 'rodando testes', detalhe: this.testes.comandoAtual() || 'testes do projeto' });
    const conectando = this.banco.conectando();
    if (conectando) l.push({ id: 'banco', rotulo: `conectando em ${this.banco.perfil(conectando)?.nome ?? 'o banco'}`, detalhe: 'abrindo a conexão com o banco (e o túnel SSH, se houver)' });
    if (this.banco.carregandoCatalogo()) l.push({ id: 'catalogo', rotulo: 'lendo o catálogo do banco', detalhe: 'tabelas e colunas da conexão' });
    if (this.busca.indexando()) l.push({ id: 'indice', rotulo: 'indexando arquivos', detalhe: 'índice da busca (␣ f e ␣ /)' });
    return l;
  });
}
