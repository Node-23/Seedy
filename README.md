# Seedy

IDE Java minimalista, guiada pelo teclado, com o visual sob controle de quem usa.
Feita com **Tauri 2 + Angular + Monaco**, roda em **Windows e Linux**.

> Status: **fundação (v0.1)**. Editor com modo vim, árvore de arquivos, terminal
> integrado e sistema de tema já funcionam. Inteligência de Java, busca, banco,
> Git, servidores (JBoss/Tomcat) e IA vêm nas próximas fases — ver [ROADMAP.md](ROADMAP.md).

## O que já tem

- **Editor Monaco com modo vim**: `:w`, `:q`, `:q!`, `:wq`, `:bn`, `:bp`, `:term`, números de linha relativos.
- **Destaque de sintaxe no estilo Alabaster**: só strings, constantes, comentários e definições ganham cor.
- **Árvore de arquivos** navegável pelo teclado (`j`/`k`, `l`/`Enter`, `h`).
- **Terminal integrado** com abas: shell de verdade (PowerShell no Windows, seu `$SHELL` no Linux).
- **Tema editável** (cores, fontes e forma), aplicado na hora em que você salva o arquivo.
- **Tecla líder** (`␣`) com menu de atalhos, como o which-key do nvim.
- Painéis redimensionáveis (arraste os divisores) e modo foco.

## Pré-requisitos

| | Windows | Linux (Ubuntu/Debian) |
|---|---|---|
| Node.js 20+ | [nodejs.org](https://nodejs.org) | `sudo apt install nodejs npm` ou nvm |
| Rust (stable) | [rustup.rs](https://rustup.rs) | `curl https://sh.rustup.rs -sSf \| sh` |
| Bibliotecas do sistema | Visual Studio Build Tools (C++) e WebView2 (já vem no Windows 10/11) | `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev build-essential libssl-dev` |
| JDK 21 | só a partir da fase do jdtls | só a partir da fase do jdtls |

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
| `␣ e` | mostrar/esconder arquivos |
| `␣ t` ou `Alt+F12` | mostrar/esconder terminal |
| `␣ o` | abrir projeto |
| `␣ w` ou `Ctrl+S` | salvar |
| `␣ q` | fechar buffer |
| `␣ c` | editar o tema |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | próximo / anterior buffer |

Os atalhos ficam em `src/app/teclado/atalhos.service.ts`.

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
  app/layout/                registro de painéis e disposição
  app/teclado/               atalhos
  styles.css                 todo o visual (só usa as variáveis do tema)
src-tauri/                   núcleo (Rust)
  src/arquivos.rs            listar pastas, ler/gravar arquivos
  src/terminal.rs            PTY (ConPTY no Windows)
  src/tema.rs                tema.json, fontes e recarga ao vivo
  src/git.rs                 branch atual
```

Sem plugins: cada funcionalidade é um módulo interno. Para mudar algo, muda o código.

## Licença

[PolyForm Noncommercial 1.0.0](LICENSE.md): uso, estudo e modificação livres para
fins **não comerciais**. Uso comercial não é permitido.
