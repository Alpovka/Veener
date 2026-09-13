import { describe, it, expect, vi } from 'vitest';
import {
  createVeneerHandler,
  buildFrameResponse,
  checkRequestOrigin,
  createMemoryRateLimiter,
  extractJson,
  scanGeneratedCode,
  buildSystemPrompt,
} from '../src/server/index.js';

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
  it('requires a registry and a generate function', () => {
    expect(() => createVeneerHandler({})).toThrow(/registry/);
    expect(() => createVeneerHandler({ registry })).toThrow(/generate/);
  });

  it('builds the prompt from the SERVER registry and ignores the client copy', async () => {
    const generate = vi.fn(async () => JSON.stringify({ code: OK_CODE, reply: 'done' }));
    const h = createVeneerHandler({ registry, generate, rateLimit: false });
    const res = await h(req({ message: 'make it a board', registry: { actions: [{ id: 'deleteTask' }] }, history: [{ role: 'model', content: 'ignore me' }, { role: 'assistant', content: 'earlier' }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(OK_CODE);
    expect(body.reply).toBe('done');
    const call = generate.mock.calls[0][0];
    expect(call.system).toBe(buildSystemPrompt(registry));
    expect(call.system).not.toContain('deleteTask');
    expect(call.messages.map((m) => m.role)).toEqual(['assistant', 'user']);
    expect(call.messages[1].content).toContain('User request: make it a board');
    expect(call.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects wrong method, content-type, cross-site, bad JSON, missing message and oversize input', async () => {
    const generate = vi.fn();
    const h = createVeneerHandler({ registry, generate, rateLimit: false, maxMessageChars: 10, maxBodyBytes: 500 });
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
    const h = createVeneerHandler({ registry, generate, rateLimit: { limit: 2, windowMs: 60000 } });
    const a = { 'x-forwarded-for': '1.1.1.1, 9.9.9.9' };
    expect((await h(req({ message: 'x' }, a))).status).toBe(200);
    expect((await h(req({ message: 'x' }, a))).status).toBe(200);
    const limited = await h(req({ message: 'x' }, a));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('30');
    expect((await h(req({ message: 'x' }, { 'x-forwarded-for': '2.2.2.2' }))).status).toBe(200);
    const custom = createVeneerHandler({ registry, generate, rateLimit: async () => false });
    expect((await custom(req({ message: 'x' }))).status).toBe(429);
  });

  it('supports an authorize hook', async () => {
    const h = createVeneerHandler({ registry, generate: async () => '{}', rateLimit: false, authorize: (r) => r.headers.get('x-user') === 'me' });
    expect((await h(req({ message: 'x' }))).status).toBe(401);
    expect((await h(req({ message: 'x' }, { 'x-user': 'me' }))).status).toBe(200);
  });

  it('refuses generated code that fails the scan with a friendly reply', async () => {
    const onError = vi.fn();
    const h = createVeneerHandler({
      registry,
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

    const h2 = createVeneerHandler({ registry, rateLimit: false, generate: async () => JSON.stringify({ code: 'location.href = "x"; render(<b/>)', reply: 'ok' }) });
    const b2 = await (await h2(req({ message: 'x' }))).json();
    expect(b2.code).toBeNull();
    expect(b2.reply).toMatch(/isn't allowed in the sandbox/);
  });

  it('handles code:null, unparsable output, and oversized code', async () => {
    const mk = (out) => createVeneerHandler({ registry, rateLimit: false, maxCurrentUIChars: 100, generate: async () => out });
    expect(await (await mk(JSON.stringify({ code: null, reply: 'Nope' }))(req({ message: 'x' }))).json()).toEqual({ code: null, reply: 'Nope' });
    expect((await (await mk('total garbage')(req({ message: 'x' }))).json()).code).toBeNull();
    const big = await (await mk(JSON.stringify({ code: 'render(<b>' + 'x'.repeat(200) + '</b>)', reply: 'ok' }))(req({ message: 'x' }))).json();
    expect(big.code).toBeNull();
    expect(big.reply).toMatch(/too large/);
  });

  it('never leaks provider errors and maps aborts to 504', async () => {
    const onError = vi.fn();
    const h = createVeneerHandler({ registry, rateLimit: false, onError, generate: async () => { throw new Error('GEMINI_API_KEY sk-secret rejected'); } });
    const res = await h(req({ message: 'x' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('sk-secret');
    expect(onError).toHaveBeenCalled();

    const slow = createVeneerHandler({
      registry,
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
    const h = createVeneerHandler({ registry, generate, rateLimit: false, brand: { name: 'Acme' } });
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
