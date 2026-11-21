import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { BancoService } from './banco.service';
import { AmbienteBanco, PerfilBanco, ponte, TipoBanco } from '../nucleo/ponte';

const PORTA_PADRAO: Record<TipoBanco, number> = { postgres: 5432, mysql: 3306, oracle: 1521 };

/** Nova conexão / editar (n / e no painel de conexões). ctrl+⏎ salva e conecta. */
@Component({
  selector: 'sd-perfil-banco',
  template: `
    @if (banco.editando(); as ed) {
      <div class="busca perfil-banco" role="dialog" [attr.aria-label]="ed.novo ? 'Nova conexão' : 'Editar conexão'" (keydown)="teclar($event)">
        <div class="painel-faixa">
          <span class="rotulo">{{ ed.novo ? 'NOVA CONEXÃO' : 'CONEXÃO · ' + ed.perfil.nome.toUpperCase() }}</span>
        </div>
        <div class="perfil-corpo">
          <label class="campo larga"><span>nome</span>
            <input #primeiro type="text" spellcheck="false" [value]="p().nome" (input)="mudar('nome', valor($event))" placeholder="Produção" /></label>
          <label class="campo"><span>ambiente</span>
            <select [value]="p().ambiente" (change)="mudarAmbiente(valor($event))">
              <option value="local">Local</option><option value="homolog">Homolog</option><option value="producao">Produção</option>
            </select></label>
          <label class="campo"><span>banco</span>
            <select [value]="p().tipo" (change)="mudarTipo(valor($event))">
              <option value="postgres">PostgreSQL</option><option value="mysql">MySQL / MariaDB</option><option value="oracle">Oracle</option>
            </select></label>
          <label class="campo larga"><span>host</span>
            <input type="text" spellcheck="false" [value]="p().host" (input)="mudar('host', valor($event))" placeholder="localhost" /></label>
          <label class="campo"><span>porta</span>
            <input type="number" [value]="p().porta" (input)="mudar('porta', +valor($event))" /></label>
          <label class="campo"><span>{{ p().tipo === 'oracle' ? 'serviço' : 'banco' }}</span>
            <input type="text" spellcheck="false" [value]="p().banco" (input)="mudar('banco', valor($event))" [placeholder]="p().tipo === 'oracle' ? 'FREEPDB1' : 'feira_db'" /></label>
          <label class="campo"><span>usuário</span>
            <input type="text" spellcheck="false" [value]="p().usuario" (input)="mudar('usuario', valor($event))" /></label>
          <label class="campo"><span>senha</span>
            <input type="password" [value]="senha()" (input)="senha.set(valor($event))" [placeholder]="temSenha() ? '•••• guardada (vazio mantém)' : 'fica no cofre do sistema'" /></label>
          <label class="campo"><span>SSL</span>
            <select [value]="p().ssl" (change)="mudar('ssl', $any(valor($event)))">
              <option value="desligado">desligado</option><option value="exigir">exigir (sem validar certificado)</option><option value="verificar">verificar certificado</option>
            </select></label>
          <label class="campo larga"><span>túnel SSH</span>
            <input type="text" spellcheck="false" [value]="p().ssh ?? ''" (input)="mudar('ssh', valor($event).trim() || null)" placeholder="Host do ~/.ssh/config ou usuario@servidor (vazio = sem túnel)" /></label>
          @if (p().ssh) { <div class="perfil-dica suave larga">com túnel, host e porta são vistos de dentro do servidor SSH (ex.: localhost:5432)</div> }
          <label class="commit-opcao larga" title="alt+l">
            <input type="checkbox" [checked]="p().somenteLeitura" (change)="mudar('somenteLeitura', !p().somenteLeitura)" />
            somente leitura (o banco recusa qualquer alteração nesta conexão)
          </label>
          @if (p().tipo === 'oracle') { <div class="perfil-dica suave larga">o Oracle precisa do Oracle Instant Client instalado nesta máquina</div> }
        </div>
        <div class="perfil-acoes">
          <span class="espaco"></span>
          <button class="botao" (click)="banco.editando.set(null)">cancelar <kbd>esc</kbd></button>
          <button class="botao" (click)="salvar(false)">salvar</button>
          <button class="botao destaque" (click)="salvar(true)">salvar e conectar <kbd>ctrl ⏎</kbd></button>
        </div>
      </div>
    }
  `,
})
export class PerfilBancoComponent {
  protected readonly banco = inject(BancoService);
  private readonly primeiro = viewChild<ElementRef<HTMLInputElement>>('primeiro');
  protected readonly senha = signal('');
  protected readonly temSenha = signal(false);
  private focoAnterior: HTMLElement | null = null;

  protected p(): PerfilBanco {
    return this.banco.editando()!.perfil;
  }

  /** Muda só ao abrir/fechar (ou trocar de perfil), não a cada campo editado. */
  private readonly aberto = computed(() => {
    const ed = this.banco.editando();
    return ed ? { id: ed.perfil.id, novo: ed.novo } : null;
  }, { equal: (a, b) => a?.id === b?.id && a?.novo === b?.novo });

  constructor() {
    effect(() => {
      const ed = this.aberto();
      if (!ed) return;
      untracked(() => {
        this.senha.set(this.banco.editando()?.senha ?? '');
        this.focoAnterior = document.activeElement as HTMLElement | null;
        void ponte.banco.temSenha(ed.id).then((t) => this.temSenha.set(!ed.novo && t));
        queueMicrotask(() => this.primeiro()?.nativeElement.focus());
      });
    });
  }

  protected valor(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected mudar<K extends keyof PerfilBanco>(campo: K, valor: PerfilBanco[K]): void {
    this.banco.editando.update((ed) => (ed ? { ...ed, perfil: { ...ed.perfil, [campo]: valor } } : ed));
  }

  protected mudarTipo(tipo: string): void {
    const antigo = this.p();
    this.mudar('tipo', tipo as TipoBanco);
    // A porta acompanha o banco, se ainda era a padrão do anterior.
    if (antigo.porta === PORTA_PADRAO[antigo.tipo]) this.mudar('porta', PORTA_PADRAO[tipo as TipoBanco]);
  }

  protected mudarAmbiente(a: string): void {
    this.mudar('ambiente', a as AmbienteBanco);
    // Produção nasce somente leitura (dá para desligar).
    if (a === 'producao') this.mudar('somenteLeitura', true);
  }

  protected async salvar(conectar: boolean): Promise<void> {
    const p = this.p();
    if (!p.nome.trim()) {
      this.primeiro()?.nativeElement.focus();
      return;
    }
    const perfil = { ...p, nome: p.nome.trim(), host: p.host.trim(), banco: p.banco.trim(), usuario: p.usuario.trim() };
    const ok = await this.banco.salvar(perfil, this.senha() ? this.senha() : null, conectar);
    if (ok) this.restaurarFoco();
  }

  protected teclar(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.banco.editando.set(null);
      this.restaurarFoco();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void this.salvar(true);
    else if (e.altKey && e.code === 'KeyL') this.mudar('somenteLeitura', !this.p().somenteLeitura);
    else {
      e.stopPropagation(); // espaço e letras ficam no campo
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  private restaurarFoco(): void {
    const a = this.focoAnterior;
    this.focoAnterior = null;
    if (a?.isConnected && a !== document.body) queueMicrotask(() => a.focus());
  }
}
