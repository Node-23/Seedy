import { inject, Injectable, signal } from '@angular/core';
import { ponte } from '../nucleo/ponte';
import { MensagensService } from '../nucleo/mensagens.service';
import { FERRAMENTAS, FerramentasService } from './ferramentas.service';

/**
 * Lado da interface do servidor MCP: diz ao núcleo quais ferramentas existem e executa
 * cada chamada do Claude Code (`mcp-chamada`) com as ferramentas do Seedy.
 */
@Injectable({ providedIn: 'root' })
export class McpService {
  private readonly ferramentas = inject(FerramentasService);
  private readonly mensagens = inject(MensagensService);

  /** Última ferramenta chamada pelo Claude Code (a statusline mostra). */
  readonly ultima = signal<{ rotulo: string; quando: number } | null>(null);

  constructor() {
    void ponte.mcp.definirFerramentas(
      FERRAMENTAS.map((f) => ({ name: f.name, title: f.rotulo, description: f.description, inputSchema: f.input_schema })),
    );
    void ponte.mcp.aoChamar((c) => void this.atender(c.id, c.nome, c.argumentos ?? {}));
  }

  private async atender(id: number, nome: string, argumentos: Record<string, unknown>): Promise<void> {
    this.ultima.set({ rotulo: this.ferramentas.rotulo(nome), quando: Date.now() });
    try {
      const r = await this.ferramentas.executar(nome, argumentos, 'claude-code');
      await ponte.mcp.responder(id, r, null);
    } catch (e) {
      await ponte.mcp.responder(id, null, (e as Error).message ?? String(e));
    }
  }

  /** Copia o comando que registra o Seedy no Claude Code (uma vez só; o token não muda). */
  async copiarComandoDoClaudeCode(): Promise<void> {
    const info = await ponte.mcp.info();
    if (!info.comando) {
      this.mensagens.erro('o servidor MCP do Seedy não está rodando (só no app)');
      return;
    }
    try {
      await navigator.clipboard.writeText(info.comando);
      this.mensagens.mostrar(`comando copiado: cole no terminal (alt+F12) para o Claude Code usar o Seedy (${info.url})`);
    } catch {
      this.mensagens.mostrar(info.comando);
    }
  }
}
