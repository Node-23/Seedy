import { Injectable, signal } from '@angular/core';
import { nomeBase, ponte } from '../nucleo/ponte';

export type TipoDeProjeto = 'Spring Boot' | 'Java · Maven' | 'Java · Gradle' | 'Angular · Tauri' | 'Tauri' | 'Angular' | 'React · Vite' | 'React' | 'Node' | 'pasta';

export interface Recente {
  caminho: string;
  /** Quando foi aberto pela última vez (ms). */
  quando: number;
  tipo: TipoDeProjeto;
}

const CHAVE = 'seedy.recentes';
const LIMITE = 20;

/** Os projetos abertos há pouco, para a tela de início. */
@Injectable({ providedIn: 'root' })
export class RecentesService {
  readonly lista = signal<Recente[]>(ler());

  async registrar(caminho: string): Promise<void> {
    const tipo = await descobrirTipo(caminho).catch(() => 'pasta' as const);
    this.gravar([{ caminho, tipo, quando: Date.now() }, ...this.lista().filter((r) => r.caminho !== caminho)].slice(0, LIMITE));
  }

  /** Tira da lista (a pasta continua no disco). */
  esquecer(caminho: string): void {
    this.gravar(this.lista().filter((r) => r.caminho !== caminho));
  }

  private gravar(lista: Recente[]): void {
    this.lista.set(lista);
    try {
      localStorage.setItem(CHAVE, JSON.stringify(lista));
    } catch {
      /* sem armazenamento */
    }
  }
}

function ler(): Recente[] {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE) ?? '[]');
    return Array.isArray(salvo) ? salvo.filter((r) => typeof r?.caminho === 'string') : [];
  } catch {
    return [];
  }
}

/** Pelo que há na raiz da pasta. */
async function descobrirTipo(raiz: string): Promise<TipoDeProjeto> {
  const entradas = await ponte.lerPasta(raiz);
  const achar = (...nomes: string[]) => entradas.find((e) => nomes.includes(nomeBase(e.caminho)));
  const conteudo = (caminho: string) => ponte.lerArquivo(caminho).catch(() => '');

  const maven = achar('pom.xml');
  const java = maven ?? achar('build.gradle', 'build.gradle.kts');
  if (java) {
    if ((await conteudo(java.caminho)).includes('org.springframework.boot')) return 'Spring Boot';
    return maven ? 'Java · Maven' : 'Java · Gradle';
  }
  const pacote = achar('package.json');
  if (!pacote) return 'pasta';
  const texto = await conteudo(pacote.caminho);
  const angular = texto.includes('"@angular/core"');
  if (achar('src-tauri')) return angular ? 'Angular · Tauri' : 'Tauri';
  if (angular) return 'Angular';
  if (texto.includes('"react"')) return texto.includes('"vite"') ? 'React · Vite' : 'React';
  return 'Node';
}
