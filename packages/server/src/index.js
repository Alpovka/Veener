/**
 * @veneer/server — the host-side generator endpoint, for any runtime that speaks the Fetch API
 * (Next.js route handlers, Remix, Hono, Bun, Deno, Node 20+). Also serves the legacy iframe
 * engine's document (`buildFrameResponse`) for hosts still on <VeneerFrame>.
 *
 * The SERVER owns the registry. The client sends only { message, history, currentUI }; whatever
 * else it sends is ignored. This is what stops the endpoint from being a general-purpose LLM
 * proxy with an attacker-chosen system prompt.
 *
 * No React is imported here; this entry is safe to load in server-only code.
 */
import { buildFrameHtml, FRAME_CSP, FRAME_SANDBOX, hashRegistryShape } from '@veneer/core';
import { runGeneration, sanitizeHistory, GENERATION_LIMITS } from './generation.js';
import { createLicenseClient, createDevLicenseClient, LicenseError } from './license.js';

export { scanGeneratedCode, buildSystemPrompt, buildUserPrompt, buildEditPrompt, buildEditRepairPrompt, applyEdits, extractJson, runGeneration, buildRepairPrompt, sanitizeHistory, GENERATION_LIMITS, classifyIntent, classifyScope, resolveIntent, INTENTS } from './generation.js';
export { createLicenseClient, LicenseError, DEFAULT_LICENSE_API } from './license.js';
// Shared helpers hosts may need server-side (the core workspace is bundled, not published).
export { hashRegistryShape, verifyLicenseToken, LICENSE_PUBLIC_KEYS, FRAME_CSP, FRAME_SANDBOX } from '@veneer/core';

export const DEFAULT_HANDLER_OPTIONS = {
  ...GENERATION_LIMITS,
  maxBodyBytes: 120000,
  timeoutMs: 45000,
  allowedOrigins: [],
  allowMissingFetchMetadata: true,
  rateLimit: { limit: 20, windowMs: 60000 },
  /** Small tweaks to the current UI are requested as search/replace edits (faster); `false` always regenerates. */
  editMode: true,
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

/**
 * Default rate limiter: fixed window per key, in process memory. On serverless platforms every
 * instance has its own map, so treat this as a courtesy limit and plug in a shared store
 * (`rateLimit: async (key) => boolean`) for real protection.
 */
export function createMemoryRateLimiter({ limit = 20, windowMs = 60000, now = () => Date.now() } = {}) {
  const buckets = new Map();
  return async function allow(key) {
    const t = now();
    let b = buckets.get(key);
    if (!b || t - b.start >= windowMs) {
      b = { start: t, count: 0 };
      buckets.set(key, b);
    }
    if (buckets.size > 10000) {
      for (const [k, v] of buckets) if (t - v.start >= windowMs) buckets.delete(k);
    }
    b.count++;
    return b.count <= limit;
  };
}

/**
 * Rate-limit key. Trusts `x-forwarded-for` (first hop), which is only safe behind a proxy that sets
 * it (Vercel, Cloudflare, nginx with real_ip). Pass your own `rateLimit(key)` if you need a
 * different identity (a session id, an API key).
 */
export function clientKey(request) {
  const h = request.headers;
  const xff = h.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return h.get('x-real-ip') || h.get('cf-connecting-ip') || 'unknown';
}

/**
 * Same-site guard. A cross-site page cannot send `Content-Type: application/json` without a
 * CORS preflight (which fails, since we never answer preflights), so the content-type check is
 * the real blocker for `mode: 'no-cors'` abuse. Fetch Metadata is checked as a second layer.
 */
export function checkRequestOrigin(request, { allowedOrigins = [], allowMissingFetchMetadata = true } = {}) {
  const ct = (request.headers.get('content-type') || '').toLowerCase();
  if (!ct.startsWith('application/json')) return { ok: false, status: 415, error: 'Content-Type must be application/json.' };
  const site = request.headers.get('sec-fetch-site');
  const origin = request.headers.get('origin');
  if (origin && allowedOrigins.includes(origin)) return { ok: true };
  if (site === null || site === undefined) {
    return allowMissingFetchMetadata ? { ok: true } : { ok: false, status: 403, error: 'Missing Fetch Metadata.' };
  }
  if (site === 'same-origin' || site === 'none') return { ok: true };
  return { ok: false, status: 403, error: 'Cross-site requests are not allowed.' };
}


/**
 * Create a Fetch-API request handler for the generator endpoint.
 *
 * Two ways to run it:
 *  - Self-hosted: pass `licenseKey` and `generate` (your LLM call). Prompting, scanning and the
 *    verify→repair loop run on your server; only a per-generation license check reaches Veneer.
 *  - Veneer Cloud: pass `cloud: { apiKey, llm }`. This handler still owns the registry and guards
 *    the request, then forwards { registry, brand, message, history, currentUI, llm } to Veneer
 *    Cloud, which runs the pipeline with your LLM key and returns { code, reply, token }.
 *  - Local development: `license: false` (self-hosted mode without a key; issues a DEV token that
 *    @veneer/react only accepts on localhost).
 *
 * @param {object} opts
 * @param {object} opts.registry   the SAME registry object the client passes to <VeneerProvider>
 * @param {(input: { system: string, messages: {role:'user'|'assistant', content:string}[], signal: AbortSignal, mode: 'edit'|'design' }) => Promise<string>} [opts.generate]
 *   `mode` is 'edit' for small tweaks (a few hundred output tokens: route these to a fast model with
 *   thinking off) and 'design' for whole views.
 * @param {boolean} [opts.editMode]  default true
 * @param {string} [opts.licenseKey]
 * @param {false} [opts.license]   pass false for local development without a key
 * @param {{ apiKey: string, apiBase?: string, llm: { provider: 'gemini'|'openai'|'anthropic', key: string, model?: string } }} [opts.cloud]
 * @param {(key: string) => Promise<boolean>|boolean} [opts.rateLimit]  or `{ limit, windowMs }` for the in-memory default, or `false`
 * @param {string[]} [opts.allowedOrigins]  extra Origins allowed to call the endpoint (cross-origin embeds)
 * @param {(req: Request) => Promise<boolean>|boolean} [opts.authorize]  return false to reject with 401
 * @param {(err: unknown, ctx: object) => void} [opts.onError]  server-side logger (errors are never sent to clients)
 * @param {{ name?: string, tone?: string }} [opts.brand]
 */
export function createVeneerHandler(opts) {
  if (!opts || !opts.registry) throw new Error('createVeneerHandler: `registry` is required');
  const o = { ...DEFAULT_HANDLER_OPTIONS, ...opts };
  const registry = o.registry;
  const registryHash = hashRegistryShape(registry);
  const log = typeof o.onError === 'function' ? o.onError : () => {};
  const cloudMode = !!o.cloud;
  if (cloudMode) {
    if (!o.cloud.apiKey) throw new Error('createVeneerHandler: `cloud.apiKey` is required in cloud mode');
    if (!o.cloud.llm || !o.cloud.llm.provider || !o.cloud.llm.key) throw new Error('createVeneerHandler: `cloud.llm` needs { provider, key }');
  } else {
    if (typeof o.generate !== 'function') throw new Error('createVeneerHandler: `generate` is required (or use `cloud`)');
    if (o.license !== false && !o.licenseKey) throw new Error('createVeneerHandler: `licenseKey` is required (or `license: false` for local development)');
  }
  const license = cloudMode ? null : o.license === false ? createDevLicenseClient() : (o.licenseClient || createLicenseClient({ licenseKey: o.licenseKey, apiBase: o.licenseApiBase, fetch: o.fetch, onError: (e) => log(e, { stage: 'license' }) }));
  const fetchImpl = o.fetch || (typeof fetch === 'function' ? fetch : null);
  if (cloudMode && !fetchImpl) throw new Error('createVeneerHandler: fetch is not available in this runtime (pass `fetch`)');
  if (!cloudMode && o.license === false && typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production') {
    log(new Error('createVeneerHandler runs with license:false in production; @veneer/react accepts the DEV token on localhost only'), { stage: 'config' });
  }
  const allowedOrigins = Array.isArray(o.allowedOrigins) ? o.allowedOrigins : [];
  const corsHeaders = (request) => {
    const origin = request.headers.get('origin');
    if (!origin || !allowedOrigins.includes(origin)) return {};
    return { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'origin' };
  };

  let allow;
  if (o.rateLimit === false) allow = async () => true;
  else if (typeof o.rateLimit === 'function') allow = o.rateLimit;
  else allow = createMemoryRateLimiter(o.rateLimit || {});

  return async function handler(request) {
    const cors = corsHeaders(request);
    try {
      if (request.method === 'OPTIONS') {
        // Cross-origin embeds listed in `allowedOrigins` need a preflight answer; everyone else gets nothing.
        return new Response(null, { status: Object.keys(cors).length ? 204 : 405, headers: { ...cors, 'access-control-max-age': '600', allow: 'POST, OPTIONS' } });
      }
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, { allow: 'POST, OPTIONS', ...cors });

      const originCheck = checkRequestOrigin(request, o);
      if (!originCheck.ok) return json({ error: originCheck.error }, originCheck.status, cors);

      if (typeof o.authorize === 'function') {
        let authorized = false;
        try {
          authorized = await o.authorize(request);
        } catch (e) {
          authorized = false;
        }
        if (!authorized) return json({ error: 'Unauthorized.' }, 401);
      }

      const key = clientKey(request);
      if (!(await allow(key))) return json({ error: 'Too many requests. Please wait a moment.' }, 429, { 'retry-after': '30' });

      const declared = Number(request.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > o.maxBodyBytes) return json({ error: 'Request too large.' }, 413);
      const text = await request.text();
      if (text.length > o.maxBodyBytes) return json({ error: 'Request too large.' }, 413);

      let body;
      try {
        body = JSON.parse(text);
      } catch (e) {
        return json({ error: 'Invalid JSON.' }, 400);
      }
      if (!body || typeof body !== 'object') return json({ error: 'Invalid request.' }, 400);

      const message = typeof body.message === 'string' ? body.message.trim() : '';
      if (!message) return json({ error: 'Message is required.' }, 400);
      if (message.length > o.maxMessageChars) return json({ error: `Message exceeds ${o.maxMessageChars} characters.` }, 413);

      const currentUI = typeof body.currentUI === 'string' ? body.currentUI : '';
      if (currentUI.length > o.maxCurrentUIChars) return json({ error: 'Current UI is too large.' }, 413);

      const history = sanitizeHistory(body.history, o);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), o.timeoutMs);
      try {
        if (cloudMode) {
          const res = await fetchImpl(`${(o.cloud.apiBase || DEFAULT_CLOUD_API).replace(/\/$/, '')}/v1/generate`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${o.cloud.apiKey}` },
            body: JSON.stringify({ registry, brand: o.brand, message, history, currentUI, llm: o.cloud.llm }),
            signal: controller.signal,
          });
          let out = null;
          try {
            out = await res.json();
          } catch (e) {
            out = null;
          }
          if (res.status === 401 || res.status === 402 || res.status === 403) {
            log(new Error(`cloud refused: ${res.status}`), { stage: 'cloud', code: out && out.code });
            return json({ error: (out && out.error) || 'Veneer Cloud refused the request. Check your API key and plan.', code: (out && out.code) || 'cloud-refused' }, res.status, cors);
          }
          if (res.status === 429) {
            log(new Error('cloud rate-limited'), { stage: 'cloud', code: out && out.code });
            return json({ error: (out && out.error) || 'Too many requests. Please wait a moment.', code: (out && out.code) || 'rate-limited' }, 429, { 'retry-after': res.headers.get('retry-after') || '30', ...cors });
          }
          if (res.status === 400 && out && out.code) {
            // Misconfigured LLM key or provider on our side of the call: tell the operator, not a generic 502.
            log(new Error(`cloud rejected the request: ${out.code}`), { stage: 'cloud', code: out.code });
            return json({ error: out.error || 'Veneer Cloud rejected the request.', code: out.code }, 502, cors);
          }
          if (!res.ok || !out || typeof out !== 'object') {
            log(new Error(`cloud error: ${res.status}`), { stage: 'cloud', code: out && out.code });
            return json({ error: 'The design service failed. Please try again.' }, 502, cors);
          }
          return json({ code: typeof out.code === 'string' ? out.code : null, intent: ['design', 'chat', 'clarify'].includes(out.intent) ? out.intent : out.code ? 'design' : 'chat', reply: typeof out.reply === 'string' ? out.reply : '', mode: out.mode === 'edit' ? 'edit' : 'design', edited: !!out.edited, blocked: out.blocked, repaired: out.repaired, token: out.token, remaining: out.remaining }, 200, cors);
        }

        // Self-hosted: run the pipeline, then license the result. Only design turns that produced
        // code count against the license; chat replies, clarifications and refusals are free.
        const result = await runGeneration({ registry, generate: o.generate, message, history, currentUI, brand: o.brand, signal: controller.signal, maxCurrentUIChars: o.maxCurrentUIChars, maxRepairRounds: o.maxRepairRounds, maxEdits: o.maxEdits, editMode: o.editMode !== false, log });
        if (result.code == null) return json(result, 200, cors);
        let lic;
        try {
          lic = await license.assertGeneration({ registryHash });
        } catch (e) {
          if (e instanceof LicenseError) {
            log(e, { stage: 'license' });
            return json({ error: e.code === 'quota-exceeded' ? 'Veneer license quota exceeded for this period.' : e.code === 'unreachable' ? 'Veneer license service unreachable.' : 'Veneer license key invalid or inactive.', code: e.code }, e.status === 503 ? 503 : 402, cors);
          }
          throw e;
        }
        return json({ ...result, token: lic.token, remaining: lic.remaining, ...(lic.stale ? { licenseStale: true } : {}) }, 200, cors);
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      log(e, { stage: 'handler' });
      const aborted = e && (e.name === 'AbortError' || /abort/i.test(String(e.message || '')));
      return json({ error: aborted ? 'The design service timed out. Please try again.' : 'The design service failed. Please try again.' }, aborted ? 504 : 500, cors);
    }
  };
}

export const DEFAULT_CLOUD_API = 'https://api.veneer.dev';

/**
 * LEGACY (iframe engine only; <VeneerCanvas> needs no route — it loads `dist/veneer-worker.js`).
 * Serve the sandbox document from a URL (pass its path as `frameSrc` to <VeneerFrame>). Unlike a
 * srcdoc frame, this document does NOT inherit the host page's CSP, and the policy is delivered
 * as a header (so it can also carry `sandbox` and `frame-ancestors`). Serve it from a separate
 * origin/site when you can: the frame then runs out-of-process on browsers with site isolation,
 * and an accidental `allow-same-origin` can never grant the host origin.
 *
 * @param {{ frameAncestors?: string }} [opts]  CSP frame-ancestors source list (default 'self')
 */
export function buildFrameResponse({ frameAncestors = "'self'" } = {}) {
  const csp = `${FRAME_CSP}; sandbox ${FRAME_SANDBOX}; frame-ancestors ${frameAncestors}`;
  return new Response(buildFrameHtml(), {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': csp,
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'cache-control': 'public, max-age=3600',
    },
  });
}

