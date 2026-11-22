# Seedy

IDE Java minimalista, guiada pelo teclado, com o visual sob controle de quem usa.
Feita com **Tauri 2 + Angular + Monaco**, roda em **Windows e Linux**.

> Status: **v0.1 em andamento**. Editor com modo vim, árvore de arquivos, terminal,
> tema, buscas, inteligência de Java (jdtls), Git, banco de dados e servidores (JBoss/WildFly e
> Tomcat, com debug) já funcionam. Web (TS/Angular) e o resto da IA vêm nas próximas fases — ver
> [ROADMAP.md](ROADMAP.md).

## O que já tem

- **Editor Monaco com modo vim**: `:w`, `:q`, `:q!`, `:wq`, `:bn`, `:bp`, `:term`, números de linha relativos.
- **Destaque de sintaxe no estilo Alabaster**: só strings, constantes, comentários e definições ganham cor.
- **Árvore de arquivos** navegável pelo teclado (`j`/`k`, `l`/`Enter`, `h`).
- **Terminal integrado** com abas: shell de verdade (PowerShell no Windows, seu `$SHELL` no Linux).
- **Tema editável** (cores, fontes e forma), aplicado na hora em que você salva o arquivo.
- **Tecla líder** (`␣`) com menu de atalhos, como o which-key do nvim.
- **Três buscas**, como no IntelliJ:
  - `Ctrl+F` — **no arquivo aberto** (a caixa de busca do editor): `↓` / `⏎` / `F3` vão para o
    próximo, `↑` / `shift+⏎` / `shift+F3` para o anterior. Ao fechar (`esc`), o cursor fica no
    trecho encontrado, em modo normal.
  - `Ctrl+P` — **buscar arquivo**: janela com prévia do código e filtros Tudo, Classes, Arquivos,
    Símbolos, Texto e Ações (`tab` troca), contagem de usos e `^u` para procurar os usos.
  - `Ctrl+Shift+F` — **buscar no projeto**: opções `Aa` (maiúsculas), `W` (palavra inteira) e
    `.*` (regex) com `alt c` / `alt w` / `alt r`, máscara de arquivos (`*.java, !*Test.java`),
    resultados e prévia embaixo. Abre já com o texto selecionado no editor.
  - `Ctrl+Shift+R` — **substituir no projeto**: cada linha mostra o antes (riscado) e o depois,
    `alt+x` tira uma linha, `ctrl+⏎` substitui; com regex, `$1`, `$2`... valem.
  - Nas janelas: `↑↓` / `^n` `^p` navegam, `⏎` abre na linha, `^v` / `shift+⏎` abre ao lado,
    `esc` fecha (no `Ctrl+P`, colar é `ctrl+shift+v`).
- **Usos de verdade, também fora do Java**: `Alt+F7` e o rodapé do `Ctrl+P` juntam os usos do jdtls
  com XML, JSP e .properties (Struts/Tiles/Spring pelo nome completo da classe, EL `${feira.nome}`
  para `getNome()`).
- **Editor dividido** (`Ctrl+\`, `:vs`, `^v` nas buscas): dois painéis lado a lado, cada um com o
  seu vim; `Ctrl+W h/l` troca de painel, `Ctrl+W q` ou `:q` fecha o painel.
- **Inteligência de Java (jdtls)**: erros e avisos enquanto digita, completar (com import
  automático), documentação no hover, assinatura dos métodos, ir para definição e implementação,
  usos, renomear em vários arquivos, ações rápidas, extrair variável/método/campo (já abre o
  renomear no nome novo), organizar imports, formatar, Maven e Gradle. Código de bibliotecas e
  do JDK abre somente leitura (fonte anexado ou decompilado), e o `Ctrl+P` também acha essas
  classes. Código não usado ganha uma dica no fim da linha (`◆ import não usado`).
  `Alt+Insert` gera getters/setters, construtor, toString e equals/hashCode escolhendo os campos.
  Cada projeto compila contra o JDK da versão dele: o Seedy passa todos os JDKs instalados ao jdtls.
- **Árvore, busca e jdtls acompanham o disco**: arquivos criados, apagados ou alterados fora do
  editor (git, build, outro programa) aparecem sozinhos; buffer sem edição recarrega.
  Só as definições ganham cor (Alabaster), via tokens semânticos. O Seedy baixa o jdtls sozinho
  na primeira vez que abre um projeto Java; o status aparece na statusline (`jdtls ✓`).
- **Git**: tela do Git (`␣ g`) com branches, stash, log com o grafo das branches e detalhe do
  commit; commit (`Ctrl+K`) com prévia do diff, push, pull, merge, cherry-pick, reverter, blame
  (`␣ n`), marcas de mudança na margem e na árvore. Conflitos abrem no merge em 3 colunas com
  **resolver simples**, `dp`/`do` e `:w` para gravar e concluir.
- **Prateleira** (o *shelf* do IntelliJ): guarde mudanças com um nome (`␣ S`, ou `alt+s` no
  commit para escolher os arquivos) e devolva depois, inteiras ou arquivo a arquivo, em qualquer
  branch. Se o arquivo mudou nesse meio-tempo, o Seedy junta em três vias; conflitos abrem no
  merge em 3 colunas. Fica dentro da pasta `.git` (nunca vai num commit).
- **Pull request e issue** sem sair da IDE (`␣ P` / `␣ I`): o PR vai da branch atual (o Seedy
  faz o push antes, se faltar) para a base escolhida, com título e descrição sugeridos pelos commits.
- **Banco de dados** (mockup 03, `␣ d`): conexões PostgreSQL, MySQL/MariaDB e Oracle com perfis
  Local / Homolog / Produção (cor por ambiente; Produção nasce somente leitura e, liberada, pede
  confirmação antes de alterar). Senhas no cofre do sistema (Gerenciador de Credenciais do
  Windows, Secret Service no Linux). Túnel SSH com usuário e senha ou chave (cliente embutido) ou pelo `ssh` do sistema (usa `~/.ssh/config`,
  `known_hosts`, chaves e o ssh-agent). Árvore de schemas, tabelas, views, funções e colunas;
  console SQL por conexão ou qualquer `.sql` do projeto, com autocompletar (tabelas, colunas e
  apelidos); `Ctrl+Enter` executa a instrução sob o cursor; grade **somente leitura**, explain,
  exportar CSV (o resultado inteiro) e histórico por conexão.
- **Servidores de aplicação** (mockup 06, `␣ j`): JBoss/WildFly e Tomcat atrás do mesmo adaptador.
  O Seedy monta a aplicação explodida a partir do projeto, sem Maven/Gradle: a pasta web, as
  classes que o jdtls compila ao salvar e os jars das dependências (os da API do servidor ficam de
  fora). Cada perfil roda numa pasta de servidor própria (a instalação não é tocada). Enquanto roda,
  JSP, estáticos e classes alterados vão para o servidor sozinhos (hot swap). Saída com contadores
  de ERROR/WARN, filtro por nível, stack trace clicável (frames de framework recolhidos) e a linha
  da última exceção marcada no editor (`◆ NullPointerException`).
- **RUN e DEBUG** (mockup 11), como no IntelliJ: a barra de cima mostra a configuração de execução
  (`␣ r` troca) — uma classe com `main` (o jdtls acha todas) ou um servidor do projeto — e os botões
  ▶ (`shift+F10`), 🐞 (`shift+F9`) e ■ (`ctrl+F2`). A saída da `main` aparece no painel de baixo.
- **Debug em tela cheia** (mockup 11, `␣ x`; abre sozinho quando a execução para): pilha com as
  threads, breakpoints (com condição, silenciar e parar em exceções), o código na linha pausada com
  os valores das variáveis ao lado, variáveis, expressões vigiadas, avaliar (`alt+F8`), até o cursor
  (`alt+F9`) e o console do processo. Hot code replace: a classe alterada entra no processo sem
  reiniciar.
- **Projetos web** (Fase 6, mockup 13): TypeScript/JavaScript pelo typescript-language-server e
  templates Angular pelo Angular Language Service (completar, hover, ir à definição, usos,
  renomear, ações rápidas, erros de template); avisos do ESLint no editor; Prettier para formatar
  (e ao salvar, quando o projeto tem configuração dele). Os servidores são instalados com o npm na
  primeira vez (precisa do Node).
- **Scripts do package.json** (`␣ p`): rodar, parar, ver a saída com os arquivos clicáveis e abrir
  o endereço no navegador; os scripts também entram no RUN/DEBUG.
- **Debug no navegador** (mockup 14): o DEBUG de um script sobe o servidor de desenvolvimento,
  abre o Edge/Chrome com o js-debug e para nos breakpoints do `.ts` (source maps), na mesma tela
  de debug do Java, com o console do navegador embaixo.
- **Barra de ícones à esquerda**: arquivos, busca, git, TODO, terminal, servidor, scripts, banco,
  containers, debug, entender o sistema e IA (a barra de cima ficou com o projeto, os buffers e o
  RUN/DEBUG).
- **seedy.json** (`␣ ,`) e **layout editável** (`␣ L`, ou arrastar a faixa de um painel): ver a
  seção [seedy.json](#seedyjson).
- **TODO** (mockup 20, `␣ T` ou o botão na barra de ícones à esquerda): um painel por cima das
  telas com cards ligados a linhas de código, regras, caminhos, blocos da arquitetura, containers
  e conexões de banco. `l` liga ao card o que está aberto embaixo; a linha ligada ganha a marca
  "☐ TODO" no editor. Os cards ficam em `.seedy/todo.md` (vai para o git, dá para editar à mão).
- **Testes** (mockup 21, `␣ E` ou o frasco na barra de ícones): os testes do projeto lidos do código,
  por tipo (unitários, integração, API e e2e), rodados pelo Maven (surefire e failsafe) ou Gradle, com
  o resultado dos relatórios, a falha explicada (`a`, com a IA) e a saída do comando. Os do front
  (`.spec.ts`, Cypress, Playwright) aparecem na lista e rodam pelo painel de scripts. Cenários que
  conferem um erro levam ⚠.
- **Regras de negócio com cobertura** (mockups 22 e 23): cada regra mostra se tem teste, se ele falha e
  quais cenários estão cobertos: o caminho feliz e cada desvio que o código tem (`throw`, validação,
  4xx). `u` filtra as sem teste, `x` as falhando; o clique direito (ou `t`) abre ir para o teste,
  rodar, criar teste manualmente ou com a IA e sugerir cenários que faltam. "Testada" quer dizer que
  um teste passa pelo código da regra, lido do código; não é cobertura de linhas.
- **Uso da assinatura do Claude** (mockup 24): no modo assinatura, a barra de status mostra a janela de
  5 horas e a semana, lidas do Claude Code depois de cada resposta (clique para os detalhes).
- **Entender o sistema** (Fase 9, mockups 17 a 19, `␣ A`): a arquitetura do projeto em blocos
  (domínios × camadas, da tela do Angular até a tabela), as regras de negócio achadas no código
  (guardadas em `.seedy/regras.md`, reescritas pela IA) e o caminho de um método — `ctrl+.` →
  "acompanhar método" mostra de onde a chamada vem (até o botão da tela), para onde vai (até o
  banco) e onde ela pode ser barrada. Spring Boot, Java EE/Jakarta, Struts 1/2 com JSP e Angular
  (com as rotas: qual rota abre qual tela e para onde cada tela vai).
- **Configuração de execução** (`␣ r` → ⚙): argumentos do programa, variáveis de ambiente e opções
  da JVM da classe `main` ou do script escolhido, em `.seedy/execucao.json`.
- **Containers** (Fase 8, mockups 15 e 16): `␣ D` abre a tela do Docker com os containers do
  projeto e os outros, um mapa de quem fala com quem (rede, `depends_on`, tráfego TCP medido
  agora, variável de ambiente que aponta para outro container e portas no host), o detalhe e os
  logs ao vivo. Inicia/para/reinicia, compose up/down, abre um shell dentro do container no
  terminal integrado e transforma um Postgres/MySQL do Docker em conexão do painel de banco.
  `␣ h` mostra a versão compacta embaixo do editor.
- **Novo projeto** (mockup 12, `␣ N`): Spring Boot (com os iniciadores do start.spring.io), Java com
  Maven, Java web (WAR, pronto para o servidor do Seedy), Java simples e Angular (`ng new`). Escolhe
  o JDK entre os instalados, faz `git init` + primeiro commit, abre o projeto e deixa o RUN na `main`.
- **IA que opera a IDE** (Fase 7): as mesmas ferramentas servem ao painel de IA do Seedy
  (mockup 06, `␣ a`, pela API) e ao **Claude Code no terminal** pelo servidor MCP do Seedy
  (`␣ i` copia o comando `claude mcp add …` para registrar uma vez). A IA abre e lê código, busca
  no projeto, vê os erros do jdtls, sobe/derruba o servidor, lê o log, faz requisições à
  aplicação local e consulta os bancos (só leitura). Toda edição vira diff na **revisão**
  (`␣ y`): propostas esperam você aceitar ou recusar (a IA recebe a decisão); edições que o
  Claude Code faz direto no disco num arquivo aberto aparecem já aplicadas, com desfazer.
  A IA também **roda e depura** (`rodar`, `parar`, breakpoints, passos, avaliar), **roda os testes**
  e lê a cobertura das regras, mexe nos **containers** e no `docker compose`, usa o **TODO** e os
  **bookmarks**, navega pelo código (definição, usos, símbolos), lê a **arquitetura** e as
  **regras de negócio**, opera o **Git** e o **GitHub** (commit, push, branches, PR, issue), o
  **jdtls e o JDK**, edita o **servidor de aplicação** e liga um container ao **banco**. Rodar,
  testar, commitar e mexer em container pedem a sua aprovação (o modo automático, `␣ Y`, dispensa);
  push, apagar, `docker compose down`, PR e issue perguntam sempre. `/historico` no chat mostra o
  que foi pedido e decidido na sessão.
- **Mandar para o chat da IA** (mockup 25): `ctrl+shift+a` manda o que está em foco (container,
  regra, bloco da arquitetura, caminho, card do TODO, teste e a falha, conexão de banco, commit
  selecionado, estado do Git ou o trecho do código) e o botão direito faz o mesmo no item clicado.
  Viram chips removíveis no painel da IA e vão junto da próxima mensagem; `ctrl+shift+backspace`
  limpa. Na tela de testes, `i` manda todas as falhas. A conversa da IA é guardada por projeto e
  volta quando você reabre o projeto (`/clear` apaga).
- **IA no merge** (mockup 10): `␣ a` abre um chat ao lado das três colunas para conversar
  sobre os conflitos. A IA (Claude) lê o código relacionado e o histórico do arquivo e propõe a
  resolução, que aparece como prévia no resultado: `⏎` aplica, `esc` recusa, `ctrl+r` pede outra.
  Na primeira mensagem o Seedy pede a chave da API da Anthropic (fica no arquivo `ia.chave` da
  pasta de configuração, ou use `ANTHROPIC_API_KEY`); a chave nunca passa pela interface.
- **Conta do GitHub**: entre como no IntelliJ (pelo navegador, via Git Credential Manager, ou com
  um token) com `␣ G` ou pelo botão da tela do Git; clone os seus repositórios de lá. O token fica no
  núcleo e no cofre do sistema, nunca na interface.
- Painéis redimensionáveis (arraste os divisores) e modo foco.

## Pré-requisitos

| | Windows | Linux (Ubuntu/Debian) |
|---|---|---|
| Node.js 20+ | [nodejs.org](https://nodejs.org) | `sudo apt install nodejs npm` ou nvm |
| Rust (stable) | [rustup.rs](https://rustup.rs) | `curl https://sh.rustup.rs -sSf \| sh` |
| Bibliotecas do sistema | Visual Studio Build Tools (C++) e WebView2 (já vem no Windows 10/11) | `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev build-essential libssl-dev libdbus-1-dev pkg-config` |
| JDK 25+ (roda o jdtls) | [adoptium.net](https://adoptium.net) ou `winget install EclipseAdoptium.Temurin.25.JDK` | `sudo apt install openjdk-25-jdk` ou SDKMAN |

O JDK 25 é só para rodar o jdtls: o projeto continua compilando com a versão do `pom.xml` /
`build.gradle`. O Seedy procura o JDK em `SEEDY_JAVA_HOME`, `JAVA_HOME` e nas pastas de
instalação comuns (Adoptium, Oracle, Microsoft, Zulu, Corretto, `/usr/lib/jvm`, `~/.sdkman`, `~/.jdks`).

Para o **Oracle**, o Seedy usa o Oracle Instant Client (só quando há uma conexão Oracle):
baixe em https://www.oracle.com/database/technologies/instant-client/downloads.html e ponha a
pasta no `PATH` (Windows) ou em `LD_LIBRARY_PATH` (Linux). PostgreSQL e MySQL não precisam de nada.

Guia oficial do Tauri, se algo faltar: https://tauri.app/start/prerequisites/

## Rodando

```bash
npm install          # instala tudo (e prepara o monaco-vim em src/vendor)
npm run dev          # abre o Seedy em modo desenvolvimento (recarrega ao salvar)
npm run empacotar    # gera o instalador (.msi/.exe no Windows, .deb/.AppImage no Linux)
```

Para abrir já num projeto: `seedy /caminho/do/projeto` (ou `␣ o` dentro do app).

Só o visual, sem compilar o Rust: `npm start` e abra http://localhost:4200
(modo navegador, com arquivos e conexões de exemplo; o terminal não funciona aqui).

### Testes dos servidores

Também `#[ignore]`: sobem um Tomcat e um WildFly de verdade com um JSP, conferem a página, o hot
swap e o encerrar. Aponte para as instalações e um JDK 17+:

```bash
SEEDY_TESTE_TOMCAT=/opt/apache-tomcat-11.0.29 SEEDY_TESTE_WILDFLY=/opt/wildfly-42.0.0.Final \
SEEDY_TESTE_JDK=/usr/lib/jvm/java-21 cargo test --lib de_verdade -- --ignored
```

### Testes do banco

Os testes dos drivers contra bancos de verdade ficam marcados como `#[ignore]`. Com Docker:

```bash
docker run -d --name seedy-pg -e POSTGRES_PASSWORD=seedy -e POSTGRES_DB=feira_db -p 55432:5432 postgres:17
docker run -d --name seedy-mysql -e MYSQL_ROOT_PASSWORD=seedy -e MYSQL_DATABASE=feira_db -p 53306:3306 mysql:8.4
# crie as tabelas feira/banca (e no PostgreSQL a tabela grande) como em src-tauri/src/banco/mod.rs
cd src-tauri && cargo test --lib -- --include-ignored
```

## Atalhos

| Tecla | Ação |
|---|---|
| `␣` (modo normal / fora do editor) | menu do líder |
| `Ctrl+F` | buscar no arquivo aberto |
| `Ctrl+P` ou `␣ f` | buscar arquivo (`␣ ␣` abre a mesma janela em "Tudo"; `␣ s` em "Símbolos") |
| `Ctrl+Shift+F` ou `␣ /` | buscar no projeto |
| `Ctrl+Shift+R` ou `␣ R` | substituir no projeto |
| `Ctrl+\` ou `:vs` | dividir o editor (de novo: junta) |
| `Ctrl+W` `h` / `l` / `w` | painel da esquerda / da direita / o outro |
| `Ctrl+W` `q` ou `:q` | fechar o painel (`Ctrl+W o` ou `:only`: fica só este) |
| `␣ e` | mostrar/esconder arquivos |
| `␣ t` ou `Alt+F12` | mostrar/esconder terminal |
| `␣ o` | abrir projeto |
| `␣ N` | novo projeto: `j`/`k` modelo, `tab` campos, `espaço` marca, `/` filtra iniciadores, `ctrl+o` pasta, `ctrl+⏎` cria |
| `␣ w` ou `Ctrl+S` | salvar |
| `␣ q` | fechar buffer |
| `␣ c` | editar o tema |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | próximo / anterior buffer |
| `Alt+←` / `Alt+→` | voltar / avançar nos arquivos vistos (reabre o que foi fechado) |
| `Ctrl+Shift+S` ou `:wa` | salvar todos |
| `Ctrl+Space` | completar |
| `Ctrl+B`, `F12` ou `gd` | ir para definição |
| `Ctrl+Alt+B` ou `gi` | ir para implementação |
| `Alt+F7`, `Shift+F12` ou `gr` | usos |
| `K` (modo normal) | documentação (hover) |
| `Shift+F6` ou `F2` | renomear (em vários arquivos: depois `Ctrl+Shift+S`) |
| `Alt+Enter` | ações rápidas |
| `Ctrl+Alt+O` / `Ctrl+Alt+L` | organizar imports / formatar |
| `Ctrl+F12` | estrutura do arquivo |
| `Alt+Insert` | gerar: getters/setters, construtor, toString, equals/hashCode, sobrescrever métodos |
| `␣ l` | reiniciar o jdtls |
| `␣ v` | escolher o JDK que roda o jdtls |
| `␣ g` | tela do Git (de novo: volta ao editor) |
| `Ctrl+K` ou `␣ k` | commit (`ctrl+⏎` commita, `ctrl+alt+⏎` commita e faz push) |
| `Ctrl+Shift+K` / `Ctrl+T` | push / pull |
| `␣ b` | trocar de branch (ou criar uma) |
| `␣ n` | blame no arquivo aberto |
| `␣ m` | resolver conflitos (merge em 3 colunas) |
| `␣ a` | painel de IA (no merge: o chat do conflito); no campo, `⏎` envia ou aplica a proposta, `esc` recusa, `ctrl+l` nova conversa |
| `␣ y` | revisar as alterações da IA: `⏎` aceita/mantém, `d` recusa/desfaz, `D` diff completo |
| `ctrl+shift+a` | mandar para o chat da IA o que está em foco; `ctrl+shift+backspace` limpa os anexos |
| `␣ i` | copiar o comando que liga o Claude Code ao Seedy (MCP) |
| `␣ j` | painel do servidor: `i` inicia, `d` debug, `x` para, `r` redeploy, `o` abre no navegador, `e`/`w`/`a` filtro (erros, avisos, tudo), `⏎` num frame abre o código, `s` troca de servidor, `n` novo, `E` editar |
| `shift+F10` / `shift+F9` / `ctrl+F2` / `ctrl+F10` | rodar / depurar a configuração escolhida / parar / redeploy do servidor (como no IntelliJ) |
| `␣ D` · `␣ h` | containers (tela com o mapa · painel): `j`/`k`, `s` inicia/para, `R` reinicia, `l` logs, `t` terminal no container, `b` ligar ao banco, `u` compose up, `m` mapa (`h j k l` entre os nós, `+`/`−` zoom, `0` encaixa) |
| `␣ p` | scripts do package.json: `j`/`k`, `⏎` roda, `x` para, `o` abre no navegador, `d` debug, `i` npm install, `c` limpa |
| `␣ r` · `␣ x` | escolher o que o RUN/DEBUG roda · tela de debug (`p`/`b`/`v`/`c` focam pilha, breakpoints, variáveis e console; na lista de breakpoints `e` edita a condição e `d` apaga; `esc` volta) |
| `ctrl+F8` · `F8` · `F7` · `shift+F8` · `F9` · `alt+F9` · `alt+F8` | breakpoint · passar · entrar · sair · continuar · até o cursor · avaliar |
| `␣ d` | conexões (banco): `j`/`k`, `l`/`⏎` abre/conecta, `⏎` numa tabela consulta, `c` console, `n` nova, `e` editar, `x` desconectar, `r` recarregar, `del` apagar |
| `Ctrl+Enter` / `Ctrl+Shift+Enter` (num .sql) | executa a instrução sob o cursor (ou a seleção) / explain |
| grade do resultado | `j`/`k`/`h`/`l` andam, `y` copia a célula, `Y` copia a linha, `esc` volta ao editor |
| `␣ a` (no merge) | chat da IA: `⏎` envia (vazio: aplica a proposta), `esc` recusa, `ctrl+r` outra |
| `␣ G` | GitHub: conectar, clonar, criar PR ou issue, desconectar |
| `␣ P` / `␣ I` | criar pull request / issue (`ctrl+⏎` cria, `alt+b` troca a base, `alt+r` rascunho) |
| `␣ S` | guardar as mudanças na prateleira (no commit: `alt+s` com os arquivos marcados) |
| tela do Git, prateleira: `⏎`, `r`, `d` | devolver (escolhendo os arquivos), renomear, apagar |
| tela do Git: `h`/`l`, `j`/`k`, `⏎` | painéis, commits, diff; `c` checkout, `b` branch aqui, `p` cherry-pick, `r` reverter, `m` merge, `d` apagar, `/` filtrar |
| merge: `]c` / `[c`, `dp` / `do`, `:w` | próximo/anterior conflito, pegar o seu/o deles, gravar e concluir |

Os atalhos ficam em `src/app/teclado/atalhos.service.ts`.

## Avisos do compilador Java

Os avisos que o jdtls mostra (import, variável ou campo não usado...) vêm de
`jdtls.prefs`, na mesma pasta do tema (formato `.prefs` do Eclipse). O Seedy cria o
arquivo na primeira vez; depois de editar, reinicie o jdtls com `␣ l`.
Detalhe do compilador do Java: num arquivo com erro de compilação, "import não usado"
só aparece depois que o erro é corrigido.

## Tema

O tema é um arquivo JSON que você edita (no próprio Seedy: `␣ c`):

- **Linux:** `~/.config/seedy/tema.json`
- **Windows:** `%APPDATA%\seedy\tema.json`

Ao salvar, a IDE inteira muda na hora. Se o JSON tiver erro, o Seedy mantém o
tema anterior e avisa no rodapé. O que você apagar do arquivo volta ao padrão.

```jsonc
{
  "fontes": {
    "interface": { "familia": "Inky Mono", "arquivo": "fontes/InkyMono.otf", "tamanho": 13 },
    "codigo":    { "familia": "Inky Mono", "arquivo": "fontes/InkyMono.otf", "tamanho": 13, "alturaLinha": 20, "ligaduras": false },
    "reserva": "Martian Mono, ui-monospace, monospace"
  },
  "cores":   { "fundo": "#19191B", "painel": "#2A2A2D", "destaque": "#92A9E1", "...": "..." },
  "sintaxe": { "padrao": "#E9E2D3", "definicao": "#92A9E1", "string": "#B7D39C", "constante": "#E3A9CC", "comentario": "#E8C979" },
  "forma":   { "raio": 14, "raioPequeno": 9, "espessuraBorda": 2, "deslocamentoSombra": 4, "espaco": 12 },
  "terminal": { "ansi": ["16 cores: preto, vermelho, verde, amarelo, azul, magenta, ciano, branco e as versões claras"] }
}
```

**Fontes:** `arquivo` aceita `.ttf`, `.otf` ou `.woff2`. Caminho relativo é contado a
partir da pasta do tema (ex.: crie `~/.config/seedy/fontes/` e coloque a Inky Mono lá).
Sem arquivo, o Seedy usa a família instalada no sistema e, se não achar, a `reserva`
(a Martian Mono já vem embutida). Tema padrão: `src/app/tema/tema-padrao.json`.

O tema vira variáveis CSS (`--fundo`, `--destaque`, `--raio`...) usadas em
`src/styles.css`, e o tema do Monaco e do terminal é gerado a partir do mesmo arquivo.

## seedy.json

Configurações em arquivo, ao lado do `tema.json` (`%APPDATA%\seedy\seedy.json` no Windows,
`~/.config/seedy/seedy.json` no Linux). Abra com `␣ ,`; salvou, vale na hora. Um
`.seedy/seedy.json` no projeto sobrepõe o global (bom para o time combinar a tabulação, por
exemplo).

```json
{
  "editor": {
    "tabulacao": null,          // null = detecta pelo arquivo
    "espacos": true,
    "quebraDeLinha": false,
    "numerosRelativos": true,
    "minimapa": false,
    "formatarAoSalvar": true    // Prettier ao salvar, nos projetos que usam
  },
  "terminal": { "shell": null, "argumentos": [] },   // ex.: "C:\\Program Files\\Git\\bin\\bash.exe", ["--login"]
  "atalhos": { "lider": { "todo": "t" } },           // id da ação → tecla do líder
  "ia": { "modelo": "claude-opus-5-5" },
  "layout": { ... }                                  // gravado pelo Seedy (␣ L)
}
```

Ids das ações do líder: `buscar-tudo`, `buscar-arquivo`, `buscar-no-projeto`, `substituir`,
`simbolos`, `arquivos`, `terminal`, `abrir-projeto`, `novo-projeto`, `salvar`, `fechar-buffer`,
`tema`, `reiniciar-jdtls`, `jdk`, `execucao`, `debug`, `git`, `commit`, `branch`, `blame`,
`banco`, `servidor`, `scripts`, `containers-painel`, `containers`, `todo`, `entender`, `merge`,
`github`, `prateleira`, `pull-request`, `issue`, `ia`, `revisar-ia`, `layout`, `config`, `mcp`.
A ação que perde a tecla para outra fica sem atalho (continua na busca, `␣ ␣`).

### Layout

Cada painel (arquivos, terminal, servidor, scripts, containers, banco, IA) mora numa região:
à esquerda, embaixo ou à direita, um por região. Arraste a faixa de título de um painel para
outra região, ou use `␣ L` → mover. Os divisores mudam o tamanho (de cada painel). `␣ L` também
salva a disposição atual com um nome e troca entre as salvas; tudo fica no `seedy.json`.

## Estrutura

```
src/                         interface (Angular)
  app/nucleo/ponte.ts        única porta de entrada para o núcleo em Rust
  app/tema/                  tema padrão + serviço de tema
  app/editor/                Monaco, modo vim, buffers, tema do editor
  app/arquivos/              árvore de arquivos
  app/terminal/              terminal (xterm.js)
  app/barra/                 barra de cima, statusline, menu do líder
  app/busca/                 buscas: arquivo (Ctrl+P), projeto (Ctrl+Shift+F), prévia
  app/layout/                registro de painéis e disposição
  app/java/                  cliente LSP do jdtls: ciclo de vida, sincronia, provedores do Monaco, gerar código
  app/git/                   tela do Git, grafo, commit, diff, blame, merge em 3 colunas, GitHub
  app/servidor/              servidores: perfis, painel e log (stack clicável), depurador (DAP), breakpoints
  app/banco/                 conexões, formulário, grade de resultado, SQL (divisão, autocompletar)
  app/ia/                    IA: painel (mockup 06), ferramentas da IDE, MCP, revisão de alterações, chat do merge
  app/escolha/               janela de escolha (uma ou várias opções), usada por quem precisa perguntar
  app/teclado/               atalhos
  styles.css                 todo o visual (só usa as variáveis do tema)
src-tauri/                   núcleo (Rust)
  src/arquivos.rs            listar pastas, ler/gravar arquivos
  src/terminal.rs            PTY (ConPTY no Windows)
  src/tema.rs                tema.json, fontes e recarga ao vivo
  src/git.rs                 roda o git, conta do GitHub (credential manager e API)
  src/ia.rs                  chave da API da Anthropic e pedido com streaming (SSE)
  src/mcp.rs                 servidor MCP (HTTP local com token) que repassa as ferramentas à interface
  src/servidor/              servidores: adaptador WildFly/Tomcat, pasta de servidor por perfil, processo, deploy explodido e hot swap
  src/depurador.rs           plugin java-debug (baixado e conferido) e transporte DAP
  src/banco/                 perfis e cofre de senhas, drivers (postgres, mysql, oracle), túnel SSH, SQL
  src/busca.rs               índice de arquivos/símbolos Java e busca de texto
  src/java.rs                acha os JDKs, baixa e verifica o jdtls, processo e canal LSP
  src/observador.rs          observa a pasta do projeto (mudanças feitas fora do editor)
```

Sem plugins: cada funcionalidade é um módulo interno. Para mudar algo, muda o código.

## Licença

[PolyForm Noncommercial 1.0.0](LICENSE.md): uso, estudo e modificação livres para
fins **não comerciais**. Uso comercial não é permitido.
