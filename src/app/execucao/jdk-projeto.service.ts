import { inject, Injectable } from '@angular/core';
import { ponte } from '../nucleo/ponte';
import { ProjetoService } from '../nucleo/projeto.service';

export interface JdkDoProjeto {
  home: string;
  versao: string;
  /** A versão que o pom.xml ou o build.gradle declaram. */
  declarada: number;
}

/**
 * O JDK com que o Maven e o Gradle rodam: o menor instalado que atenda a versão que o projeto declara
 * (um pom de Java 17 roda no 21 e não no 25, onde o Lombok antigo e outros processadores de anotação
 * quebram). Vira `JAVA_HOME` nos testes e nos comandos da IA; um `JAVA_HOME` do `.env` ganha.
 */
@Injectable({ providedIn: 'root' })
export class JdkProjetoService {
  private readonly projeto = inject(ProjetoService);

  async doProjeto(): Promise<JdkDoProjeto | null> {
    const raiz = this.projeto.raiz();
    if (!raiz) return null;
    return ponte.java.jdkDoProjeto(raiz).catch(() => null);
  }

  /** `{ JAVA_HOME }` para o build do projeto, ou `{}` se ele não declara versão (ou não há JDK que atenda). */
  async ambiente(): Promise<{ ambiente: Record<string, string>; aviso: string | null }> {
    const j = await this.doProjeto();
    if (!j) return { ambiente: {}, aviso: null };
    return { ambiente: { JAVA_HOME: j.home }, aviso: `JDK ${j.versao} no build (o projeto declara Java ${j.declarada})` };
  }
}
