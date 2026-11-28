# Guia do Seedy

Referência completa: o que cada tela faz, os atalhos e os arquivos de configuração.
Para conhecer o projeto e instalar, comece pelo [README](../README.md).

## Funcionalidades

- **Completar enquanto digita** (opcional, pergunta na primeira abertura): texto fantasma no modo de inserção.
  `Tab` aceita, `Ctrl+→` uma palavra, `esc` descarta (e sai da inserção), `Alt+\` pede na hora,
  `Alt+Shift+C` liga e desliga. **Local**: o Seedy baixa uma vez o llama.cpp e o Qwen2.5-Coder 1.5B (~1 GB),
  confere o SHA-256 e roda tudo em `127.0.0.1`; funciona sem internet e sai com `r` em `Ctrl+,` aba IA.
  **API**: Claude Haiku, paga por uso, com a chave da API. No `seedy.json` global: `ia.completar`
  (`"desligado"`, `"local"`, `"api"`), `ia.completarSozinho` e `ia.completarLinhas`. O `.seedy/seedy.json`
  de um projeto não muda isso.
- **Editor Monaco com modo vim**: `:w`, `:q`, `:q!`, `:wq`, `:bn`, `:bp`, `:term`, números de linha relativos.
- **Destaque de sintaxe no estilo Alabaster**: só strings, constantes, comentários e definições ganham cor.
- **Markdown ao vivo:** um `.md` aparece formatado no próprio editor (títulos, negrito, listas, caixas de
  tarefa, código, citações, links e tabelas); a linha do cursor mostra os símbolos. `Alt+Shift+R` (ou
  `ao vivo | fonte` no topo) alterna para o texto puro.
- **Arquivos recentes** (`Ctrl+E`): os últimos vistos no projeto, com filtro; `2` a `9` abrem direto, `^v` abre
  ao lado, `del` tira da lista. No Vim, a rolagem fica com `Ctrl+D`.
- **Problemas** (`Alt+3` ou o contador na barra de status): erros e avisos do projeto por arquivo; `⏎` vai até a
  linha, `.` abre as ações rápidas. `F8` / `Shift+F8` vão ao próximo e ao anterior (no debug pausado, continuam
  passando e saindo). Os da web aparecem para os arquivos já abertos.
- **Rodar pela margem:** `▶` em cada teste e `main` de um arquivo Java (`▶▶` na classe de teste, vermelho se
  falhou no último run). `Ctrl+Shift+F10` roda e `Ctrl+Shift+F9` depura o que está sob o cursor.
- **Árvore de arquivos** navegável pelo teclado (`j`/`k`, `l`/`Enter`, `h`). Botão direito (ou a tecla de menu)
  abre **Novo**, copiar, colar, renomear, apagar e abrir no explorador de arquivos. `n` ou `Alt+Insert` criam: classe Java (com o
  `package` da pasta), arquivo com o nome que quiser (`/` cria pastas), pasta, TypeScript, componente React
  ou Angular, HTML, CSS, JSON, YAML, XML, SQL e Markdown. `Ctrl+C` / `Ctrl+V` copiam e colam; colando sobre um
  nome que já existe, o Seedy pede outro, e uma classe Java colada leva o nome e o pacote novos. Nada é sobrescrito.
  Num repositório Git, o nome ganha cor como no IntelliJ: verde para o que foi adicionado, vermelho para o novo
  que ainda está fora do Git, azul para o modificado, e apagado para o que o `.gitignore` deixa de fora. `F2` ou `Shift+F6` renomeiam (numa
  classe Java o jdtls atualiza as referências) e `del` manda para a Lixeira, depois de confirmar. O menu também copia o caminho (e o nome completo da classe),
  o `+` no topo do painel cria, `Alt+F1` (ou `◎`) mostra na árvore o arquivo aberto, e pacotes que só têm outro
  pacote aparecem numa linha só (`br/com/mana`).
- **Terminal integrado** com abas: shell de verdade (PowerShell no Windows, seu `$SHELL` no Linux).
- **Tema editável** (cores, fontes e forma), aplicado na hora em que você salva o arquivo.
- **Atalhos diretos**, um acorde só como no IntelliJ (`Alt+9` Git, `Alt+5` debug, `Alt+Shift+T` testes...), trocáveis em `Ctrl+,` ou no `seedy.json`; o menu de atalhos (`Ctrl+Shift+Espaço` ou o botão da logo) lista todos.
- **Abertura e tela de início**: sem projeto aberto, a janela fica do tamanho do cartão de início e volta ao tamanho de trabalho quando um projeto abre; janela de carregamento enquanto o projeto abre; sem projeto aberto, a tela de início cria (`n`), abre (`o`) ou clona (`c`, do GitHub ou por endereço git) e lista os recentes (`1` a `9` abrem direto, o mais recente vem marcado como "continuar", `/` busca, `del` tira da lista). O Seedy abre nessa tela; para pular direto para o último projeto, ligue "abrir o último projeto ao iniciar" em `Ctrl+,`, aba 3 (`inicio.abrirUltimoProjeto` no `seedy.json`).
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
- **Git**: tela do Git (`Alt+9`) com branches, stash, log com o grafo das branches e detalhe do
  commit; commit (`Ctrl+K`) com prévia do diff, push, pull, merge, cherry-pick, reverter, blame
  (`Alt+Shift+K`), marcas de mudança na margem e na árvore. Conflitos abrem no merge em 3 colunas com
  **resolver simples**, `dp`/`do` e `:w` para gravar e concluir.
- **Prateleira** (o *shelf* do IntelliJ): guarde mudanças com um nome (`Alt+Shift+S`, ou `alt+s` no
  commit para escolher os arquivos) e devolva depois, inteiras ou arquivo a arquivo, em qualquer
  branch. Se o arquivo mudou nesse meio-tempo, o Seedy junta em três vias; conflitos abrem no
  merge em 3 colunas. Fica dentro da pasta `.git` (nunca vai num commit).
- **Pull request e issue** sem sair da IDE (`Alt+Shift+P` / `Alt+Shift+Q`): o PR vai da branch atual (o Seedy
  faz o push antes, se faltar) para a base escolhida, com título e descrição sugeridos pelos commits.
- **Banco de dados** (`Alt+Shift+D`): conexões PostgreSQL, MySQL/MariaDB e Oracle com perfis
  Local / Homolog / Produção (cor por ambiente; Produção nasce somente leitura e, liberada, pede
  confirmação antes de alterar). Senhas no cofre do sistema (Gerenciador de Credenciais do
  Windows, Secret Service no Linux). Túnel SSH com usuário e senha ou chave (cliente embutido) ou pelo `ssh` do sistema (usa `~/.ssh/config`,
  `known_hosts`, chaves e o ssh-agent). Árvore de schemas, tabelas, views, funções e colunas;
  console SQL por conexão ou qualquer `.sql` do projeto, com autocompletar (tabelas, colunas e
  apelidos); `Ctrl+Enter` executa a instrução sob o cursor; grade **somente leitura**, explain,
  exportar CSV (o resultado inteiro) e histórico por conexão.
- **Servidores de aplicação** (`Alt+4`): JBoss/WildFly e Tomcat atrás do mesmo adaptador.
  O Seedy monta a aplicação explodida a partir do projeto, sem Maven/Gradle: a pasta web, as
  classes que o jdtls compila ao salvar e os jars das dependências (os da API do servidor ficam de
  fora). Cada perfil roda numa pasta de servidor própria (a instalação não é tocada). Enquanto roda,
  JSP, estáticos e classes alterados vão para o servidor sozinhos (hot swap). Saída com contadores
  de ERROR/WARN, filtro por nível, stack trace clicável (frames de framework recolhidos) e a linha
  da última exceção marcada no editor (`◆ NullPointerException`).
- **RUN e DEBUG**, como no IntelliJ: a barra de cima mostra a configuração de execução
  (`Alt+Shift+F10` troca) — uma classe com `main` (o jdtls acha todas) ou um servidor do projeto — e os botões
  ▶ (`shift+F10`), 🐞 (`shift+F9`) e ■ (`ctrl+F2`). A saída da `main` aparece no painel de baixo.
- **Debug em tela cheia** (`Alt+5`; abre sozinho quando a execução para): pilha com as
  threads, breakpoints (com condição, silenciar e parar em exceções), o código na linha pausada com
  os valores das variáveis ao lado, variáveis, expressões vigiadas, avaliar (`alt+F8`), até o cursor
  (`alt+F9`) e o console do processo. Hot code replace: a classe alterada entra no processo sem
  reiniciar.
- **Projetos web** : TypeScript/JavaScript pelo typescript-language-server e
  templates Angular pelo Angular Language Service (completar, hover, ir à definição, usos,
  renomear, ações rápidas, erros de template); avisos do ESLint no editor; Prettier para formatar
  (e ao salvar, quando o projeto tem configuração dele). Os servidores são instalados com o npm na
  primeira vez (precisa do Node).
- **Scripts do package.json** (`Alt+Shift+J`): rodar, parar, ver a saída com os arquivos clicáveis e abrir
  o endereço no navegador; os scripts também entram no RUN/DEBUG.
- **Debug no navegador**: o DEBUG de um script sobe o servidor de desenvolvimento,
  abre o Edge/Chrome com o js-debug e para nos breakpoints do `.ts` (source maps), na mesma tela
  de debug do Java, com o console do navegador embaixo.
- **Barra de ícones à esquerda**: arquivos, busca, git, TODO, terminal, servidor, scripts, banco,
  containers, debug, entender o sistema e IA (a barra de cima ficou com o projeto, os buffers e o
  RUN/DEBUG).
- **Avisos e erros** em toasts, com o sino (`Alt+Shift+H`) guardando o que passou; clicar mostra o texto
  inteiro. Falha do próprio Seedy pode ser enviada para análise (Sentry) com um clique: você vê o texto
  antes, vai sem código nem senhas, e nada é enviado sozinho. Se o erro derrubar o
  Seedy, o aviso aparece na próxima abertura.
- **seedy.json** (`Ctrl+,`) e **layout editável** (`Alt+Shift+L`, ou arrastar a faixa de um painel): ver a
  seção [seedy.json](#seedyjson).
- **TODO** (`Alt+6` ou o botão na barra de ícones à esquerda): um painel por cima das
  telas com cards ligados a linhas de código, regras, caminhos, blocos da arquitetura, containers
  e conexões de banco. `l` liga ao card o que está aberto embaixo; a linha ligada ganha a marca
  "☐ TODO" no editor. Os cards ficam em `.seedy/todo.md` (vai para o git, dá para editar à mão).
- **Testes** (`Alt+Shift+T` ou o frasco na barra de ícones): os testes do projeto lidos do código,
  por tipo (unitários, integração, API e e2e), rodados pelo Maven (surefire e failsafe) ou Gradle, com
  o resultado dos relatórios, a falha explicada (`a`, com a IA) e a saída do comando. Os do front
  (`.spec.ts`, Cypress, Playwright) aparecem na lista e rodam pelo painel de scripts. Cenários que
  conferem um erro levam ⚠.
- **Nada fica rodando depois de fechar o Seedy**: no Windows ele entra num job que encerra todos os descendentes (jdtls, a classe
  main do RUN/DEBUG, servidores, scripts, terminais, Claude Code) quando o processo termina, até se cair; no Linux e no macOS
  ele encerra a árvore de filhos ao sair. O navegador aberto por um link e o instalador da atualização continuam vivos.
  Containers do Docker não são mexidos.
- **Vim** (`Alt+Shift+V`, `:h` ou clicar no modo "NORMAL" da barra de status): janela com a configuração do editor que vale hoje (números relativos, tabulação, minimapa...), o que o Seedy liga no Vim (`gd`, `gr`, `gi`, `K`, `:w`, `:q`, `:vs`, `ctrl+w`...) e o essencial do Vim por grupo (mover, editar, visual, buscar, marcas e macros). O botão da logo (menu do líder) abre e fecha.
- **Perfis do Spring** (`Alt+Shift+F10` → ⚙ da classe main, só em projeto Spring Boot): o Seedy acha os `application-<perfil>.yml|properties`
  e você marca os que quer. Vira `-Dspring.profiles.active=dev,local` no RUN e no DEBUG (se o `.env` já define
  `SPRING_PROFILES_ACTIVE`, a escolha troca o valor dele; a JVM ou as variáveis da configuração têm a palavra final). A porta
  mostrada na tela de endpoints segue o `SERVER_PORT` do `.env`, o perfil escolhido e o `application`.
- **Commit** (Ctrl+K): lista de arquivos com marca, mensagem e o diff do arquivo selecionado (as linhas longas quebram). Com a IA conectada (chave ou Claude Code), o botão ✦ gerar com a IA (alt+g) escreve a mensagem lendo o diff dos arquivos marcados e o estilo dos últimos commits; um rascunho seu vira ponto de partida.
- **Atualização do Seedy** (`Alt+Shift+U`): ao abrir e a cada 6 horas ele olha a última release do GitHub e, havendo versão
  nova, mostra "⬆ x.y.z disponível" na barra de status; nada baixa sozinho. O quadro mostra as notas; "instalar e
  reiniciar" baixa o instalador, confere o tamanho e o SHA-256 do `SHA256SUMS.txt` da release (sem ele o Seedy não
  instala), fecha, instala em silêncio e abre de novo no mesmo projeto. Vale para o instalador do Windows e para o
  AppImage do Linux; o portátil e os pacotes `.deb`/`.rpm` só abrem a página da release. Desliga com `atualizacao.verificar: false` no `seedy.json`.
- **Bookmarks com nome** (`Ctrl+F2` na linha, ou o botão direito na margem): ao marcar, o Seedy pergunta o nome (já vem uma sugestão com o método da linha; `esc` cancela). `Alt+2` lista pelo nome, com o arquivo e a linha ao lado; o nome acompanha a linha quando o código muda acima dela. Ficam em `.seedy/bookmarks.json` (marcas antigas, sem nome, aparecem pelo texto da linha).
- **Login nos endpoints** (tela de endpoints, `L`): em endpoint protegido (🔒) o Seedy pede o usuário e a senha uma vez por sessão, faz o login no endpoint de login do projeto (`POST /login`, `/auth/login`...) e guarda os cookies (ou o token do corpo) só na memória; as chamadas seguintes já vão com a sessão. Se vier 401, renova pelo refresh ou pede o login de novo e repete a chamada. `L` sai da sessão. Um `Cookie` ou `Authorization` escrito no pedido tem prioridade.
- **A IA em todas as telas**: o painel da IA acompanha o Git, os testes, o debug, os containers, a arquitetura e as demais telas cheias, do lado direito (arraste o divisor para mudar a largura); o que você escreveu no campo fica ao trocar de tela.
- **Editar uma mensagem enviada**: o ✎ no balão (ou `↑` com o campo vazio) traz o texto de volta ao campo; ao reenviar, a conversa volta àquele ponto (o que já mudou nos arquivos continua). `esc` cancela.
- **Imagem no chat da IA** (`ctrl+v` no campo, o botão 🖼 ou arrastar um arquivo): PNG, JPEG, GIF ou WebP até 5 MB, até
  4 por mensagem. O chip mostra a miniatura; imagens grandes são reduzidas a 1568 px antes de seguir. Vale para a
  chave da API e para o modo assinatura (Claude Code). A conversa guardada em `.seedy/conversa.json` fica só com as
  miniaturas, nunca com a imagem inteira.
- **Endpoints do Spring** (`Alt+Shift+E` ou o globo na barra de ícones, só em projeto Spring Boot): os
  endpoints lidos do código por controller, com verbo, caminho, parâmetros, corpo (campos e validações),
  acesso (`@PreAuthorize`) e os testes que passam por cada um. `c` chama o endpoint na aplicação local
  (o pedido é editável, `{{NOME}}` vem do `.env`), `y` copia o curl, `w` abre o Swagger, `a` o Actuator.
- **Regras de negócio com cobertura**: cada regra mostra se tem teste, se ele falha e
  quais cenários estão cobertos: o caminho feliz e cada desvio que o código tem (`throw`, validação,
  4xx). `u` filtra as sem teste, `x` as falhando; o clique direito (ou `t`) abre ir para o teste,
  rodar, criar teste manualmente ou com a IA e sugerir cenários que faltam. "Testada" quer dizer que
  um teste passa pelo código da regra, lido do código; não é cobertura de linhas.
- **Uso da assinatura do Claude**: no modo assinatura, a barra de status mostra a janela de
  5 horas e a semana, lidas do Claude Code depois de cada resposta (clique para os detalhes).
- **Entender o sistema** (`Alt+7`): a arquitetura do projeto em blocos
  (domínios × camadas, da tela do Angular até a tabela), as regras de negócio achadas no código
  (guardadas em `.seedy/regras.md`, reescritas pela IA) e o caminho de um método — `ctrl+.` →
  "acompanhar método" mostra de onde a chamada vem (até o botão da tela), para onde vai (até o
  banco) e onde ela pode ser barrada. Spring Boot, Java EE/Jakarta, Struts 1/2 com JSP e Angular
  (com as rotas: qual rota abre qual tela e para onde cada tela vai).
- **Configuração de execução** (`Alt+Shift+F10` → ⚙): argumentos do programa, variáveis de ambiente e opções
  da JVM da classe `main` ou do script escolhido, em `.seedy/execucao.json`.
- **Containers** : `Alt+Shift+8` abre a tela do Docker com os containers do
  projeto e os outros, um mapa de quem fala com quem (rede, `depends_on`, tráfego TCP medido
  agora, variável de ambiente que aponta para outro container e portas no host), o detalhe e os
  logs ao vivo. Inicia/para/reinicia, compose up/down, abre um shell dentro do container no
  terminal integrado e transforma um Postgres/MySQL do Docker em conexão do painel de banco.
  `Alt+8` mostra a versão compacta embaixo do editor.
- **Novo projeto** (`Alt+Shift+N`): Spring Boot (com os iniciadores do start.spring.io), Java com
  Maven, Java web (WAR, pronto para o servidor do Seedy), Java simples, Angular (`ng new`) e React
  (Vite + TypeScript, com `npm install`). Escolhe
  o JDK entre os instalados, faz `git init` + primeiro commit, abre o projeto e deixa o RUN na `main`.
- **IA que opera a IDE** : as mesmas ferramentas servem ao painel de IA do Seedy
  (`Alt+A`, pela API) e ao **Claude Code no terminal** pelo servidor MCP do Seedy
  (menu de atalhos, `i`, copia o comando `claude mcp add …` para registrar uma vez). A IA abre e lê código, busca
  no projeto, vê os erros do jdtls, sobe/derruba o servidor, lê o log, faz requisições à
  aplicação local e consulta os bancos (só leitura). Toda edição vira diff na **revisão**
  (`Alt+Y`): propostas esperam você aceitar ou recusar (a IA recebe a decisão); edições que o
  Claude Code faz direto no disco num arquivo aberto aparecem já aplicadas, com desfazer.
  A IA também **roda e depura** (`rodar`, `parar`, breakpoints, passos, avaliar), **roda os testes**
  e lê a cobertura das regras, mexe nos **containers** e no `docker compose`, usa o **TODO** e os
  **bookmarks**, navega pelo código (definição, usos, símbolos), lê a **arquitetura** e as
  **regras de negócio**, opera o **Git** e o **GitHub** (commit, push, branches, PR, issue), o
  **jdtls e o JDK**, edita o **servidor de aplicação** e liga um container ao **banco**. Rodar,
  testar, commitar e mexer em container pedem a sua aprovação (o modo automático, `Alt+Shift+Y`, dispensa);
  push, apagar, `docker compose down`, PR e issue perguntam sempre. `/historico` no chat mostra o
  que foi pedido e decidido na sessão.
- **Projetos React** (Vite): editar `.tsx`/`.jsx` com o servidor de TypeScript, rodar `npm run dev`
  pelo painel de scripts (o Seedy pega o endereço do Vite) e depurar no Edge/Chrome com source maps.
  Os testes `*.test.tsx` e `*.spec.tsx` entram na lista de testes. A tela de arquitetura ainda não
  entende componentes React (função + JSX), e os resultados do Vitest/Jest não são lidos.
- **Depurar um teste só** (tela de testes, `d` ou "🐞 depurar este"): sobe só aquele teste pelo Maven
  (ou Gradle) com o depurador anexado, e o Seedy vai para a tela de debug quando ele para num breakpoint.
  A IA faz o mesmo com `testes_rodar` + `depurar`.
- **Janela**: o ícone do Seedy aparece na barra de tarefas e no Alt+Tab do Windows, e a interface se
  adapta de 900 × 560 em diante (painéis laterais encolhem, a barra de ícones rola e as telas cheias
  estreitam as colunas).
- **Variáveis do `.env`**: o Seedy lê o `.env` da raiz do projeto e o passa para o que roda:
  a classe `main` (RUN e DEBUG), o servidor de aplicação, os scripts do `package.json`, os testes e os
  comandos da IA. Com um só `.env` ele é usado sozinho; com vários (`.env`, `.env.local`...) o Seedy
  pergunta qual usar na primeira execução e guarda a escolha por projeto (`Alt+Shift+F10` → ⚙ muda ou desliga,
  `alt+e`). O arquivo é lido de novo a cada execução, as "variáveis de ambiente" da configuração valem
  por cima, valores com cara de senha aparecem mascarados e a IA só vê os nomes (`env_listar`). Se o
  arquivo não está no `.gitignore`, as opções avisam e dão o botão "adicionar".
- **Mandar para o chat da IA**: `ctrl+shift+a` manda o que está em foco (container,
  regra, bloco da arquitetura, caminho, card do TODO, teste e a falha, conexão de banco, commit
  selecionado, estado do Git ou o trecho do código) e o botão direito faz o mesmo no item clicado.
  Viram chips removíveis no painel da IA e vão junto da próxima mensagem; `ctrl+shift+backspace`
  limpa. Na tela de testes, `i` manda todas as falhas. A conversa da IA é guardada por projeto em
  `.seedy/conversa.json` e volta quando você reabre o projeto (`/clear` apaga). A IA também tem **memória**:
  notas que ela propõe guardar (você aprova cada uma, sempre) para as próximas conversas, do projeto
  (`.seedy/memoria.md`) e globais (`memoria.md` na pasta de configuração); `/memoria` lista e
  `/memoria editar` abre o arquivo. O Seedy põe só a conversa e a memória do projeto no .gitignore
  (o resto de `.seedy/` continua para o time).
- **IA no merge**: `Alt+A` abre um chat ao lado das três colunas para conversar
  sobre os conflitos. A IA (Claude) lê o código relacionado e o histórico do arquivo e propõe a
  resolução, que aparece como prévia no resultado: `⏎` aplica, `esc` recusa, `ctrl+r` pede outra.
  Na primeira mensagem o Seedy pede a chave da API da Anthropic (fica no arquivo `ia.chave` da
  pasta de configuração, ou use `ANTHROPIC_API_KEY`); a chave nunca passa pela interface.
- **Conta do GitHub**: entre como no IntelliJ (pelo navegador, via Git Credential Manager, ou com
  um token) com `Alt+Shift+G` ou pelo botão da tela do Git; clone os seus repositórios de lá. O token fica no
  núcleo e no cofre do sistema, nunca na interface.
- Painéis redimensionáveis (arraste os divisores) e modo foco.

## Atalhos

| Tecla | Ação |
|---|---|
| `Ctrl+Shift+Espaço` ou o botão da logo | menu de atalhos (as letras valem lá dentro; `"espacoAbreMenu": true` faz o Espaço abrir também) |
| `Ctrl+F` | buscar no arquivo aberto |
| `Ctrl+P` | buscar arquivo (`Ctrl+Shift+P` abre a mesma janela em "Tudo"; `Ctrl+Shift+O` em "Símbolos") |
| `Ctrl+Shift+F` | buscar no projeto |
| `Ctrl+Shift+R` | substituir no projeto |
| `Ctrl+\` ou `:vs` | dividir o editor (de novo: junta) |
| `Ctrl+W` `h` / `l` / `w` | painel da esquerda / da direita / o outro |
| `Ctrl+W` `q` ou `:q` | fechar o painel (`Ctrl+W o` ou `:only`: fica só este) |
| `Alt+1` | mostrar/esconder arquivos |
| `Alt+F12` | mostrar/esconder terminal |
| `Alt+Shift+O` | abrir projeto |
| `Ctrl+Shift+Espaço`, `Q` | fechar o projeto e voltar à tela de início |
| `Alt+Shift+N` | novo projeto: `j`/`k` modelo, `tab` campos, `espaço` marca, `/` filtra iniciadores, `ctrl+o` pasta, `ctrl+⏎` cria |
| `Ctrl+S` | salvar |
| `Ctrl+F4` | fechar buffer |
| menu de atalhos, `c` | editar o tema |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | próximo / anterior buffer |
| `Ctrl+1` … `Ctrl+9` | ir para o 1º … 9º arquivo aberto (o número aparece na aba) |
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
| menu de atalhos, `l` | reiniciar o jdtls |
| menu de atalhos, `v` | escolher o JDK que roda o jdtls |
| `Alt+9` | tela do Git (de novo: volta ao editor) |
| `Ctrl+K` | commit (`ctrl+⏎` commita, `ctrl+alt+⏎` commita e faz push) |
| `Ctrl+Shift+K` / `Ctrl+T` | push / pull |
| `Alt+Shift+B` | trocar de branch (ou criar uma) |
| `Alt+Shift+K` | blame no arquivo aberto |
| `Alt+Shift+M` | resolver conflitos (merge em 3 colunas) |
| `Alt+A` | painel de IA (no merge: o chat do conflito); no campo, `⏎` envia ou aplica a proposta, `esc` recusa, `ctrl+l` nova conversa |
| `Alt+Y` | revisar as alterações da IA: `⏎` aceita/mantém, `d` recusa/desfaz, `D` diff completo |
| `ctrl+shift+a` | mandar para o chat da IA o que está em foco; `ctrl+shift+backspace` limpa os anexos |
| menu de atalhos, `i` | copiar o comando que liga o Claude Code ao Seedy (MCP) |
| `Alt+4` | painel do servidor: `i` inicia, `d` debug, `x` para, `r` redeploy, `o` abre no navegador, `e`/`w`/`a` filtro (erros, avisos, tudo), `⏎` num frame abre o código, `s` troca de servidor, `n` novo, `E` editar |
| `shift+F10` / `shift+F9` / `ctrl+F2` / `ctrl+F10` | rodar / depurar a configuração escolhida / parar / redeploy do servidor (como no IntelliJ) |
| `Alt+Shift+8` · `Alt+8` | containers (tela com o mapa · painel): `j`/`k`, `s` inicia/para, `R` reinicia, `l` logs, `t` terminal no container, `b` ligar ao banco, `u` compose up, `m` mapa (`h j k l` entre os nós, `+`/`−` zoom, `0` encaixa) |
| `Alt+Shift+J` | scripts do package.json: `j`/`k`, `⏎` roda, `x` para, `o` abre no navegador, `d` debug, `i` npm install, `c` limpa |
| `Alt+Shift+F10` · `Alt+5` | escolher o que o RUN/DEBUG roda · tela de debug (`p`/`b`/`v`/`c` focam pilha, breakpoints, variáveis e console; na lista de breakpoints `e` edita a condição e `d` apaga; `esc` volta) |
| `ctrl+F8` · `F8` · `F7` · `shift+F8` · `F9` · `alt+F9` · `alt+F8` | breakpoint · passar · entrar · sair · continuar · até o cursor · avaliar |
| `Alt+Shift+D` | conexões (banco): `j`/`k`, `l`/`⏎` abre/conecta, `⏎` numa tabela consulta, `c` console, `n` nova, `e` editar, `x` desconectar, `r` recarregar, `del` apagar |
| `Ctrl+Enter` / `Ctrl+Shift+Enter` (num .sql) | executa a instrução sob o cursor (ou a seleção) / explain |
| grade do resultado | `j`/`k`/`h`/`l` andam, `y` copia a célula, `Y` copia a linha, `esc` volta ao editor |
| `Alt+A` (no merge) | chat da IA: `⏎` envia (vazio: aplica a proposta), `esc` recusa, `ctrl+r` outra |
| `Alt+Shift+G` | GitHub: conectar, clonar, criar PR ou issue, desconectar |
| `Alt+Shift+P` / `Alt+Shift+Q` | criar pull request / issue (`ctrl+⏎` cria, `alt+b` troca a base, `alt+r` rascunho) |
| `Alt+Shift+S` | guardar as mudanças na prateleira (no commit: `alt+s` com os arquivos marcados) |
| tela do Git, prateleira: `⏎`, `r`, `d` | devolver (escolhendo os arquivos), renomear, apagar |
| tela do Git: `h`/`l`, `j`/`k`, `⏎` | painéis, commits, diff; `c` checkout, `b` branch aqui, `p` cherry-pick, `r` reverter, `m` merge, `d` apagar, `/` filtrar |
| merge: `]c` / `[c`, `dp` / `do`, `:w` | próximo/anterior conflito, pegar o seu/o deles, gravar e concluir |

Os atalhos ficam em `src/app/teclado/atalhos.service.ts`.

## Avisos do compilador Java

Os avisos que o jdtls mostra (import, variável ou campo não usado...) vêm de
`jdtls.prefs`, na mesma pasta do tema (formato `.prefs` do Eclipse). O Seedy cria o
arquivo na primeira vez; depois de editar, reinicie o jdtls pelo menu de atalhos (`Ctrl+Shift+Espaço`, `l`).
Detalhe do compilador do Java: num arquivo com erro de compilação, "import não usado"
só aparece depois que o erro é corrigido.

## Tema

O tema é um arquivo JSON que você edita (no próprio Seedy: menu de atalhos, `c`):

- **Linux:** `~/.config/seedy/tema.json`
- **Windows:** `%APPDATA%\seedy\tema.json`

Ao salvar, a IDE inteira muda na hora. Se o JSON tiver erro, o Seedy mantém o
tema anterior e avisa num toast. O que você apagar do arquivo volta ao padrão.

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
`~/.config/seedy/seedy.json` no Linux). Abra com `Ctrl+,`; salvou, vale na hora. Um
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
  "atualizacao": { "verificar": true },              // false desliga a procura de versão nova
  "layout": { ... }                                  // gravado pelo Seedy (Alt+Shift+L)
}
```

Ids das ações do líder: `buscar-tudo`, `buscar-arquivo`, `buscar-no-projeto`, `substituir`,
`simbolos`, `arquivos`, `terminal`, `abrir-projeto`, `novo-projeto`, `salvar`, `fechar-buffer`,
`tema`, `reiniciar-jdtls`, `jdk`, `execucao`, `debug`, `git`, `commit`, `branch`, `blame`,
`banco`, `servidor`, `scripts`, `containers-painel`, `containers`, `todo`, `entender`, `merge`,
`github`, `prateleira`, `pull-request`, `issue`, `ia`, `revisar-ia`, `layout`, `config`, `mcp`.
A ação que perde a tecla para outra fica sem atalho (continua na busca, `Ctrl+Shift+P`).

### Atalhos diretos

Cada ação do menu tem um atalho direto (um acorde só, como no IntelliJ); o menu mostra o de cada uma e `Ctrl+,` → Atalhos lista e troca (`⏎` troca, `x` desliga, `r` volta ao padrão). No `seedy.json`:

```json
"atalhos": {
  "teclas": { "git": "alt+9", "testes": "alt+shift+t", "vim": null },   // null desliga
  "espacoAbreMenu": false                                           // true: o Espaço também abre o menu
}
```

Nenhum atalho usa Ctrl+Alt (no teclado ABNT2 é o AltGr). As letras do menu (`lider`) continuam valendo dentro do menu.

### Layout

Cada painel (arquivos, terminal, servidor, scripts, containers, banco, IA) mora numa região:
à esquerda, embaixo ou à direita, um por região. Arraste a faixa de título de um painel para
outra região, ou use `Alt+Shift+L` → mover. Os divisores mudam o tamanho (de cada painel). `Alt+Shift+L` também
salva a disposição atual com um nome e troca entre as salvas; tudo fica no `seedy.json`.

## Compilar e testar

### Pré-requisitos

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

### Rodando

```bash
npm install          # instala tudo (e prepara o monaco-vim em src/vendor)
npm run dev          # abre o Seedy em modo desenvolvimento (recarrega ao salvar)
npm run empacotar    # gera o instalador (.msi/.exe no Windows, .deb/.AppImage no Linux)
```

Para abrir já num projeto: `seedy /caminho/do/projeto` (ou `Alt+Shift+O` dentro do app).

Só o visual, sem compilar o Rust: `npm start` e abra http://localhost:4200
(modo navegador, com arquivos e conexões de exemplo; o terminal não funciona aqui).

#### Testes dos servidores

Também `#[ignore]`: sobem um Tomcat e um WildFly de verdade com um JSP, conferem a página, o hot
swap e o encerrar. Aponte para as instalações e um JDK 17+:

```bash
SEEDY_TESTE_TOMCAT=/opt/apache-tomcat-11.0.29 SEEDY_TESTE_WILDFLY=/opt/wildfly-42.0.0.Final \
SEEDY_TESTE_JDK=/usr/lib/jvm/java-21 cargo test --lib de_verdade -- --ignored
```

#### Testes do banco

Os testes dos drivers contra bancos de verdade ficam marcados como `#[ignore]`. Com Docker:

```bash
docker run -d --name seedy-pg -e POSTGRES_PASSWORD=seedy -e POSTGRES_DB=feira_db -p 55432:5432 postgres:17
docker run -d --name seedy-mysql -e MYSQL_ROOT_PASSWORD=seedy -e MYSQL_DATABASE=feira_db -p 53306:3306 mysql:8.4
# crie as tabelas feira/banca (e no PostgreSQL a tabela grande) como em src-tauri/src/banco/mod.rs
cd src-tauri && cargo test --lib -- --include-ignored
```

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
  app/ia/                    IA: painel, ferramentas da IDE, MCP, revisão de alterações, chat do merge
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

