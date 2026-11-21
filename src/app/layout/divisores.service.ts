import { Injectable } from '@angular/core';

/** Grades das telas cheias cujas colunas e linhas o usuário pode arrastar (o vão entre os painéis). */
const GRADES = '.git-tela, .debug-grade, .docker-grade, .docker-painel-corpo, .entender-grade, .testes-grade';
const MINIMO = 140;
const FOLGA = 3;
const CHAVE = 'seedy.divisores';

type Eixo = 'colunas' | 'linhas';
interface Linha { eixo: Eixo; indice: number }

/**
 * Arrastar o vão entre dois painéis de qualquer tela cheia redimensiona os dois (como o
 * editor já faz com as regiões). As trilhas viram frações (fr) proporcionais ao tamanho em
 * pixels, então continuam acompanhando a janela; o tamanho fica guardado por tela.
 */
@Injectable({ providedIn: 'root' })
export class DivisoresService {
  private salvos: Record<string, { colunas?: number[]; linhas?: number[] }> = this.ler();

  constructor() {
    document.addEventListener('pointermove', (e) => this.aoMover(e), { capture: true, passive: true });
    document.addEventListener('pointerdown', (e) => this.aoPressionar(e), { capture: true });
    // As telas são criadas e destruídas ao abrir/fechar: o tamanho guardado volta ao reaparecerem.
    new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes.forEach((n) => {
          if (n instanceof HTMLElement) [n, ...Array.from(n.querySelectorAll<HTMLElement>(GRADES))].filter((x) => x.matches(GRADES)).forEach((g) => this.restaurar(g));
        });
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  private ler(): Record<string, { colunas?: number[]; linhas?: number[] }> {
    try {
      return JSON.parse(localStorage.getItem(CHAVE) ?? '{}');
    } catch {
      return {};
    }
  }

  private guardar(): void {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(this.salvos));
    } catch {
      /* sem armazenamento: vale só até fechar */
    }
  }

  private chave(g: HTMLElement): string {
    return [...g.classList].filter((c) => !c.startsWith('ng-')).join('.');
  }

  private trilhas(g: HTMLElement, eixo: Eixo): number[] {
    const v = getComputedStyle(g)[eixo === 'colunas' ? 'gridTemplateColumns' : 'gridTemplateRows'];
    return v.split(' ').map(parseFloat).filter((n) => !Number.isNaN(n));
  }

  private aplicar(g: HTMLElement, eixo: Eixo, tamanhos: number[]): void {
    g.style[eixo === 'colunas' ? 'gridTemplateColumns' : 'gridTemplateRows'] = tamanhos.map((t) => `minmax(0, ${t.toFixed(3)}fr)`).join(' ');
  }

  private restaurar(g: HTMLElement): void {
    const s = this.salvos[this.chave(g)];
    if (!s) return;
    for (const eixo of ['colunas', 'linhas'] as Eixo[]) {
      const t = s[eixo];
      if (t && t.length === this.trilhas(g, eixo).length) this.aplicar(g, eixo, t);
    }
  }

  /** O vão sob o ponteiro (só quando o alvo é a própria grade, ou seja, não há painel ali). */
  private vao(e: PointerEvent): { grade: HTMLElement; linha: Linha } | null {
    const alvo = e.target;
    if (!(alvo instanceof HTMLElement) || !alvo.matches(GRADES)) return null;
    const cs = getComputedStyle(alvo);
    const r = alvo.getBoundingClientRect();
    for (const eixo of ['colunas', 'linhas'] as Eixo[]) {
      const tr = this.trilhas(alvo, eixo);
      const vao = parseFloat(eixo === 'colunas' ? cs.columnGap : cs.rowGap) || 0;
      let pos = (eixo === 'colunas' ? r.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth) : r.top + parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth));
      const p = eixo === 'colunas' ? e.clientX : e.clientY;
      for (let i = 0; i < tr.length - 1; i++) {
        pos += tr[i];
        if (p >= pos - FOLGA && p <= pos + vao + FOLGA) return { grade: alvo, linha: { eixo, indice: i } };
        pos += vao;
      }
    }
    return null;
  }

  private aoMover(e: PointerEvent): void {
    if (document.body.classList.contains('arrastando')) return;
    const alvo = e.target;
    if (!(alvo instanceof HTMLElement) || !alvo.matches(GRADES)) return;
    const v = this.vao(e);
    alvo.style.cursor = v ? (v.linha.eixo === 'colunas' ? 'col-resize' : 'row-resize') : '';
  }

  private aoPressionar(e: PointerEvent): void {
    if (e.button !== 0) return;
    const v = this.vao(e);
    if (!v) return;
    e.preventDefault();
    const { grade, linha } = v;
    const inicio = this.trilhas(grade, linha.eixo);
    const p0 = linha.eixo === 'colunas' ? e.clientX : e.clientY;
    const total = inicio.reduce((a, b) => a + b, 0);
    const mover = (m: PointerEvent) => {
      const d = (linha.eixo === 'colunas' ? m.clientX : m.clientY) - p0;
      const a = Math.max(MINIMO, Math.min(inicio[linha.indice] + inicio[linha.indice + 1] - MINIMO, inicio[linha.indice] + d));
      const novo = [...inicio];
      novo[linha.indice + 1] = inicio[linha.indice] + inicio[linha.indice + 1] - a;
      novo[linha.indice] = a;
      this.aplicar(grade, linha.eixo, novo.map((t) => t / total));
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      document.body.classList.remove('arrastando');
      const k = this.chave(grade);
      const atual = this.trilhas(grade, linha.eixo);
      const soma = atual.reduce((a, b) => a + b, 0);
      this.salvos[k] = { ...this.salvos[k], [linha.eixo]: atual.map((t) => t / soma) };
      this.guardar();
    };
    document.body.classList.add('arrastando');
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  }
}
