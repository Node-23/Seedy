/**
 * Comandos de shell que a IA nunca roda sozinha: mesmo no modo automático, o usuário aprova na hora.
 * Não é uma lista de proibidos: é uma lista de "pergunte sempre" (apagar em massa, reescrever a história
 * do git, publicar, baixar e executar, tirar dados da máquina, mexer no sistema).
 */
const REGRAS: { re: RegExp; motivo: string }[] = [
  // Apagar em massa
  { re: /\brm\s+(-[a-z]*r[a-z]*|--recursive)\b/i, motivo: 'apaga pastas inteiras (rm -r)' },
  { re: /\b(rmdir|rd)\s+(\/s|\/q)/i, motivo: 'apaga pastas inteiras (rmdir /s)' },
  { re: /\bdel\s+(\/[a-z]\s+)*\/[sqf]\b/i, motivo: 'apaga arquivos em massa (del /s)' },
  { re: /\bRemove-Item\b[^|;&]*-Recurse/i, motivo: 'apaga pastas inteiras (Remove-Item -Recurse)' },
  { re: /\b(format|mkfs(\.\w+)?|diskpart)\b/i, motivo: 'formata ou particiona disco' },
  { re: /\bdd\s+[^|;&]*\bof=/i, motivo: 'escreve direto em disco (dd)' },
  // Reescrever ou perder trabalho no git
  { re: /\bgit\b[^|;&]*\bpush\b[^|;&]*(--force\b|--force-with-lease|\s-f\b|\s\+\S)/i, motivo: 'reescreve a história no remoto (git push --force)' },
  { re: /\bgit\s+reset\s+[^|;&]*--hard\b/i, motivo: 'descarta alterações (git reset --hard)' },
  { re: /\bgit\s+clean\b[^|;&]*-[a-z]*[fdx]/i, motivo: 'apaga arquivos não rastreados (git clean)' },
  { re: /\bgit\s+(checkout|restore)\b[^|;&]*\s\.\s*$/i, motivo: 'descarta alterações do projeto todo' },
  { re: /\bgit\s+branch\b[^|;&]*\s-D\b/, motivo: 'apaga uma branch sem checar o merge (git branch -D)' },
  { re: /\bgit\s+push\b[^|;&]*--delete\b/i, motivo: 'apaga uma branch ou tag no remoto' },
  { re: /\bgit\s+filter-(branch|repo)\b/i, motivo: 'reescreve a história inteira do repositório' },
  // Publicar
  { re: /\bgit\s+push\b/i, motivo: 'envia commits ao remoto (git push)' },
  { re: /\bnpm\s+publish\b|\byarn\s+publish\b|\bpnpm\s+publish\b/i, motivo: 'publica um pacote (npm publish)' },
  { re: /\bmvn(w)?(\.cmd)?\b[^|;&]*\bdeploy\b|\bgradle(w)?\b[^|;&]*\bpublish\b/i, motivo: 'publica o artefato (deploy/publish)' },
  { re: /\bdocker\s+push\b/i, motivo: 'publica uma imagem (docker push)' },
  { re: /\bgh\s+(release|repo)\s+(create|delete)\b/i, motivo: 'cria ou apaga release/repositório no GitHub' },
  // Baixar e executar
  { re: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/i, motivo: 'baixa e executa um script (curl | sh)' },
  { re: /\b(iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^|]*\|\s*(iex|Invoke-Expression)\b/i, motivo: 'baixa e executa um script (iwr | iex)' },
  { re: /\bInvoke-Expression\b|\biex\s*\(/i, motivo: 'executa texto como comando (Invoke-Expression)' },
  // Mandar dados para fora / ler segredos
  { re: /\b(curl|wget)\b[^|;&]*(\s-d\b|--data\b|--data-\w+|\s-F\b|--form\b|\s-T\b|--upload-file|--post-file)/i, motivo: 'envia dados para fora da máquina' },
  { re: /\b(Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b[^|;&]*-(Body|InFile)\b/i, motivo: 'envia dados para fora da máquina' },
  { re: /(\.ssh[\\/]|\.aws[\\/]|\.gnupg|id_rsa|id_ed25519|\.kube[\\/]config|credentials\.json|\.npmrc\b|\.netrc)/i, motivo: 'mexe em chaves e credenciais' },
  { re: /\b(printenv|env|set)\s*\|\s*(curl|wget|nc|ncat)\b/i, motivo: 'manda as variáveis de ambiente para fora' },
  // Sistema e permissões
  { re: /\bsudo\b|\brunas\b|\bsu\s+-?\s*\w*/i, motivo: 'pede privilégios de administrador' },
  { re: /\bchmod\s+(-R\s+)?[0-7]*7{2,3}\b|\bchmod\s+-R\b|\bchown\s+-R\b/i, motivo: 'muda permissões em massa' },
  { re: /\b(shutdown|reboot|halt|poweroff|Restart-Computer|Stop-Computer)\b/i, motivo: 'desliga ou reinicia a máquina' },
  { re: /\b(reg\s+(add|delete)|setx\b|schtasks\s+\/create|crontab\s+-[re])/i, motivo: 'muda o registro, variáveis do sistema ou tarefas agendadas' },
  { re: /\b(kill|killall|pkill|taskkill)\b[^|;&]*(-9|\/f)\b/i, motivo: 'encerra processos à força' },
  { re: /:\(\)\s*\{\s*:\s*\|/, motivo: 'fork bomb' },
  // Containers e bancos
  { re: /\bdocker\s+(system|volume|image|container|network)\s+prune\b|\bdocker\s+volume\s+rm\b|\bdocker\s+compose\b[^|;&]*\bdown\b[^|;&]*-v\b/i, motivo: 'apaga volumes ou dados do Docker' },
  { re: /\bdocker\s+rm\s+[^|;&]*-f\b|\bdocker\s+(kill|rmi)\b/i, motivo: 'remove containers ou imagens' },
  { re: /\b(drop\s+(table|database|schema)|truncate\s+table|delete\s+from\s+\w+\s*(;|"|'|$))/i, motivo: 'apaga dados ou estruturas do banco' },
];

/** O motivo de o comando ser sensível, ou null se pode seguir o fluxo normal de aprovação. */
export function motivoSensivel(comando: string): string | null {
  const texto = comando.replace(/\s+/g, ' ');
  return REGRAS.find((r) => r.re.test(texto))?.motivo ?? null;
}
