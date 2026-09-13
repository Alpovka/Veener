/**
 * veneer-sdk/server — the host-side generator endpoint and the frame document, for any runtime
 * that speaks the Fetch API (Next.js route handlers, Remix, Hono, Bun, Deno, Node 18+).
 *
 * The SERVER owns the registry. The client sends only { message, history, currentUI }; whatever
 * else it sends is ignored. This is what stops the endpoint from being a general-purpose LLM
 * proxy with an attacker-chosen system prompt.
 *
 * No React is imported here; this entry is safe to load in server-only code.
 */
import * as parser from '@babel/parser';
import traverseNs from '@babel/traverse';
import { createScanner, registryIds } from '../scan.js';
import { buildFrameHtml, FRAME_CSP, FRAME_SANDBOX } from '../frameRuntime.js';
import { THEME_UTILITIES } from '../theme.js';

const traverse = typeof traverseNs === 'function' ? traverseNs : traverseNs.default;
const scan = createScanner(parser, traverse);

/** Scan generated code against a registry on the server (AST-based, scope-aware). */
export function scanGeneratedCode(code, registry) {
  return scan(code, registryIds(registry));
}

export const DEFAULT_HANDLER_OPTIONS = {
  maxHistory: 20,
  maxMessageChars: 4000,
  maxHistoryTurnChars: 4000,
  maxCurrentUIChars: 60000,
  maxBodyBytes: 120000,
  timeoutMs: 45000,
  allowedOrigins: [],
  allowMissingFetchMetadata: true,
  rateLimit: { limit: 20, windowMs: 60000 },
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

function sanitizeHistory(history, { maxHistory, maxHistoryTurnChars }) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-maxHistory)
    .map((m) => ({ role: m.role, content: m.content.slice(0, maxHistoryTurnChars) }));
}

/**
 * Create a Fetch-API request handler for the generator endpoint.
 *
 * @param {object} opts
 * @param {object} opts.registry   the SAME registry object the client passes to <VeneerProvider>
 * @param {(input: { system: string, messages: {role:'user'|'assistant', content:string}[], signal: AbortSignal }) => Promise<string>} opts.generate
 *        calls your LLM and resolves with the raw text of its reply (a JSON object per buildSystemPrompt)
 * @param {(key: string) => Promise<boolean>|boolean} [opts.rateLimit]  or `{ limit, windowMs }` for the in-memory default, or `false`
 * @param {string[]} [opts.allowedOrigins]  extra Origins allowed to call the endpoint (cross-origin embeds)
 * @param {(req: Request) => Promise<boolean>|boolean} [opts.authorize]  return false to reject with 401
 * @param {(err: unknown, ctx: object) => void} [opts.onError]  server-side logger (errors are never sent to clients)
 * @param {{ name?: string, tone?: string }} [opts.brand]  optional words about the brand for the prompt (token values stay on the client)
 */
export function createVeneerHandler(opts) {
  if (!opts || !opts.registry) throw new Error('createVeneerHandler: `registry` is required');
  if (typeof opts.generate !== 'function') throw new Error('createVeneerHandler: `generate` is required');
  const o = { ...DEFAULT_HANDLER_OPTIONS, ...opts };
  const registry = o.registry;
  const system = buildSystemPrompt(registry, { brand: o.brand });
  const ids = registryIds(registry);
  const log = typeof o.onError === 'function' ? o.onError : () => {};
  let allow;
  if (o.rateLimit === false) allow = async () => true;
  else if (typeof o.rateLimit === 'function') allow = o.rateLimit;
  else allow = createMemoryRateLimiter(o.rateLimit || {});

  return async function handler(request) {
    try {
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, { allow: 'POST' });

      const originCheck = checkRequestOrigin(request, o);
      if (!originCheck.ok) return json({ error: originCheck.error }, originCheck.status);

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
      const messages = [...history, { role: 'user', content: buildUserPrompt(message, currentUI) }];

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), o.timeoutMs);
      let raw;
      try {
        raw = await o.generate({ system, messages, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }

      const parsed = extractJson(typeof raw === 'string' ? raw : '');
      if (!parsed) {
        return json({ code: null, reply: "Sorry, I couldn't generate that. Try rephrasing." });
      }
      const reply = parsed.reply != null ? String(parsed.reply) : '';
      if (parsed.code == null || parsed.code === '') return json({ code: null, reply: reply || 'Done.' });
      const code = String(parsed.code);
      if (code.length > o.maxCurrentUIChars) {
        return json({ code: null, reply: 'That design came out too large to run safely. Try asking for something simpler.' });
      }

      const result = scan(code, ids);
      if (!result.ok) {
        log(new Error('generated code failed the scan'), { violations: result.violations, key });
        return json({
          code: null,
          reply: friendlyScanReply(result.violations, registry),
          blocked: result.violations,
        });
      }
      return json({ code, reply });
    } catch (e) {
      log(e, { stage: 'handler' });
      const aborted = e && (e.name === 'AbortError' || /abort/i.test(String(e.message || '')));
      return json({ error: aborted ? 'The design service timed out. Please try again.' : 'The design service failed. Please try again.' }, aborted ? 504 : 500);
    }
  };
}

function friendlyScanReply(violations, registry) {
  const unregistered = violations.filter((v) => /is not a registered/.test(v));
  if (unregistered.length) {
    const names = ((registry && registry.actions) || []).map((a) => a.id).join(', ');
    return `I can't do that here — it needs a capability this app hasn't made available. I kept the current view. Actions I can use: ${names || 'none'}.`;
  }
  return "I generated something that isn't allowed in the sandbox, so I kept the current view. Try rephrasing the request.";
}

/**
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

export function buildSystemPrompt(registry, { brand } = {}) {
  const reg = JSON.stringify(registry || {}, null, 2);
  const u = THEME_UTILITIES;
  const brandLine = brand && (brand.name || brand.tone)
    ? `\nThe host brand${brand.name ? ` is "${String(brand.name).slice(0, 80)}"` : ''}${brand.tone ? `; its tone is ${String(brand.tone).slice(0, 200)}` : ''}.`
    : '';
  return `You are Veneer, a UI generator embedded in a host web application. The end user will
describe how they want the current page to look, and you generate the UI for it.

You have FULL creative freedom over layout and design — invent any layout the request calls for
(kanban board, calendar, dashboard, timeline, gallery, anything). But you operate inside a hard
security sandbox: your code runs in an isolated iframe with no network access and no access to the
host page. Your ONLY connection to the app is a small in-frame API.

RESPONSE FORMAT — respond with ONLY a single JSON object, no prose, no markdown fences:
{
  "code": "<a self-contained React component, as a string>",
  "reply": "<one or two friendly sentences to show the user>"
}

THE CODE YOU WRITE:
- Is plain JSX. These globals are already available — DO NOT import anything, DO NOT use export:
  React, useState, useEffect, useMemo, useCallback, useRef, veneer, render.
- Defines a function component (e.g. function VeneerUI() { ... }) and ends by calling render(<VeneerUI />).
- Reads data ONLY via veneer.data(sourceId) with a string literal id — returns the current value (usually an array).
- Triggers actions ONLY via veneer.action(id, args) with a string literal id — returns a Promise. After an
  action runs, fresh data is pushed in automatically and your component re-renders, so just call the
  action. Actions resolve with undefined unless the registry entry declares "returns".
- Styles with Tailwind CSS utility classes (Tailwind is available in the sandbox). Make it polished,
  modern, and visually distinct — good spacing, rounded corners, subtle shadows, clear hierarchy.
- MUST NOT use window, document, location, navigator, fetch, XMLHttpRequest, WebSocket, cookies,
  localStorage, \`this\`, classes, dangerouslySetInnerHTML, <a href> links, or any external URL/script.
  Code that does is rejected before it runs. Forms may use onSubmit (call e.preventDefault()) but never navigate.

CAPABILITY RULES (this is the contract — follow it exactly):
- You may ONLY call veneer.action(id, ...) with an action id that appears in the registry below.
- You may ONLY call veneer.data(id) with a data source id that appears in the registry below.
- Pass exactly the declared args, with the declared types. Unknown or wrongly typed args are rejected.
- If the user asks for something that has NO matching registered capability (for example, deleting a
  record when no delete action is registered), DO NOT invent it and DO NOT fake it. Instead, set
  "code" to null (keep the current UI), and in "reply" politely explain that the action isn't
  available in this app, naming what you can do instead.

BRAND (the sandbox is themed by the host app — make the UI look like part of it):${brandLine}
- Use these brand utilities for chrome and structure; they resolve to the host's own colours, radii and fonts:
  surfaces: ${u.surfaces.join(', ')}
  text: ${u.text.join(', ')}
  borders: ${u.borders.join(', ')}
  radius: ${u.radius.join(', ')}   fonts: ${u.fonts.join(', ')}   shadows: ${u.shadows.join(', ')}
- Page background: bg-background. Cards/panels: bg-surface border border-border rounded-lg shadow-sm.
  Primary buttons: bg-primary text-primary-foreground rounded-md. Body text: text-foreground; secondary: text-muted.
- Brand colours do not support opacity modifiers (no bg-primary/50). Never hardcode hex colours or inline colour styles.
- Raw Tailwind palette colours (e.g. bg-emerald-100) are fine for data-visualisation accents, status chips and
  when the user explicitly asks for a colourful design; otherwise prefer the brand utilities.
- The canvas is auto-sized to its content: do not use min-h-screen or fixed viewport heights.

REGISTERED CAPABILITIES:
${reg}

Each data source lists its fields. Each action lists its args — pass exactly those.`;
}

export function buildUserPrompt(message, currentUI) {
  const cur = currentUI ? String(currentUI) : '(none yet)';
  return `User request: ${message}

For reference, the current UI code is:
\`\`\`
${cur}
\`\`\`

Generate the new UI (or, if the request needs a capability that isn't registered, set code to null
and explain in reply). Respond with ONLY the JSON object.`;
}

/** Robustly pull the JSON object out of the model's response. */
export function extractJson(text) {
  if (!text) return null;
  let candidate = text.trim();
  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidate = fence[1].trim();
  try {
    const v = JSON.parse(candidate);
    return v && typeof v === 'object' ? v : null;
  } catch (e) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      try {
        const v = JSON.parse(candidate.slice(start, end + 1));
        return v && typeof v === 'object' ? v : null;
      } catch (e2) {
        return null;
      }
    }
    return null;
  }
}
