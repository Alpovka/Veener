// Copies the SDK into veneer-demo/veneer-sdk. The demo depends on `file:./veneer-sdk` (a path
// inside its own directory) so that Vercel can build it; this keeps that copy identical.
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sdk = resolve(here, '..');
const dest = resolve(sdk, '..', 'veneer-demo', 'veneer-sdk');

mkdirSync(dest, { recursive: true });
for (const entry of ['src', 'package.json', 'README.md']) {
  const target = resolve(dest, entry);
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  cpSync(resolve(sdk, entry), target, { recursive: true });
}
console.log(`synced veneer-sdk → ${dest}`);
