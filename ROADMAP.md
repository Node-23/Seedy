# Roadmap do Seedy

Referência visual: mockups no canvas "IDE Java — mockups" (grafite + lavanda,
bordas grossas com sombra dura, Alabaster, tudo no teclado).

## ✅ Fase 0 — Fundação

- Tauri 2 + Angular + Monaco, Windows e Linux
- Tema editável (cores, fontes, forma) com recarga ao vivo
- Editor com modo vim, buffers, árvore de arquivos
- Terminal integrado com abas (PTY real)
- Tecla líder + menu de atalhos, statusline, painéis redimensionáveis

## ✅ Fase 1 — Inteligência de Java (jdtls)

- ✅ Baixar/gerenciar o jdtls (versão fixa 1.63.0, conferida por SHA-256; roda em JDK 25+)
- ✅ Ponte LSP no núcleo (stdio ↔ interface) e cliente LSP no Monaco
- ✅ Erros em tempo real, completar (com import automático e templates postfix no fim da lista),
  hover, assinatura, ir para definição/implementação, usos, renomear em vários arquivos,
  ações rápidas, organizar imports, formatar, estrutura do arquivo
- ✅ Destaque de definições via semantic tokens (Alabaster completo)
- ✅ Maven e Gradle (importação do jdtls; os arquivos do Eclipse ficam no cache, não no projeto)
- ✅ Abrir código de bibliotecas/JDK somente leitura (`jdt://`, com `java/classFileContents`),
  navegando de dentro dele também
- ✅ `Ctrl+P` com classes de bibliotecas/JDK (`workspace/symbol`) e usos de verdade
  (`textDocument/references`); os símbolos do projeto seguem vindo do índice (instantâneo)
- ✅ Extrair variável/campo/método já abrindo o renomear no nome gerado
- ✅ Dica inline de código não usado ("◆ import não usado"), avisos configuráveis em `jdtls.prefs`

- ✅ Gerar (alt+insert) getters/setters, construtor, toString, equals/hashCode e sobrescrever
  métodos, escolhendo os campos numa janela de escolha
- ✅ Escolher o JDK que roda o jdtls (␣ v) e usar todos os JDKs instalados como *runtimes*
  (cada projeto compila contra a versão dele: 8, 17, 21...)

## ✅ Fase 2 — Busca

- ✅ Buscar no arquivo aberto (`Ctrl+F`): a caixa de busca do Monaco, no visual do tema
- ✅ Buscar arquivo (`Ctrl+P`): a janela do mockup 02 (Search Everywhere), com classes,
  arquivos, símbolos, texto e ações
- ✅ Buscar no projeto (`Ctrl+Shift+F`), como o "Find in Files" do IntelliJ: maiúsculas,
  palavra inteira, regex e máscara de arquivos (crates `ignore` + `regex`, respeita `.gitignore`)
- ✅ Substituir no projeto (`Ctrl+Shift+R`): antes/depois de cada linha, tirar linhas
  (`alt+x`), grupos de regex (`$1`); buffers abertos podem ser desfeitos (`u`)
- ✅ Referência das telas de busca e do editor dividido em `docs/design/` (07 a 09)
- ✅ Símbolos: os do projeto vêm do índice (instantâneo, com métodos); os de bibliotecas e
  do JDK, do jdtls (`workspace/symbol`)
- ✅ Usos híbridos: semânticos (jdtls) + textuais em XML/JSP/.properties (Struts, Tiles,
  Spring XML pelo nome completo da classe; EL `${obj.prop}` para getters), no `Ctrl+P` e no `Alt+F7`
- ✅ Dividir (`^v` / `shift+⏎`): abre o resultado ao lado — o editor ganhou divisão vertical
  (`Ctrl+\`, `:vs`, `Ctrl+W h/l/w/q/o`, `:q` fecha o painel)

## ✅ Fase 3 — Banco de dados

- ✅ Conexões PostgreSQL, MySQL e Oracle, com perfis (Local / Homolog / Produção); senhas no
  cofre do sistema
- ✅ Cor por ambiente; Produção somente leitura por padrão (o próprio banco recusa a escrita), e
  liberada pede confirmação antes de alterar
- ✅ Túnel SSH por conexão, pelo `ssh` do sistema (`~/.ssh/config`, `known_hosts`, ssh-agent)
- ✅ Árvore de schemas, tabelas, views, funções e colunas; editor SQL com autocomplete
  (tabelas, colunas, apelidos); `Ctrl+Enter` executa a instrução sob o cursor; explain
- ✅ Grade de resultados **somente leitura** (alterações só por SQL), exportar CSV, histórico
- Oracle: driver Rust com o Instant Client (implementado, ainda sem teste contra um Oracle de
  verdade); se der problema, sidecar Java (JDBC)
- Depois: cancelar consulta em andamento, editar dados na grade gerando o SQL para revisar

## ✅ Fase 4 — Git

- ✅ Tela do Git (mockup 04, `␣ g`): branches locais/remotas, tags e stash; log com o grafo das
  branches, filtro e "todas as branches"; detalhe do commit com arquivos e diff
- ✅ Commit (`Ctrl+K`): escolher arquivos, prévia do diff, emendar, commit e push, descartar
- ✅ Push (`Ctrl+Shift+K`), pull (`Ctrl+T`), trocar/criar/apagar branch (`␣ b`), merge,
  cherry-pick, reverter, stash (guardar/aplicar/apagar), blame (`␣ n`)
- ✅ Marcas de mudança na margem do editor e letra do Git na árvore
- ✅ Diff em tela cheia (editor de diff do Monaco, `]c`/`[c` entre mudanças)
- ✅ Merge de conflitos em 3 colunas (mockup 05), com **resolver simples** (diff3: aplica o que
  só um lado mudou, junta imports, ignora diferença só de espaço); `dp`/`do`, `:w` grava,
  marca como resolvido e conclui o merge
- ✅ Conta do GitHub como no IntelliJ: entrar pelo navegador (Git Credential Manager) ou com
  token; clonar os seus repositórios. O token fica no núcleo e no cofre do sistema
- ✅ Prateleira (shelf do IntelliJ): guardar mudanças com nome, devolver em partes, juntar em
  três vias com conflitos no merge de 3 colunas
- ✅ Criar pull request e issue direto da IDE (`␣ P` / `␣ I`), com push antes se faltar
- Sugestão de resolução por IA (fica para a fase de IA)

## Fase 5 — Servidores de aplicação: JBoss/WildFly **e** Tomcat

Um adaptador comum, com uma implementação para cada servidor:

| | JBoss / WildFly | Tomcat |
|---|---|---|
| iniciar | `standalone.sh/.bat` | `catalina.sh/.bat run` |
| deploy explodido | `deployments/` + marcadores `.dodeploy` | `webapps/` ou contexto apontando para a pasta |
| debug | `-agentlib:jdwp=...` via `JAVA_OPTS` | `catalina jpda run` / `JPDA_OPTS` |
| log | `standalone/log/server.log` | `logs/catalina.out` |

- Perfis por servidor (porta, memória, variáveis), iniciar/parar/redeploy
- Hot swap de JSP e recursos estáticos ao salvar
- Debug via java-debug (DAP): breakpoints, step, avaliar expressão
- Console de log com filtro por nível e stack trace clicável

## Fase 6 — Web: JS / TS / HTML / CSS / Angular

Decisão: **na mesma IDE**, não numa "gêmea". O Monaco já traz JS/TS/HTML/CSS;
o resto entra como módulos internos:

- typescript-language-server e Angular Language Service via LSP
- ESLint/Prettier, rodar scripts do `package.json`, debug no navegador (CDP)

## Fase 7 — IA

1. Claude Code no terminal integrado (já funciona hoje)
2. Servidor MCP do Seedy: a IA opera a IDE — abrir arquivo, ler erros do jdtls,
   rodar build, subir/derrubar servidor, ler log, consultar banco (só leitura)
3. Painel de revisão: toda alteração vira diff para aceitar ou recusar
4. ✅ Chat da IA no merge de conflitos (mockup 10, `␣ a`): Claude lê o código e o histórico,
   propõe a resolução como prévia no resultado e o usuário aplica ou recusa

## Fase 8 — Painel de containers

_A detalhar._

## Fase 9 — Painel de arquitetura

_A detalhar._

- Observação: incluir um painel de caminho da função

## Depois

- Layout editável (arrastar painéis, salvar disposições) — a base já existe em
  `src/app/layout/layout.service.ts`
- ✅ Watcher de arquivos: árvore, busca e jdtls se atualizam com mudanças feitas fora do
  editor (git checkout, build); buffers sem edição recarregam sozinhos
- ✅ Voltar/avançar nos arquivos vistos (alt+← / alt+→), com cursor e rolagem guardados por arquivo
- Configurações em arquivo (`seedy.json`): atalhos, shell do terminal, etc.
