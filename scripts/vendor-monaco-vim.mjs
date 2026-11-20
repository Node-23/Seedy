// O monaco-vim importa caminhos antigos do Monaco ("monaco-editor/esm/vs/...")
// que o mapa de "exports" do monaco-editor atual não resolve mais.
// Este script copia o monaco-vim para src/vendor e corrige esses imports.
// Roda sozinho depois do `npm install` (script "postinstall").
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'monaco-vim', 'dist');
const out = join(root, 'src', 'vendor', 'monaco-vim');
mkdirSync(out, { recursive: true });

const code = readFileSync(join(src, 'index.mjs'), 'utf8')
  .replace('"monaco-editor/esm/vs/editor/editor.api"', '"monaco-editor/editor/editor.api.js"')
  .replace(
    '"monaco-editor/esm/vs/editor/common/commands/shiftCommand"',
    '"monaco-editor/editor/common/commands/shiftCommand.js"',
  );
writeFileSync(join(out, 'index.js'), '// @ts-nocheck\n/* eslint-disable */\n// Gerado por scripts/vendor-monaco-vim.mjs — não editar.\n' + code);
writeFileSync(join(out, 'index.d.ts'), readFileSync(join(src, 'index.d.mts'), 'utf8'));
console.log('monaco-vim copiado para src/vendor/monaco-vim');
