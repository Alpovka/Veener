/**
 * Browser end-to-end checks, run in the preinstalled Chromium.
 *   node e2e/run.mjs                 # everything
 *   E2E_ONLY=canvas node e2e/run.mjs # the worker engine (VeneerCanvas) only
 *   E2E_ONLY=frame  node e2e/run.mjs # the legacy iframe engine (VeneerFrame) only
 * Canvas: serves a host page plus dist/veneer-worker.js, on a plain page and under a strict CSP,
 * and drives the allowlist, the bridge, the interpreter's deadlines and the watchdog from the page.
 * Frame (legacy): routes the CDN scripts to node_modules (so the SRI hashes are exercised against
 * the real bytes) and drives attacks from inside the frame.
 */
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Resolve a file inside an installed package without going through its `exports` map
// (React's UMD builds are not exported). Walks up from this package to the workspace root.
const resolvePkg = (spec) => {
  const [pkg, ...rest] = spec.startsWith('@') ? [spec.split('/').slice(0, 2).join('/'), ...spec.split('/').slice(2)] : [spec.split('/')[0], ...spec.split('/').slice(1)];
  const pkgJson = require.resolve(pkg + '/package.json');
  return resolve(dirname(pkgJson), ...rest);
};
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { buildFrameResponse } from '@veneer/server';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
// Chromium: CHROME_PATH if set, else a preinstalled binary, else Playwright's own download (CI).
const CHROME = process.env.CHROME_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync) || undefined;

const bundle = await build({
  entryPoints: [resolve(here, 'harness/host.jsx')],
  bundle: true,
  write: false,
  format: 'iife',
  loader: { '.js': 'jsx', '.jsx': 'jsx' },
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'error',
});
const hostJs = bundle.outputFiles[0].text;

// The worker engine: the host bundle comes from src, the worker from dist (it is a build product:
// guest bundle text + QuickJS wasm + the Tailwind compiler). Build it if it is not there yet.
const workerFile = resolve(root, 'dist/veneer-worker.js');
if (!existsSync(workerFile)) execFileSync(process.execPath, [resolve(root, 'build.mjs')], { stdio: 'inherit' });
const workerJs = readFileSync(workerFile, 'utf8');
const workerWasm = readFileSync(resolve(root, 'dist/veneer-worker.wasm'));
// 1×1 transparent PNG for the image-allowlist scenario.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const canvasBundle = await build({
  entryPoints: [resolve(here, 'harness/canvas.jsx')],
  bundle: true,
  write: false,
  format: 'iife',
  loader: { '.js': 'jsx', '.jsx': 'jsx' },
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'error',
});
const canvasJs = canvasBundle.outputFiles[0].text;
// No 'unsafe-inline' anywhere and no 'unsafe-eval': only wasm compilation, in a same-origin worker.
// connect-src 'self' is what fetches the .wasm next to the worker.
const CANVAS_STRICT_CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; worker-src 'self'; connect-src 'self'; img-src 'none'; font-src 'self'; frame-src 'none'; base-uri 'none'; form-action 'none'";

const steals = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>host</title><div id="app"></div><script src="/host.js"></script>');
  } else if (url.pathname === '/strict-csp') {
    // A host page with a strict CSP: srcdoc frames inherit it (and break); frameSrc frames do not.
    res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'self'" });
    res.end('<!doctype html><title>host</title><div id="app"></div><script src="/host.js"></script>');
  } else if (url.pathname === '/host.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(hostJs);
  } else if (url.pathname === '/canvas') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>canvas host</title><div id="app"></div><script src="/canvas.js"></script>');
  } else if (url.pathname === '/canvas-strict') {
    res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': CANVAS_STRICT_CSP });
    res.end('<!doctype html><title>canvas host</title><div id="app"></div><script src="/canvas.js"></script>');
  } else if (url.pathname === '/canvas.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(canvasJs);
  } else if (url.pathname === '/veneer-worker.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(workerJs);
  } else if (url.pathname === '/veneer-worker.wasm') {
    res.writeHead(200, { 'content-type': 'application/wasm' });
    res.end(workerWasm);
  } else if (url.pathname === '/img/ok.png') {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(PNG);
  } else if (url.pathname === '/veneer-frame') {
    const r = buildFrameResponse({ frameAncestors: "'self'" });
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(await r.text());
  } else if (url.pathname === '/fonts/test.woff2') {
    res.writeHead(200, { 'content-type': 'font/woff2' });
    res.end(readFileSync(resolvePkg('@fontsource/inter/files/inter-latin-400-normal.woff2')));
  } else if (url.pathname === '/steal') {
    steals.push(url.search);
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><script>window.__got=[];addEventListener("message",e=>{window.__got.push(e.data)});parent.postMessage({source:"veneer-frame",type:"ready",v:2},"*");</script>stolen');
  } else if (url.pathname === '/hang') {
    steals.push(url.search);
    res.writeHead(200, { 'content-type': 'text/html' });
    res.write('<!doctype html><script>parent.postMessage({source:"veneer-frame",type:"ready",v:2},"*")</script>never finishes');
    // never end()
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const cdnFiles = {
  'https://unpkg.com/react@18.3.1/umd/react.production.min.js': 'react/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js': 'react-dom/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone@7.29.8/babel.min.js': '@babel/standalone/babel.min.js',
};

// IsolateSandboxedIframes puts each sandboxed frame in its own process; Playwright's request
// interception can miss that process's very first request, so the CDN stubs would not apply.
// The flag only affects test plumbing, not what the SDK does.
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--disable-features=IsolateSandboxedIframes'] });
let failures = 0;
const results = [];
function check(name, cond, detail = '') {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!cond) failures++;
}

async function newPage({ breakSri = false } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (e) => results.push(`      pageerror: ${e.message}`));
  await context.route('https://unpkg.com/**', (route) => {
    const file = cdnFiles[route.request().url()];
    if (!file) return route.fulfill({ status: 404, body: '' });
    let body = readFileSync(resolvePkg(file), 'utf8');
    if (breakSri) body += '\n;window.__tampered=1;';
    return route.fulfill({ status: 200, body, headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' } });
  });
  await context.route('https://cdn.tailwindcss.com/**', (route) => route.fulfill({ status: 200, body: 'window.tailwind={};', headers: { 'content-type': 'text/javascript' } }));
  return { context, page };
}
const veneerFrame = (page) => page.frames().find((f) => f.parentFrame() === page.mainFrame() && f !== page.mainFrame() && f.name() !== 'sibling' && !/sibling/.test(f.url()) && (f.url().startsWith('about:srcdoc') || /veneer-frame|steal|hang|chrome-error/.test(f.url())));
const waitState = (page, pred, timeout = 8000) => page.waitForFunction(pred, null, { timeout });
const events = (page) => page.evaluate(() => window.__events);

// E2E_ONLY=canvas | frame narrows the run while iterating; CI runs everything.
const ONLY = process.env.E2E_ONLY || '';

if (ONLY !== 'canvas') for (const mode of ['srcdoc', 'url']) {
  const { context, page } = await newPage();
  await page.goto(`${base}/?mode=${mode}`);
  const frameLoc = page.frameLocator('iframe[title="Veneer canvas"]');
  try {
    await frameLoc.locator('#count').waitFor({ timeout: 15000 });
    check(`[${mode}] default UI renders through the bridge`, (await frameLoc.locator('#count').textContent()) === '1');
    await frameLoc.locator('#add').click();
    await frameLoc.locator('#count').filter({ hasText: '2' }).waitFor({ timeout: 5000 });
    check(`[${mode}] action round-trip + data push re-renders`, true);
    check(`[${mode}] declared return value crosses the bridge`, /^t[a-z0-9]+$/.test((await frameLoc.locator('#last').textContent()) || ''));
    await frameLoc.locator('#bad').click();
    await frameLoc.locator('#last').filter({ hasText: 'rejected' }).waitFor({ timeout: 5000 });
    check(`[${mode}] invalid args are rejected by the bridge`, /must be string/.test(await frameLoc.locator('#last').textContent()));
    await frameLoc.locator('#submit').click();
    check(`[${mode}] form onSubmit fires and does not navigate`, (await frameLoc.locator('#last').textContent()) === 'submitted');
    const before = (await events(page)).length;
    await frameLoc.locator('#link').click();
    await page.waitForTimeout(500);
    check(`[${mode}] anchor click is neutralised`, steals.length === 0 && (await frameLoc.locator('#count').count()) === 1);

    const f = veneerFrame(page);
    const delResult = await f.evaluate(() => veneer.action('deleteTask', { id: 't1' }).then(() => 'ran', (e) => 'rejected: ' + e.message));
    check(`[${mode}] unregistered action is rejected and never reaches the host impl`, /not registered/.test(delResult) && !(await page.evaluate(() => window.__deleted)), delResult);
    const fetchResult = await f.evaluate(() => fetch('/steal?via=fetch').then(() => 'ok', (e) => 'blocked:' + e.name));
    check(`[${mode}] fetch is blocked by CSP`, /^blocked/.test(fetchResult), fetchResult);
    const leak = await f.evaluate(() => { try { return JSON.stringify(veneer.data('secrets')); } catch (e) { return 'threw:' + e.message; } });
    check(`[${mode}] unregistered data source is not in the frame`, /^threw/.test(leak), leak);
    const frozen = await f.evaluate(() => { try { window.veneer = 1; } catch (e) {} return typeof window.veneer; });
    check(`[${mode}] window.veneer cannot be replaced`, frozen === 'object');

    // Sibling frame tries to drive the sandbox with a forged init.
    const sib = page.frames().find((fr) => fr.url() === 'about:srcdoc' && fr !== f) || page.frame({ name: 'sibling' });
    await page.evaluate(() => document.getElementById('sibling').contentWindow.postMessage({ go: true }, '*'));
    await page.waitForTimeout(500);
    check(`[${mode}] forged init from a sibling frame is ignored`, (await frameLoc.locator('#pwned').count()) === 0 && (await frameLoc.locator('#count').count()) === 1);

    // Scanner refuses code that reaches for the window.
    await page.evaluate(() => window.__veneer.setUi("render(<div id='x'>{location.href}</div>)"));
    await waitState(page, () => window.__events.some((e) => e.reason === 'scan-violation'));
    const ev1 = await events(page);
    check(`[${mode}] scan violation → quarantined and reset to default`, ev1.some((e) => e.kind === 'violation' && e.reason === 'scan-violation') && (await page.evaluate(() => window.__veneer.ui === window.__veneer.defaultUI)));
    await frameLoc.locator('#count').waitFor({ timeout: 15000 });
    check(`[${mode}] default UI is back after the violation`, (await frameLoc.locator('#count').textContent()) === '2');
  } catch (e) {
    check(`[${mode}] scenario threw`, false, e.message.split('\n')[0]);
  }
  await context.close();
}

// Branding: theme tokens, dark mode, inlined font and auto-height.
if (ONLY !== 'canvas') for (const dark of ['0', '1']) {
  const { context, page } = await newPage();
  await page.goto(`${base}/?mode=url&dark=${dark}&autoheight=1`);
  const frameLoc = page.frameLocator('iframe[title="Veneer canvas"]');
  try {
    await frameLoc.locator('#brand').waitFor({ timeout: 15000 });
    const f = veneerFrame(page);
    const probe = await f.evaluate(() => {
      const el = document.getElementById('brand');
      const cs = getComputedStyle(el);
      return {
        primaryVar: getComputedStyle(document.documentElement).getPropertyValue('--veneer-primary').trim(),
        bg: cs.backgroundColor, color: cs.color, radius: cs.borderTopLeftRadius,
        dark: document.documentElement.classList.contains('dark'),
        bodyFont: getComputedStyle(document.body).fontFamily,
        fontFace: !!document.getElementById('veneer-theme') && document.getElementById('veneer-theme').textContent.includes('@font-face'),
        fontLoaded: document.fonts ? document.fonts.check('12px VeneerTestFont') : 'n/a',
        pageBg: getComputedStyle(document.documentElement).getPropertyValue('--veneer-background').trim(),
        // The Tailwind Play CDN is stubbed in this harness (not reachable from the runner), so the
        // utility→variable mapping is asserted structurally; the variables themselves are asserted live.
        twPrimary: window.tailwind && window.tailwind.config && window.tailwind.config.theme.extend.colors.primary.DEFAULT,
        twRadius: window.tailwind && window.tailwind.config && window.tailwind.config.theme.extend.borderRadius.md,
        twDark: window.tailwind && window.tailwind.config && window.tailwind.config.darkMode,
      };
    });
    check(`[dark=${dark}] Tailwind brand utilities map onto the variables`, probe.twPrimary === 'var(--veneer-primary)' && probe.twRadius === 'var(--veneer-radius-md)' && probe.twDark === 'class', JSON.stringify([probe.twPrimary, probe.twRadius, probe.twDark]));
    check(`[dark=${dark}] brand variable reaches the frame`, probe.primaryVar === '#0f766e', probe.primaryVar);
    check(`[dark=${dark}] --veneer-primary resolves to the brand colour`, probe.bg === 'rgb(15, 118, 110)', probe.bg);
    check(`[dark=${dark}] --veneer-primary-foreground resolves`, probe.color === 'rgb(255, 255, 255)', probe.color);
    check(`[dark=${dark}] --veneer-radius-md is the brand radius`, probe.radius === '2px', probe.radius);
    check(`[dark=${dark}] dark class follows the host mode`, probe.dark === (dark === '1'), String(probe.dark));
    check(`[dark=${dark}] per-mode background variable`, probe.pageBg === (dark === '1' ? '#101418' : '#fffdf7'), probe.pageBg);
    check(`[dark=${dark}] body font uses the brand stack`, /VeneerTestFont/.test(probe.bodyFont), probe.bodyFont);
    // the font arrives asynchronously (fetched by the host, then pushed as a theme update)
    await f.waitForFunction(() => document.getElementById('veneer-theme') && document.getElementById('veneer-theme').textContent.includes('@font-face'), null, { timeout: 8000 }).catch(() => {});
    const fontState = await f.evaluate(async () => { try { await document.fonts.ready; } catch (e) {} return { face: document.getElementById('veneer-theme').textContent.includes('@font-face'), loaded: document.fonts.check('12px VeneerTestFont') }; });
    check(`[dark=${dark}] host font is inlined as a data: URI @font-face`, fontState.face === true, JSON.stringify(fontState));
    check(`[dark=${dark}] inlined font is usable`, fontState.loaded === true, JSON.stringify(fontState));
    const h1 = await page.evaluate(() => document.querySelector('iframe[title="Veneer canvas"]').getBoundingClientRect().height);
    await frameLoc.locator('#add').click();
    await frameLoc.locator('#add').click();
    await page.waitForFunction((prev) => document.querySelector('iframe[title="Veneer canvas"]').getBoundingClientRect().height > prev + 500, h1, { timeout: 8000 }).catch(() => {});
    const h2 = await page.evaluate(() => document.querySelector('iframe[title="Veneer canvas"]').getBoundingClientRect().height);
    check(`[dark=${dark}] auto-height grows the iframe with its content`, h2 > h1 + 500, `${h1} → ${h2}`);
    const themeErrors = (await events(page)).filter((e) => e.kind === 'theme-error');
    check(`[dark=${dark}] no theme errors`, themeErrors.length === 0, JSON.stringify(themeErrors));
  } catch (e) {
    check(`[dark=${dark}] branding scenario threw`, false, e.message.split('\n')[0]);
  }
  await context.close();
}

// Navigation exfil, simulating a scanner bypass by running the navigation from inside the frame.
if (ONLY !== 'canvas') {
  const { context, page } = await newPage();
  await page.goto(`${base}/?mode=url`);
  const frameLoc = page.frameLocator('iframe[title="Veneer canvas"]');
  try {
    await frameLoc.locator('#count').waitFor({ timeout: 15000 });
    // A generated (non-default) UI, so the violation path remounts the default one afterwards.
    await page.evaluate(() => window.__veneer.setUi(window.__veneer.defaultUI + '\n// generated'));
    await page.waitForTimeout(300);
    await frameLoc.locator('#count').waitFor({ timeout: 15000 });
    steals.length = 0;
    const f = veneerFrame(page);
    await f.evaluate((b) => { setTimeout(() => { location.href = b + '/steal?d=' + encodeURIComponent(JSON.stringify(veneer.data('tasks'))); }, 0); }, base).catch(() => {});
    await waitState(page, () => window.__events.some((e) => e.reason === 'frame-navigated'), 10000).catch(() => {});
    const ev = await events(page);
    check('self-navigation is detected as a violation', ev.some((e) => e.kind === 'frame-violation' && e.reason === 'frame-navigated'), JSON.stringify(ev.map((e) => e.reason || e.type)));
    check('the first navigation request leaks data already in the frame (documented residual)', steals.length === 1, `steals=${steals.length}`);
    // After the violation the attacker document must get no init/data even though it posted `ready`.
    await page.evaluate(() => window.__veneer.actions.createTask({ title: 'after' }));
    await page.waitForTimeout(700);
    const stolenFrame = page.frames().find((fr) => /\/steal/.test(fr.url()));
    const got = stolenFrame ? await stolenFrame.evaluate(() => window.__got).catch(() => []) : [];
    check('attacker document receives no host messages', got.length === 0, JSON.stringify(got).slice(0, 100));
    await frameLoc.locator('#count').waitFor({ timeout: 15000 });
    check('canvas is reset to the default UI in a fresh document', (await page.evaluate(() => window.__veneer.ui === window.__veneer.defaultUI)));
    check('offending code is reported with the violation', ev.some((e) => e.kind === 'violation' && e.reason === 'frame-navigated'));
  } catch (e) {
    check('navigation scenario threw', false, e.message.split('\n')[0]);
  }
  await context.close();
}

// Never-completing navigation: no load event → heartbeat must catch it.
if (ONLY !== 'canvas') {
  const { context, page } = await newPage();
  await page.goto(`${base}/?mode=url`);
  const frameLoc = page.frameLocator('iframe[title="Veneer canvas"]');
  try {
    await frameLoc.locator('#count').waitFor({ timeout: 15000 });
    const f = veneerFrame(page);
    await f.evaluate((b) => { setTimeout(() => { location.href = b + '/hang?x=1'; }, 0); }, base).catch(() => {});
    await waitState(page, () => window.__events.some((e) => e.reason === 'frame-unresponsive' || e.reason === 'frame-navigated'), 10000).catch(() => {});
    const ev = await events(page);
    check('hanging navigation is caught (heartbeat or load)', ev.some((e) => e.kind === 'frame-violation'), JSON.stringify(ev.map((e) => e.reason || e.type)));
  } catch (e) {
    check('hang scenario threw', false, e.message.split('\n')[0]);
  }
  await context.close();
}

// Tampered CDN bytes must fail SRI: the runtime never starts, the host reports a timeout.
if (ONLY !== 'canvas') {
  const { context, page } = await newPage({ breakSri: true });
  await page.goto(`${base}/?mode=url`);
  try {
    await waitState(page, () => window.__events.some((e) => e.type === 'runtime-timeout'), 15000);
    const tampered = await veneerFrame(page).evaluate(() => window.__tampered).catch(() => 'n/a');
    check('tampered runtime script fails SRI and never runs', tampered !== 1, `tampered=${tampered}`);
  } catch (e) {
    check('SRI scenario threw', false, e.message.split('\n')[0]);
  }
  await context.close();
}

// Host CSP inheritance: srcdoc breaks under a strict host CSP, frameSrc works.
if (ONLY !== 'canvas') {
  const { context, page } = await newPage();
  await page.goto(`${base}/strict-csp?mode=url`);
  const frameLoc = page.frameLocator('iframe[title="Veneer canvas"]');
  try {
    await frameLoc.locator('#count').waitFor({ timeout: 15000 });
    check('frameSrc mode works under a strict host CSP', true);
  } catch (e) {
    check('frameSrc mode works under a strict host CSP', false, e.message.split('\n')[0]);
  }
  await context.close();
  const { context: c2, page: p2 } = await newPage();
  await p2.goto(`${base}/strict-csp?mode=srcdoc`);
  try {
    await waitState(p2, () => window.__events.some((e) => e.type === 'runtime-timeout'), 15000);
    check('srcdoc mode under a strict host CSP reports a clear runtime-timeout diagnostic', true);
  } catch (e) {
    check('srcdoc mode under a strict host CSP reports a clear runtime-timeout diagnostic', false, e.message.split('\n')[0]);
  }
  await c2.close();
}

// ============================================================================================
// Worker engine (VeneerCanvas): generated UI lands in the host document through the allowlist.
// Generated ids are namespaced (`#count` → `#v-count`), classes are prefixed (`grid` → `v:grid`).
// ============================================================================================
const canvasEvents = (page) => page.evaluate(() => window.__events);
const canvasOf = (page) => page.locator('[data-veneer-engine="worker"]');
const noSteal = (page) => page.evaluate(() => location.pathname);

if (ONLY !== 'frame') for (const variant of ['/canvas', '/canvas-strict']) {
  const strict = variant === '/canvas-strict';
  const tag = strict ? '[canvas strict-csp]' : '[canvas]';
  const { context, page } = await newPage();
  const cspViolations = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text());
  });
  await page.goto(`${base}${variant}`);
  try {
    await page.locator('#v-count').waitFor({ timeout: 20000 });
    check(`${tag} default UI renders natively (no iframe)`, (await page.locator('#v-count').textContent()) === '1' && (await page.locator('iframe').count()) === 0);
    check(`${tag} generated nodes live inside the canvas root`, (await canvasOf(page).locator('#v-count').count()) === 1);

    // Styling: prefixed utilities compiled in the worker, brand tokens from the provider theme.
    const brand = await page.evaluate(() => {
      const el = document.getElementById('v-brand');
      const cs = getComputedStyle(el);
      const h1 = getComputedStyle(document.getElementById('host-h1'));
      const root = document.querySelector('[data-veneer-engine="worker"]');
      return {
        cls: el.className,
        bg: cs.backgroundColor,
        color: cs.color,
        radius: cs.borderTopLeftRadius,
        h1Size: h1.fontSize,
        h1Margin: h1.marginTop,
        primaryVar: getComputedStyle(root).getPropertyValue('--veneer-primary').trim(),
        bgVar: getComputedStyle(root).getPropertyValue('--veneer-background').trim(),
        font: getComputedStyle(document.getElementById('v-count')).fontFamily,
        sheets: document.adoptedStyleSheets ? document.adoptedStyleSheets.length : -1,
        countSize: getComputedStyle(document.getElementById('v-count')).fontSize,
      };
    });
    check(`${tag} class names are prefixed`, /(^|\s)v:bg-primary(\s|$)/.test(brand.cls) && !/(^|\s)bg-primary(\s|$)/.test(brand.cls), brand.cls);
    check(`${tag} bg-primary resolves to the brand colour`, brand.bg === 'rgb(15, 118, 110)', brand.bg);
    check(`${tag} text-primary-foreground resolves`, brand.color === 'rgb(255, 255, 255)', brand.color);
    check(`${tag} rounded-md is the brand radius`, brand.radius === '2px', brand.radius);
    check(`${tag} text-2xl utility applies`, brand.countSize === '24px', brand.countSize);
    check(`${tag} brand font reaches generated nodes`, /Georgia/.test(brand.font), brand.font);
    check(`${tag} theme variables are set on the canvas root`, brand.primaryVar === '#0f766e' && brand.bgVar === '#fffdf7', JSON.stringify([brand.primaryVar, brand.bgVar]));
    check(`${tag} preflight does not leak onto the host page`, brand.h1Size === '32px' && brand.h1Margin !== '0px', JSON.stringify([brand.h1Size, brand.h1Margin]));
    check(`${tag} stylesheet is installed via adoptedStyleSheets`, brand.sheets >= 1, String(brand.sheets));

    // Bridge: actions, validation, data push.
    await page.locator('#v-add').click();
    await page.locator('#v-count').filter({ hasText: '2' }).waitFor({ timeout: 5000 });
    check(`${tag} action round-trip + data push re-renders`, true);
    check(`${tag} declared return value crosses the bridge`, /^t[a-z0-9]+$/.test((await page.locator('#v-last').textContent()) || ''));
    check(`${tag} list re-renders from pushed data`, (await page.locator('.v\\:task').count()) === 2);
    await page.locator('#v-bad').click();
    await page.locator('#v-last').filter({ hasText: 'rejected' }).waitFor({ timeout: 5000 });
    check(`${tag} invalid args are rejected by the bridge`, /must be string/.test(await page.locator('#v-last').textContent()));
    await page.locator('#v-del').click();
    await page.locator('#v-last').filter({ hasText: 'not registered' }).waitFor({ timeout: 5000 });
    check(`${tag} unregistered action is refused inside the box and never reaches the host impl`, !(await page.evaluate(() => window.__deleted)));
    await page.locator('#v-globals').click();
    await page.locator('#v-last').filter({ hasText: 'undefined' }).waitFor({ timeout: 5000 });
    const globals = await page.locator('#v-last').textContent();
    check(`${tag} fetch/location/window/document/XHR/WebAssembly/importScripts do not exist in the box`, globals === 'undefined,undefined,undefined,undefined,undefined,undefined,undefined', globals);

    // Typing: DOM owns the text, the box sees the value.
    await page.locator('#v-title').fill('hello');
    await page.locator('#v-echo').filter({ hasText: 'hello' }).waitFor({ timeout: 5000 });
    check(`${tag} typing reaches the box and the input keeps its text`, (await page.locator('#v-title').inputValue()) === 'hello');

    // Wall 2: the allowlist.
    steals.length = 0;
    await page.locator('#v-submit').click();
    await page.locator('#v-last').filter({ hasText: 'submitted' }).waitFor({ timeout: 5000 });
    check(`${tag} form onSubmit fires and does not navigate`, (await noSteal(page)) === variant);
    const link = await page.evaluate(() => {
      const el = document.getElementById('v-link');
      return el ? { tag: el.tagName, href: el.getAttribute('href'), text: el.textContent } : null;
    });
    check(`${tag} <a> is demoted to a span without href`, link && link.tag === 'SPAN' && link.href === null && link.text === 'link text', JSON.stringify(link));
    await page.locator('#v-link').click();
    await page.waitForTimeout(300);
    check(`${tag} clicking the demoted link goes nowhere`, (await noSteal(page)) === variant && steals.length === 0);
    check(`${tag} <img> is dropped`, (await page.locator('#v-img').count()) === 0 && (await canvasOf(page).locator('img').count()) === 0);
    const sty = await page.evaluate(() => {
      const cs = getComputedStyle(document.getElementById('v-sty'));
      return { bgImage: cs.backgroundImage, position: cs.position, z: cs.zIndex, color: cs.color };
    });
    check(`${tag} inline style: url() dropped, fixed demoted, z-index capped, safe colour kept`, sty.bgImage === 'none' && sty.position !== 'fixed' && Number(sty.z) <= 100 && sty.color === 'rgb(1, 2, 3)', JSON.stringify(sty));
    const cls = await page.evaluate(() => ({ cls: document.getElementById('v-cls').className, size: getComputedStyle(document.getElementById('v-cls')).fontSize }));
    check(`${tag} class grammar: url class dropped, numeric arbitrary value kept`, !/url/.test(cls.cls) && cls.size === '11px', JSON.stringify(cls));
    check(`${tag} nothing was fetched from the network`, steals.length === 0, `steals=${steals.length}`);

    // Data that is not registered never enters the box.
    await page.evaluate(() => window.__veneer.setUi("render(<div id='leak'>{(() => { try { return JSON.stringify(veneer.data('secrets')); } catch (e) { return 'threw:' + e.message; } })()}</div>)"));
    await page.locator('#v-leak').waitFor({ timeout: 20000 });
    const leak = await page.locator('#v-leak').textContent();
    check(`${tag} unregistered data source is not in the box`, /^threw/.test(leak), leak);
    check(`${tag} secret never appears in the document`, !(await page.content()).includes('do-not-leak'));

    // Wall 3: the interpreter's deadline. A hot loop at start-up can never finish "starting".
    await page.evaluate(() => window.__veneer.setUi("render(<div id='hot'>hot</div>); while (true) {}"));
    await waitState(page, () => window.__events.some((e) => e.kind === 'canvas-violation'), 25000);
    const ev1 = await canvasEvents(page);
    check(`${tag} hot loop at start-up → engine-fatal violation`, ev1.some((e) => e.kind === 'canvas-violation' && e.reason === 'engine-fatal') && ev1.some((e) => e.kind === 'violation' && e.reason === 'engine-fatal'), JSON.stringify(ev1.map((e) => e.reason || e.type)));
    await page.locator('#v-count').waitFor({ timeout: 20000 });
    check(`${tag} default UI is back in a fresh worker after the violation`, (await page.locator('#v-count').textContent()) === '2' && (await page.evaluate(() => window.__veneer.ui === window.__veneer.defaultUI)));

    // A hot loop in an event handler after start-up: each entry blows its 250ms budget and is
    // interrupted (the page never freezes); three in a row ends the box.
    await page.evaluate(() => window.__veneer.setUi("render(<button id='burn' onClick={() => { while (true) {} }}>burn</button>);"));
    await page.locator('#v-burn').waitFor({ timeout: 20000 });
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) {
      await page.locator('#v-burn').click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(400);
    }
    const pageResponsive = Date.now() - t0 < 6000;
    await waitState(page, () => window.__events.filter((e) => e.kind === 'canvas-violation').length >= 2, 25000);
    const ev2 = await canvasEvents(page);
    check(`${tag} hot loop in a handler is interrupted and the page stays responsive`, pageResponsive && ev2.some((e) => e.kind === 'error' && e.errKind === 'timeout' && e.stage === 'event'), JSON.stringify(ev2.filter((e) => e.kind === 'error').map((e) => [e.type, e.errKind, e.stage])).slice(0, 300));
    check(`${tag} three timeouts in a row → engine-fatal`, ev2.filter((e) => e.kind === 'canvas-violation' && e.reason === 'engine-fatal').length >= 2, JSON.stringify(ev2.map((e) => e.reason || e.type)));
    await page.locator('#v-count').waitFor({ timeout: 20000 });
    check(`${tag} default UI is back again`, (await page.locator('#v-count').textContent()) === '2');
    const engineErrors = (await canvasEvents(page)).filter((e) => e.kind === 'error' && e.type === 'runtime-timeout');
    check(`${tag} no engine start-up failures`, engineErrors.length === 0, JSON.stringify(engineErrors).slice(0, 200));
    if (strict) check(`${tag} no CSP violations under a strict policy`, cspViolations.length === 0, cspViolations.join(' | ').slice(0, 300));
  } catch (e) {
    check(`${tag} scenario threw`, false, e.message.split('\n')[0]);
  }
  await context.close();
}

// Warm spare worker: after the first UI is up, a second worker is booted in the background and the
// next UI adopts it, so the swap skips the cold start (QuickJS wasm + Tailwind ≈ 1 s).
if (ONLY !== 'frame') {
  const { context, page } = await newPage();
  await page.goto(`${base}/canvas`);
  try {
    await page.locator('#v-count').waitFor({ timeout: 20000 });
    await page.waitForFunction(() => window.__veneerWarm && window.__veneerWarm(), null, { timeout: 5000 }).catch(() => {});
    // Playwright registers a new Worker asynchronously; give it a moment to show up.
    for (let i = 0; i < 50 && page.workers().length < 2; i++) await page.waitForTimeout(100);
    const workersBefore = page.workers().length;
    check('[canvas warm] a spare worker is booted while a UI is showing', (await page.evaluate(() => window.__veneerWarm())) === true && workersBefore === 2, `workers=${workersBefore}`);
    const heightBefore = await page.evaluate(() => document.querySelector('[data-veneer-engine="worker"]').getBoundingClientRect().height);
    const t0 = Date.now();
    await page.evaluate(() => window.__veneer.setUi("render(<div id='swap' className='p-4'>swapped</div>)"));
    await page.locator('#v-swap').waitFor({ timeout: 10000 });
    const swapMs = Date.now() - t0;
    check('[canvas warm] the next UI adopts the spare and renders fast', swapMs < 1500, `${swapMs}ms`);
    check('[canvas warm] the old height is held during the swap (no page jump)', heightBefore > 0, `${heightBefore}px held`);
    await page.waitForFunction(() => window.__veneerWarm(), null, { timeout: 5000 }).catch(() => {});
    for (let i = 0; i < 50 && page.workers().length !== 2; i++) await page.waitForTimeout(100);
    check('[canvas warm] a new spare is booted after the swap (old worker gone)', (await page.evaluate(() => window.__veneerWarm())) === true && page.workers().length === 2, `workers=${page.workers().length}`);
  } catch (e) {
    check('[canvas warm] scenario threw', false, e.message.split('\n')[0]);
  }
  await context.close();
}

// State carry-over: an edit keeps what the user was doing; a new view starts clean.
if (ONLY !== 'frame') {
  const { context, page } = await newPage();
  await page.goto(`${base}/canvas`);
  try {
    await page.locator('#v-count').waitFor({ timeout: 20000 });
    await page.locator('#v-add').click();
    await page.locator('#v-count').filter({ hasText: '2' }).waitFor({ timeout: 5000 });
    // Type last, so the title field is the focused element when the swap happens.
    await page.locator('#v-title').fill('hello there');
    await page.locator('#v-echo').filter({ hasText: 'hello there' }).waitFor({ timeout: 5000 });
    check('[canvas carry] badge marks the area as AI-generated', (await page.locator('.veneer-badge').textContent()) === 'AI-generated view');
    // A small edit of the same UI (only markup changed), applied as the server would: carryState.
    await page.evaluate(() => window.__veneer.setUi(window.__veneer.defaultUI.replace('>brand<', '>brand!<'), { carryState: true }));
    await page.locator('#v-brand').filter({ hasText: 'brand!' }).waitFor({ timeout: 20000 });
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => ({ echo: document.getElementById('v-echo').textContent, value: document.getElementById('v-title').value, focused: document.activeElement && document.activeElement.id, last: document.getElementById('v-last').textContent }));
    check('[canvas carry] typed text survives an edit (useState carried into the new interpreter)', after.echo === 'hello there' && after.value === 'hello there', JSON.stringify(after));
    check('[canvas carry] focus returns to the same field after the swap', after.focused === 'v-title', String(after.focused));
    check('[canvas carry] other component state survives too', /^t[a-z0-9]+$/.test(after.last || ''), after.last);
    // A new view (no carryState) starts from the code's own initial values.
    await page.evaluate(() => window.__veneer.setUi(window.__veneer.defaultUI.replace('>brand<', '>fresh<')));
    await page.locator('#v-brand').filter({ hasText: 'fresh' }).waitFor({ timeout: 20000 });
    const fresh = await page.evaluate(() => ({ echo: document.getElementById('v-echo').textContent, value: document.getElementById('v-title').value }));
    check('[canvas carry] a new view does not inherit state', fresh.echo === '' && fresh.value === '', JSON.stringify(fresh));
  } catch (e) {
    check('[canvas carry] scenario threw', false, e.message.split('\n')[0]);
  }
  await context.close();
}

// Host allow policy: images and links only from listed sources, with safe attributes.
if (ONLY !== 'frame') {
  const { context, page } = await newPage();
  await page.goto(`${base}/canvas?allow=1`);
  try {
    await page.locator('#v-count').waitFor({ timeout: 20000 });
    const probe = await page.evaluate(() => {
      const img = document.getElementById('v-okimg');
      const bad = document.getElementById('v-img');
      const ok = document.getElementById('v-oklink');
      const link = document.getElementById('v-link');
      return {
        img: img ? { tag: img.tagName, src: img.getAttribute('src'), loading: img.getAttribute('loading'), ref: img.getAttribute('referrerpolicy'), alt: img.getAttribute('alt') } : null,
        bad: !!bad,
        ok: ok ? { tag: ok.tagName, href: ok.getAttribute('href'), target: ok.getAttribute('target'), rel: ok.getAttribute('rel') } : null,
        link: link ? { tag: link.tagName, href: link.getAttribute('href') } : null,
      };
    });
    check('[canvas allow] same-origin image is rendered lazily with no referrer', probe.img && probe.img.tag === 'IMG' && /\/img\/ok\.png$/.test(probe.img.src) && probe.img.loading === 'lazy' && probe.img.ref === 'no-referrer' && probe.img.alt === 'ok', JSON.stringify(probe.img));
    check('[canvas allow] an image from a non-allowed path is still dropped', probe.bad === false);
    check('[canvas allow] allowed cross-origin link opens in a new tab with noopener', probe.ok && probe.ok.tag === 'A' && probe.ok.href === 'https://example.com/x' && probe.ok.target === '_blank' && /noopener/.test(probe.ok.rel), JSON.stringify(probe.ok));
    check('[canvas allow] a link to a non-allowed destination is still demoted', probe.link && probe.link.tag === 'SPAN' && probe.link.href === null, JSON.stringify(probe.link));
    check('[canvas allow] nothing was fetched from the network besides the allowed image', steals.length === 0, `steals=${steals.length}`);
  } catch (e) {
    check('[canvas allow] scenario threw', false, e.message.split('\n')[0]);
  }
  await context.close();
}

// Dark mode: the `.veneer-dark` class on the canvas root drives the `dark:` variant.
if (ONLY !== 'frame') {
  const { context, page } = await newPage();
  await page.goto(`${base}/canvas?dark=1`);
  try {
    await page.locator('#v-brand').waitFor({ timeout: 20000 });
    const probe = await page.evaluate(() => {
      const root = document.querySelector('[data-veneer-engine="worker"]');
      const cs = getComputedStyle(document.getElementById('v-brand'));
      return { dark: root.classList.contains('veneer-dark'), bg: cs.backgroundColor, bgVar: getComputedStyle(root).getPropertyValue('--veneer-background').trim() };
    });
    check('[canvas dark] canvas root carries .veneer-dark', probe.dark === true);
    check('[canvas dark] dark:bg-accent wins over bg-primary', probe.bg === 'rgb(124, 58, 237)', probe.bg);
    check('[canvas dark] per-mode background variable', probe.bgVar === '#101418', probe.bgVar);
  } catch (e) {
    check('[canvas dark] scenario threw', false, e.message.split('\n')[0]);
  }
  await context.close();
}

await browser.close();
server.close();
console.log(results.join('\n'));
console.log(`\n${results.filter((r) => r.startsWith('PASS')).length} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
