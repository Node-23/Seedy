/** Grupos de comandos do Vim para a janela "Alt+Shift+V": o que é do Seedy primeiro, depois o essencial do Vim. */
export interface GrupoDeVim {
  titulo: string;
  /** Do Seedy (aparece destacado) ou do Vim em geral. */
  seedy?: boolean;
  itens: [string, string][];
}

export const GRUPOS_DE_VIM: GrupoDeVim[] = [
  {
    titulo: 'SEEDY NO MODO NORMAL',
    seedy: true,
    itens: [
      ['Ctrl+Shift+Espaço', 'menu de atalhos (e o botão da logo)'],
      ['gd', 'ir para a definição (jdtls)'],
      ['gr', 'ver os usos'],
      ['gi', 'ir para a implementação'],
      ['K', 'mostrar a documentação (hover)'],
      [']c  [c', 'próximo / anterior conflito (merge)'],
      ['dp  do', 'passar / trazer a mudança (merge)'],
    ],
  },
  {
    titulo: 'COMANDOS  :',
    seedy: true,
    itens: [
      [':w  :wa', 'salvar o arquivo / todos'],
      [':q  :q!', 'fechar o buffer (ou o painel dividido)'],
      [':wq  :x', 'salvar e fechar'],
      [':bn  :bp', 'próximo / anterior buffer'],
      [':vs [arq]', 'dividir o editor em dois painéis'],
      [':on  :clo', 'só este painel / fechar o painel'],
      [':term', 'abrir o terminal'],
      [':h', 'esta janela'],
    ],
  },
  {
    titulo: 'PAINÉIS  (ctrl+w)',
    seedy: true,
    itens: [
      ['ctrl+w h  l', 'painel da esquerda / direita'],
      ['ctrl+w w', 'alternar entre os painéis'],
      ['ctrl+w v', 'dividir'],
      ['ctrl+w q', 'fechar o painel'],
      ['ctrl+w o', 'ficar só com este painel'],
    ],
  },
  {
    titulo: 'MOVER',
    itens: [
      ['h j k l', 'esquerda, baixo, cima, direita'],
      ['w  b  e', 'palavra à frente / atrás / fim dela'],
      ['0  ^  $', 'começo da linha / 1º caractere / fim'],
      ['gg  G', 'início / fim do arquivo (5G: linha 5)'],
      ['{  }', 'parágrafo anterior / próximo'],
      ['%', 'o par de ( [ {'],
      ['f x  t x', 'ir até / antes do caractere x na linha'],
      [';  ,', 'repetir / inverter o último f ou t'],
      ['ctrl+d  ctrl+u', 'meia página para baixo / cima'],
      ['ctrl+f  ctrl+b', 'página para baixo / cima'],
    ],
  },
  {
    titulo: 'EDITAR',
    itens: [
      ['i  a  I  A', 'inserir antes / depois / no começo / no fim da linha'],
      ['o  O', 'nova linha abaixo / acima'],
      ['x  X', 'apagar o caractere sob / antes do cursor'],
      ['dd  yy  p  P', 'apagar, copiar, colar depois / antes da linha'],
      ['dw  cw  ciw', 'apagar / trocar palavra / trocar a palavra inteira'],
      ['ci"  ci(  ci{', 'trocar o que está entre aspas, parênteses, chaves'],
      ['D  C', 'apagar / trocar até o fim da linha'],
      ['r x  ~', 'trocar um caractere / inverter maiúscula'],
      ['>>  <<', 'indentar / desindentar a linha'],
      ['J', 'juntar com a linha de baixo'],
      ['u  ctrl+r', 'desfazer / refazer'],
      ['.', 'repetir a última mudança'],
    ],
  },
  {
    titulo: 'VISUAL',
    itens: [
      ['v  V  ctrl+v', 'selecionar caracteres / linhas / bloco'],
      ['iw  ip  i(', 'selecionar palavra, parágrafo, parênteses'],
      ['y  d  c', 'copiar, apagar, trocar a seleção'],
      ['>  <', 'indentar / desindentar'],
      ['o', 'ir para a outra ponta da seleção'],
      ['gv', 'selecionar de novo o último trecho'],
    ],
  },
  {
    titulo: 'BUSCAR E TROCAR',
    itens: [
      ['/ texto  ? texto', 'buscar para frente / para trás'],
      ['n  N', 'próximo / anterior resultado'],
      ['*  #', 'buscar a palavra sob o cursor'],
      [':%s/a/b/g', 'trocar a por b no arquivo todo'],
      [':s/a/b/', 'trocar na linha (ou na seleção)'],
      [':noh', 'tirar o destaque da busca'],
    ],
  },
  {
    titulo: 'MARCAS, REGISTROS E MACROS',
    itens: [
      ['m a  \'a', 'marcar a posição como a / voltar a ela'],
      ['"ay  "ap', 'copiar / colar usando o registro a'],
      ['q a ... q', 'gravar uma macro no registro a'],
      ['@a  @@', 'rodar a macro / repetir a última'],
      ['ctrl+o  ctrl+i', 'posição anterior / seguinte'],
    ],
  },
];
