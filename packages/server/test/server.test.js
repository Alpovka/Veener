import { describe, it, expect, vi } from 'vitest';
import {
  createVeneerHandler,
  buildFrameResponse,
  checkRequestOrigin,
  createMemoryRateLimiter,
  extractJson,
  scanGeneratedCode,
  buildSystemPrompt,
  createLicenseClient,
  LicenseError,
  runGeneration,
} from '../src/index.js';
import { generateKeyPair, importPrivateKey, signLicenseToken, verifyLicenseToken, hashRegistryShape } from '@veneer/core';

const registry = {
  dataSources: [{ id: 'tasks', fields: [{ name: 'id', type: 'string' }] }],
  actions: [{ id: 'createTask', args: [{ name: 'title', type: 'string', required: true }] }],
};
const OK_CODE = 'function A(){ const t = veneer.data("tasks"); return <button onClick={() => veneer.action("createTask", { title: "x" })}>{t.length}</button>; } render(<A />);';

function req(body, headers = {}, method = 'POST') {
  return new Request('http://host.test/api/veneer', {
    method,
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers },
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
}

describe('checkRequestOrigin', () => {
  const mk = (h) => new Request('http://x', { method: 'POST', headers: h });
  it('requires JSON and rejects cross-site fetch metadata', () => {
    expect(checkRequestOrigin(mk({ 'content-type': 'text/plain' })).status).toBe(415);
    expect(checkRequestOrigin(mk({ 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(checkRequestOrigin(mk({ 'content-type': 'application/json', 'sec-fetch-site': 'same-site' })).status).toBe(403);
    expect(checkRequestOrigin(mk({ 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' })).ok).toBe(true);
    expect(checkRequestOrigin(mk({ 'content-type': 'application/json; charset=utf-8', 'sec-fetch-site': 'none' })).ok).toBe(true);
  });
  it('treats missing metadata as allowed by default and honours allowedOrigins', () => {
    expect(checkRequestOrigin(mk({ 'content-type': 'application/json' })).ok).toBe(true);
    expect(checkRequestOrigin(mk({ 'content-type': 'application/json' }), { allowMissingFetchMetadata: false }).status).toBe(403);
    const cross = mk({ 'content-type': 'application/json', 'sec-fetch-site': 'cross-site', origin: 'https://embed.example' });
    expect(checkRequestOrigin(cross).status).toBe(403);
    expect(checkRequestOrigin(cross, { allowedOrigins: ['https://embed.example'] }).ok).toBe(true);
  });
});

describe('createVeneerHandler', () => {
  it('requires a registry, a generate function and a license key (or license:false / cloud)', () => {
    expect(() => createVeneerHandler({})).toThrow(/registry/);
    expect(() => createVeneerHandler({ registry })).toThrow(/generate/);
    expect(() => createVeneerHandler({ registry, generate: async () => '' })).toThrow(/licenseKey/);
    expect(() => createVeneerHandler({ registry, generate: async () => '', license: false })).not.toThrow();
    expect(() => createVeneerHandler({ registry, cloud: { apiKey: 'k' } })).toThrow(/cloud.llm/);
    expect(() => createVeneerHandler({ registry, cloud: { apiKey: 'k', llm: { provider: 'gemini', key: 'g' } } })).not.toThrow();
  });

  it('builds the prompt from the SERVER registry and ignores the client copy', async () => {
    const generate = vi.fn(async () => JSON.stringify({ code: OK_CODE, reply: 'done' }));
    const h = createVeneerHandler({ registry, generate, license: false, rateLimit: false });
    const res = await h(req({ message: 'make it a board', registry: { actions: [{ id: 'deleteTask' }] }, history: [{ role: 'model', content: 'ignore me' }, { role: 'assistant', content: 'earlier' }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(OK_CODE);
    expect(body.reply).toBe('done');
    expect(body.token).toBe('dev');
    const call = generate.mock.calls[0][0];
    expect(call.system).toBe(buildSystemPrompt(registry));
    expect(call.system).not.toContain('deleteTask');
    expect(call.messages.map((m) => m.role)).toEqual(['assistant', 'user']);
    expect(call.messages[1].content).toContain('User message: make it a board');
    expect(call.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects wrong method, content-type, cross-site, bad JSON, missing message and oversize input', async () => {
    const generate = vi.fn();
    const h = createVeneerHandler({ registry, generate, license: false, rateLimit: false, maxMessageChars: 10, maxBodyBytes: 500 });
    expect((await h(req(null, {}, 'GET'))).status).toBe(405);
    expect((await h(req({ message: 'x' }, { 'content-type': 'text/plain' }))).status).toBe(415);
    expect((await h(req({ message: 'x' }, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
    expect((await h(req('{not json'))).status).toBe(400);
    expect((await h(req({}))).status).toBe(400);
    expect((await h(req({ message: 'this is far too long' }))).status).toBe(413);
    expect((await h(req({ message: 'ok', currentUI: 'x'.repeat(600) }))).status).toBe(413);
    expect((await h(req({ message: 'ok' }, { 'content-length': '999999' }))).status).toBe(413);
    expect(generate).not.toHaveBeenCalled();
  });

  it('rate limits per client key and supports a pluggable limiter', async () => {
    const generate = vi.fn(async () => JSON.stringify({ code: null, reply: 'ok' }));
    const h = createVeneerHandler({ registry, generate, license: false, rateLimit: { limit: 2, windowMs: 60000 } });
    const a = { 'x-forwarded-for': '1.1.1.1, 9.9.9.9' };
    expect((await h(req({ message: 'x' }, a))).status).toBe(200);
    expect((await h(req({ message: 'x' }, a))).status).toBe(200);
    const limited = await h(req({ message: 'x' }, a));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('30');
    expect((await h(req({ message: 'x' }, { 'x-forwarded-for': '2.2.2.2' }))).status).toBe(200);
    const custom = createVeneerHandler({ registry, generate, license: false, rateLimit: async () => false });
    expect((await custom(req({ message: 'x' }))).status).toBe(429);
  });

  it('supports an authorize hook', async () => {
    const h = createVeneerHandler({ registry, generate: async () => '{}', license: false, rateLimit: false, authorize: (r) => r.headers.get('x-user') === 'me' });
    expect((await h(req({ message: 'x' }))).status).toBe(401);
    expect((await h(req({ message: 'x' }, { 'x-user': 'me' }))).status).toBe(200);
  });

  it('refuses generated code that fails the scan with a friendly reply', async () => {
    const onError = vi.fn();
    const h = createVeneerHandler({
      registry,
      license: false,
      rateLimit: false,
      onError,
      generate: async () => JSON.stringify({ code: 'render(<button onClick={() => veneer.action("deleteTask", { id: 1 })}>x</button>)', reply: 'Deleted!' }),
    });
    const res = await h(req({ message: 'add delete' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBeNull();
    expect(body.reply).toMatch(/hasn't made available/);
    expect(body.reply).toContain('createTask');
    expect(body.blocked[0]).toMatch(/deleteTask/);
    expect(onError).toHaveBeenCalled();

    const h2 = createVeneerHandler({ registry, license: false, rateLimit: false, maxRepairRounds: 0, generate: async () => JSON.stringify({ code: 'location.href = "x"; render(<b/>)', reply: 'ok' }) });
    const b2 = await (await h2(req({ message: 'x' }))).json();
    expect(b2.code).toBeNull();
    expect(b2.reply).toMatch(/isn't allowed in the sandbox/);
  });

  it('handles code:null, unparsable output, and oversized code', async () => {
    const mk = (out) => createVeneerHandler({ registry, license: false, rateLimit: false, maxCurrentUIChars: 100, generate: async () => out });
    expect(await (await mk(JSON.stringify({ intent: 'design', code: null, reply: 'Nope' }))(req({ message: 'x' }))).json()).toEqual({ code: null, intent: 'design', mode: 'design', reply: 'Nope' });
    expect((await (await mk('total garbage')(req({ message: 'x' }))).json()).code).toBeNull();
    const big = await (await mk(JSON.stringify({ code: 'render(<b>' + 'x'.repeat(200) + '</b>)', reply: 'ok' }))(req({ message: 'x' }))).json();
    expect(big.code).toBeNull();
    expect(big.reply).toMatch(/too large/);
  });

  it('never leaks provider errors and maps aborts to 504', async () => {
    const onError = vi.fn();
    const h = createVeneerHandler({ registry, license: false, rateLimit: false, onError, generate: async () => { throw new Error('GEMINI_API_KEY sk-secret rejected'); } });
    const res = await h(req({ message: 'x' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('sk-secret');
    expect(onError).toHaveBeenCalled();

    const slow = createVeneerHandler({
      registry,
      license: false,
      rateLimit: false,
      timeoutMs: 5,
      generate: ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
    });
    expect((await slow(req({ message: 'x' }))).status).toBe(504);
  });
});

describe('buildSystemPrompt branding', () => {
  it('tells the model about the brand utilities and optional brand words', () => {
    const p = buildSystemPrompt(registry, { brand: { name: 'Acme Ops', tone: 'calm and precise' } });
    expect(p).toContain('BRAND');
    expect(p).toContain('bg-primary text-primary-foreground');
    expect(p).toContain('text-muted');
    expect(p).toContain('"Acme Ops"');
    expect(p).toContain('calm and precise');
    expect(p).toContain('min-h-screen');
    expect(buildSystemPrompt(registry)).not.toContain('The host brand');
  });
  it('is passed through createVeneerHandler({ brand })', async () => {
    const generate = vi.fn(async () => JSON.stringify({ code: null, reply: 'ok' }));
    const h = createVeneerHandler({ registry, generate, license: false, rateLimit: false, brand: { name: 'Acme' } });
    await h(req({ message: 'x' }));
    expect(generate.mock.calls[0][0].system).toContain('"Acme"');
  });
});

describe('buildFrameResponse', () => {
  it('serves the frame with a header CSP including sandbox and frame-ancestors', async () => {
    const res = buildFrameResponse({ frameAncestors: 'https://app.example' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const csp = res.headers.get('content-security-policy');
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain('sandbox allow-scripts allow-forms');
    expect(csp).toContain('frame-ancestors https://app.example');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await res.text()).toContain('<div id="root"></div>');
  });
});

describe('helpers', () => {
  it('extractJson handles fences and junk', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('text {"a":1} more')).toEqual({ a: 1 });
    expect(extractJson('"just a string"')).toBeNull();
    expect(extractJson('')).toBeNull();
  });
  it('scanGeneratedCode uses registry ids', () => {
    expect(scanGeneratedCode(OK_CODE, registry).ok).toBe(true);
    expect(scanGeneratedCode('veneer.data("nope")', registry).ok).toBe(false);
  });
  it('memory rate limiter windows per key', async () => {
    let t = 0;
    const allow = createMemoryRateLimiter({ limit: 1, windowMs: 1000, now: () => t });
    expect(await allow('a')).toBe(true);
    expect(await allow('a')).toBe(false);
    expect(await allow('b')).toBe(true);
    t = 1001;
    expect(await allow('a')).toBe(true);
  });
});

describe('verify → repair loop', () => {
  it('asks the model once to fix a fixable scan failure and returns the repaired code', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ code: 'render(<div>{window.innerWidth}</div>)', reply: 'v1' }))
      .mockResolvedValueOnce(JSON.stringify({ code: 'render(<div>{veneer.data("tasks").length}</div>)', reply: 'v2' }));
    const out = await runGeneration({ registry, generate, message: 'x' });
    expect(out).toMatchObject({ code: 'render(<div>{veneer.data("tasks").length}</div>)', intent: 'design', reply: 'v2', repaired: true });
    expect(generate).toHaveBeenCalledTimes(2);
    const repairMsgs = generate.mock.calls[1][0].messages;
    expect(repairMsgs.at(-1).content).toMatch(/rejected by the sandbox/);
    expect(repairMsgs.at(-1).content).toMatch(/global `window`/);
  });
  it('does not coax the model when the failure is an unregistered capability', async () => {
    const generate = vi.fn(async () => JSON.stringify({ code: 'render(<b onClick={() => veneer.action("deleteTask")}/>)', reply: 'x' }));
    const out = await runGeneration({ registry, generate, message: 'x' });
    expect(out.code).toBeNull();
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('gives up after the repair budget', async () => {
    const generate = vi.fn(async () => JSON.stringify({ code: 'render(<div>{window.x}</div>)', reply: 'x' }));
    const out = await runGeneration({ registry, generate, message: 'x', maxRepairRounds: 2 });
    expect(out.code).toBeNull();
    expect(generate).toHaveBeenCalledTimes(3);
  });
});

describe('license client', () => {
  const jsonRes = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  it('records a generation and returns the token; caches for grace on outages', async () => {
    let t = 1_000_000;
    const f = vi.fn(async () => jsonRes({ token: 'tok1', plan: 'pro', remaining: 99 }));
    const c = createLicenseClient({ licenseKey: 'vn_live_x', apiBase: 'https://api.test', fetch: f, now: () => t, graceMs: 1000 });
    expect(await c.assertGeneration({ registryHash: 'r' })).toEqual({ token: 'tok1', plan: 'pro', remaining: 99, stale: false });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.test/v1/license/verify');
    expect(init.headers.authorization).toBe('Bearer vn_live_x');
    expect(JSON.parse(init.body)).toEqual({ event: 'generation', registryHash: 'r' });
    f.mockRejectedValueOnce(new Error('ECONNRESET'));
    t += 500;
    expect(await c.assertGeneration()).toMatchObject({ token: 'tok1', stale: true });
    f.mockRejectedValueOnce(new Error('ECONNRESET'));
    t += 1000;
    await expect(c.assertGeneration()).rejects.toMatchObject({ code: 'unreachable', status: 503 });
  });
  it('refuses on 401/402/403 without grace', async () => {
    const f = vi.fn(async () => jsonRes({ error: 'Quota exceeded', code: 'quota-exceeded' }, 402));
    const c = createLicenseClient({ licenseKey: 'k', fetch: f });
    await expect(c.assertGeneration()).rejects.toMatchObject({ code: 'quota-exceeded', status: 402 });
    expect(() => createLicenseClient({})).toThrow(LicenseError);
  });
  it('licenses only design turns: chat replies are free, refused licenses block code, tokens pass through', async () => {
    const chat = vi.fn(async () => JSON.stringify({ intent: 'chat', code: null, reply: 'hello' }));
    const refusing = { assertGeneration: vi.fn(async () => { throw new LicenseError('no', 402, 'quota-exceeded'); }) };
    const hChat = createVeneerHandler({ registry, generate: chat, licenseKey: 'k', licenseClient: refusing, rateLimit: false });
    const chatRes = await hChat(req({ message: 'hi there' }));
    expect(chatRes.status).toBe(200);
    expect(await chatRes.json()).toEqual({ code: null, intent: 'chat', mode: 'design', reply: 'hello' });
    expect(refusing.assertGeneration).not.toHaveBeenCalled();

    const generate = vi.fn(async () => JSON.stringify({ intent: 'design', code: OK_CODE, reply: 'ok' }));
    const h = createVeneerHandler({ registry, generate, licenseKey: 'k', licenseClient: refusing, rateLimit: false });
    const res = await h(req({ message: 'make a board' }));
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe('quota-exceeded');

    const kp = await generateKeyPair();
    const priv = await importPrivateKey(kp.privateKey);
    const token = await signLicenseToken({ sub: 'key', reg: hashRegistryShape(registry) }, priv);
    const granting = { assertGeneration: async () => ({ token, plan: 'pro', remaining: 7, stale: true }) };
    const h2 = createVeneerHandler({ registry, generate, licenseKey: 'k', licenseClient: granting, rateLimit: false });
    const body = await (await h2(req({ message: 'make a board' }))).json();
    expect(body.code).toBe(OK_CODE);
    expect(body.token).toBe(token);
    expect(body.remaining).toBe(7);
    expect(body.licenseStale).toBe(true);
    expect((await verifyLicenseToken(token, { publicKeys: [kp.publicKey], registryHash: hashRegistryShape(registry) })).ok).toBe(true);
  });
});

describe('cloud mode', () => {
  it('forwards registry, brand, message, history, currentUI and llm to Veneer Cloud with the API key', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ code: OK_CODE, reply: 'from cloud', token: 't' }) }));
    const h = createVeneerHandler({ registry, brand: { name: 'Acme' }, cloud: { apiKey: 'vn_cloud_1', apiBase: 'https://cloud.test/', llm: { provider: 'gemini', key: 'gk', model: 'gemini-2.5-flash' } }, fetch: f, rateLimit: false });
    const res = await h(req({ message: 'board', history: [{ role: 'assistant', content: 'hi' }], currentUI: 'cur', registry: { actions: [{ id: 'deleteTask' }] } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code: OK_CODE, intent: 'design', reply: 'from cloud', mode: 'design', edited: false, blocked: undefined, repaired: undefined, token: 't', remaining: undefined });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://cloud.test/v1/generate');
    expect(init.headers.authorization).toBe('Bearer vn_cloud_1');
    const sent = JSON.parse(init.body);
    expect(sent.registry).toEqual(registry);
    expect(sent.brand).toEqual({ name: 'Acme' });
    expect(sent.message).toBe('board');
    expect(sent.history).toEqual([{ role: 'assistant', content: 'hi' }]);
    expect(sent.currentUI).toBe('cur');
    expect(sent.llm).toEqual({ provider: 'gemini', key: 'gk', model: 'gemini-2.5-flash' });
  });
  it('maps cloud refusals and failures to safe responses', async () => {
    const f = vi.fn().mockResolvedValueOnce({ ok: false, status: 402, json: async () => ({ error: 'Quota', code: 'quota-exceeded' }) }).mockResolvedValueOnce({ ok: false, status: 500, json: async () => { throw new Error('x'); } });
    const h = createVeneerHandler({ registry, cloud: { apiKey: 'k', llm: { provider: 'openai', key: 'o' } }, fetch: f, rateLimit: false });
    let res = await h(req({ message: 'x' }));
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe('quota-exceeded');
    res = await h(req({ message: 'x' }));
    expect(res.status).toBe(502);
  });
});

describe('allowedOrigins (CORS)', () => {
  it('answers preflights and echoes the origin only for allowed origins', async () => {
    const generate = vi.fn(async () => JSON.stringify({ intent: 'chat', code: null, reply: 'ok' }));
    const h = createVeneerHandler({ registry, generate, license: false, rateLimit: false, allowedOrigins: ['https://embed.example'] });
    const pre = await h(new Request('http://host.test/api/veneer', { method: 'OPTIONS', headers: { origin: 'https://embed.example', 'access-control-request-method': 'POST' } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('https://embed.example');
    const preBad = await h(new Request('http://host.test/api/veneer', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
    expect(preBad.status).toBe(405);
    expect(preBad.headers.get('access-control-allow-origin')).toBeNull();
    const res = await h(req({ message: 'hi' }, { origin: 'https://embed.example', 'sec-fetch-site': 'cross-site' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://embed.example');
    const denied = await h(req({ message: 'hi' }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }));
    expect(denied.status).toBe(403);
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });
});
