import { Injectable, signal } from '@angular/core';

export interface Aprovacao {
  quando: number;
  /** O que a IA pediu ("A IA QUER RODAR UM COMANDO"...). */
  titulo: string;
  detalhe: string;
  decisao: 'aprovado' | 'recusado' | 'automático';
}

const LIMITE = 200;

/** Tudo o que a IA pediu para fazer nesta sessão e o que foi decidido (`/historico` no chat). */
@Injectable({ providedIn: 'root' })
export class AprovacoesService {
  readonly registro = signal<Aprovacao[]>([]);

  registrar(titulo: string, detalhe: string, decisao: Aprovacao['decisao']): void {
    this.registro.update((l) => [...l, { quando: Date.now(), titulo, detalhe, decisao }].slice(-LIMITE));
  }

  /** O histórico em markdown (o chat renderiza), do mais recente para o mais antigo. */
  texto(): string {
    const l = [...this.registro()].reverse();
    if (!l.length) return 'Nada foi pedido pela IA nesta sessão ainda.';
    const marca = { aprovado: '✓ aprovado', recusado: '✗ recusado', 'automático': '⚡ automático' };
    return [
      `**Histórico de aprovações da IA** (${l.length}, do mais recente ao mais antigo):`,
      '',
      ...l.map((a) => {
        const hora = new Date(a.quando).toTimeString().slice(0, 8);
        const pedido = a.titulo.replace(/^A IA QUER /, '').toLowerCase();
        return `- \`${hora}\` ${marca[a.decisao]} — ${pedido}: ${a.detalhe.split('\n')[0].slice(0, 160)}`;
      }),
    ].join('\n');
  }
}
