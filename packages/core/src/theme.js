/**
 * Theme contract: how a host brands the generated UI and the SDK's widgets.
 *
 * A theme is plain data. The provider resolves it against DEFAULT_THEME and turns it into CSS custom
 * properties (`--veneer-*`) for a light and a dark variant. VeneerCanvas sets the current mode's
 * variables inline on the canvas root, and the Tailwind stylesheet compiled in the engine worker
 * maps a fixed vocabulary of brand utilities (THEME_UTILITIES) onto them, so generated code writes
 * `bg-primary text-primary-foreground rounded-md` and gets the host's brand. (The legacy iframe
 * engine receives the same variables over its `init` / `theme` messages.)
 *
 * Every value is validated here before it is used as CSS: colours must be CSS colours, lengths
 * must be lengths, font stacks and shadows may not contain `url(`, `;`, `{` or `}`. A theme can
 * therefore never inject CSS or load a remote resource.
 *
 * `fonts` (data-URI loading via `loadThemeFonts`) exists for the legacy iframe engine, whose CSP
 * allows `font-src data:` and nothing else. VeneerCanvas renders in the host page, so the page's
 * own fonts apply and nothing needs to be inlined.
 */

/** Brand utility classes generated code may use. Shared by the system prompt and both engines. */
export const THEME_UTILITIES = {
  surfaces: ['bg-background', 'bg-surface', 'bg-primary', 'bg-accent', 'bg-success', 'bg-warning', 'bg-danger'],
  text: ['text-foreground', 'text-muted', 'text-primary', 'text-primary-foreground', 'text-accent', 'text-success', 'text-warning', 'text-danger'],
  borders: ['border-border', 'border-primary', 'ring-primary'],
  radius: ['rounded-sm', 'rounded-md', 'rounded-lg', 'rounded-full'],
  fonts: ['font-sans', 'font-mono'],
  shadows: ['shadow-sm', 'shadow-md'],
};

export const DEFAULT_THEME = {
  mode: 'system', // 'light' | 'dark' | 'system'
  colors: {
    background: { light: '#ffffff', dark: '#0b1020' },
    surface: { light: '#f8fafc', dark: '#111827' },
    border: { light: '#e2e8f0', dark: '#273244' },
    foreground: { light: '#0f172a', dark: '#e5e7eb' },
    muted: { light: '#64748b', dark: '#9ca3af' },
    primary: '#4f46e5',
    primaryForeground: '#ffffff',
    accent: '#9333ea',
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
  },
  radius: { sm: '6px', md: '10px', lg: '16px', full: '9999px' },
  font: {
    sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    size: '14px',
  },
  shadow: {
    sm: '0 1px 2px rgba(15, 23, 42, 0.06)',
    md: '0 10px 30px -12px rgba(15, 23, 42, 0.25)',
  },
  /** [{ family, src, weight?, style? }] — fetched by the host and inlined as data URIs. */
  fonts: [],
};

const COLOR_RE = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([^;{}()]{1,80}\)|[a-z]{3,30}|transparent|currentcolor)$/i;
const LENGTH_RE = /^-?\d*\.?\d+(px|rem|em|%|vh|vw)$/;
const FORBIDDEN_RE = /url\s*\(|expression\s*\(|[;{}<>\\]|@import|javascript:/i;
const FONT_RE = /^[\w\s,'"()-]{1,300}$/;
const SHADOW_RE = /^[\w\s,.()#%-]{1,400}$/;
const MODES = ['light', 'dark', 'system'];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function kebab(s) {
  return s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}

function validColor(v) {
  return typeof v === 'string' && !FORBIDDEN_RE.test(v) && COLOR_RE.test(v.trim());
}
function validLength(v) {
  return typeof v === 'string' && LENGTH_RE.test(v.trim());
}
function validFont(v) {
  return typeof v === 'string' && !FORBIDDEN_RE.test(v) && FONT_RE.test(v);
}
function validShadow(v) {
  return typeof v === 'string' && !FORBIDDEN_RE.test(v) && (v.trim() === 'none' || SHADOW_RE.test(v));
}

/** Normalise a colour entry to { light, dark }. */
function colorPair(value, fallback) {
  if (typeof value === 'string') return validColor(value) ? { light: value.trim(), dark: value.trim() } : null;
  if (isPlainObject(value)) {
    const light = validColor(value.light) ? value.light.trim() : null;
    const dark = validColor(value.dark) ? value.dark.trim() : null;
    if (!light && !dark) return null;
    return { light: light || dark, dark: dark || light };
  }
  return fallback ? colorPair(fallback) : null;
}

/**
 * Merge a partial theme over the defaults and produce the CSS variable maps.
 * Invalid values are dropped (reported in `problems`) and the default is used instead.
 * @returns {{ theme, vars: { light: Record<string,string>, dark: Record<string,string> }, problems: string[] }}
 */
export function resolveTheme(partial) {
  const p = isPlainObject(partial) ? partial : {};
  const problems = [];
  const theme = {
    mode: MODES.includes(p.mode) ? p.mode : DEFAULT_THEME.mode,
    colors: {},
    radius: { ...DEFAULT_THEME.radius },
    font: { ...DEFAULT_THEME.font },
    shadow: { ...DEFAULT_THEME.shadow },
    fonts: [],
  };
  if (p.mode !== undefined && !MODES.includes(p.mode)) problems.push(`mode: unsupported value ${JSON.stringify(p.mode)}`);

  const pc = isPlainObject(p.colors) ? p.colors : {};
  for (const key of Object.keys(DEFAULT_THEME.colors)) {
    const fromHost = pc[key] !== undefined ? colorPair(pc[key]) : null;
    if (pc[key] !== undefined && !fromHost) problems.push(`colors.${key}: not a valid CSS colour`);
    theme.colors[key] = fromHost || colorPair(DEFAULT_THEME.colors[key]);
  }
  for (const key of Object.keys(pc)) if (!(key in DEFAULT_THEME.colors)) problems.push(`colors.${key}: unknown token`);

  const pr = isPlainObject(p.radius) ? p.radius : {};
  for (const key of Object.keys(DEFAULT_THEME.radius)) {
    if (pr[key] === undefined) continue;
    if (validLength(pr[key])) theme.radius[key] = pr[key].trim();
    else problems.push(`radius.${key}: not a valid length`);
  }

  const pf = isPlainObject(p.font) ? p.font : {};
  for (const key of ['sans', 'mono']) {
    if (pf[key] === undefined) continue;
    if (validFont(pf[key])) theme.font[key] = pf[key].trim();
    else problems.push(`font.${key}: not a valid font stack`);
  }
  if (pf.size !== undefined) {
    if (validLength(pf.size)) theme.font.size = pf.size.trim();
    else problems.push('font.size: not a valid length');
  }

  const ps = isPlainObject(p.shadow) ? p.shadow : {};
  for (const key of Object.keys(DEFAULT_THEME.shadow)) {
    if (ps[key] === undefined) continue;
    if (validShadow(ps[key])) theme.shadow[key] = ps[key].trim();
    else problems.push(`shadow.${key}: not a valid shadow`);
  }

  if (Array.isArray(p.fonts)) {
    for (const f of p.fonts) {
      if (!isPlainObject(f) || !validFont(f.family) || typeof f.src !== 'string' || FORBIDDEN_RE.test(f.src) || f.src.length > 2048) {
        problems.push('fonts[]: entries need a valid family and a src URL');
        continue;
      }
      const weight = f.weight === undefined ? '400' : String(f.weight);
      const style = f.style === undefined ? 'normal' : String(f.style);
      if (!/^\d{3}(\s\d{3})?$/.test(weight) || !/^(normal|italic|oblique)$/.test(style)) {
        problems.push(`fonts[]: invalid weight/style for ${f.family}`);
        continue;
      }
      theme.fonts.push({ family: f.family.trim(), src: f.src, weight, style });
    }
  }

  const vars = { light: {}, dark: {} };
  for (const [key, pair] of Object.entries(theme.colors)) {
    vars.light[`--veneer-${kebab(key)}`] = pair.light;
    vars.dark[`--veneer-${kebab(key)}`] = pair.dark;
  }
  for (const m of ['light', 'dark']) {
    for (const [k, v] of Object.entries(theme.radius)) vars[m][`--veneer-radius-${k}`] = v;
    vars[m]['--veneer-font-sans'] = theme.font.sans;
    vars[m]['--veneer-font-mono'] = theme.font.mono;
    vars[m]['--veneer-font-size'] = theme.font.size;
    for (const [k, v] of Object.entries(theme.shadow)) vars[m][`--veneer-shadow-${k}`] = v;
  }
  return { theme, vars, problems };
}

/** Cheap stable hash for change detection. */
export function hashTheme(resolved) {
  const s = JSON.stringify(resolved && resolved.vars ? resolved.vars : resolved || {});
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * Build a partial theme from CSS custom properties already defined on the host page.
 *   themeFromCSSVariables({ colors: { primary: '--brand-600' }, radius: { md: '--radius' } })
 * Reads computed values from `element` (default: the root element). Empty values are skipped.
 */
export function themeFromCSSVariables(map, { element, getComputedStyle: gcs } = {}) {
  if (typeof window === 'undefined' && !gcs) return {};
  const el = element || (typeof document !== 'undefined' ? document.documentElement : null);
  const styles = gcs ? gcs(el) : window.getComputedStyle(el);
  const read = (name) => {
    const v = styles.getPropertyValue(name);
    return v ? v.trim() : '';
  };
  const out = {};
  for (const group of ['colors', 'radius', 'font', 'shadow']) {
    if (!isPlainObject(map && map[group])) continue;
    for (const [token, varName] of Object.entries(map[group])) {
      if (typeof varName === 'string') {
        const v = read(varName);
        if (v) (out[group] = out[group] || {})[token] = v;
      } else if (isPlainObject(varName)) {
        const light = varName.light ? read(varName.light) : '';
        const dark = varName.dark ? read(varName.dark) : '';
        if (light || dark) (out[group] = out[group] || {})[token] = { light: light || dark, dark: dark || light };
      }
    }
  }
  return out;
}

const fontCache = new Map();
const FORMATS = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' };

function toBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * LEGACY (iframe engine): fetch the theme's font files and return them as data URIs the frame can
 * use. Failures are reported through `onError` and skipped; the frame keeps its fallback stack.
 * @returns {Promise<Array<{ family, weight, style, format, dataUri }>>}
 */
export async function loadThemeFonts(fonts, { fetch: fetchImpl, maxBytes = 2 * 1024 * 1024, onError } = {}) {
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!f || !Array.isArray(fonts) || fonts.length === 0) return [];
  let total = 0;
  const out = [];
  for (const font of fonts) {
    try {
      let entry = fontCache.get(font.src);
      if (!entry) {
        const res = await f(font.src, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = new Uint8Array(await res.arrayBuffer());
        const ext = (font.src.split('?')[0].split('.').pop() || '').toLowerCase();
        const format = FORMATS[ext] || 'woff2';
        entry = { bytes: buf.length, dataUri: `data:font/${ext || 'woff2'};base64,${toBase64(buf)}`, format };
        fontCache.set(font.src, entry);
      }
      total += entry.bytes;
      if (total > maxBytes) throw new Error(`fonts exceed ${maxBytes} bytes`);
      out.push({ family: font.family, weight: font.weight || '400', style: font.style || 'normal', format: entry.format, dataUri: entry.dataUri });
    } catch (e) {
      if (typeof onError === 'function') onError({ type: 'font-load-failed', family: font.family, src: font.src, message: String((e && e.message) || e) });
    }
  }
  return out;
}

/** LEGACY (iframe engine): the payload that crosses into the frame. `fonts` are the loaded data-URI entries. */
export function themePayload(resolved, mode, fonts) {
  return {
    vars: resolved.vars,
    mode: mode === 'dark' ? 'dark' : 'light',
    fonts: Array.isArray(fonts) ? fonts : [],
  };
}
