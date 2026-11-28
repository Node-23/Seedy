# Design do Seedy

Referência visual de todas as telas. **Toda tela nova deve seguir estes mockups.**

| Tela | Imagem | Fase |
|---|---|---|
| Editor (árvore, código, statusline, menu do líder) | [01-editor.png](01-editor.png) | 0 ✅ |
| Busca de arquivo, `Ctrl+P` (Search Everywhere, estilo Telescope) | [02-busca.png](02-busca.png) | 2 ✅ |
| Banco de dados (conexões, SQL, grade só leitura, túnel SSH) | [03-banco.png](03-banco.png) | 3 ✅ |
| Git (árvore de commits, detalhe, diff) | [04-git.png](04-git.png) | 4 |
| Merge de conflitos (3 colunas, resolver simples) | [05-merge.png](05-merge.png) | 4 |
| IA + console do servidor | [06-ia-servidor.png](06-ia-servidor.png) | 5 ✅ (servidor) e 7 |
| Buscar no projeto, `Ctrl+Shift+F` (tela implementada) | [07-busca-projeto.png](07-busca-projeto.png) | 2 ✅ |
| Substituir no projeto, `Ctrl+Shift+R` (tela implementada) | [08-substituir.png](08-substituir.png) | 2 ✅ |
| Editor dividido, `^v` / `Ctrl+\` / `:vs` (tela implementada) | [09-editor-dividido.png](09-editor-dividido.png) | 2 ✅ |
| Merge com chat de IA (conversar sobre o conflito, prévia no resultado) | [10-merge-ia.png](10-merge-ia.png) | 7 ✅ |
| Depurador em tela cheia + RUN/DEBUG e configuração de execução na barra | [11-debug.png](11-debug.png) | ✅ |
| Novo projeto (Spring Boot, Maven, WAR, Java simples, Angular), `Alt+Shift+N` | [12-novo-projeto.png](12-novo-projeto.png) | ✅ |
| Projeto web: TS/Angular (LSP), ESLint, Prettier e painel de scripts do package.json | [13-web.png](13-web.png) | 6 ✅ |
| Debug no navegador (Edge/Chrome via CDP, source maps do .ts) | [14-debug-web.png](14-debug-web.png) | 6 ✅ |
| Containers em tela cheia: lista, mapa das conexões, detalhe e logs, `Alt+Shift+8` | [15-containers.png](15-containers.png) | 8 ✅ |
| Painel de containers no editor (lista e logs), `Alt+8` | [16-containers-painel.png](16-containers-painel.png) | 8 ✅ |
| Arquitetura em blocos (domínios × camadas, da tela ao banco), `Alt+7` | [17-arquitetura.png](17-arquitetura.png) | 9 ✅ |
| Regras de negócio por domínio (IA + código, em .seedy/regras.md) | [18-regras.png](18-regras.png) | 9 ✅ |
| Caminho do método (ctrl+. "acompanhar método"): de onde vem, para onde vai, condições | [19-caminho.png](19-caminho.png) | 9 ✅ |
| TODO por cima das outras telas (barra de ícones à esquerda, cards ligados a código, regras, diagramas e containers), `Alt+6` | [20-todo.png](20-todo.png) | ✅ |
| Tela de testes (árvore por tipo, detalhe da falha, saída e resumo das regras), `Alt+Shift+T` | [21-testes.jpg](21-testes.jpg) | ✅ |
| Regras de negócio com cobertura de testes e cenários de erro (`fontes/Testes.dc.html`) | [22-regras-cobertura.jpg](22-regras-cobertura.jpg) | ✅ |
| Menu do botão direito numa regra (ir para o teste, criar manual/IA, sugerir cenários) | [23-menu-regra.jpg](23-menu-regra.jpg) | ✅ |
| Uso da assinatura do Claude na barra de status (5 horas e semana) | [24-limites-de-uso.jpg](24-limites-de-uso.jpg) | ✅ |
| Depurar um teste só, Spring Boot (perfis e endpoints), imagem no chat da IA e atualização automática — **implementada** (`fontes/Ideias.dc.html`) | [27-ideias.png](27-ideias.png) | ✅ (depurar teste, imagem no chat, atualização; Spring: perfis aqui, endpoints no 28) |
| Tela **Endpoints** do Spring Boot (botão só em projetos Spring): lista por controller, detalhe, testes que cobrem, chamar e copiar curl — **implementada (Alt+Shift+E)** (`fontes/Endpoints.dc.html`) | [28-endpoints.png](28-endpoints.png) | ✅ |
| Tela de **carregamento** (janela de 720 × 440 ao abrir o app) (`fontes/Carregamento.dc.html`) | [29-carregamento.png](29-carregamento.png) | ✅ |
| Tela de **início** (sem projeto aberto: ações e projetos recentes) (`fontes/Inicio.dc.html`) | [30-inicio.png](30-inicio.png) | ✅ |
| **Editor vazio** com a marca e os atalhos principais (`fontes/EditorVazio.dc.html`) | [31-editor-vazio.png](31-editor-vazio.png) | ✅ |
| Configurações, aba **Sobre** (`fontes/Sobre.dc.html`) | [32-sobre.png](32-sobre.png) | ✅ |
| Painel da **IA sem conversa** com o broto e exemplos (`fontes/IaVazia.dc.html`) | [33-ia-vazia.png](33-ia-vazia.png) | ✅ |
| **Toasts** no lugar das mensagens do rodapé, e o sino na barra de cima (`fontes/Toasts.dc.html`) | [34-toasts.png](34-toasts.png) | ✅ |
| **Erro completo** e envio para análise (`fontes/ErroDoSeedy.dc.html`) | [35-erro-do-seedy.png](35-erro-do-seedy.png) | ✅ |
| Lista de **notificações** (`Alt+Shift+H`) (`fontes/Notificacoes.dc.html`) | [36-notificacoes.png](36-notificacoes.png) | ✅ |
| **Completar código**: texto fantasma no editor (`fontes/Completar.dc.html`) | [37-completar.png](37-completar.png) | ✅ |
| Completar código: a pergunta da **primeira abertura** (local, API ou não usar) (`fontes/CompletarLigar.dc.html`) | [38-completar-ligar.png](38-completar-ligar.png) | ✅ |
| Configurações, aba IA: **completar código** (`fontes/CompletarConfig.dc.html`) | [39-completar-config.png](39-completar-config.png) | ✅ |
| Árvore: botão direito → **Novo** e os tipos (`fontes/NovoArquivo.dc.html`) | [40-novo-arquivo.png](40-novo-arquivo.png) | ✅ |
| Nova **classe Java** (nome e tipo) (`fontes/NovoJava.dc.html`) | [41-novo-java.png](41-novo-java.png) | ✅ |
| Novo **arquivo em branco** (nome e extensão) (`fontes/NovoEmBranco.dc.html`) | [42-novo-em-branco.png](42-novo-em-branco.png) | ✅ |
| **Markdown ao vivo** no editor, como no Obsidian (`fontes/Markdown.dc.html`) | [43-markdown.png](43-markdown.png) | ✅ |
| **Arquivos recentes** (`Ctrl+E`) (`fontes/Recentes.dc.html`) | [44-recentes.png](44-recentes.png) | ✅ |
| **Problemas do projeto**: painel, contador na barra de status e próximo erro (`fontes/Problemas.dc.html`) | [45-problemas.png](45-problemas.png) | ✅ |
| **Rodar e depurar pela margem** (teste e `main`) (`fontes/RodarMargem.dc.html`) | [46-rodar-margem.png](46-rodar-margem.png) | ✅ |
| **Histórico local**: versões do arquivo sem commit, com restaurar (`fontes/HistoricoLocal.dc.html`) | [47-historico-local.png](47-historico-local.png) | ✅ |
| **Histórico no Git** de um arquivo ou trecho (`fontes/HistoricoGit.dc.html`) | [48-historico-git.png](48-historico-git.png) | ✅ |
| Variáveis do `.env` nas opções de execução e a pergunta de qual arquivo usar (`fontes/Env.dc.html`) | [26-env.png](26-env.png) | ✅ |
| Mandar itens para o chat da IA (chips removíveis, ⌃⇧A e menu do botão direito) (`fontes/IaAnexos.dc.html`) | [25-ia-anexos.png](25-ia-anexos.png) | ✅ |

As telas 07 a 09 não têm mockup próprio: foram feitas na linguagem visual dos outros e
capturadas do app. Servem de referência do mesmo jeito.

A pasta `fontes/` tem o HTML de cada mockup: medidas, espaçamentos e cores exatas
estão nos `style` de cada elemento. Abra no navegador para inspecionar.

## Linguagem visual

- **Painéis como "janelas"**: borda grossa (`--espessura-borda`), cantos arredondados
  (`--raio`) e sombra dura deslocada, sem desfoque (`--deslocamento-sombra`).
- **Faixa de título** em cada painel: rótulo em caixa alta, espaçado, cor suave, e o
  atalho do painel num `kbd` à direita.
- **Recorte no canto** (entalhe) com um botão quadrado de destaque — usado no editor.
- **Cores**: grafite de fundo, lavanda como destaque, bege como texto. Verde/vermelho só
  com fundo tingido (`--sucesso-fundo`, `--erro-fundo`) para adições, remoções e Produção.
- **Sintaxe Alabaster**: só strings, constantes, comentários e definições têm cor.
- **Teclado sempre visível**: dicas de atalho no rodapé dos painéis e no menu do líder.
- **Statusline** estilo lualine: bloco do modo à esquerda (cor muda por modo), segmentos
  separados por borda, posição do cursor em bloco à direita.
- Nos mockups as cores aparecem fixas; **no código, sempre as variáveis do tema**
  (a tabela de equivalência está no topo de `src/styles.css`).

| Cor no mockup | Variável |
|---|---|
| `#19191B` | `--fundo` |
| `#2A2A2D` | `--painel` |
| `#222225` | `--painel-elevado` |
| `#333337` | `--selecao` |
| `#0B0B0C` | `--borda` / `--sombra` |
| `#E9E2D3` | `--texto` |
| `#A29D93` | `--texto-suave` |
| `#9CD7BA` (os mockups 01 a 12 ainda mostram o lavanda antigo `#92A9E1`) | `--destaque` |
| `#16171C` | `--texto-sobre-destaque` |
| `#B7D39C` / `#2E3A2B` | `--sucesso` / `--sucesso-fundo` |
| `#E8C979` / `#3A3527` | `--aviso` / `--aviso-fundo` |
| `#EE8C84` / `#3A2A2B` | `--erro` / `--erro-fundo` |
| `#E3A9CC` | `--rosa` |
| `#92A9E1` | `--modificado` (nome de arquivo modificado no Git) |
