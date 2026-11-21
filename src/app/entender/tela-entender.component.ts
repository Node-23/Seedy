import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { EntenderService, AbaEntender, RegraVisivel } from './entender.service';
import { Bloco, CorTexto, nomeCurto, nomeDaTela, TipoSeta } from './desenho';
import { trechosDoTexto } from './regras';
import { LayoutService } from '../layout/layout.service';
import { ComponenteAnalise, ponte } from '../nucleo/ponte';

const COR: Record<TipoSeta, string> = { chama: 'var(--texto)', dominio: 'var(--aviso)', http: 'var(--rosa)', desvio: 'var(--erro)' };
const TRACO: Record<TipoSeta, string | null> = { chama: null, dominio: '4 3', http: null, desvio: '4 3' };
const CAMADA: Record<string, string> = { tela: 'tela', front: 'serviço do front', entrada: 'entrada (API)', job: 'rotina agendada', servico: 'serviço', repositorio: 'repositório', entidade: 'entidade · tabela' };
const PALAVRAS = 'public|private|protected|static|final|if|else|throw|new|return|for|while|class|void|const|let|async|await|try|catch';
const SEPARAR_PALAVRAS = new RegExp(`(\\b(?:${PALAVRAS})\\b)`);
const EH_PALAVRA = new RegExp(`^(?:${PALAVRAS})$`);

type Parte = 'diagrama' | 'metodos';

/**
 * Entender o sistema em tela cheia (␣ A, mockups 17–19): Arquitetura (1), Regras de negócio
 * (2) e Caminho do método (3). Tudo pelo teclado; o detalhe de cada aba fica à direita.
 */
@Component({
  selector: 'sd-tela-entender',
  template: `
    <div class="entender-tela" (keydown)="teclar($event)">
      <div class="entender-abas">
        <button class="entender-aba" [class.ativa]="e.aba() === 'arquitetura'" (click)="trocar('arquitetura')">▦ Arquitetura <kbd>1</kbd></button>
        <button class="entender-aba" [class.ativa]="e.aba() === 'regras'" (click)="trocar('regras')">⚑ Regras de negócio <kbd>2</kbd></button>
        <button class="entender-aba" [class.ativa]="e.aba() === 'caminho'" (click)="trocar('caminho')">⇢ Caminho <kbd>3</kbd></button>
        @if (e.aba() === 'caminho' && focoTexto(); as f) {
          <span class="entender-foco"><span class="destaque-texto">⇢</span> <b>{{ f.nome }}</b><span class="suave">({{ f.params }})</span></span>
        }
        <span class="espaco"></span>
        @if (e.analisando()) { <span class="aviso-texto">lendo o código…</span> }
        @switch (e.aba()) {
          @case ('arquitetura') {
            @if (e.analise(); as a) { <span class="suave entender-resumo">{{ resumo() }}</span> }
            <button class="botao" (click)="e.analisar()">↻ reanalisar <kbd>r</kbd></button>
          }
          @case ('regras') {
            <span class="suave entender-resumo">{{ e.regras().length }} {{ e.regras().length === 1 ? 'regra' : 'regras' }}@if (e.arquivo().escritasEm; as em) { · escritas {{ e.arquivo().pelaIa ? 'pela IA' : 'do código' }} em {{ hora(em) }}}@if (novas(); as n) { · <span class="aviso-texto">{{ n }} {{ n === 1 ? 'nova' : 'novas' }}</span> desde a sua revisão}</span>
            <button class="botao" [disabled]="e.escrevendo()" (click)="e.atualizarComIa()"><span class="destaque-texto">✦</span> {{ e.escrevendo() ? 'a IA está escrevendo…' : 'atualizar com IA' }} <kbd>a</kbd></button>
          }
          @case ('caminho') {
            @if (e.desenhoCaminho(); as d) { <span class="suave entender-resumo">{{ d.entradas }} {{ d.entradas === 1 ? 'entrada' : 'entradas' }} · {{ d.condicoes }} {{ d.condicoes === 1 ? 'condição' : 'condições' }}</span> }
            <span class="botao entender-niveis">níveis <kbd (click)="e.mudarNiveis(-1)">−</kbd> {{ e.niveis() }} <kbd (click)="e.mudarNiveis(1)">+</kbd></span>
          }
        }
      </div>

      @if (!e.analise()) {
        <section class="painel entender-vazio"><span class="suave">{{ e.erro() ?? (e.analisando() ? 'lendo o código do projeto…' : 'abra um projeto Spring Boot, Java EE/Jakarta ou Angular') }}</span></section>
      } @else {
        @switch (e.aba()) {
          @case ('arquitetura') {
            <div class="entender-grade arquitetura">
              <section class="painel" aria-label="Arquitetura">
                <div class="painel-faixa">
                  <span class="rotulo">ARQUITETURA</span><span class="suave">domínios × camadas · da tela até o banco</span><span class="espaco"></span>
                  <span class="docker-legenda"><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke="var(--texto)" stroke-width="2" /></svg>chama</span>
                  <span class="docker-legenda"><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke="var(--aviso)" stroke-width="2" stroke-dasharray="4 3" /></svg>entre domínios</span>
                  <span class="docker-legenda"><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke="var(--rosa)" stroke-width="2" /></svg>HTTP</span>
                </div>
                @if (e.desenhoArquitetura(); as d) {
                  <div #area class="entender-area" tabindex="0" (focus)="parte.set('diagrama')">
                    <div class="entender-conteudo" [style.width.px]="d.largura" [style.height.px]="d.altura">
                      @for (c of d.camadas; track c.chave) { <span class="entender-coluna" [style.left.px]="c.x + 6">{{ c.rotulo }}</span> }
                      @for (dm of d.dominios; track dm.nome) {
                        <div class="entender-dominio" [style.top.px]="dm.y" [style.height.px]="dm.altura"><span>{{ dm.nome.toUpperCase() }}</span></div>
                      }
                      @for (dv of d.divisas; track dv.x) {
                        <div class="entender-divisa" [style.left.px]="dv.x"></div>
                        <span class="entender-divisa-rotulo suave" [style.left.px]="dv.x + 8">{{ dv.rotulo }}</span>
                      }
                      <svg class="docker-setas" [attr.width]="d.largura" [attr.height]="d.altura" aria-hidden="true">
                        <defs>
                          @for (t of tipos; track t) {
                            <marker [attr.id]="'arq-' + t" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" [attr.fill]="cor(t)" /></marker>
                          }
                        </defs>
                        @for (s of d.setas; track $index) {
                          <path [attr.d]="s.d" fill="none" [attr.stroke]="cor(s.tipo)" stroke-width="1.8" [attr.stroke-dasharray]="traco(s.tipo)" [attr.marker-end]="'url(#arq-' + s.tipo + ')'" />
                          @if (s.rotulo) { <text [attr.x]="s.rx" [attr.y]="s.ry" [attr.fill]="cor(s.tipo)" [attr.text-anchor]="s.ancora ?? 'middle'" class="docker-rotulo">{{ s.rotulo }}</text> }
                        }
                      </svg>
                      @for (b of d.blocos; track b.id) {
                        <div class="entender-bloco" [attr.data-id]="b.id" [class.db]="b.estilo === 'db'" [class.ext]="b.estilo === 'ext'" [class.selecionado]="b.id === e.selecionado()"
                             [style.left.px]="b.x" [style.top.px]="b.y" [style.width.px]="b.largura" (click)="escolherBloco(b)" (dblclick)="e.abrirNoEditor(b.caminho, b.linha)">
                          <b [class]="corDe(b.tituloCor)">{{ b.titulo }}</b><br /><span [class]="corDe(b.subCor)">{{ b.sub }}</span>
                        </div>
                      }
                    </div>
                  </div>
                }
              </section>

              <section class="painel entender-detalhe" aria-label="Detalhe">
                @if (compSel(); as c) {
                  <div class="painel-faixa"><span class="rotulo">{{ c.nome.toUpperCase() }}</span>@if (c.anotacoes[0]; as a) {<span class="suave">&#64;{{ a }}</span>}<span class="espaco"></span><kbd>⏎</kbd></div>
                  <div class="docker-kv entender-kv">
                    <div><span class="k">{{ c.linguagem === 'ts' ? 'pasta' : 'pacote' }}</span><span>{{ c.pacote || '—' }}</span></div>
                    <div><span class="k">camada</span><span>{{ camada(c) }} · domínio {{ c.dominio }}</span></div>
                    @if (c.rota) { <div><span class="k">rota</span><span class="rosa-texto">{{ c.rota }}</span></div> }
                    @if (c.tabela) { <div><span class="k">tabela</span><span>{{ c.tabela }}</span></div> }
                    @if (c.externo) { <div><span class="k">chama</span><span class="rosa-texto">{{ c.externo }} (HTTP)</span></div> }
                    @if (usa(c); as l) { @if (l.length) { <div><span class="k">usa</span><span>@for (u of l; track u.id) {<span [class.aviso-texto]="u.outro">{{ u.nome }}</span>{{ $last ? '' : ', ' }}}</span></div> } }
                    @if (usadoPor(c); as l) { @if (l.length) { <div><span class="k">usado por</span><span>@for (u of l; track u.id) {<span [class.aviso-texto]="u.outro">{{ u.nome }}</span>{{ $last ? '' : ', ' }}}</span></div> } }
                    @if (abre(c); as l) { @if (l.length) { <div><span class="k">abre</span><span class="rosa-texto">{{ l.join(', ') }}</span></div> } }
                    @if (e.regrasPorComp().get(c.id); as n) { <div><span class="k">regras</span><span class="aviso-texto entender-link" (click)="regrasDe(c)">⚑ {{ n }} → aba Regras (2)</span></div> }
                  </div>
                  @if (e.metodosDe(c); as ms) {
                    @if (ms.length) {
                      <div class="entender-grupo">MÉTODOS</div>
                      <div #metodos class="entender-metodos" tabindex="0" (focus)="parte.set('metodos')">
                        @for (m of ms; track $index) {
                          <div class="entender-item" [class.selecionado]="$index === e.metodoSel()" (click)="e.metodoSel.set($index)" (dblclick)="e.acompanhar(c.id, m.nome)">
                            <span [class.destaque-texto]="$index === e.metodoSel()">{{ m.nome }}</span><span class="suave">({{ m.params.join(', ') }})</span>
                            @if (m.http) { <span class="rosa-texto entender-mini">{{ m.http.verbo }}</span> }
                            @if (m.agendado) { <span class="suave entender-mini">&#64;Scheduled</span> }
                            @if ($index === e.metodoSel()) { <span class="destaque-texto entender-direita">⇢</span> }
                          </div>
                        }
                      </div>
                    }
                  }
                  <div class="espaco-v"></div>
                  <div class="docker-acoes entender-acoes">
                    <button class="botao" (click)="acompanharSel()">⇢ acompanhar <kbd>c</kbd></button>
                    <button class="botao" (click)="e.abrirNoEditor(c.caminho, c.linha)">abrir <kbd>⏎</kbd></button>
                  </div>
                } @else {
                  <div class="painel-faixa"><span class="rotulo">DETALHE</span></div>
                  <div class="debug-vazio suave">{{ blocoSel()?.estilo === 'ext' ? 'sistema externo, chamado por HTTP' : 'escolha um bloco' }}</div>
                }
              </section>
            </div>
          }

          @case ('regras') {
            <div class="entender-grade regras">
              <section class="painel" aria-label="Domínios">
                <div class="painel-faixa"><span class="rotulo">DOMÍNIOS</span><span class="espaco"></span><kbd>h l</kbd></div>
                <div class="entender-lista">
                  @for (d of e.dominiosDasRegras(); track d.nome) {
                    <div class="entender-item" [class.selecionado]="d.nome === dominioAtual()" (click)="escolherDominio(d.nome)">
                      <span [class.forte]="d.nome === dominioAtual()">{{ d.nome }}</span>
                      <span class="entender-direita" [class.aviso-texto]="d.nome === dominioAtual()" [class.suave]="d.nome !== dominioAtual()">⚑ {{ d.total }}</span>
                    </div>
                  } @empty { <div class="debug-vazio suave">nenhuma regra achada no código</div> }
                </div>
                <div class="suave entender-nota">As regras ficam em<br /><span class="texto-normal">.seedy/regras.md</span><br />(vão para o git; dá para editar à mão).</div>
              </section>

              <section class="painel" aria-label="Regras">
                <div class="painel-faixa">
                  <span class="rotulo">{{ (dominioAtual() ?? '').toUpperCase() }}</span><span class="suave">{{ e.regrasDoDominio().length }} {{ e.regrasDoDominio().length === 1 ? 'regra' : 'regras' }}</span><span class="espaco"></span>
                  <label class="docker-filtro"><span class="destaque-texto">/</span><input #filtro type="text" spellcheck="false" placeholder="filtrar" [value]="e.filtro()" (input)="e.filtro.set($any($event.target).value)" (keydown)="teclarFiltro($event)" /></label>
                </div>
                <div #cartoes class="entender-cartoes" tabindex="0">
                  @for (r of e.regrasDoDominio(); track r.id) {
                    <div class="entender-regra" [attr.data-id]="r.id" [class.selecionada]="r.id === e.regraAtual()?.id" (click)="e.regraSel.set(r.id)" (dblclick)="abrirRegra(r)">
                      <div class="rt">
                        <span class="id">{{ r.id }}</span><b>{{ r.titulo }}</b>
                        <span class="tag" [class.git-mais]="r.estado === 'revisada'" [class.aviso-texto]="r.estado === 'nova' && !!r.chave" [class.suave]="!r.chave || (!r.codigo && !!r.chave)">{{ !r.chave ? 'à mão' : !r.codigo ? 'sumiu do código' : r.estado }}</span>
                      </div>
                      <div class="rd">@for (t of trechos(r.descricao); track $index) {@if (t.codigo) {<span class="destaque-texto">{{ t.texto }}</span>} @else {{{ t.texto }}}}</div>
                      @if (r.codigo; as c) {
                        <div class="ro">
                          <span class="destaque-texto">⇢ {{ nome(c.componente) }}{{ c.metodo ? '.' + c.metodo : c.condicao ? '.' + c.condicao : '' }} :{{ c.linha }}</span>
                          <span class="suave">· {{ rodapeDaRegra(r) }}</span>
                          <span class="entender-direita" [class.git-mais]="!!c.teste" [class.aviso-texto]="!c.teste">{{ c.teste ? '✓ testada' : 'sem teste' }}</span>
                        </div>
                      }
                    </div>
                  } @empty { <div class="debug-vazio suave">nenhuma regra{{ e.filtro() ? ' com esse filtro' : '' }}</div> }
                </div>
              </section>

              <section class="painel entender-detalhe" aria-label="Regra no código">
                @if (e.regraAtual(); as r) {
                  <div class="painel-faixa"><span class="rotulo">{{ r.id }} · NO CÓDIGO</span><span class="suave">{{ arquivoDe(r) }}</span><span class="espaco"></span><kbd>⏎</kbd></div>
                  <div class="entender-codigo">
                    @for (l of trecho(); track l.n) {
                      <div class="entender-linha" [class.marcada]="l.marcada"><span class="n">{{ l.n }}</span>@for (p of l.partes; track $index) {<span [class]="p.cor">{{ p.texto }}</span>}</div>
                    } @empty { <div class="debug-vazio suave">{{ !r.codigo ? 'regra sem ligação com o código' : trechoLido() ? 'não consegui ler o arquivo' : 'lendo…' }}</div> }
                  </div>
                  @if (r.codigo; as c) {
                    @if (c.apareceEm.length || c.teste) {
                      <div class="entender-grupo">TAMBÉM APARECE EM</div>
                      @for (l of c.apareceEm; track $index) {
                        <div class="entender-item entender-link" (click)="e.abrirNoEditor(l.caminho, l.linha)"><span class="destaque-texto">⇢</span> {{ arquivoCurto(l.relativo) }}:{{ l.linha }} <span class="suave">{{ l.detalhe === 'mensagem' ? 'mensagem' : '→ ' + (l.detalhe.split('→ ')[1] ?? l.detalhe) }}</span></div>
                      }
                      @if (c.teste; as t) { <div class="entender-item entender-link" (click)="e.abrirNoEditor(t.caminho, t.linha)"><span class="git-mais">✓</span> {{ t.detalhe }}</div> }
                    }
                  }
                  <div class="espaco-v"></div>
                  <div class="docker-acoes entender-acoes">
                    <button class="botao" [disabled]="!r.codigo?.metodo" (click)="caminhoDaRegra(r)">⇢ caminho <kbd>c</kbd></button>
                    <button class="botao" (click)="e.editarRegra(r)">✎ editar <kbd>e</kbd></button>
                    <button class="botao" (click)="e.alternarRevisada(r)">{{ r.estado === 'revisada' ? '↺ desfazer revisão' : '✓ revisar' }} <kbd>v</kbd></button>
                  </div>
                } @else {
                  <div class="painel-faixa"><span class="rotulo">NO CÓDIGO</span></div>
                  <div class="debug-vazio suave">escolha uma regra</div>
                }
              </section>
            </div>
          }

          @case ('caminho') {
            <div class="entender-grade caminho">
              <section class="painel" aria-label="Caminho">
                <div class="painel-faixa">
                  <span class="rotulo">CAMINHO</span><span class="suave">de onde vem → para onde vai</span><span class="espaco"></span>
                  <span class="docker-legenda"><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke="var(--texto)" stroke-width="2" /></svg>chama</span>
                  <span class="docker-legenda"><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke="var(--rosa)" stroke-width="2" /></svg>HTTP</span>
                  <span class="docker-legenda"><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke="var(--erro)" stroke-width="2" stroke-dasharray="4 3" /></svg>desvia / barra</span>
                </div>
                @if (e.desenhoCaminho(); as d) {
                  <div #area class="entender-area" tabindex="0">
                    <div class="entender-conteudo" [style.width.px]="d.largura" [style.height.px]="d.altura">
                      @for (c of d.colunas; track c.x) { <span class="entender-coluna" [style.left.px]="c.x">{{ c.rotulo }}</span> }
                      <svg class="docker-setas" [attr.width]="d.largura" [attr.height]="d.altura" aria-hidden="true">
                        <defs>
                          @for (t of tipos; track t) {
                            <marker [attr.id]="'cam-' + t" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" [attr.fill]="cor(t)" /></marker>
                          }
                        </defs>
                        @for (s of d.setas; track $index) {
                          <path [attr.d]="s.d" fill="none" [attr.stroke]="cor(s.tipo)" stroke-width="1.8" [attr.stroke-dasharray]="traco(s.tipo)" [attr.marker-end]="'url(#cam-' + s.tipo + ')'" />
                          @if (s.rotulo) { <text [attr.x]="s.rx" [attr.y]="s.ry" [attr.fill]="cor(s.tipo)" [attr.text-anchor]="s.ancora ?? 'middle'" class="docker-rotulo">{{ s.rotulo }}</text> }
                        }
                      </svg>
                      @for (b of d.blocos; track b.id) {
                        <div class="entender-bloco" [attr.data-id]="b.id" [class.db]="b.estilo === 'db'" [class.ext]="b.estilo === 'ext'" [class.erro]="b.estilo === 'erro'" [class.tela-erro]="b.estilo === 'tela-erro'"
                             [class.foco]="b.id === d.foco" [class.selecionado]="b.id === e.noSel()"
                             [style.left.px]="b.x" [style.top.px]="b.y" [style.width.px]="b.largura" [attr.title]="b.titulo + '  ' + b.sub" (click)="e.noSel.set(b.id)" (dblclick)="e.abrirNoEditor(b.caminho, b.linha)">
                          <b [class]="corDe(b.tituloCor)">{{ b.titulo }}</b><br /><span [class]="corDe(b.subCor)">{{ b.sub }}</span>
                        </div>
                      }
                    </div>
                  </div>
                  <div class="suave entender-dica">h l anda no caminho · j k entre ramos · ⏎ abre · <span class="destaque-texto">+</span>/<span class="destaque-texto">−</span> níveis</div>
                } @else {
                  <div class="debug-vazio suave entender-sem-foco">Escolha um método: <span class="destaque-texto">ctrl+.</span> no editor → "acompanhar método", ou <span class="destaque-texto">c</span> num método da aba Arquitetura.</div>
                }
              </section>

              <section class="painel entender-detalhe" aria-label="Passo a passo">
                <div class="painel-faixa"><span class="rotulo">PASSO A PASSO</span><span class="espaco"></span><kbd>j k</kbd></div>
                @if (e.desenhoCaminho(); as d) {
                  <div class="entender-passos">
                    @for (p of d.passos; track $index) {
                      <div class="entender-passo" [class.selecionado]="p.bloco === e.noSel()" (click)="e.noSel.set(p.bloco)">
                        <span class="num">{{ $index + 1 }}</span>
                        <div>
                          @for (x of p.partes; track $index) {<span [class]="corDe(x.cor)" [class.forte]="x.forte">{{ x.texto }}</span>}
                          @for (dv of p.desvios; track $index) {<br /><span class="erro-texto">↳ {{ dv.texto }}</span>@if (dv.regra) {<span class="aviso-texto entender-regra-id">{{ dv.regra }}</span>}}
                        </div>
                      </div>
                    }
                    @if (d.outras.length) {
                      <div class="entender-grupo">{{ d.outras.length === 1 ? 'OUTRA ENTRADA' : 'OUTRAS ENTRADAS' }}</div>
                      @for (o of d.outras; track o.bloco) {
                        <div class="entender-item" [class.selecionado]="o.bloco === e.noSel()" (click)="e.noSel.set(o.bloco)"><span class="destaque-texto">⇢</span> {{ o.texto }} <span class="suave">· {{ o.sub }}</span></div>
                      }
                    }
                    @if (e.explicacao() || e.explicando()) {
                      <div class="entender-grupo"><span class="destaque-texto">✦</span> EXPLICAÇÃO</div>
                      <div class="entender-explicacao">{{ e.explicacao() || 'a IA está lendo o caminho…' }}</div>
                    }
                  </div>
                }
                <div class="espaco-v"></div>
                <div class="docker-acoes entender-acoes">
                  <button class="botao" (click)="abrirNo()">abrir <kbd>⏎</kbd></button>
                  <button class="botao" [disabled]="!e.desenhoCaminho() || e.explicando()" (click)="e.explicar()"><span class="destaque-texto">✦</span> explicar <kbd>a</kbd></button>
                </div>
              </section>
            </div>
          }
        }
      }
    </div>
  `,
})
export class TelaEntenderComponent {
  protected readonly e = inject(EntenderService);
  private readonly layout = inject(LayoutService);
  private readonly elArea = viewChild<ElementRef<HTMLElement>>('area');
  private readonly elMetodos = viewChild<ElementRef<HTMLElement>>('metodos');
  private readonly elCartoes = viewChild<ElementRef<HTMLElement>>('cartoes');
  private readonly elFiltro = viewChild<ElementRef<HTMLInputElement>>('filtro');

  protected readonly tipos = ['chama', 'dominio', 'http', 'desvio'] as const;
  protected readonly parte = signal<Parte>('diagrama');
  protected readonly trecho = signal<{ n: number; marcada: boolean; partes: { texto: string; cor: string }[] }[]>([]);
  protected readonly trechoLido = signal(false);
  /** Linhas dos arquivos já lidos (zera a cada análise nova, para não mostrar código velho). */
  private readonly fontes = new Map<string, string[]>();

  protected readonly compSel = computed(() => {
    const id = this.e.selecionado();
    return id ? (this.e.componentes().get(id) ?? null) : null;
  });
  protected readonly blocoSel = computed(() => this.e.desenhoArquitetura()?.blocos.find((b) => b.id === this.e.selecionado()) ?? null);
  protected readonly dominioAtual = computed(() => this.e.dominioSel() ?? this.e.dominiosDasRegras()[0]?.nome ?? null);
  protected readonly novas = computed(() => this.e.regras().filter((r) => r.estado === 'nova' && r.codigo).length);
  protected readonly resumo = computed(() => {
    const a = this.e.analise();
    if (!a) return '';
    const grade = a.componentes.filter((c) => !['teste', 'outro', 'excecao', 'tratador'].includes(c.papel));
    const dominios = new Set(grade.filter((c) => c.papel !== 'entidade').map((c) => c.dominio)).size;
    const endpoints = a.componentes.reduce((s, c) => s + c.metodos.filter((m) => m.http).length, 0);
    const classes = a.componentes.filter((c) => c.linguagem === 'java' && c.papel !== 'teste').length;
    const partes = [...a.tecnologias, `${dominios} ${dominios === 1 ? 'domínio' : 'domínios'}`];
    if (classes) partes.push(`${classes} classes`);
    if (endpoints) partes.push(`${endpoints} endpoints`);
    return partes.join(' · ');
  });
  protected readonly focoTexto = computed(() => {
    const f = this.e.foco();
    const c = f ? this.e.componentes().get(f.comp) : null;
    const m = c?.metodos.find((x) => x.nome === f?.metodo);
    return c && m ? { nome: `${c.nome}.${m.nome}`, params: m.params.join(', ') } : null;
  });

  constructor() {
    // Ao trocar de aba ou abrir a tela: o foco vai para o diagrama/lista da aba.
    effect(() => {
      this.e.aba();
      this.e.analise();
      untracked(() => setTimeout(() => this.focarAba()));
    });
    // Código da regra escolhida (com as linhas da regra marcadas).
    effect(() => {
      this.e.analise();
      untracked(() => this.fontes.clear());
    });
    effect(() => {
      const r = this.e.regraAtual();
      untracked(() => void this.carregarTrecho(r));
    });
    // A seleção sempre visível.
    effect(() => {
      const id = this.e.aba() === 'caminho' ? this.e.noSel() : this.e.aba() === 'regras' ? this.e.regraAtual()?.id : this.e.selecionado();
      untracked(() =>
        setTimeout(() => {
          const raiz = this.e.aba() === 'regras' ? this.elCartoes()?.nativeElement : this.elArea()?.nativeElement;
          if (id) raiz?.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }),
      );
    });
  }

  private focarAba(): void {
    if (this.layout.tela() !== 'entender') return;
    (this.e.aba() === 'regras' ? this.elCartoes() : this.elArea())?.nativeElement.focus({ preventScroll: true });
  }

  protected trocar(aba: AbaEntender): void {
    this.e.aba.set(aba);
  }

  // ---------- textos ----------

  protected cor(t: TipoSeta): string {
    return COR[t];
  }

  protected traco(t: TipoSeta): string | null {
    return TRACO[t];
  }

  protected corDe(c?: CorTexto): string {
    return c ? ({ suave: 'suave', rosa: 'rosa-texto', destaque: 'destaque-texto', aviso: 'aviso-texto', erro: 'erro-texto', sucesso: 'git-mais' } as const)[c] : '';
  }

  protected nome(id: string): string {
    return nomeCurto(id);
  }

  protected camada(c: ComponenteAnalise): string {
    return CAMADA[c.papel] ?? c.papel;
  }

  protected hora(em: string): string {
    const m = /(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/.exec(em);
    if (!m) return em;
    const hoje = new Date();
    const mesmoDia = Number(m[1]) === hoje.getFullYear() && Number(m[2]) === hoje.getMonth() + 1 && Number(m[3]) === hoje.getDate();
    return mesmoDia ? m[4] : `${m[3]}/${m[2]} ${m[4]}`;
  }

  protected trechos(t: string) {
    return trechosDoTexto(t);
  }

  protected arquivoCurto(rel: string): string {
    return rel.split('/').pop() ?? rel;
  }

  protected arquivoDe(r: RegraVisivel): string {
    return r.codigo ? this.arquivoCurto(r.codigo.caminho.replace(/\\/g, '/')) : '.seedy/regras.md';
  }

  protected rodapeDaRegra(r: RegraVisivel): string {
    const c = r.codigo!;
    if (c.tipo === 'excecao') return `lança ${c.excecao}${c.status ? ` → ${c.status}` : ''}`;
    if (c.tipo === 'desvio') return `responde ${c.status}`;
    return c.detalhe.replace(/\s+/g, ' ');
  }

  protected usa(c: ComponenteAnalise) {
    const comps = this.e.componentes();
    return c.usa.map((u) => comps.get(u)).filter((x): x is ComponenteAnalise => !!x && x.papel !== 'entidade').map((x) => ({ id: x.id, nome: x.nome, outro: x.dominio !== c.dominio }));
  }

  /** Telas que esta abre (links do template e navegações dos métodos). */
  protected abre(c: ComponenteAnalise): string[] {
    const comps = this.e.componentes();
    const todas = [...c.navega, ...c.metodos.flatMap((m) => m.navega)];
    return [...new Set(todas.map((n) => (n.alvo && comps.get(n.alvo) ? nomeDaTela(comps.get(n.alvo)!) : n.rota)))];
  }

  protected usadoPor(c: ComponenteAnalise) {
    const lista = (this.e.analise()?.componentes ?? []).filter(
      (x) => x.papel !== 'teste' && x.id !== c.id && (x.usa.includes(c.id) || x.metodos.some((m) => m.httpSaida.some((h) => h.alvo?.alvo === c.id))),
    );
    return lista.map((x) => ({ id: x.id, nome: x.nome, outro: x.dominio !== c.dominio }));
  }

  // ---------- ações ----------

  protected escolherBloco(b: Bloco): void {
    this.e.selecionado.set(b.id);
    this.e.metodoSel.set(0);
  }

  protected acompanharSel(): void {
    const c = this.compSel();
    const m = c ? this.e.metodosDe(c)[this.e.metodoSel()] : null;
    if (c && m) void this.e.acompanhar(c.id, m.nome);
  }

  protected regrasDe(c: ComponenteAnalise): void {
    const r = this.e.regras().find((x) => x.codigo?.componente === c.id);
    if (r) {
      this.e.dominioSel.set(r.dominio);
      this.e.regraSel.set(r.id);
    }
    this.e.aba.set('regras');
  }

  protected escolherDominio(d: string): void {
    this.e.dominioSel.set(d);
    this.e.regraSel.set(null);
  }

  protected abrirRegra(r: RegraVisivel): void {
    if (r.codigo) this.e.abrirNoEditor(r.codigo.caminho, r.codigo.linha);
    else void this.e.editarRegra(r);
  }

  protected caminhoDaRegra(r: RegraVisivel): void {
    if (r.codigo?.metodo) void this.e.acompanhar(r.codigo.componente, r.codigo.metodo);
  }

  protected abrirNo(): void {
    const b = this.e.desenhoCaminho()?.blocos.find((x) => x.id === this.e.noSel());
    if (b) this.e.abrirNoEditor(b.caminho, b.linha);
  }

  private async carregarTrecho(r: RegraVisivel | null): Promise<void> {
    this.trecho.set([]);
    this.trechoLido.set(false);
    const c = r?.codigo;
    if (!c) return;
    if (!this.fontes.has(c.caminho)) this.fontes.set(c.caminho, (await ponte.lerArquivo(c.caminho).catch(() => '')).split(/\r?\n/));
    if (this.e.regraAtual()?.codigo?.chave !== c.chave) return;
    this.trechoLido.set(true);
    const linhas = this.fontes.get(c.caminho)!;
    const ini = Math.max(1, c.linha - 5);
    const fim = Math.min(linhas.length, Math.max(c.linhaFim + 3, ini + 9));
    const lista = [];
    for (let n = ini; n <= fim; n++) lista.push({ n, marcada: n >= c.linha && n <= c.linhaFim, partes: colorir(linhas[n - 1] ?? '') });
    this.trecho.set(lista);
  }

  // ---------- teclado ----------

  protected teclar(ev: KeyboardEvent): void {
    const alvo = ev.target as HTMLElement;
    if (alvo.tagName === 'INPUT') return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = ev.key;
    const feito = () => {
      ev.preventDefault();
      ev.stopPropagation();
    };
    if (k === 'Escape') return (feito(), this.e.fechar());
    if (k === '1' || k === '2' || k === '3') return (feito(), this.trocar((['arquitetura', 'regras', 'caminho'] as const)[Number(k) - 1]));
    if (k === 'r' && this.e.aba() === 'arquitetura') return (feito(), void this.e.analisar());
    if (this.e.aba() === 'arquitetura') this.teclarArquitetura(ev, feito);
    else if (this.e.aba() === 'regras') this.teclarRegras(ev, feito);
    else this.teclarCaminho(ev, feito);
  }

  private teclarArquitetura(ev: KeyboardEvent, feito: () => void): void {
    const c = this.compSel();
    if (this.parte() === 'metodos') {
      const n = c ? this.e.metodosDe(c).length : 0;
      if (ev.key === 'j' || ev.key === 'ArrowDown') return (feito(), this.e.metodoSel.set(Math.min(n - 1, this.e.metodoSel() + 1)));
      if (ev.key === 'k' || ev.key === 'ArrowUp') return (feito(), this.e.metodoSel.set(Math.max(0, this.e.metodoSel() - 1)));
      if (ev.key === 'Enter' || ev.key === 'c') return (feito(), this.acompanharSel());
      if (ev.key === 'Tab' || ev.key === 'h') return (feito(), this.elArea()?.nativeElement.focus());
      return;
    }
    const d = this.e.desenhoArquitetura();
    if (!d) return;
    const dir = direcao(ev.key);
    if (dir) {
      feito();
      const atual = d.blocos.find((b) => b.id === this.e.selecionado()) ?? null;
      const prox = atual ? vizinho(d.blocos, atual, dir) : d.blocos[0];
      if (prox) this.escolherBloco(prox);
      return;
    }
    if (ev.key === 'Enter') return (feito(), this.e.abrirNoEditor(c?.caminho, c?.linha));
    if (ev.key === 'c') return (feito(), this.acompanharSel());
    if (ev.key === 'Tab' && this.elMetodos()) return (feito(), this.elMetodos()!.nativeElement.focus());
  }

  private teclarRegras(ev: KeyboardEvent, feito: () => void): void {
    const lista = this.e.regrasDoDominio();
    const atual = this.e.regraAtual();
    const i = atual ? lista.indexOf(atual) : -1;
    const dominios = this.e.dominiosDasRegras().map((d) => d.nome);
    const iD = dominios.indexOf(this.dominioAtual() ?? '');
    switch (ev.key) {
      case 'j':
      case 'ArrowDown':
        feito();
        if (lista[i + 1]) this.e.regraSel.set(lista[i + 1].id);
        return;
      case 'k':
      case 'ArrowUp':
        feito();
        if (i > 0) this.e.regraSel.set(lista[i - 1].id);
        return;
      case 'l':
      case 'ArrowRight':
        feito();
        if (dominios[iD + 1]) this.escolherDominio(dominios[iD + 1]);
        return;
      case 'h':
      case 'ArrowLeft':
        feito();
        if (iD > 0) this.escolherDominio(dominios[iD - 1]);
        return;
      case 'Enter':
        feito();
        if (atual) this.abrirRegra(atual);
        return;
      case 'e':
        feito();
        void this.e.editarRegra(atual);
        return;
      case 'v':
        feito();
        if (atual) void this.e.alternarRevisada(atual);
        return;
      case 'c':
        feito();
        if (atual) this.caminhoDaRegra(atual);
        return;
      case 'a':
        feito();
        void this.e.atualizarComIa();
        return;
      case '/':
        feito();
        this.elFiltro()?.nativeElement.focus();
        return;
    }
  }

  protected teclarFiltro(ev: KeyboardEvent): void {
    if (ev.key === 'Escape' || ev.key === 'Enter') {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.key === 'Escape') this.e.filtro.set('');
      this.elCartoes()?.nativeElement.focus();
    }
  }

  private teclarCaminho(ev: KeyboardEvent, feito: () => void): void {
    const d = this.e.desenhoCaminho();
    if (ev.key === '+' || ev.key === '=') return (feito(), this.e.mudarNiveis(1));
    if (ev.key === '-' || ev.key === '_') return (feito(), this.e.mudarNiveis(-1));
    if (ev.key === 'a') return (feito(), void this.e.explicar());
    if (!d) return;
    if (ev.key === 'Enter') return (feito(), this.abrirNo());
    const dir = direcao(ev.key);
    if (dir) {
      feito();
      const atual = d.blocos.find((b) => b.id === this.e.noSel()) ?? d.blocos.find((b) => b.id === d.foco) ?? null;
      const prox = atual ? vizinho(d.blocos, atual, dir) : null;
      if (prox) this.e.noSel.set(prox.id);
    }
  }
}

type Direcao = 'esquerda' | 'direita' | 'cima' | 'baixo';

function direcao(k: string): Direcao | null {
  return ({ h: 'esquerda', ArrowLeft: 'esquerda', l: 'direita', ArrowRight: 'direita', k: 'cima', ArrowUp: 'cima', j: 'baixo', ArrowDown: 'baixo' } as Record<string, Direcao>)[k] ?? null;
}

/** O bloco mais perto na direção (h/l: a coluna vizinha que tiver algo; j/k: na mesma coluna). */
function vizinho(blocos: Bloco[], atual: Bloco, dir: Direcao): Bloco | null {
  const cy = atual.y + atual.altura / 2;
  const cx = atual.x + atual.largura / 2;
  if (dir === 'esquerda' || dir === 'direita') {
    const lado = blocos.filter((b) => (dir === 'direita' ? b.x > atual.x + 10 : b.x < atual.x - 10));
    if (!lado.length) return null;
    const alvoX = dir === 'direita' ? Math.min(...lado.map((b) => b.x)) : Math.max(...lado.map((b) => b.x));
    return lado.filter((b) => Math.abs(b.x - alvoX) < 30).sort((p, q) => Math.abs(p.y + p.altura / 2 - cy) - Math.abs(q.y + q.altura / 2 - cy))[0] ?? null;
  }
  const mesma = blocos.filter((b) => b !== atual && (dir === 'baixo' ? b.y > atual.y + 10 : b.y < atual.y - 10));
  return mesma.sort((p, q) => {
    const dp = Math.abs(p.x + p.largura / 2 - cx) * 2 + Math.abs(p.y - atual.y);
    const dq = Math.abs(q.x + q.largura / 2 - cx) * 2 + Math.abs(q.y - atual.y);
    return dp - dq;
  })[0] ?? null;
}

/** Cores do trecho de código, no estilo Alabaster (palavras-chave, strings e o resto). */
function colorir(linha: string): { texto: string; cor: string }[] {
  const partes: { texto: string; cor: string }[] = [];
  const re = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\/\/.*$)/g;
  let ultimo = 0;
  for (const m of linha.matchAll(re)) {
    if (m.index! > ultimo) partes.push(...palavras(linha.slice(ultimo, m.index)));
    partes.push({ texto: m[0], cor: m[0].startsWith('//') ? 'suave' : 'git-mais' });
    ultimo = m.index! + m[0].length;
  }
  if (ultimo < linha.length) partes.push(...palavras(linha.slice(ultimo)));
  return partes.length ? partes : [{ texto: ' ', cor: '' }];
}

function palavras(t: string): { texto: string; cor: string }[] {
  return t.split(SEPARAR_PALAVRAS).filter(Boolean).map((p) => ({ texto: p, cor: EH_PALAVRA.test(p) ? 'destaque-texto' : '' }));
}
