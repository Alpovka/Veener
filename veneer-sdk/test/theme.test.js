import { describe, it, expect, vi } from 'vitest';
import { resolveTheme, hashTheme, themeFromCSSVariables, loadThemeFonts, themePayload, DEFAULT_THEME, THEME_UTILITIES } from '../src/theme.js';

describe('resolveTheme', () => {
  it('returns defaults for an empty theme, with light and dark variable maps', () => {
    const r = resolveTheme();
    expect(r.problems).toEqual([]);
    expect(r.theme.mode).toBe('system');
    expect(r.vars.light['--veneer-primary']).toBe(DEFAULT_THEME.colors.primary);
    expect(r.vars.light['--veneer-background']).toBe('#ffffff');
    expect(r.vars.dark['--veneer-background']).toBe('#0b1020');
    expect(r.vars.light['--veneer-radius-md']).toBe('10px');
    expect(r.vars.dark['--veneer-font-sans']).toBe(DEFAULT_THEME.font.sans);
    expect(r.vars.light['--veneer-primary-foreground']).toBe('#ffffff');
  });
  it('merges host values and keeps per-mode colours', () => {
    const r = resolveTheme({ mode: 'dark', colors: { primary: 'rgb(10, 20, 30)', surface: { light: '#eee', dark: '#111' } }, radius: { md: '1rem' }, font: { sans: 'Inter, sans-serif', size: '15px' }, shadow: { md: 'none' } });
    expect(r.problems).toEqual([]);
    expect(r.theme.mode).toBe('dark');
    expect(r.vars.light['--veneer-primary']).toBe('rgb(10, 20, 30)');
    expect(r.vars.dark['--veneer-primary']).toBe('rgb(10, 20, 30)');
    expect(r.vars.light['--veneer-surface']).toBe('#eee');
    expect(r.vars.dark['--veneer-surface']).toBe('#111');
    expect(r.vars.light['--veneer-radius-md']).toBe('1rem');
    expect(r.vars.light['--veneer-font-size']).toBe('15px');
    expect(r.vars.light['--veneer-shadow-md']).toBe('none');
  });
  it('rejects values that could inject CSS or load resources, falling back to defaults', () => {
    const r = resolveTheme({
      mode: 'neon',
      colors: { primary: 'url(https://evil/x)', foreground: 'red; background: url(x)', border: '#fff}body{display:none', accent: { light: '<script>' }, unknown: '#000' },
      radius: { md: 'calc(1px + url(x))', lg: '20' },
      font: { sans: 'Inter, url(x)', mono: 'a;b' },
      shadow: { sm: '0 0 0 url(x)' },
      fonts: [{ family: 'Bad', src: 'javascript:alert(1)' }, { family: 'Ok', src: '/f.woff2', weight: 'bold' }, 'nope'],
    });
    expect(r.problems.length).toBeGreaterThanOrEqual(10);
    expect(r.vars.light['--veneer-primary']).toBe(DEFAULT_THEME.colors.primary);
    expect(r.vars.light['--veneer-foreground']).toBe('#0f172a');
    expect(r.vars.light['--veneer-border']).toBe('#e2e8f0');
    expect(r.theme.radius.md).toBe('10px');
    expect(r.theme.font.sans).toBe(DEFAULT_THEME.font.sans);
    expect(r.theme.fonts).toEqual([]);
    expect(r.theme.mode).toBe('system');
    for (const v of Object.values(r.vars.light)) expect(v).not.toMatch(/url\(|[;{}<]/);
  });
  it('normalises font entries', () => {
    const r = resolveTheme({ fonts: [{ family: 'Inter', src: '/fonts/inter.woff2', weight: 600 }, { family: 'Inter', src: '/fonts/inter-i.woff2', style: 'italic' }] });
    expect(r.theme.fonts).toEqual([
      { family: 'Inter', src: '/fonts/inter.woff2', weight: '600', style: 'normal' },
      { family: 'Inter', src: '/fonts/inter-i.woff2', weight: '400', style: 'italic' },
    ]);
  });
  it('hashes by variables', () => {
    expect(hashTheme(resolveTheme())).toBe(hashTheme(resolveTheme({})));
    expect(hashTheme(resolveTheme({ colors: { primary: '#000' } }))).not.toBe(hashTheme(resolveTheme()));
  });
});

describe('themeFromCSSVariables', () => {
  it('reads computed custom properties into a partial theme', () => {
    const styles = { getPropertyValue: (n) => ({ '--brand': ' #4f46e5 ', '--bg-dark': '#000', '--radius': '12px' })[n] || '' };
    const t = themeFromCSSVariables(
      { colors: { primary: '--brand', background: { light: '--missing', dark: '--bg-dark' }, accent: '--nope' }, radius: { md: '--radius' } },
      { element: {}, getComputedStyle: () => styles }
    );
    expect(t).toEqual({ colors: { primary: '#4f46e5', background: { light: '#000', dark: '#000' } }, radius: { md: '12px' } });
  });
});

describe('loadThemeFonts', () => {
  it('inlines fetched fonts as data URIs, caches, caps size and reports failures', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('missing')) return { ok: false, status: 404 };
      return { ok: true, arrayBuffer: async () => new Uint8Array([0x77, 0x4f, 0x46, 0x32]).buffer };
    });
    const onError = vi.fn();
    const out = await loadThemeFonts(
      [{ family: 'A', src: '/a.woff2', weight: '700', style: 'normal' }, { family: 'B', src: '/missing.woff', weight: '400', style: 'normal' }, { family: 'C', src: '/c.ttf', weight: '400', style: 'italic' }],
      { fetch: fetchImpl, onError }
    );
    expect(out.map((f) => f.family)).toEqual(['A', 'C']);
    expect(out[0]).toMatchObject({ weight: '700', format: 'woff2', dataUri: 'data:font/woff2;base64,d09GMg==' });
    expect(out[1].format).toBe('truetype');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ type: 'font-load-failed', family: 'B' }));
    await loadThemeFonts([{ family: 'A', src: '/a.woff2' }], { fetch: fetchImpl });
    expect(fetchImpl.mock.calls.filter((c) => c[0] === '/a.woff2').length).toBe(1);
    const capped = await loadThemeFonts([{ family: 'D', src: '/d.woff2' }], { fetch: fetchImpl, maxBytes: 2, onError });
    expect(capped).toEqual([]);
  });
  it('returns [] without fonts or fetch', async () => {
    expect(await loadThemeFonts([], {})).toEqual([]);
    expect(await loadThemeFonts([{ family: 'A', src: '/a' }], { fetch: null })).toEqual(typeof fetch === 'function' ? expect.any(Array) : []);
  });
});

describe('themePayload / utilities', () => {
  it('builds the frame payload', () => {
    const r = resolveTheme({ colors: { primary: '#123' } });
    const p = themePayload(r, 'dark', [{ family: 'X', dataUri: 'data:font/woff2;base64,AA==' }]);
    expect(p.mode).toBe('dark');
    expect(p.vars.light['--veneer-primary']).toBe('#123');
    expect(p.fonts.length).toBe(1);
    expect(themePayload(r, 'weird', null)).toMatchObject({ mode: 'light', fonts: [] });
  });
  it('lists the brand utilities the prompt and the frame agree on', () => {
    const all = Object.values(THEME_UTILITIES).flat();
    expect(all).toContain('bg-primary');
    expect(all).toContain('text-primary-foreground');
    expect(all).toContain('rounded-md');
    expect(all).toContain('font-sans');
  });
});
