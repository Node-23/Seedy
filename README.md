# Seedy

IDE Java minimalista, guiada pelo teclado, com o visual sob controle de quem usa.
Feita com **Tauri 2 + Angular + Monaco**, roda em **Windows e Linux**.

> Status: **v0.1 em andamento**. Editor com modo vim, árvore de arquivos, terminal,
> tema, buscas, inteligência de Java (jdtls) e Git já funcionam. Banco, servidores
> (JBoss/Tomcat) e IA vêm nas próximas fases — ver [ROADMAP.md](ROADMAP.md).

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
- **Conta do GitHub**: entre como no IntelliJ (pelo navegador, via Git Credential Manager, ou com
  um token) com `␣ G` ou pelo botão da tela do Git; clone os seus repositórios de lá. O token fica no
  núcleo e no cofre do sistema, nunca na interface.
- Painéis redimensionáveis (arraste os divisores) e modo foco.

## Pré-requisitos

| | Windows | Linux (Ubuntu/Debian) |
|---|---|---|
| Node.js 20+ | [nodejs.org](https://nodejs.org) | `sudo apt install nodejs npm` ou nvm |
| Rust (stable) | [rustup.rs](https://rustup.rs) | `curl https://sh.rustup.rs -sSf \| sh` |
| Bibliotecas do sistema | Visual Studio Build Tools (C++) e WebView2 (já vem no Windows 10/11) | `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev build-essential libssl-dev` |
| JDK 25+ (roda o jdtls) | [adoptium.net](https://adoptium.net) ou `winget install EclipseAdoptium.Temurin.25.JDK` | `sudo apt install openjdk-25-jdk` ou SDKMAN |

O JDK 25 é só para rodar o jdtls: o projeto continua compilando com a versão do `pom.xml` /
`build.gradle`. O Seedy procura o JDK em `SEEDY_JAVA_HOME`, `JAVA_HOME` e nas pastas de
instalação comuns (Adoptium, Oracle, Microsoft, Zulu, Corretto, `/usr/lib/jvm`, `~/.sdkman`, `~/.jdks`).

Guia oficial do Tauri, se algo faltar: https://tauri.app/start/prerequisites/

## Rodando

```bash
npm install          # instala tudo (e prepara o monaco-vim em src/vendor)
npm run dev          # abre o Seedy em modo desenvolvimento (recarrega ao salvar)
npm run empacotar    # gera o instalador (.msi/.exe no Windows, .deb/.AppImage no Linux)
```

Para abrir já num projeto: `seedy /caminho/do/projeto` (ou `␣ o` dentro do app).

Só o visual, sem compilar o Rust: `npm start` e abra http://localhost:4200
(modo navegador, com arquivos de exemplo; o terminal não funciona aqui).

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
  app/escolha/               janela de escolha (uma ou várias opções), usada por quem precisa perguntar
  app/teclado/               atalhos
  styles.css                 todo o visual (só usa as variáveis do tema)
src-tauri/                   núcleo (Rust)
  src/arquivos.rs            listar pastas, ler/gravar arquivos
  src/terminal.rs            PTY (ConPTY no Windows)
  src/tema.rs                tema.json, fontes e recarga ao vivo
  src/git.rs                 roda o git, conta do GitHub (credential manager e API)
  src/busca.rs               índice de arquivos/símbolos Java e busca de texto
  src/java.rs                acha os JDKs, baixa e verifica o jdtls, processo e canal LSP
  src/observador.rs          observa a pasta do projeto (mudanças feitas fora do editor)
```

Sem plugins: cada funcionalidade é um módulo interno. Para mudar algo, muda o código.

## Licença

[PolyForm Noncommercial 1.0.0](LICENSE.md): uso, estudo e modificação livres para
fins **não comerciais**. Uso comercial não é permitido.
