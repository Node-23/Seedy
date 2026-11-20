/**
 * Projeto de exemplo para o modo navegador (`npm start`), onde não há núcleo em Rust.
 * Serve para trabalhar no visual com dados parecidos com os dos mockups.
 * Nada aqui roda dentro do app.
 */
import type { Entrada, Indice, Ocorrencia, Simbolo } from './ponte';
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
