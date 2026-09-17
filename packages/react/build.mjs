/**
 * Builds the publishable bundle: `src/**` (JSX) → `dist/index.js` (plain ESM, JSX compiled with
 * the automatic runtime). React and @veneer/core stay external so hosts get a single copy of each.
 * The 'use client' directive is re-added as a banner: esbuild drops per-file directives when
 * bundling, and Next.js needs it at the top of the module.
 */
import { build } from 'esbuild';
import { rm, mkdir, copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  entryPoints: [resolve(here, 'src/index.js')],
  outfile: resolve(dist, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  external: ['react', 'react-dom', 'react/jsx-runtime', '@veneer/core'],
  banner: { js: "'use client';" },
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
});
await copyFile(resolve(here, 'index.d.ts'), resolve(dist, 'index.d.ts'));
