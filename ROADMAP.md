# Roadmap do Seedy

Referência visual: mockups no canvas "IDE Java — mockups" (grafite + lavanda,
bordas grossas com sombra dura, Alabaster, tudo no teclado).

## ✅ Fase 0 — Fundação

- Tauri 2 + Angular + Monaco, Windows e Linux
- Tema editável (cores, fontes, forma) com recarga ao vivo
- Editor com modo vim, buffers, árvore de arquivos
- Terminal integrado com abas (PTY real)
- Tecla líder + menu de atalhos, statusline, painéis redimensionáveis

## Fase 1 — Inteligência de Java (jdtls)

- Baixar/gerenciar o Eclipse JDT Language Server (precisa de JDK 21)
- Ponte LSP no núcleo (stdio ↔ interface) e cliente LSP no Monaco
- Autocomplete, erros em tempo real, ir para definição/implementação,
  find usages, renomear, extrair variável/método, organizar imports, formatar
- Destaque de definições de verdade via semantic tokens (Alabaster completo)
- Suporte a Maven e Gradle (projetos multi-módulo)

## Fase 2 — Busca (em andamento)

- ✅ Search Everywhere (`␣␣`): classes, arquivos, símbolos, texto e ações num lugar só
- ✅ Busca de texto no projeto (crates `ignore` + `regex`, respeita `.gitignore`), prévia e usos
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
