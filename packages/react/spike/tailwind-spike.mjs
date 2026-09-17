import { compileAst, Polyfills } from 'tailwindcss';
import { readFileSync } from 'node:fs';
const t0 = performance.now();
const base = 'node_modules/tailwindcss/';
const loadStylesheet = async (id) => {
  const map = { 'tailwindcss/theme': 'theme.css', 'tailwindcss/utilities': 'utilities.css', 'tailwindcss/preflight': 'preflight.css' };
  const file = map[id] || (id.startsWith('tailwindcss') ? id.replace('tailwindcss/', '') : null);
  if (!file) throw new Error('unknown import ' + id);
  return { path: base + file, base: base, content: readFileSync(base + file, 'utf8') };
};
const css = `
@import "tailwindcss/theme" layer(theme);
@import "tailwindcss/utilities" layer(utilities) prefix(v);
@theme { --color-primary: var(--veneer-primary); --color-primary-foreground: var(--veneer-primary-foreground); --radius-md: var(--veneer-radius-md); --font-sans: var(--veneer-font-sans); }
@custom-variant dark (&:where(.veneer-dark, .veneer-dark *));
`;
const compiled = await compileAst(css, { base, loadStylesheet, polyfills: Polyfills.None });
const t1 = performance.now();
const ast = compiled.build(['v:grid', 'v:grid-cols-3', 'v:gap-4', 'v:bg-primary', 'v:text-primary-foreground', 'v:rounded-md', 'v:font-sans', 'v:dark:bg-primary', 'v:bg-primary/50', 'v:bg-[url(https://evil)]', 'v:hover:opacity-90']);
const t2 = performance.now();
// our own printer: flatten @layer, scope every style rule under :where(.veneer-canvas), rewrite :root/:host
function toCss(nodes, scope, indent = '') {
  let out = '';
  for (const n of nodes) {
    if (n.kind === 'rule') {
      const sel = n.selector.split(',').map((s) => s.trim()).map((s) => /^:root$|^:host$|^:root,\s*:host$/.test(s) || s === ':root, :host' ? scope : `:where(${scope}) ${s}`).join(', ');
      out += `${indent}${sel} {\n${toCss(n.nodes, scope, indent + '  ')}${indent}}\n`;
    } else if (n.kind === 'at-rule') {
      if (n.name === '@layer') { out += toCss(n.nodes, scope, indent); continue; }
      if (n.name === '@property' || n.name === '@keyframes') { out += `${indent}${n.name} ${n.params} {\n${toCss(n.nodes, scope, indent + '  ')}${indent}}\n`; continue; }
      out += `${indent}${n.name} ${n.params} {\n${toCss(n.nodes, scope, indent + '  ')}${indent}}\n`;
    } else if (n.kind === 'declaration') {
      out += `${indent}${n.property}: ${n.value}${n.important ? ' !important' : ''};\n`;
    } else if (n.kind === 'comment') { /* drop */ }
    else if (n.kind === 'context' || n.kind === 'at-root') { out += toCss(n.nodes, scope, indent); }
  }
  return out;
}
const out = toCss(ast, '.veneer-canvas');
const t3 = performance.now();
console.log(`compile ${Math.round(t1 - t0)}ms · build ${Math.round(t2 - t1)}ms · print ${Math.round(t3 - t2)}ms · ${out.length} chars`);
console.log(out.split('\n').filter((l) => /v\\:|--color-primary|dark|url\(|color-mix/.test(l)).slice(0, 24).join('\n'));
console.log('tripwire url(:', /url\s*\(/i.test(out), '| kinds:', [...new Set(ast.map((n) => n.kind + (n.name ? ':' + n.name : '')))].join(', '));
