import { computed, inject, Injectable, isDevMode, signal } from '@angular/core';
import { ConfigService } from '../config/config.service';
import { ponte } from '../nucleo/ponte';

/** Um limite de uso da assinatura, como o Claude Code informa depois de cada resposta. */
export interface LimiteDeUso {
  tipo: string;
  /** 0 a 100, quando o Claude Code informa a porcentagem. */
  utilizacao: number | null;
  /** Quando a janela renova (segundos desde 1970). */
  reiniciaEm: number | null;
  estado: string | null;
}

export interface JanelaVista {
  /** null = o Claude Code só avisou o estado, sem porcentagem. */
  pct: number | null;
  nivel: 'ok' | 'aviso' | 'erro';
  rotulo: string;
  renova: string;
  vistoEm: Date;
}

const CHAVE = 'seedy.limites';

/**
 * Uso da assinatura do Claude (janela de 5 horas e semana). O número vem do Claude Code, no modo
 * "assinatura": cada resposta traz o estado dos limites. Com chave da API não há esse limite.
 */
@Injectable({ providedIn: 'root' })
export class LimitesService {
  private readonly config = inject(ConfigService);

  private readonly cincoH = signal<(LimiteDeUso & { visto: number }) | null>(null);
  private readonly semanal = signal<(LimiteDeUso & { visto: number }) | null>(null);
  /** O painel com os detalhes (clique no indicador). */
  readonly aberto = signal(false);
  private readonly agora = signal(Date.now());

  /** Tipos de janela que já chegaram (para dizer o que falta quando uma das duas não veio). */
  readonly recebidos = signal<Record<string, number>>({});

  readonly visivel = computed(() => this.config.atual().ia.modo === 'assinatura' && (!!this.cincoH() || !!this.semanal() || Object.keys(this.recebidos()).length > 0));
  readonly faltaDe5h = computed(() => !this.cincoH());
  readonly faltaSemana = computed(() => !this.semanal());
  readonly tiposRecebidos = computed(() => Object.keys(this.recebidos()).join(', '));
  readonly janelaDe5h = computed(() => this.ver(this.cincoH(), 'horas'));
  readonly semana = computed(() => this.ver(this.semanal(), 'dia'));

  constructor() {
    try {
      const salvo = JSON.parse(localStorage.getItem(CHAVE) ?? '{}');
      if (salvo.cincoH) this.cincoH.set(salvo.cincoH);
      if (salvo.semanal) this.semanal.set(salvo.semanal);
      if (salvo.recebidos) this.recebidos.set(salvo.recebidos);
    } catch {
      /* sem histórico */
    }
    void ponte.ia.aoLimites((l) => this.receber(l));
    // Para o "renova em…" e a janela que já renovou: reavalia a cada minuto.
    setInterval(() => this.agora.set(Date.now()), 60_000);
    if (isDevMode()) Object.assign(window, { seedyLimites: this });
  }

  receber(l: LimiteDeUso): void {
    const t = l.tipo.toLowerCase();
    const caso = { ...l, visto: Date.now() };
    this.recebidos.update((r) => ({ ...r, [l.tipo]: Date.now() }));
    if (/five|5h|5_h|hour/.test(t)) this.cincoH.set(caso);
    else if (/seven|week|7/.test(t)) {
      // seven_day, seven_day_opus...: vale o mais cheio.
      const atual = this.semanal();
      if (!atual || (l.utilizacao ?? 0) >= (atual.utilizacao ?? 0) || (atual.reiniciaEm ?? 0) < Date.now() / 1000) this.semanal.set(caso);
    }
    try {
      localStorage.setItem(CHAVE, JSON.stringify({ cincoH: this.cincoH(), semanal: this.semanal(), recebidos: this.recebidos() }));
    } catch {
      /* só vale até fechar */
    }
  }

  private ver(l: (LimiteDeUso & { visto: number }) | null, escala: 'horas' | 'dia'): JanelaVista | null {
    if (!l) return null;
    this.agora();
    const renovou = l.reiniciaEm !== null && l.reiniciaEm * 1000 < Date.now();
    const pct = renovou ? 0 : l.utilizacao;
    const estado = renovou ? 'allowed' : (l.estado ?? '');
    const nivel: JanelaVista['nivel'] = estado.includes('reject') || (pct ?? 0) >= 90 ? 'erro' : estado.includes('warning') || (pct ?? 0) >= 75 ? 'aviso' : 'ok';
    const rotulo = pct !== null ? `${Math.round(pct)}%` : nivel === 'ok' ? 'ok' : nivel === 'aviso' ? 'perto' : 'no limite';
    return { pct, nivel, rotulo, renova: renovou ? 'renovou' : this.quando(l.reiniciaEm, escala), vistoEm: new Date(l.visto) };
  }

  private quando(s: number | null, escala: 'horas' | 'dia'): string {
    if (!s) return 'sem horário de renovação';
    const d = new Date(s * 1000);
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (escala === 'dia') return `renova ${d.toLocaleDateString('pt-BR', { weekday: 'long' })}, ${hora}`;
    const min = Math.max(0, Math.round((s * 1000 - Date.now()) / 60000));
    const h = Math.floor(min / 60);
    return `renova em ${h ? `${h} h ` : ''}${min % 60} min (às ${hora})`;
  }
}
