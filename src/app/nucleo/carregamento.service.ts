import { computed, inject, Injectable } from '@angular/core';
import { BuscaService } from '../busca/busca.service';
import { EntenderService } from '../entender/entender.service';
import { TestesService } from '../testes/testes.service';

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

  readonly cargas = computed<Carga[]>(() => {
    const l: Carga[] = [];
    if (this.entender.analisando()) l.push({ id: 'analise', rotulo: 'lendo o código', detalhe: 'arquitetura, regras de negócio e testes do projeto' });
    if (this.testes.lendoRelatorios()) l.push({ id: 'relatorios', rotulo: 'lendo relatórios de teste', detalhe: 'resultado do último mvn/gradle test' });
    if (this.testes.preparando()) l.push({ id: 'maven', rotulo: 'preparando os testes', detalhe: 'sem Maven instalado, o Seedy baixa o Maven na primeira vez' });
    if (this.testes.rodando()) l.push({ id: 'testes', rotulo: 'rodando testes', detalhe: this.testes.comandoAtual() || 'testes do projeto' });
    if (this.busca.indexando()) l.push({ id: 'indice', rotulo: 'indexando arquivos', detalhe: 'índice da busca (␣ f e ␣ /)' });
    return l;
  });
}
