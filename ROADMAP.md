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

Ficou para depois:

- Gerar getters/construtor/toString com escolha de campos (prompts do jdtls)
- Selecionar o JDK do jdtls em configuração (hoje: `SEEDY_JAVA_HOME` ou o mais novo instalado)
- Árvore de arquivos atualizando sozinha (hoje: ↻ na faixa) — ver "Depois"

## Fase 2 — Busca (em andamento)

- ✅ Buscar no arquivo aberto (`Ctrl+F`): a caixa de busca do Monaco, no visual do tema
- ✅ Buscar arquivo (`Ctrl+P`): a janela do mockup 02 (Search Everywhere), com classes,
  arquivos, símbolos, texto e ações
- ✅ Buscar no projeto (`Ctrl+Shift+F`), como o "Find in Files" do IntelliJ: maiúsculas,
  palavra inteira, regex e máscara de arquivos (crates `ignore` + `regex`, respeita `.gitignore`)
- Substituir no projeto (`Ctrl+Shift+R`), com prévia das alterações
- Mockup das janelas de `Ctrl+Shift+F` em `docs/design/` (hoje seguem a linguagem visual
  dos outros mockups, sem um próprio)
- Símbolos hoje saem de uma leitura das declarações Java linha a linha; trocar pelo jdtls
  (`workspace/symbol`) na fase 1
- Usos hoje são ocorrências do nome; trocar por usos semânticos (jdtls) + textuais em
  XML/JSP (Struts, Tiles)
- Dividir (`^v`): abrir o resultado ao lado, quando o editor tiver divisão

## Fase 3 — Banco de dados

- Conexões PostgreSQL, MySQL e Oracle, com perfis (Local / Homolog / Produção)
- Cor por ambiente; Produção somente leitura por padrão, com confirmação
- Túnel SSH por conexão (lendo `~/.ssh/config` e `known_hosts`)
- Árvore de schemas, editor SQL com autocomplete, `Ctrl+Enter` executa
- Grade de resultados **somente leitura** (alterações só por SQL), exportar CSV
- Oracle: driver Rust depende do Instant Client; se der problema, sidecar Java (JDBC)

## Fase 4 — Git

- Árvore de commits com as linhas das branches, detalhe do commit, diff
- Commit, push, pull, branches, stash, blame
- Diff entre arquivos quaisquer (editor de diff do Monaco)
- Merge de conflitos em 3 colunas, com **resolver simples** (diff3: aplica o que só
  um lado mudou, junta imports, ignora diferença só de espaço) e sugestão por IA

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

## Depois

- Layout editável (arrastar painéis, salvar disposições) — a base já existe em
  `src/app/layout/layout.service.ts`
- Watcher de arquivos para a árvore atualizar sozinha
- Configurações em arquivo (`seedy.json`): atalhos, shell do terminal, etc.
