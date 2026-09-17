// Copies the Veneer engine worker from @veneer/react's build output into public/, so the canvas
// can load it same-origin at /veneer-worker.js. Runs before `next dev` and `next build`.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('@veneer/react/package.json'));
const src = resolve(pkgDir, 'dist/veneer-worker.js');
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
mkdirSync(outDir, { recursive: true });
copyFileSync(src, resolve(outDir, 'veneer-worker.js'));
console.log('[demo] copied veneer-worker.js → public/');
