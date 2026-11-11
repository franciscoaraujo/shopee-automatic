// Inicia o vitest com o diretório normalizado.
// Windows: terminais abertos pelo VS Code usam "c:\" minúsculo; o Node trata file:///c:/ e
// file:///C:/ como módulos diferentes e o vitest acaba carregado duas vezes ("failed to find
// the current suite"). Corrige a letra do drive e repassa os argumentos.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const fix = (p) => (process.platform === 'win32' ? p.replace(/^[a-z]:/, (d) => d.toUpperCase()) : p);
const cwd = fix(process.cwd());
const cli = fix(path.join(path.dirname(createRequire(path.join(cwd, 'package.json')).resolve('vitest/package.json')), 'vitest.mjs'));
const r = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { cwd, stdio: 'inherit' });
process.exit(r.status ?? 1);
