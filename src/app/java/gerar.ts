/**
 * "Gerar..." do jdtls (alt+insert): getters/setters, construtor, toString,
 * equals/hashCode e sobrescrever métodos. O jdtls manda um comando de
 * "prompt"; aqui o Seedy pergunta (janela de escolha), pede o código ao jdtls
 * e aplica a edição.
 */
import { EscolhaService } from '../escolha/escolha.service';
import { MensagensService } from '../nucleo/mensagens.service';
import { EdicaoDeWorkspaceLsp } from './conversao';
import { JdtlsService } from './jdtls.service';

interface Campo {
  bindingKey: string;
  name: string;
  type: string;
  isField: boolean;
  isSelected: boolean;
}

interface Acessor {
  fieldName: string;
  isStatic: boolean;
  generateGetter: boolean;
  generateSetter: boolean;
  typeName: string;
}

interface Metodo {
  bindingKey: string;
  name: string;
  parameters: string[];
  unimplemented?: boolean;
  declaringClass?: string;
}

/** Trata um comando de "prompt" do jdtls. Devolve false se não for um deles. */
export async function executarGerador(
  comando: string,
  args: unknown[],
  jdtls: JdtlsService,
  escolha: EscolhaService,
  mensagens: MensagensService,
): Promise<boolean> {
  const cliente = jdtls.cliente();
  const contexto = args[0] as Record<string, unknown> | undefined;
  if (!cliente || !contexto) return false;
  const pedir = <T>(metodo: string, params: unknown) => cliente.pedir<T>(metodo, params);
  const aplicar = async (edicao: EdicaoDeWorkspaceLsp | null, oQue: string) => {
    if (!edicao) return mensagens.erro(`jdtls não gerou ${oQue}`);
    await jdtls.aplicarEdicao(edicao);
    mensagens.mostrar(`${oQue} gerado`);
  };
  const opcoesDeCampos = (campos: Campo[], todosMarcados = false) =>
    campos.map((c) => ({ rotulo: c.name, detalhe: c.type, valor: c, marcada: todosMarcados || c.isSelected }));

  switch (comando) {
    case 'java.action.generateAccessorsPrompt': {
      const tipo = (contexto['kind'] as number | undefined) ?? 2; // 0 getters, 1 setters, 2 os dois
      const campos = await pedir<Acessor[]>('java/resolveUnimplementedAccessors', contexto);
      const faltando = (campos ?? []).filter((c) => (tipo !== 1 && c.generateGetter) || (tipo !== 0 && c.generateSetter));
      if (!faltando.length) {
        mensagens.mostrar('todos os campos já têm getter/setter');
        return true;
      }
      const titulo = tipo === 0 ? 'GERAR GETTERS' : tipo === 1 ? 'GERAR SETTERS' : 'GERAR GETTERS E SETTERS';
      const escolhidos = await escolha.escolher(
        titulo,
        faltando.map((c) => ({
          rotulo: c.fieldName,
          detalhe: `${c.typeName}${c.isStatic ? ' (static)' : ''}`,
          valor: c,
          marcada: true,
        })),
        { multipla: true },
      );
      if (!escolhidos?.length) return true;
      const acessores = escolhidos.map((c) => ({
        ...c,
        generateGetter: tipo !== 1 && c.generateGetter,
        generateSetter: tipo !== 0 && c.generateSetter,
      }));
      await aplicar(await pedir('java/generateAccessors', { context: contexto, accessors: acessores }), 'getter/setter');
      return true;
    }

    case 'java.action.generateConstructorsPrompt': {
      const estado = await pedir<{ constructors: Metodo[]; fields: Campo[] }>('java/checkConstructorsStatus', contexto);
      if (!estado?.constructors?.length) {
        mensagens.mostrar('não há construtor para gerar aqui');
        return true;
      }
      // Classe com vários construtores na superclasse: primeiro escolhe qual chamar.
      let base: Metodo | null = estado.constructors[0];
      if (estado.constructors.length > 1) {
        base = await escolha.escolherUm(
          'CONSTRUTOR DA SUPERCLASSE',
          estado.constructors.map((c) => ({ rotulo: `${c.name}(${c.parameters.join(', ')})`, valor: c })),
        );
        if (!base) return true;
      }
      let campos: Campo[] = [];
      if (estado.fields?.length) {
        const r = await escolha.escolher('CAMPOS DO CONSTRUTOR', opcoesDeCampos(estado.fields), {
          multipla: true,
          dica: 'nenhum marcado = construtor vazio',
        });
        if (r === null) return true;
        campos = r;
      }
      await aplicar(await pedir('java/generateConstructors', { context: contexto, constructors: [base], fields: campos }), 'construtor');
      return true;
    }

    case 'java.action.generateToStringPrompt': {
      const estado = await pedir<{ type: string; fields: Campo[]; exists: boolean }>('java/checkToStringStatus', contexto);
      if (!estado) return true;
      if (estado.exists && !(await confirmar(escolha, `${estado.type} já tem toString(). Substituir?`))) return true;
      const campos = await escolha.escolher(`TOSTRING DE ${estado.type.toUpperCase()}`, opcoesDeCampos(estado.fields), { multipla: true });
      if (campos === null) return true;
      await aplicar(await pedir('java/generateToString', { context: contexto, fields: campos }), 'toString()');
      return true;
    }

    case 'java.action.hashCodeEqualsPrompt': {
      const estado = await pedir<{ type: string; fields: Campo[]; existingMethods: string[] }>('java/checkHashCodeEqualsStatus', contexto);
      if (!estado?.fields?.length) {
        mensagens.mostrar('não há campos para equals/hashCode');
        return true;
      }
      const existentes = estado.existingMethods ?? [];
      const regerar = existentes.length > 0;
      if (regerar && !(await confirmar(escolha, `${estado.type} já tem ${existentes.join(' e ')}. Substituir?`))) return true;
      const campos = await escolha.escolher(`EQUALS/HASHCODE DE ${estado.type.toUpperCase()}`, opcoesDeCampos(estado.fields, true), {
        multipla: true,
      });
      if (!campos?.length) return true;
      await aplicar(
        await pedir('java/generateHashCodeEquals', { context: contexto, fields: campos, regenerate: regerar }),
        'equals() e hashCode()',
      );
      return true;
    }

    case 'java.action.overrideMethodsPrompt': {
      const estado = await pedir<{ type: string; methods: Metodo[] }>('java/listOverridableMethods', contexto);
      if (!estado?.methods?.length) {
        mensagens.mostrar('nada para sobrescrever');
        return true;
      }
      const metodos = await escolha.escolher(
        `SOBRESCREVER EM ${estado.type.toUpperCase()}`,
        estado.methods.map((m) => ({
          rotulo: `${m.name}(${m.parameters.join(', ')})`,
          detalhe: m.declaringClass,
          valor: m,
          // Os que a classe é obrigada a implementar já vêm marcados.
          marcada: !!m.unimplemented,
        })),
        { multipla: true },
      );
      if (!metodos?.length) return true;
      await aplicar(await pedir('java/addOverridableMethods', { context: contexto, overridableMethods: metodos }), 'métodos');
      return true;
    }

    default:
      return false;
  }
}

async function confirmar(escolha: EscolhaService, pergunta: string): Promise<boolean> {
  const r = await escolha.escolherUm(pergunta.toUpperCase(), [
    { rotulo: 'Substituir', valor: true },
    { rotulo: 'Cancelar', valor: false },
  ]);
  return r === true;
}
