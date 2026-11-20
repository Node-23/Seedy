# Seedy — instruções para o Claude Code

IDE Java pessoal, minimalista e guiada pelo teclado. Tauri 2 (Rust) + Angular + Monaco.
Precisa rodar em **Windows e Linux**. Leia `README.md` e `ROADMAP.md` antes de mudar algo grande.

## Regras

- **Idioma:** código, nomes, comentários, mensagens de commit e textos da interface em
  português do Brasil (ex.: `ProjetoService`, `ler_pasta`, `abrirLider`).
- **Sem plugins.** Cada funcionalidade é um módulo interno; nada de sistema de extensões.
- **Visual só pelo tema.** Cores, fontes, raios, bordas e espaçamentos vêm das variáveis
  CSS geradas do `tema.json` (`--fundo`, `--destaque`, `--raio`...). Nunca escreva uma cor
  fixa em componente ou CSS. Novo token de cor → adicione em `src/app/tema/tema-padrao.json`,
  no tipo `Tema` (`src/app/tema/tema.ts`) e use a variável.
- **Estilos** ficam em `src/styles.css` (componentes não têm CSS próprio), para o visual
  ser editável num lugar só.
- **Núcleo pequeno.** O Rust só faz o que precisa do sistema (arquivos, processos, PTY, Git,
  banco, rede). Toda chamada da interface ao Rust passa por `src/app/nucleo/ponte.ts`, que
  também tem a versão de exemplo para o modo navegador (`npm start`).
- **Teclado primeiro.** Toda ação nova ganha atalho (de preferência no menu do líder, em
  `src/app/teclado/atalhos.service.ts`) e precisa funcionar sem mouse.
- **Painéis** são registrados em `src/app/layout/layout.service.ts` — é a base do layout editável.
- **Multiplataforma:** caminhos com `std::path` no Rust; nada de `/` fixo em caminho; testar
  diferenças de shell (`.sh` vs `.bat`), fim de linha (CRLF/LF) e pastas de configuração.
- **Servidores de aplicação:** sempre JBoss/WildFly **e** Tomcat, atrás de um adaptador comum.
- Não edite `src/vendor/` — é gerado por `scripts/vendor-monaco-vim.mjs` no `npm install`.

## Verificação antes de entregar

```bash
npm run build                       # interface
cd src-tauri && cargo check && cargo test --lib   # núcleo
```

Para mudanças visuais, rode `npm start` (modo navegador) e confira contra os mockups.
