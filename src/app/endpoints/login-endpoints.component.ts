import { Component, effect, ElementRef, inject, Injectable, signal, untracked, viewChild } from '@angular/core';

export interface PedidoDeLogin {
  /** Onde o login vai ("POST /auth/login"). */
  destino: string;
  /** O último usuário que tentou entrar (vem preenchido). */
  usuario: string;
  /** Por que a tentativa anterior falhou (aparece em cima dos campos). */
  erro: string | null;
  resolver: (r: { usuario: string; senha: string } | null) => void;
}

/** O popup de login dos endpoints: usuário e senha juntos; se a conexão falha, ele abre de novo com o último usuário. */
@Injectable({ providedIn: 'root' })
export class LoginEndpointsService {
  readonly pedido = signal<PedidoDeLogin | null>(null);
  private focoAnterior: HTMLElement | null = null;

  pedir(destino: string, usuario: string, erro: string | null): Promise<{ usuario: string; senha: string } | null> {
    if (!this.pedido()) this.focoAnterior = document.activeElement as HTMLElement | null;
    this.pedido()?.resolver(null);
    return new Promise((resolver) => this.pedido.set({ destino, usuario, erro, resolver }));
  }

  private fechar(r: { usuario: string; senha: string } | null): void {
    const p = this.pedido();
    this.pedido.set(null);
    p?.resolver(r);
    const anterior = this.focoAnterior;
    this.focoAnterior = null;
    if (anterior?.isConnected && anterior !== document.body) queueMicrotask(() => anterior.focus());
  }

  confirmar(usuario: string, senha: string): void {
    this.fechar(usuario.trim() && senha ? { usuario: usuario.trim(), senha } : null);
  }

  cancelar(): void {
    this.fechar(null);
  }
}

@Component({
  selector: 'sd-login-endpoints',
  template: `
    @if (s.pedido(); as p) {
      <div class="busca escolha login-endpoints" role="dialog" aria-label="Login para os endpoints" (keydown)="teclar($event)">
        <div class="painel-faixa"><span class="rotulo">LOGIN PARA OS ENDPOINTS</span><span class="espaco"></span><span class="suave">{{ p.destino }}</span></div>
        @if (p.erro; as erro) { <div class="login-erro erro-texto">{{ erro }}</div> }
        <label class="busca-campo">
          <span class="busca-prompt login-rotulo">usuário</span>
          <input #usuario type="text" spellcheck="false" autocomplete="off" aria-label="Usuário" [value]="p.usuario" />
        </label>
        <label class="busca-campo">
          <span class="busca-prompt login-rotulo">senha</span>
          <input #senha type="password" spellcheck="false" autocomplete="off" aria-label="Senha" />
        </label>
        <div class="busca-dicas">
          <span><span class="tecla">tab</span> próximo campo</span>
          <span><span class="tecla">⏎</span> entrar</span>
          <span><span class="tecla">esc</span> cancelar</span>
          <span class="espaco"></span>
          <span>a senha e o token ficam só na memória, até fechar o Seedy</span>
        </div>
      </div>
    }
  `,
})
export class LoginEndpointsComponent {
  protected readonly s = inject(LoginEndpointsService);
  private readonly usuario = viewChild<ElementRef<HTMLInputElement>>('usuario');
  private readonly senha = viewChild<ElementRef<HTMLInputElement>>('senha');

  constructor() {
    effect(() => {
      const p = this.s.pedido();
      if (!p) return;
      // Com o usuário já preenchido (de uma tentativa anterior), vai direto para a senha.
      untracked(() => setTimeout(() => (p.usuario ? this.senha() : this.usuario())?.nativeElement.focus()));
    });
  }

  protected teclar(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.s.cancelar();
    } else if (e.key === 'Enter') {
      const u = this.usuario()?.nativeElement;
      const sn = this.senha()?.nativeElement;
      if (!u || !sn) return;
      // ⏎ no usuário vai para a senha; ⏎ na senha entra.
      if (e.target === u && !sn.value) sn.focus();
      else this.s.confirmar(u.value, sn.value);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }
}
