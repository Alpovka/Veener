/**
 * Builds the publishable package in three steps:
 *
 *  1. `dist/guest.bundle.txt` — the guest runtime (Preact + MiniDOM + shims + veneer API) as one
 *     script, evaluated INSIDE QuickJS. Emitted as .txt so step 2 can inline it as a string.
 *  2. `dist/veneer-worker.js` — the Web Worker: QuickJS (single-file wasm variant), the JSX
 *     compiler, Tailwind v4 with its stylesheets inlined, and the guest bundle. Self-contained:
 *     hosts serve this one file from their origin (default `/veneer-worker.js`).
 *  3. `dist/index.js` — the React SDK (plain ESM, JSX compiled with the automatic runtime).
 *     React stays external; `@veneer/core` (a private workspace) is bundled in, so the package has
 *     no runtime dependencies besides React. The 'use client' directive is re-added as a banner.
 *
 * Declarations: `index.d.ts` refers to `@veneer/core` for the shared types; the build copies
 * core's declarations next to it as `dist/core.d.ts` and rewrites the specifier.
 */
import { build } from 'esbuild';
import { rm, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = resolve(here, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

// 1. guest → string
await build({
  entryPoints: [resolve(here, 'src/engine/guest.js')],
  outfile: resolve(dist, 'guest.bundle.txt'),
  bundle: true,
  format: 'iife',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
});

// 2. worker (self-contained)
const twDir = dirname(require.resolve('tailwindcss/package.json'));
await build({
  entryPoints: [resolve(here, 'src/engine/worker.js')],
  outfile: resolve(dist, 'veneer-worker.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  loader: { '.txt': 'text', '.css': 'text' },
  alias: {
    'tailwindcss/index.css': resolve(twDir, 'index.css'),
    'tailwindcss/theme.css': resolve(twDir, 'theme.css'),
    'tailwindcss/utilities.css': resolve(twDir, 'utilities.css'),
    'tailwindcss/preflight.css': resolve(twDir, 'preflight.css'),
  },
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
});

// 3. SDK
await build({
  entryPoints: [resolve(here, 'src/index.js')],
  outfile: resolve(dist, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  banner: { js: "'use client';" },
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
});

const dts = await readFile(resolve(here, 'index.d.ts'), 'utf8');
await writeFile(resolve(dist, 'index.d.ts'), dts.replaceAll("'@veneer/core'", "'./core'"));
await copyFile(resolve(here, '../core/index.d.ts'), resolve(dist, 'core.d.ts'));
