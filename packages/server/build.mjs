/**
 * Builds the publishable server bundle: `src/**` → `dist/index.js` (ESM for Node 20+ and other
 * Fetch-API runtimes). `@veneer/core` (a private workspace) is bundled in; the Babel parser and
 * traverser stay external because they are large and shared with the host's own toolchain.
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
  platform: 'neutral',
  target: ['es2022'],
  external: ['@babel/parser', '@babel/traverse'],
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
});

const dts = await readFile(resolve(here, 'index.d.ts'), 'utf8');
await writeFile(resolve(dist, 'index.d.ts'), dts.replaceAll("'@veneer/core'", "'./core'"));
await copyFile(resolve(here, '../core/index.d.ts'), resolve(dist, 'core.d.ts'));
