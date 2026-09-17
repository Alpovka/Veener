import { describe, it, expect, vi } from 'vitest';
import { createCloudApp, createMemoryStore, keysFromEnv, createProvider } from '../src/index.js';
import { generateKeyPair, verifyLicenseToken, hashRegistryShape } from '@veneer/core';

const registry = { dataSources: [{ id: 'tasks' }], actions: [{ id: 'createTask', args: [{ name: 'title', type: 'string', required: true }] }] };
const OK_CODE = 'function A(){ return <b onClick={() => veneer.action("createTask", { title: "x" })}>{veneer.data("tasks").length}</b>; } render(<A />);';

async function setup({ quota = 3, provider } = {}) {
  const kp = await generateKeyPair();
  let t = Date.UTC(2026, 8, 17);
  const store = createMemoryStore({ keys: [{ id: 'key_1', secret: 'vn_live_good', plan: 'pro', monthlyQuota: quota, active: true }, { id: 'key_2', secret: 'vn_live_off', plan: 'pro', monthlyQuota: 10, active: false }], now: () => t });
  const providerFactory = provider || (() => async () => JSON.stringify({ code: OK_CODE, reply: 'ok' }));
  const app = createCloudApp({ signingKey: kp.privateKey, kid: 'k1', store, providerFactory });
  const call = (path, body, key = 'vn_live_good', headers = {}) => app(new Request(`https://api.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers }, body: JSON.stringify(body) }));
  return { app, call, kp, store, advance: (ms) => (t += ms) };
}

describe('license verify', () => {
  it('authenticates, meters, and returns a token that verifies against the public key', async () => {
    const { call, kp } = await setup();
    const res = await call('/v1/license/verify', { event: 'generation', registryHash: 'abc' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan).toBe('pro');
    expect(body.remaining).toBe(2);
    const v = await verifyLicenseToken(body.token, { publicKeys: [kp.publicKey], registryHash: 'abc' });
    expect(v.ok).toBe(true);
    expect(v.claims).toMatchObject({ sub: 'key_1', plan: 'pro', reg: 'abc' });
  });
  it('rejects missing, unknown and inactive keys', async () => {
    const { call } = await setup();
    expect((await call('/v1/license/verify', {}, null)).status).toBe(401);
    expect((await call('/v1/license/verify', {}, 'vn_live_nope')).status).toBe(401);
    expect((await call('/v1/license/verify', {}, 'vn_live_off')).status).toBe(401);
  });
  it('enforces the monthly quota and resets next month', async () => {
    const { call, advance } = await setup({ quota: 2 });
    expect((await call('/v1/license/verify', {})).status).toBe(200);
    expect((await call('/v1/license/verify', {})).status).toBe(200);
    const over = await call('/v1/license/verify', {});
    expect(over.status).toBe(402);
    expect((await over.json()).code).toBe('quota-exceeded');
    advance(32 * 24 * 3600 * 1000);
    expect((await call('/v1/license/verify', {})).status).toBe(200);
  });
});

describe('hosted generation', () => {
  it('runs the pipeline with the customer LLM key and returns code + token', async () => {
    const providerFactory = vi.fn(() => async ({ system, messages }) => {
      expect(system).toContain('createTask');
      expect(messages.at(-1).content).toContain('User message: board');
      return JSON.stringify({ code: OK_CODE, reply: 'Board ready' });
    });
    const { call, kp } = await setup({ provider: providerFactory });
    const res = await call('/v1/generate', { registry, brand: { name: 'Acme' }, message: 'board', history: [], currentUI: '', llm: { provider: 'gemini', key: 'gk', model: 'gemini-2.5-flash' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(OK_CODE);
    expect(body.reply).toBe('Board ready');
    expect(providerFactory).toHaveBeenCalledWith(expect.objectContaining({ provider: 'gemini', key: 'gk', model: 'gemini-2.5-flash' }));
    const v = await verifyLicenseToken(body.token, { publicKeys: [kp.publicKey], registryHash: hashRegistryShape(registry) });
    expect(v.ok).toBe(true);
  });
  it('refuses unregistered capabilities and reports scan blocks like the self-hosted handler', async () => {
    const { call } = await setup({ provider: () => async () => JSON.stringify({ code: 'render(<b onClick={() => veneer.action("deleteTask")}/>)', reply: 'x' }) });
    const body = await (await call('/v1/generate', { registry, message: 'delete', llm: { provider: 'openai', key: 'o' } })).json();
    expect(body.code).toBeNull();
    expect(body.blocked[0]).toMatch(/deleteTask/);
  });
  it('validates input and maps provider failures without leaking details', async () => {
    const { call, store } = await setup({ provider: () => async () => { const e = new Error('openai 401: invalid api key sk-abc'); e.status = 401; throw e; } });
    expect((await call('/v1/generate', { message: 'x', llm: { provider: 'openai', key: 'o' } })).status).toBe(400); // no registry
    expect((await call('/v1/generate', { registry, message: 'x' })).status).toBe(400); // no llm
    expect((await call('/v1/generate', { registry, message: 'x', llm: { provider: 'cohere', key: 'c' } })).status).toBe(400);
    const res = await call('/v1/generate', { registry, message: 'x', llm: { provider: 'openai', key: 'o' } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('llm-auth');
    expect(JSON.stringify(body)).not.toContain('sk-abc');
    expect(await store.getUsage('key_1')).toBe(1); // a failed LLM call still counts as a metered attempt
  });
  it('rejects non-JSON, unknown routes and answers health', async () => {
    const { app } = await setup();
    expect((await app(new Request('https://api.test/v1/health'))).status).toBe(200);
    expect((await app(new Request('https://api.test/v1/generate', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' }))).status).toBe(415);
    expect((await app(new Request('https://api.test/v1/nope', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer vn_live_good' }, body: '{}' }))).status).toBe(404);
  });
});

describe('helpers', () => {
  it('parses keys from env', () => {
    expect(keysFromEnv('vn_live_a:pro:10000, vn_live_b:starter')).toEqual([
      { id: 'key_1', secret: 'vn_live_a', plan: 'pro', monthlyQuota: 10000, active: true },
      { id: 'key_2', secret: 'vn_live_b', plan: 'starter', monthlyQuota: 1000, active: true },
    ]);
  });
  it('builds provider requests with the customer key and returns text', async () => {
    const f = vi.fn(async (url, init) => ({ ok: true, json: async () => (url.includes('googleapis') ? { candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] } : url.includes('openai') ? { choices: [{ message: { content: 'oa' } }] } : { content: [{ type: 'text', text: 'an' }] }) }));
    const g = createProvider({ provider: 'gemini', key: 'GK', fetch: f });
    expect(await g({ system: 's', messages: [{ role: 'user', content: 'u' }] })).toBe('{"a":1}');
    expect(f.mock.calls[0][1].headers['x-goog-api-key']).toBe('GK');
    const oa = createProvider({ provider: 'openai', key: 'OK', fetch: f });
    expect(await oa({ system: 's', messages: [{ role: 'user', content: 'u' }] })).toBe('oa');
    expect(f.mock.calls[1][1].headers.authorization).toBe('Bearer OK');
    const an = createProvider({ provider: 'anthropic', key: 'AK', fetch: f });
    expect(await an({ system: 's', messages: [{ role: 'user', content: 'u' }] })).toBe('an');
    expect(f.mock.calls[2][1].headers['x-api-key']).toBe('AK');
    expect(() => createProvider({ provider: 'nope', key: 'k' })).toThrow(/Unsupported/);
  });
});
