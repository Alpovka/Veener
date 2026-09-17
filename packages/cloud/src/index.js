/**
 * Veneer Cloud — reference implementation.
 *
 *   POST /v1/license/verify   self-hosted @veneer/server: record a generation, get a signed token
 *   POST /v1/generate         hosted generation: registry + message + the customer's LLM key in,
 *                             { code, reply, token } out; prompting, scan and repair run here
 *   GET  /v1/health
 *
 * Auth: `Authorization: Bearer <api key>`. Keys, plans and monthly quotas come from the store.
 * Tokens are Ed25519-signed with VENEER_SIGNING_KEY (pkcs8, base64url); the matching public key
 * is embedded in @veneer/core so clients verify offline.
 *
 * Privacy: the customer's LLM key is used for the one request and never persisted; prompts and
 * generated code are not stored. Metering records only counts.
 */
import { importPrivateKey, signLicenseToken, hashRegistryShape } from '@veneer/core';
import { runGeneration, sanitizeHistory, GENERATION_LIMITS } from '@veneer/server';
import { createProvider, SUPPORTED_PROVIDERS } from './providers/index.js';
import { createMemoryStore, keysFromEnv } from './store.js';

export { createMemoryStore, keysFromEnv, PLAN_QUOTAS } from './store.js';
export { createProvider, SUPPORTED_PROVIDERS } from './providers/index.js';

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });

export const CLOUD_LIMITS = { ...GENERATION_LIMITS, maxBodyBytes: 400000, maxRegistryBytes: 200000, timeoutMs: 60000 };

/**
 * @param {object} opts
 * @param {string} opts.signingKey   pkcs8 base64url Ed25519 private key
 * @param {string} [opts.kid]
 * @param {object} [opts.store]      createMemoryStore() compatible
 * @param {(cfg) => Function} [opts.providerFactory]  override for tests
 * @param {(err, ctx) => void} [opts.onError]
 */
export function createCloudApp(opts) {
  if (!opts || !opts.signingKey) throw new Error('createCloudApp: `signingKey` is required');
  const o = { ...CLOUD_LIMITS, ...opts };
  const store = o.store || createMemoryStore({ keys: keysFromEnv(o.keysEnv) });
  const log = typeof o.onError === 'function' ? o.onError : () => {};
  const providerFactory = o.providerFactory || createProvider;
  let privateKeyPromise = null;
  const privateKey = () => (privateKeyPromise ||= importPrivateKey(o.signingKey));

  async function authenticate(request) {
    const auth = request.headers.get('authorization') || '';
    const m = auth.match(/^Bearer\s+(\S+)$/i);
    if (!m) return { error: json({ error: 'Missing API key.', code: 'invalid-key' }, 401) };
    const key = await store.findBySecret(m[1]);
    if (!key || key.active === false) return { error: json({ error: 'Invalid or inactive API key.', code: 'invalid-key' }, 401) };
    return { key };
  }

  async function meter(key) {
    const used = await store.getUsage(key.id);
    if (typeof key.monthlyQuota === 'number' && used >= key.monthlyQuota) {
      return { error: json({ error: `Monthly quota of ${key.monthlyQuota} generations exhausted.`, code: 'quota-exceeded', used, quota: key.monthlyQuota }, 402) };
    }
    const count = await store.increment(key.id);
    return { remaining: typeof key.monthlyQuota === 'number' ? Math.max(0, key.monthlyQuota - count) : null };
  }

  async function mint(key, registryHash) {
    return signLicenseToken({ sub: key.id, plan: key.plan, reg: registryHash || undefined }, await privateKey(), { kid: o.kid });
  }

  async function readBody(request, max) {
    const text = await request.text();
    if (text.length > max) return { error: json({ error: 'Request too large.' }, 413) };
    try {
      const body = JSON.parse(text);
      if (!body || typeof body !== 'object') throw new Error('not an object');
      return { body };
    } catch (e) {
      return { error: json({ error: 'Invalid JSON.' }, 400) };
    }
  }

  async function verifyRoute(request) {
    const a = await authenticate(request);
    if (a.error) return a.error;
    const b = await readBody(request, 10000);
    if (b.error) return b.error;
    const m = await meter(a.key);
    if (m.error) return m.error;
    const registryHash = typeof b.body.registryHash === 'string' ? b.body.registryHash.slice(0, 64) : undefined;
    return json({ token: await mint(a.key, registryHash), plan: a.key.plan, remaining: m.remaining });
  }

  async function generateRoute(request) {
    const a = await authenticate(request);
    if (a.error) return a.error;
    const b = await readBody(request, o.maxBodyBytes);
    if (b.error) return b.error;
    const { registry, brand, message, history, currentUI, llm } = b.body;
    if (!registry || typeof registry !== 'object' || JSON.stringify(registry).length > o.maxRegistryBytes) return json({ error: 'A registry is required.' }, 400);
    const msg = typeof message === 'string' ? message.trim() : '';
    if (!msg) return json({ error: 'Message is required.' }, 400);
    if (msg.length > o.maxMessageChars) return json({ error: `Message exceeds ${o.maxMessageChars} characters.` }, 413);
    const cur = typeof currentUI === 'string' ? currentUI : '';
    if (cur.length > o.maxCurrentUIChars) return json({ error: 'Current UI is too large.' }, 413);
    if (!llm || typeof llm !== 'object' || !SUPPORTED_PROVIDERS.includes(llm.provider) || typeof llm.key !== 'string' || !llm.key) return json({ error: `An llm { provider, key } is required; providers: ${SUPPORTED_PROVIDERS.join(', ')}.`, code: 'bad-llm' }, 400);
    let generate;
    try {
      generate = providerFactory({ provider: llm.provider, key: llm.key, model: typeof llm.model === 'string' ? llm.model : undefined, fetch: o.fetch });
    } catch (e) {
      return json({ error: e.message, code: 'bad-llm' }, 400);
    }
    const m = await meter(a.key);
    if (m.error) return m.error;
    const registryHash = hashRegistryShape(registry);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), o.timeoutMs);
    try {
      const result = await runGeneration({ registry, generate, message: msg, history: sanitizeHistory(history, o), currentUI: cur, brand: brand && typeof brand === 'object' ? { name: brand.name, tone: brand.tone } : undefined, signal: controller.signal, maxCurrentUIChars: o.maxCurrentUIChars, maxRepairRounds: o.maxRepairRounds, log: (e, ctx) => log(e, { ...ctx, key: a.key.id }) });
      return json({ ...result, token: await mint(a.key, registryHash), remaining: m.remaining });
    } catch (e) {
      log(e, { stage: 'generate', key: a.key.id });
      const status = e && e.status;
      if (status === 401 || status === 403) return json({ error: 'The LLM provider rejected your key.', code: 'llm-auth' }, 400);
      if (status === 429) return json({ error: 'The LLM provider rate-limited the request.', code: 'llm-rate-limited' }, 429);
      const aborted = e && (e.name === 'AbortError' || /abort/i.test(String(e.message || '')));
      return json({ error: aborted ? 'Generation timed out.' : 'Generation failed.' }, aborted ? 504 : 502);
    } finally {
      clearTimeout(timer);
    }
  }

  return async function fetchHandler(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '');
    try {
      if (request.method === 'GET' && path === '/v1/health') return json({ ok: true, period: store.period ? store.period() : undefined });
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      const ct = (request.headers.get('content-type') || '').toLowerCase();
      if (!ct.startsWith('application/json')) return json({ error: 'Content-Type must be application/json.' }, 415);
      if (path === '/v1/license/verify') return verifyRoute(request);
      if (path === '/v1/generate') return generateRoute(request);
      return json({ error: 'Not found.' }, 404);
    } catch (e) {
      log(e, { stage: 'router' });
      return json({ error: 'Internal error.' }, 500);
    }
  };
}
