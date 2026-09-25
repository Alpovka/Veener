// Copies the Veneer engine worker (and its WebAssembly) from @veneer/react's build output into
// public/, so the canvas can load them same-origin at /veneer-worker.js + /veneer-worker.wasm.
// Runs before `next dev` and `next build`.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('@veneer/react/package.json'));
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
mkdirSync(outDir, { recursive: true });
for (const f of ['veneer-worker.js', 'veneer-worker.wasm']) copyFileSync(resolve(pkgDir, 'dist', f), resolve(outDir, f));
console.log('[demo] copied veneer-worker.js + veneer-worker.wasm → public/');
