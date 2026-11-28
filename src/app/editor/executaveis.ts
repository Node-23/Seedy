/** O que dá para rodar num arquivo Java: classes de teste, métodos de teste e `main`. */
export interface Executavel {
  linha: number;
  tipo: 'classe' | 'teste' | 'main';
  /** Classe como o Maven e o Gradle a filtram ("FairServiceTest", ou "Externa$Interna"). */
  classe: string;
  /** Pacote + classe, para casar com a classe `main` que o jdtls acha. */
  completa: string;
  metodo: string | null;
}

const ANOTACAO_DE_TESTE = /@(?:org\.junit\.(?:jupiter\.(?:api|params)\.)?)?(Test|ParameterizedTest|RepeatedTest|TestFactory|TestTemplate)\b/;
const MAIN = /\bstatic\b[^(=;]*\bvoid\s+main\s*\(\s*(?:final\s+)?(?:String|\))/;

/** Um nome em Java, com acentos (`naoReservaEmFeiraLotação`). */
const NOME = String.raw`[\p{L}_$][\p{L}\p{N}_$]*`;
const DECLARACAO = new RegExp(String.raw`(?:^|\s)(?:class|record|enum|interface)\s+(${NOME})`, 'u');
const CHAMADA = new RegExp(String.raw`(${NOME})\s*\(`, 'u');

/** Lê o código por linhas, sem compilar: basta para pôr o ▶ no lugar certo. */
export function acharExecutaveis(linhas: string[]): Executavel[] {
  const saida: Executavel[] = [];
  const classes: { nome: string; nivel: number; linha: number }[] = [];
  let pacote = '';
  let nivel = 0;
  let comentario = false;
  let esperandoMetodo = false;
  let classePendente: { nome: string; linha: number } | null = null;

  linhas.forEach((original, i) => {
    // Tira comentários e o conteúdo das strings, para as chaves contarem certo.
    let texto = '';
    for (let c = 0; c < original.length; c++) {
      if (comentario) {
        if (original.startsWith('*/', c)) {
          comentario = false;
          c++;
        }
        continue;
      }
      if (original.startsWith('//', c)) break;
      if (original.startsWith('/*', c)) {
        comentario = true;
        c++;
        continue;
      }
      const aspas = original[c];
      if (aspas === '"' || aspas === "'") {
        c++;
        while (c < original.length && original[c] !== aspas) c += original[c] === '\\' ? 2 : 1;
        texto += aspas + aspas;
        continue;
      }
      texto += original[c];
    }

    pacote = /^\s*package\s+([\w.]+)/.exec(texto)?.[1] ?? pacote;
    const declaracao = DECLARACAO.exec(texto);
    if (declaracao) classePendente = { nome: declaracao[1], linha: i + 1 };

    const nomeDaClasse = () => classes.map((c) => c.nome).join('$');
    const completa = () => [pacote, nomeDaClasse()].filter(Boolean).join('.');

    if (ANOTACAO_DE_TESTE.test(texto)) esperandoMetodo = true;
    if (esperandoMetodo && classes.length) {
      const semAnotacoes = texto.replace(/@[\w.]+(\((?:[^()]|\([^()]*\))*\))?/g, ' ');
      const metodo = CHAMADA.exec(semAnotacoes)?.[1];
      if (metodo && !/^\s*[,"{})]/.test(semAnotacoes)) {
        saida.push({ linha: i + 1, tipo: 'teste', classe: nomeDaClasse(), completa: completa(), metodo });
        const dona = classes[classes.length - 1];
        if (!saida.some((x) => x.tipo === 'classe' && x.linha === dona.linha)) {
          saida.push({ linha: dona.linha, tipo: 'classe', classe: nomeDaClasse(), completa: completa(), metodo: null });
        }
        esperandoMetodo = false;
      }
    }
    if (MAIN.test(texto) && classes.length) saida.push({ linha: i + 1, tipo: 'main', classe: nomeDaClasse(), completa: completa(), metodo: 'main' });

    for (const c of texto) {
      if (c === '{') {
        nivel++;
        if (classePendente) {
          classes.push({ ...classePendente, nivel });
          classePendente = null;
        }
      } else if (c === '}') {
        if (classes.length && classes[classes.length - 1].nivel === nivel) classes.pop();
        nivel--;
      }
    }
  });
  return saida.sort((a, b) => a.linha - b.linha);
}

/** O que o Ctrl+Shift+F10 roda: o método (ou a classe) em que o cursor está, ou o mais perto acima. */
export function executavelEm(lista: Executavel[], linha: number): Executavel | null {
  return [...lista].reverse().find((x) => x.linha <= linha) ?? lista[0] ?? null;
}
