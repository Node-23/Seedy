/**
 * Projeto de exemplo para o modo navegador (`npm start`), onde não há núcleo em Rust.
 * Serve para trabalhar no visual com dados parecidos com os dos mockups.
 * Nada aqui roda dentro do app.
 */
import type { ColunaDeTabela, Entrada, Indice, InfoConexao, Ocorrencia, PerfilBanco, ResultadoSql, SchemaBanco, Simbolo } from './ponte';
import { expressaoDeBusca, OpcoesTexto, passaNaMascara, trechosEncontrados } from '../busca/texto';

export const RAIZ_EXEMPLO = '/exemplo/feirinha-verde';

const PACOTE = 'src/main/java/br/com/feirinhaverde';

const ARQUIVOS: Record<string, string> = {
  'pom.xml': `<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>br.com.feirinhaverde</groupId>
  <artifactId>feirinha-verde</artifactId>
  <!-- modo navegador: dados de exemplo -->
</project>
`,
  'docker-compose.yml': `services:
  banco:
    image: postgres:16
    ports: ["5432:5432"]
`,
  [`${PACOTE}/feira/Feira.java`]: `package br.com.feirinhaverde.feira;

import java.time.LocalDate;
import java.util.List;

public class Feira {
    private Long id;
    private LocalDate data;
    private List<Banca> bancas;

    public List<Banca> getBancas() {
        return bancas;
    }
}
`,
  [`${PACOTE}/feira/FeiraController.java`]: `package br.com.feirinhaverde.feira;

@RestController
@RequestMapping("/feiras")
public class FeiraController {

    private final FeiraService feiraService;

    public FeiraController(FeiraService feiraService) {
        this.feiraService = feiraService;
    }

    @GetMapping("/abertas")
    public List<Feira> abertas() {
        return feiraService.listarAbertas();
    }
}
`,
  [`${PACOTE}/feira/FeiraRepository.java`]: `package br.com.feirinhaverde.feira;

public interface FeiraRepository extends JpaRepository<Feira, Long> {

    List<Feira> findByDataGreaterThanEqual(LocalDate data);
}
`,
  [`${PACOTE}/feira/FeiraService.java`]: `package br.com.feirinhaverde.feira;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class FeiraService {

    private static final int LIMITE_BANCAS = 120;

    private final FeiraRepository feiraRepository;
    private final BancaRepository bancaRepository;

    public FeiraService(FeiraRepository feiraRepository, BancaRepository bancaRepository) {
        this.feiraRepository = feiraRepository;
        this.bancaRepository = bancaRepository;
    }

    // Lista as feiras abertas a partir de hoje
    @Transactional(readOnly = true)
    public List<Feira> listarAbertas() {
        return feiraRepository.findByDataGreaterThanEqual(LocalDate.now());
    }

    @Transactional
    public Banca reservarBanca(Long feiraId, Long feiranteId) {
        Feira feira = feiraRepository.findById(feiraId)
            .orElseThrow(() -> new RegraNegocioException("Feira não encontrada"));

        if (feira.getBancas().size() >= LIMITE_BANCAS) {
            throw new RegraNegocioException("Feira lotada");
        }
        return bancaRepository.save(new Banca(feira, feiranteId));
    }
}
`,
  [`${PACOTE}/feira/dto/ReservaBancaRequest.java`]: `package br.com.feirinhaverde.feira.dto;

public record ReservaBancaRequest(Long feiraId, Long feiranteId) {
}
`,
  [`${PACOTE}/banca/Banca.java`]: `package br.com.feirinhaverde.banca;

public class Banca {
    private Long id;
    private Long feiranteId;

    public Banca(Feira feira, Long feiranteId) {
        this.feiranteId = feiranteId;
    }
}
`,
  [`${PACOTE}/reserva/ReservaController.java`]: `package br.com.feirinhaverde.reserva;

@RestController
@RequestMapping("/reservas")
public class ReservaController {

    private final FeiraService feiraService;

    public ReservaController(FeiraService feiraService) {
        this.feiraService = feiraService;
    }

    // Reserva uma banca para o feirante na feira escolhida.
    // Responde 409 se a feira estiver lotada.
    // O prazo de confirmação vem de reservas.prazo-horas.
    // Quem chama é o app do feirante.
    // ---
    // POST /reservas
    @PostMapping
    public Banca reservar(@RequestBody ReservaBancaRequest pedido) {
        return feiraService.reservarBanca(pedido.feiraId(), pedido.feiranteId());
    }
}
`,
  [`${PACOTE}/pagamento/PagamentoService.java`]: `package br.com.feirinhaverde.pagamento;

@Service
public class PagamentoService {

    public Banca reservarComPix(Long bancaId, Pix pix) {
        // gera a cobrança e segura a banca até o pagamento
        return null;
    }
}
`,
  'src/main/resources/application.yml': `spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/feirinha
reservas:
  prazo-horas: 24
`,
  'src/main/resources/db/migration/V12__reserva_banca.sql': `CREATE TABLE reserva_banca (
    id BIGSERIAL PRIMARY KEY,
    feira_id BIGINT NOT NULL,
    feirante_id BIGINT NOT NULL
);
`,
  'src/test/java/br/com/feirinhaverde/reserva/ReservaBancaTest.java': `package br.com.feirinhaverde.reserva;

class ReservaBancaTest {

    @Test
    void reservaQuandoHaVaga() {
        var banca = feiraService.reservarBanca(1L, 2L);
        assertNotNull(banca);
    }

    @Test
    void recusaFeiraLotada() {
        assertThrows(RegraNegocioException.class, () -> feiraService.reservarBanca(9L, 2L));
    }
}
`,
};

const absoluto = (rel: string) => `${RAIZ_EXEMPLO}/${rel}`;

const PERFIS_EXEMPLO: PerfilBanco[] = [
  { id: 'local', nome: 'Local', ambiente: 'local', tipo: 'postgres', host: 'localhost', porta: 5432, banco: 'feira_db', usuario: 'postgres', somenteLeitura: false, ssl: 'desligado', ssh: null },
  { id: 'homolog', nome: 'Homolog', ambiente: 'homolog', tipo: 'postgres', host: '10.0.0.12', porta: 5432, banco: 'feira_db', usuario: 'app', somenteLeitura: false, ssl: 'exigir', ssh: null },
  { id: 'producao', nome: 'Produção', ambiente: 'producao', tipo: 'postgres', host: 'localhost', porta: 5432, banco: 'feira_db', usuario: 'leitura', somenteLeitura: true, ssl: 'desligado', ssh: 'vps' },
];
const relativos = () => Object.keys(ARQUIVOS).sort();

export const exemplo = {
  lerPasta(caminho: string): Entrada[] {
    const prefixo = caminho === RAIZ_EXEMPLO ? '' : caminho.slice(RAIZ_EXEMPLO.length + 1) + '/';
    const vistos = new Map<string, boolean>();
    for (const rel of relativos()) {
      if (!rel.startsWith(prefixo)) continue;
      const resto = rel.slice(prefixo.length).split('/');
      vistos.set(resto[0], resto.length > 1 || vistos.get(resto[0]) === true);
    }
    return [...vistos.entries()]
      .map(([nome, pasta]) => ({ nome, pasta, caminho: absoluto(prefixo + nome) }))
      .sort((a, b) => Number(b.pasta) - Number(a.pasta) || a.nome.localeCompare(b.nome));
  },

  lerArquivo(caminho: string): string {
    return ARQUIVOS[caminho.slice(RAIZ_EXEMPLO.length + 1)] ?? '';
  },

  /** IA no modo navegador: uma resposta pronta (texto + proposta), no formato dos eventos SSE. */
  async iaMensagem(corpo: unknown, aoEvento: (dados: string) => void): Promise<void> {
    const msgs = (corpo as { messages: { content: { type: string }[] | string }[] }).messages;
    const ultimo = msgs[msgs.length - 1]?.content;
    const depoisDaFerramenta = Array.isArray(ultimo) && ultimo.some((b) => b.type === 'tool_result');
    const ev = (o: unknown) => aoEvento(JSON.stringify(o));
    const espera = () => new Promise((r) => setTimeout(r, 40));
    ev({ type: 'message_start', message: { model: 'exemplo', content: [] } });
    const texto = depoisDaFerramenta
      ? 'Pronto: a proposta está na coluna do resultado. Aplique com ⏎ ou peça outra.'
      : 'Os dois lados mudaram o mesmo trecho. Junto as duas intenções assim:';
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    for (const pedaco of texto.match(/.{1,12}/g) ?? []) {
      ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: pedaco } });
      await espera();
    }
    ev({ type: 'content_block_stop', index: 0 });
    if (!depoisDaFerramenta) {
      const entrada = JSON.stringify({ conflito: 1, codigo: '// resolvido pelo exemplo', explicacao: 'exemplo' });
      ev({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_exemplo', name: 'propor_resolucao', input: {} } });
      ev({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: entrada } });
      ev({ type: 'content_block_stop', index: 1 });
    }
    ev({ type: 'message_delta', delta: { stop_reason: depoisDaFerramenta ? 'end_turn' : 'tool_use' } });
    ev({ type: 'message_stop' });
  },

  // ---------- banco (modo navegador) ----------

  bancoPerfis(): PerfilBanco[] {
    return PERFIS_EXEMPLO;
  },

  bancoSalvar(p: PerfilBanco): void {
    const i = PERFIS_EXEMPLO.findIndex((x) => x.id === p.id);
    if (i >= 0) PERFIS_EXEMPLO[i] = p;
    else PERFIS_EXEMPLO.push(p);
  },

  bancoApagar(id: string): void {
    const i = PERFIS_EXEMPLO.findIndex((x) => x.id === id);
    if (i >= 0) PERFIS_EXEMPLO.splice(i, 1);
  },

  bancoConectar(id: string): InfoConexao {
    const p = PERFIS_EXEMPLO.find((x) => x.id === id);
    return {
      versao: 'PostgreSQL 17.2',
      tunel: p?.ssh ? { alvo: p.ssh, destino: `${p.host}:${p.porta}`, portaLocal: 54321, identidade: '~/.ssh/id_ed25519' } : null,
    };
  },

  async bancoConsultar(sql: string): Promise<ResultadoSql> {
    await new Promise((r) => setTimeout(r, 120));
    if (!/^\s*(--.*\n\s*)*(select|with)/i.test(sql)) return { colunas: [], linhas: [], cortado: false, afetadas: 1, ms: 12 };
    return {
      colunas: [
        { nome: 'nome', tipo: 'varchar' },
        { nome: 'data', tipo: 'date' },
        { nome: 'bancas', tipo: 'int8' },
      ],
      linhas: [
        ['Feira Central', '2026-11-07', '42'],
        ['Feira do Jockey', '2026-11-14', '37'],
        ['Feira Central', '2026-11-21', '18'],
        ['Feira do Jockey', '2026-11-28', '6'],
      ],
      cortado: false,
      afetadas: null,
      ms: 38,
    };
  },

  bancoCatalogo(): SchemaBanco[] {
    return [{ nome: 'public', tabelas: ['banca', 'feira', 'feirante', 'pagamento', 'reserva'], views: ['resumo'], funcoes: ['total_bancas'] }];
  },

  bancoColunas(): ColunaDeTabela[] {
    const c = (tabela: string, coluna: string, tipo: string) => ({ tabela, coluna, tipo });
    return [c('feira', 'id', 'integer'), c('feira', 'nome', 'character varying'), c('feira', 'data', 'date'), c('banca', 'id', 'integer'), c('banca', 'feira_id', 'integer')];
  },

  bancoConsole(id: string): string {
    const rel = 'reservas-mes.sql';
    if (!(rel in ARQUIVOS)) ARQUIVOS[rel] = `-- console ${id}\n`;
    return absoluto(rel);
  },

  gravarArquivo(caminho: string, conteudo: string): void {
    ARQUIVOS[caminho.slice(RAIZ_EXEMPLO.length + 1)] = conteudo;
  },

  /** Versão simplificada do índice que o Rust monta (`busca.rs`). */
  indexar(): Indice {
    const simbolos: Simbolo[] = [];
    for (const rel of relativos().filter((r) => r.endsWith('.java'))) {
      const conteudo = ARQUIVOS[rel];
      const pacote = /^\s*package\s+([\w.]+)\s*;/m.exec(conteudo)?.[1].split('.').pop() ?? '';
      let classe = '';
      conteudo.split('\n').forEach((linha, i) => {
        const tipo = /^\s*(?:\w+\s+)*(?:class|interface|enum|record)\s+(\w+)/.exec(linha);
        const metodo = /^\s+(?:(?:public|protected|private|static|final)\s+)*(?:[\w<>[\],.?]+\s+)?(\w+)\s*\(([^)]*)\)\s*\{/.exec(linha);
        const base = { caminho: absoluto(rel), linha: i + 1 };
        if (tipo) {
          classe = tipo[1];
          simbolos.push({ ...base, nome: tipo[1], tipo: 'classe', detalhe: '', conteiner: pacote });
        } else if (metodo && !['if', 'for', 'while', 'switch', 'catch'].includes(metodo[1])) {
          const detalhe = metodo[2]
            .split(',')
            .map((p) => p.trim().split(/\s+/).filter((w) => !w.startsWith('@')).slice(0, -1).join(' '))
            .filter(Boolean)
            .join(', ');
          simbolos.push({ ...base, nome: metodo[1], tipo: 'metodo', detalhe, conteiner: classe });
        }
      });
    }
    return { arquivos: relativos().map((rel) => ({ caminho: absoluto(rel), relativo: rel })), simbolos };
  },

  buscarTexto(consulta: string, limite: number, opcoes: OpcoesTexto): Ocorrencia[] {
    let expressao: RegExp;
    try {
      expressao = expressaoDeBusca(consulta, opcoes);
    } catch (e) {
      throw `expressão inválida: ${(e as Error).message}`;
    }
    const saida: Ocorrencia[] = [];
    for (const rel of relativos().filter((r) => passaNaMascara(opcoes.mascara, r))) {
      ARQUIVOS[rel].split('\n').forEach((linha, i) => {
        if (saida.length < limite && trechosEncontrados(expressao, linha).length) {
          saida.push({ caminho: absoluto(rel), relativo: rel, linha: i + 1, texto: linha.trim() });
        }
      });
    }
    return saida;
  },
};
