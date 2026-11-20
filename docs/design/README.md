# Design do Seedy

Referência visual de todas as telas. **Toda tela nova deve seguir estes mockups.**

| Tela | Imagem | Fase |
|---|---|---|
| Editor (árvore, código, statusline, menu do líder) | [01-editor.png](01-editor.png) | 0 ✅ |
| Busca de arquivo, `Ctrl+P` (Search Everywhere, estilo Telescope) | [02-busca.png](02-busca.png) | 2 ✅ |
| Banco de dados (conexões, SQL, grade só leitura, túnel SSH) | [03-banco.png](03-banco.png) | 3 |
| Git (árvore de commits, detalhe, diff) | [04-git.png](04-git.png) | 4 |
| Merge de conflitos (3 colunas, resolver simples) | [05-merge.png](05-merge.png) | 4 |
| IA + console do servidor | [06-ia-servidor.png](06-ia-servidor.png) | 5 e 7 |
| Buscar no projeto, `Ctrl+Shift+F` (tela implementada) | [07-busca-projeto.png](07-busca-projeto.png) | 2 ✅ |
| Substituir no projeto, `Ctrl+Shift+R` (tela implementada) | [08-substituir.png](08-substituir.png) | 2 ✅ |
| Editor dividido, `^v` / `Ctrl+\` / `:vs` (tela implementada) | [09-editor-dividido.png](09-editor-dividido.png) | 2 ✅ |
| Merge com chat de IA (conversar sobre o conflito, prévia no resultado) | [10-merge-ia.png](10-merge-ia.png) | 7 ✅ |

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
| `#92A9E1` | `--destaque` |
| `#16171C` | `--texto-sobre-destaque` |
| `#B7D39C` / `#2E3A2B` | `--sucesso` / `--sucesso-fundo` |
| `#E8C979` | `--aviso` |
| `#EE8C84` / `#3A2A2B` | `--erro` / `--erro-fundo` |
| `#E3A9CC` | `--rosa` |
