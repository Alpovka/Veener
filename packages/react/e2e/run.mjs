/**
 * Browser end-to-end checks for the sandbox, run in the preinstalled Chromium.
 *   node e2e/run.mjs
 * Serves a host page from a local server, routes the CDN scripts to node_modules (so the SRI
 * hashes are exercised against the real bytes), and drives attacks from inside the frame.
 */
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
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

for (const mode of ['srcdoc', 'url']) {
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
for (const dark of ['0', '1']) {
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
{
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
{
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
{
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
{
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

await browser.close();
server.close();
console.log(results.join('\n'));
console.log(`\n${results.filter((r) => r.startsWith('PASS')).length} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
