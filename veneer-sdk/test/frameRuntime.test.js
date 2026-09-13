import { describe, it, expect } from 'vitest';
import { buildFrameSrcDoc, FRAME_CSP, FRAME_SANDBOX, RUNTIME_SCRIPTS, PROTOCOL_VERSION } from '../src/frameRuntime.js';

describe('frame document', () => {
  const html = buildFrameSrcDoc();
  it('pins every runtime script by exact URL and lists only those in script-src', () => {
    for (const s of RUNTIME_SCRIPTS) {
      expect(s.url).toMatch(/^https:\/\/(unpkg\.com\/(@[^/]+\/)?[^@/]+@\d+\.\d+\.\d+\/|cdn\.tailwindcss\.com\/\d+\.\d+\.\d+$)/);
      expect(FRAME_CSP).toContain(s.url);
      expect(html).toContain(`src="${s.url}"`);
    }
    expect(FRAME_CSP).not.toMatch(/script-src[^;]*https:\/\/unpkg\.com(\s|;|$)/);
    expect(FRAME_CSP).not.toMatch(/script-src[^;]*https:\/\/cdn\.tailwindcss\.com(\s|;|$)/);
  });
  it('carries SRI + crossorigin for every script that has a hash', () => {
    const hashed = RUNTIME_SCRIPTS.filter((s) => s.integrity);
    expect(hashed.length).toBe(3);
    for (const s of hashed) {
      expect(s.integrity).toMatch(/^sha384-[A-Za-z0-9+/]+=*$/);
      expect(html).toContain(`<script src="${s.url}" integrity="${s.integrity}" crossorigin="anonymous"></script>`);
    }
  });
  it('locks down the CSP', () => {
    for (const d of ["default-src 'none'", "connect-src 'none'", "base-uri 'none'", "form-action 'none'", "'unsafe-eval'"]) {
      expect(FRAME_CSP).toContain(d);
    }
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}" />`);
    expect(html).toContain('<meta name="referrer" content="no-referrer" />');
  });
  it('exposes sandbox flags without allow-same-origin', () => {
    expect(FRAME_SANDBOX).toBe('allow-scripts allow-forms');
    expect(FRAME_SANDBOX).not.toContain('allow-same-origin');
  });
  it('inlines a parseable runtime with the scanner and protocol version substituted', () => {
    expect(html).not.toContain('__SCANNER__');
    expect(html).not.toContain('__VERSION__');
    expect(html).toContain(`type: 'ready', v: ${PROTOCOL_VERSION}`);
    const m = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/);
    expect(() => new Function(m[1])).not.toThrow();
    expect(m[1]).toContain('ev.source !== window.parent');
    expect(m[1]).toContain("'use strict'");
  });
  it('applies host branding without widening the CSP', () => {
    const m = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/)[1];
    expect(m).toContain('function applyTheme');
    expect(m).toContain("d.type === 'theme'");
    expect(m).toContain("type: 'size'");
    expect(m).toContain('window.tailwind.config');
    expect(m).toContain("primary: { DEFAULT: 'var(--veneer-primary)'");
    expect(m).toContain("darkMode: 'class'");
    // theme values are re-validated inside the frame
    expect(m).toMatch(/function safeCssValue/);
    expect(m).toContain('@font-face');
    expect(FRAME_CSP).toContain("font-src data:");
    expect(FRAME_CSP).not.toContain('fonts.gstatic');
  });
});
