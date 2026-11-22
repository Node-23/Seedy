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

## ✅ Fase 5 — Servidores de aplicação: JBoss/WildFly **e** Tomcat

Um adaptador comum, com uma implementação para cada servidor:

| | JBoss / WildFly | Tomcat |
|---|---|---|
| iniciar | `standalone.sh/.bat` | `catalina.sh/.bat run` |
| deploy explodido | `deployments/` + marcadores `.dodeploy` | `webapps/` ou contexto apontando para a pasta |
| debug | `-agentlib:jdwp=...` via `JAVA_OPTS` | `catalina jpda run` / `JPDA_OPTS` |
| log | `standalone/log/server.log` | `logs/catalina.out` |

- ✅ Perfis por servidor (porta, JDK, memória, variáveis), iniciar/parar/redeploy; cada perfil
  numa pasta de servidor própria (`jboss.server.base.dir` / `CATALINA_BASE`)
- ✅ Deploy explodido montado pelo Seedy (pasta web + classes do jdtls + jars), sem Maven/Gradle
- ✅ Hot swap de JSP, estáticos e classes ao salvar (e de edições feitas fora do Seedy)
- ✅ Debug via java-debug (DAP): breakpoints, step, variáveis, avaliar expressão, hot code replace
- ✅ Console de log com filtro por nível, stack trace clicável e a exceção marcada no editor
- Testado com WildFly 42 e Tomcat 11 no Windows; falta testar no Linux e com JBoss EAP
- Depois: comando de build próprio (Ant/Maven) como alternativa ao deploy montado pelo Seedy

## ✅ Fase 6 — Web: JS / TS / HTML / CSS / Angular

Decisão: **na mesma IDE**, não numa "gêmea". O Monaco já traz JS/TS/HTML/CSS;
o resto entra como módulos internos (mockups 13 e 14):

- ✅ typescript-language-server e Angular Language Service via LSP (completar, hover, definição,
  usos, renomear, ações rápidas, erros de template); instalados com o npm na primeira vez
- ✅ ESLint (avisos no editor e correções nas ações rápidas) e Prettier (formatar e, com
  configuração no projeto, ao salvar)
- ✅ Scripts do `package.json` (`␣ p`) e no RUN/DEBUG; debug no navegador (Edge/Chrome via
  js-debug, breakpoints no .ts pelos source maps)
- Falta testar no Linux e num projeto Angular rodando `ng serve` (o Node daqui é antigo para o CLI)

## ✅ Fase 7 — IA

1. Claude Code no terminal integrado (já funciona hoje)
2. ✅ Servidor MCP do Seedy (HTTP em 127.0.0.1, com token): o Claude Code abre arquivos, busca,
   lê erros do jdtls, sobe/derruba o servidor, lê o log, faz requisições à aplicação e consulta
   bancos (só leitura); as mesmas ferramentas servem ao painel de IA do mockup 06 (`␣ a`)
3. ✅ Painel de revisão (`␣ y`): toda proposta vira diff para aceitar ou recusar (a IA recebe a
   decisão); edições feitas direto no disco num arquivo aberto ficam registradas, com desfazer
3b. ✅ A IA opera quase tudo: rodar, parar e depurar (breakpoints, passos, avaliar), testes e
   cobertura das regras, containers e compose, TODO, bookmarks, navegação pelo código, arquitetura e
   regras, Git e GitHub, jdtls e JDK, servidor de aplicação e container → banco. Aprovação do usuário
   nas ações que mexem em algo (o modo automático dispensa; push, apagar, PR e issue perguntam sempre)
3c. ✅ Mandar itens para o chat (mockup 25): `ctrl+shift+a` e botão direito, chips removíveis;
   `/historico` lista as aprovações; a conversa é guardada por projeto
4. ✅ Chat da IA no merge de conflitos (mockup 10, `␣ a`): Claude lê o código e o histórico,
   propõe a resolução como prévia no resultado e o usuário aplica ou recusa

## ✅ Fase 8 — Containers (Docker)

Mockups 15 e 16. Tudo pelo CLI do Docker (Docker Desktop no Windows, docker no Linux):

- ✅ Tela de containers (`␣ D`): lista por compose, mapa das conexões, detalhe e logs ao vivo;
  painel compacto embaixo do editor (`␣ h`)
- ✅ Conexões no mapa: redes Docker, `depends_on` do compose, tráfego TCP medido agora (lido de
  /proc/net/tcp dentro de cada container), dependência pela configuração (variável de ambiente
  que aponta para outro container, ex.: `DATABASE_URL=...@db:5432`) e portas publicadas no host
- ✅ Iniciar/parar/reiniciar, compose up/down, terminal dentro do container (`docker exec`) e
  "ligar ao banco" (Postgres/MySQL viram conexão no painel de banco, já preenchida)
- Falta testar no Linux; imagens sem `cat` (distroless) ficam sem tráfego medido

## ✅ Fase 9 — Entender o sistema

Mockups 17, 18 e 19, em tela cheia (`␣ A`) com três abas. Lê o código direto (sem compilar),
então funciona logo ao abrir o projeto e junta o front e o back no mesmo grafo:

- ✅ Arquitetura em blocos: domínios × camadas (telas e serviços do Angular, controllers/recursos
  JAX-RS/servlets e jobs, serviços/EJBs, repositórios/DAOs/clientes HTTP, tabelas e sistemas
  externos), com as injeções, o HTTP do front ligado ao endpoint pela URL e as chamadas entre domínios
- ✅ Regras de negócio: candidatas tiradas do código (exceções de negócio com a condição e o status
  HTTP, `if ... return` com status, Bean Validation e Validators do Angular, `@Scheduled`/`@Schedule`,
  `@PreAuthorize`/`@RolesAllowed`), com onde mais a mensagem aparece e o teste que cobre. Ficam em
  `.seedy/regras.md` (fica só nesta máquina, `.seedy/` é ignorado pelo git; edita à mão); a IA reescreve em linguagem de negócio
- ✅ Caminho do método (ctrl+. "acompanhar método", ou `c` num método): de onde vem até o botão da
  tela, para onde vai até a tabela, as condições que desviam (com o status e a regra) e o passo a
  passo; a IA explica o caminho
- ✅ Struts 1/2 e JSP: ações do struts-config.xml/struts.xml (e @Action), formulários e links das JSPs
  ligados às ações, forwards para as JSPs, desvios de volta ao formulário (errors.add, getInputForward),
  validation.xml e tabelas tiradas do SQL dos DAOs em JDBC
- ✅ Rotas do Angular: qual rota abre qual tela (children, loadComponent) e para onde cada tela vai
  (router.navigate, routerLink); o Caminho termina em "depois, a tela vai para…"
- Falta: a IA testada com a chave

## Depois

- ✅ TODO por cima das telas (mockup 20, `␣ T`): barra de ícones à esquerda, cards em
  `.seedy/todo.md` ligados a código, regras, caminhos, blocos, containers e bancos

- ✅ Layout editável (`␣ L`): arrastar a faixa de um painel para outra região, tamanho por
  painel e disposições salvas com nome no `seedy.json`
- ✅ Barra de ícones à esquerda com todos os botões que abrem janelas e painéis
- ✅ Watcher de arquivos: árvore, busca e jdtls se atualizam com mudanças feitas fora do
  editor (git checkout, build); buffers sem edição recarregam sozinhos
- ✅ Voltar/avançar nos arquivos vistos (alt+← / alt+→), com cursor e rolagem guardados por arquivo
- ✅ Configurações em arquivo (`seedy.json`, `␣ ,`): editor, shell do terminal, teclas do líder,
  modelo da IA e o layout; `.seedy/seedy.json` no projeto sobrepõe o global
- ✅ Botões RUN e DEBUG na barra de cima (mockup 11): rodam/depuram a classe `main` (pelo java-debug)
  ou o servidor de aplicação escolhido (`␣ r`), com a tela de debug em tela cheia (`␣ x`)
- ✅ Criar novo projeto (mockup 12, `␣ N`): Spring Boot (start.spring.io), Maven, WAR, Java simples e
  Angular (`ng new`); falta testar o Angular com um Node atual
- ✅ Argumentos do programa, variáveis de ambiente e opções da JVM por configuração de execução
  (␣ r → ⚙), em `.seedy/execucao.json`; o servidor usa as do perfil dele
