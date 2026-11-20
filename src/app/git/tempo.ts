/** "há 20 min", "há 3 h", "ontem", "há 2 dias", "há 1 sem", "15/03/2025". */
export function haQuanto(segundos: number, agora = Date.now() / 1000): string {
  const s = Math.max(0, agora - segundos);
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  const dias = Math.floor(s / 86400);
  if (dias === 1) return 'ontem';
  if (dias < 7) return `há ${dias} dias`;
  if (dias < 35) return `há ${Math.floor(dias / 7)} sem`;
  return new Date(segundos * 1000).toLocaleDateString('pt-BR');
}

/** "hoje 16:12", "ontem 09:30", "12/11 18:00", "12/11/2024". */
export function dataCurta(segundos: number): string {
  const d = new Date(segundos * 1000);
  const hoje = new Date();
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const ontem = new Date(hoje.getTime() - 86400000);
  if (d.toDateString() === hoje.toDateString()) return `hoje ${hora}`;
  if (d.toDateString() === ontem.toDateString()) return `ontem ${hora}`;
  if (d.getFullYear() === hoje.getFullYear()) return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora}`;
  return d.toLocaleDateString('pt-BR');
}
