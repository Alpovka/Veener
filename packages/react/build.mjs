/**
 * Builds the publishable bundle: `src/**` (JSX) → `dist/index.js` (plain ESM, JSX compiled with
 * the automatic runtime). React stays external; `@veneer/core` (a private workspace) is bundled
 * in, so the published package has no runtime dependencies besides React.
 * The 'use client' directive is re-added as a banner: esbuild drops per-file directives when
 * bundling, and Next.js needs it at the top of the module.
 *
 * Declarations: `index.d.ts` refers to `@veneer/core` for the shared types; the build copies
 * core's declarations next to it as `dist/core.d.ts` and rewrites the specifier.
 */
import { build } from 'esbuild';
import { rm, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
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
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  banner: { js: "'use client';" },
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
});

const dts = await readFile(resolve(here, 'index.d.ts'), 'utf8');
await writeFile(resolve(dist, 'index.d.ts'), dts.replaceAll("'@veneer/core'", "'./core'"));
await copyFile(resolve(here, '../core/index.d.ts'), resolve(dist, 'core.d.ts'));
