/**
 * Tailwind v4 compiled at runtime, inside the worker, for exactly the class names the generated
 * UI actually uses. The output is scoped so it can be installed in the host page:
 *
 *  - candidates are filtered by a strict grammar first (letters, digits, dashes, dots, a few
 *    variants, an optional /opacity, and only numeric-length or hex-colour arbitrary values);
 *  - utilities are compiled with a `v` prefix, so `grid` becomes `.v\:grid` and neither the
 *    host's `.grid` nor a host `.card` class can restyle generated nodes (nor the reverse);
 *  - every rule is re-rooted under `.veneer-canvas` and the `@layer` wrappers are flattened.
 *    A real class ancestor (not `:where()`) and no layers is deliberate: layered rules lose to
 *    ANY unlayered host rule, so a host `h1 { font-size: 2rem }` would beat our `.v\:text-2xl`.
 *    `:root`/`html`/`body`/`:host` selectors (theme variables, preflight base) map to the canvas;
 *  - `@property`/`@keyframes`/`@font-face`-class at-rules stay top-level and unscoped (they are
 *    definitions, not matches); `@import`/`@font-face` are dropped outright;
 *  - brand tokens come in through the same `--veneer-*` variables the host sets on the canvas root;
 *  - a tripwire refuses any output containing url()/@import/@font-face/image-set()/expression().
 *
 * `createTailwind` takes the Tailwind source stylesheets as strings so the same module runs in the
 * worker (esbuild text imports) and in Node tests (fs).
 */
import { compile, Polyfills } from 'tailwindcss';

export { CLASS_TOKEN_MAX, isSafeClassToken, safeClassTokens } from './classGrammar.js';
import { isSafeClassToken } from './classGrammar.js';

const TRIPWIRE = /url\s*\(|@import|@font-face|image-set\s*\(|expression\s*\(|javascript:|-moz-binding|behavior\s*:/i;

export const BRAND_THEME = `
@theme {
  --color-background: var(--veneer-background);
  --color-surface: var(--veneer-surface);
  --color-border: var(--veneer-border);
  --color-foreground: var(--veneer-foreground);
  --color-muted: var(--veneer-muted);
  --color-primary: var(--veneer-primary);
  --color-primary-foreground: var(--veneer-primary-foreground);
  --color-accent: var(--veneer-accent);
  --color-success: var(--veneer-success);
  --color-warning: var(--veneer-warning);
  --color-danger: var(--veneer-danger);
  --radius-sm: var(--veneer-radius-sm);
  --radius-md: var(--veneer-radius-md);
  --radius-lg: var(--veneer-radius-lg);
  --radius: var(--veneer-radius-md);
  --font-sans: var(--veneer-font-sans);
  --font-mono: var(--veneer-font-mono);
  --shadow-sm: var(--veneer-shadow-sm);
  --shadow-md: var(--veneer-shadow-md);
  --shadow: var(--veneer-shadow-md);
}
@custom-variant dark (&:where(.veneer-dark, .veneer-dark *));
`;

/**
 * @param {{ indexCss: string, themeCss: string, utilitiesCss: string, preflightCss: string, scope?: string, prefix?: string }} opts
 */
export async function createTailwind({ indexCss, themeCss, utilitiesCss, preflightCss, scope = '.veneer-canvas', prefix = 'v' }) {
  const files = { 'index.css': indexCss, 'theme.css': themeCss, 'utilities.css': utilitiesCss, 'preflight.css': preflightCss };
  const loadStylesheet = async (id) => {
    const name = String(id).replace(/^tailwindcss\/?/, '').replace(/^\.\//, '') || 'index';
    const file = name.endsWith('.css') ? name : name + '.css';
    const content = files[file];
    if (content == null) throw new Error('unknown stylesheet ' + id);
    return { path: '/' + file, base: '/', content };
  };
  const entry = `@import "tailwindcss" prefix(${prefix});\n${BRAND_THEME}`;
  const compiled = await compile(entry, { base: '/', loadStylesheet, polyfills: Polyfills.None });
  const seen = new Set();
  let cached = null;

  return {
    prefix,
    scope,
    /** Register class tokens; returns true when at least one was new (so CSS must be rebuilt). */
    add(tokens) {
      let added = false;
      for (const t of tokens) {
        if (!isSafeClassToken(t)) continue;
        if (!seen.has(t)) {
          seen.add(t);
          added = true;
        }
      }
      if (added) cached = null;
      return added;
    },
    /** The scoped stylesheet for everything registered so far. Throws if the tripwire fires. */
    css() {
      if (cached !== null) return cached;
      const candidates = [...seen].map((t) => `${prefix}:${t}`);
      const raw = compiled.build(candidates);
      const out = scopeCss(String(raw), scope);
      if (TRIPWIRE.test(out)) throw new Error('refused stylesheet: forbidden construct in compiled CSS');
      cached = out;
      return out;
    },
    size() {
      return seen.size;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// CSS scoper: a small brace-matching walk over Tailwind's (well-formed, flat) output.
// ---------------------------------------------------------------------------------------------
const VERBATIM_AT = new Set(['@keyframes', '@property', '@counter-style', '@page', '@-webkit-keyframes']);
const DROP_AT = new Set(['@import', '@font-face', '@charset', '@namespace']);
const ROOTISH = /^(:root|:host|html|body)$/;

export function scopeCss(css, scope) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const top = [];
  const body = [];
  walk(css, 0, css.length, body, top, scope, 0);
  return top.join('') + body.join('');
}

function skipString(css, i, end) {
  const q = css[i];
  i++;
  while (i < end) {
    if (css[i] === '\\') i += 2;
    else if (css[i] === q) return i + 1;
    else i++;
  }
  return end;
}
function matchClose(css, i, end) {
  // css[i] === '{'
  let depth = 0;
  while (i < end) {
    const ch = css[i];
    if (ch === '"' || ch === "'") i = skipString(css, i, end);
    else {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return i;
      }
      i++;
    }
  }
  return end;
}
function walk(css, i, end, out, top, scope, depth) {
  while (i < end) {
    while (i < end && /\s/.test(css[i])) i++;
    if (i >= end) break;
    if (css[i] === '}') return i + 1;
    let j = i;
    while (j < end && css[j] !== '{' && css[j] !== ';' && css[j] !== '}') {
      if (css[j] === '"' || css[j] === "'") j = skipString(css, j, end);
      else j++;
    }
    const prelude = css.slice(i, j).trim();
    if (j >= end) break;
    if (css[j] === ';' || css[j] === '}') {
      // statement: a declaration (only valid inside a rule) or an at-statement like `@layer a, b;`
      if (prelude && !prelude.startsWith('@')) out.push(prelude + ';');
      i = css[j] === ';' ? j + 1 : j;
      if (css[j] === '}') return j + 1;
      continue;
    }
    const k = matchClose(css, j, end);
    const inner = css.slice(j + 1, k);
    i = k + 1;
    if (!prelude) continue;
    if (prelude.startsWith('@')) {
      const name = prelude.split(/[\s(]/)[0];
      if (DROP_AT.has(name)) continue;
      if (VERBATIM_AT.has(name)) {
        top.push(`${prelude}{${inner}}\n`);
        continue;
      }
      if (name === '@layer') {
        walk(inner, 0, inner.length, out, top, scope, depth); // flatten
        continue;
      }
      const nested = [];
      walk(inner, 0, inner.length, nested, top, scope, depth + 1);
      if (nested.length) out.push(`${prelude}{\n${nested.join('')}}\n`);
      continue;
    }
    // a style rule
    if (inner.includes('{')) {
      const nested = [];
      walk(inner, 0, inner.length, nested, top, scope, depth + 1);
      out.push(`${scopeSelector(prelude, scope)}{\n${nested.join('')}}\n`);
    } else {
      const decls = inner.trim();
      if (decls) out.push(`${scopeSelector(prelude, scope)}{${decls}}\n`);
    }
  }
  return i;
}
function splitTopLevel(sel, sep) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i];
    if (ch === '"' || ch === "'") {
      const j = skipString(sel, i, sel.length);
      cur += sel.slice(i, j);
      i = j - 1;
      continue;
    }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === sep && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}
export function scopeSelector(sel, scope) {
  return splitTopLevel(sel, ',')
    .map((s) => {
      if (ROOTISH.test(s)) return scope;
      const m = s.match(/^(:root|:host|html|body)(?=[\s>+~:[.#])/);
      if (m) return scope + s.slice(m[1].length);
      return `${scope} ${s}`;
    })
    .join(', ');
}
