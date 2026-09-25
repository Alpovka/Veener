'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useVeneer } from './context.js';
import { verifyLicenseToken, DEV_TOKEN, isLocalHost, hashRegistryShape } from '@veneer/core';

const MAX_HISTORY_TURNS = 20;
const REPAIR_WINDOW_MS = 8000;

/**
 * Headless generation hook. Build your own chat box, command palette or "redesign" button on
 * top of it; the SDK ships no chat UI.
 *
 *   const { generate, busy, history, reply, undo, canUndo, reset, violation } = useVeneerGenerate();
 *   <input onKeyDown={(e) => e.key === 'Enter' && generate(e.target.value)} />
 *
 * `generate(message)` POSTs { message, history, currentUI } to `endpoint` (default /api/veneer,
 * a route you create with `createVeneerHandler` from @veneer/server or point at Veneer Cloud),
 * swaps in the returned code through the provider (which persists it and mounts a fresh sandbox),
 * and records the assistant's reply. The registry is never sent: the server owns it.
 *
 * Small edits (`mode: 'edit'` from the server) are applied with state carry-over: the canvas moves
 * the previous interpreter's component state (typed text, open rows) into the new one.
 *
 * Runtime repair: if the new UI crashes right after it is applied (a render error the static scan
 * cannot see, e.g. `e.currentTarget.dataset` on a synthetic event), the hook sends ONE hidden
 * follow-up turn asking the model to fix it, and applies the fix. `repairOnError: false` disables.
 * Hidden turns carry `hidden: true` in `history`; chat UIs should not render them.
 *
 * Licensing: a response is accepted only with a valid Veneer license token (signed by Veneer,
 * verified here against the embedded public keys). The unsigned DEV token issued by
 * `createVeneerHandler({ license: false })` is accepted on localhost only. Pass
 * `requireLicense: false` to skip the check (e.g. in tests); this is a licensing control, not a
 * security boundary.
 */
export function useVeneerGenerate({ endpoint = '/api/veneer', headers, fetch: fetchImpl, requireLicense = true, publicKeys, repairOnError = true } = {}) {
  const { ui, setUi, reset: resetUi, violation, clearViolation, registry, engineError } = useVeneer();
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const undoStack = useRef([]);
  const abortRef = useRef(null);
  const busyRef = useRef(false); // synchronous guard: state updates land a render later
  const lastApplied = useRef(null); // { code, at, repaired } for the runtime-repair loop
  const historyRef = useRef(history);
  historyRef.current = history;
  const uiRef = useRef(ui);
  uiRef.current = ui;

  const run = useCallback(
    async (message, opts = {}) => {
      if (!message || busyRef.current) return null;
      const priorHistory = historyRef.current.filter((m) => !m.hidden).slice(-MAX_HISTORY_TURNS);
      const previousUi = uiRef.current;
      setError(null);
      setHistory((h) => [...h, { role: 'user', content: message, ...(opts.hidden ? { hidden: true } : {}) }]);
      busyRef.current = true;
      setBusy(true);
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      abortRef.current = controller;
      const f = fetchImpl || fetch;
      let outcome;
      try {
        const res = await f(endpoint, {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
          credentials: 'same-origin',
          signal: controller ? controller.signal : undefined,
          body: JSON.stringify({ message, currentUI: previousUi, history: priorHistory }),
        });
        let json = null;
        try {
          json = await res.json();
        } catch (e) {
          json = null;
        }
        const changed = !!json && typeof json.code === 'string' && json.code.trim().length > 0;
        // Only responses that carry code need a license token: chat turns, clarifications and
        // refusals are not metered and arrive without one.
        const license = !res.ok || !json || json.error || !changed || !requireLicense ? { ok: true } : await checkLicense(json.token, registry, publicKeys);
        if (!res.ok || !json || typeof json !== 'object' || json.error) {
          const msg = json && typeof json.error === 'string' ? json.error : `The design service returned an error (${res.status}).`;
          setError(msg);
          setHistory((h) => [...h, { role: 'assistant', content: msg, error: true, ...(opts.hidden ? { hidden: true } : {}) }]);
          outcome = { ok: false, error: msg, code: json && json.code };
        } else if (!license.ok) {
          const msg = license.message;
          setError(msg);
          setHistory((h) => [...h, { role: 'assistant', content: msg, error: true }]);
          outcome = { ok: false, error: msg, code: 'unlicensed', reason: license.reason };
        } else {
          // 'edit': the server applied a few search/replace edits to the current UI (the fast path);
          // 'design': a whole new view. Edits keep the user's in-progress state across the swap.
          const mode = json.mode === 'edit' ? 'edit' : 'design';
          if (changed) {
            undoStack.current.push(previousUi);
            lastApplied.current = { code: json.code, at: Date.now(), repaired: !!opts.repair };
            setUi(json.code, { carryState: mode === 'edit' || !!opts.repair });
          }
          // The server applies an intent gate: code arrives only for design requests. Chat turns
          // (greetings, questions, opinions) come back reply-only and leave the canvas alone.
          const intent = json.intent === 'chat' || json.intent === 'clarify' || json.intent === 'design' ? json.intent : changed ? 'design' : 'chat';
          const fallback = changed ? 'Done.' : intent === 'clarify' ? 'Could you tell me more?' : 'No changes made.';
          const reply = typeof json.reply === 'string' && json.reply ? json.reply : fallback;
          setHistory((h) => [...h, { role: 'assistant', content: reply, changed, intent, mode, ...(opts.repair ? { repair: true } : {}) }]);
          outcome = { ok: true, changed, intent, mode, reply, blocked: json.blocked };
        }
      } catch (e) {
        const msg = e && e.name === 'AbortError' ? 'Cancelled.' : 'Network error. Please try again.';
        setError(msg);
        setHistory((h) => [...h, { role: 'assistant', content: msg, error: true }]);
        outcome = { ok: false, error: msg };
      }
      abortRef.current = null;
      busyRef.current = false;
      setBusy(false);
      return outcome;
    },
    [endpoint, headers, fetchImpl, setUi, requireLicense, publicKeys, registry]
  );

  const generate = useCallback((input) => run(typeof input === 'string' ? input.trim() : ''), [run]);

  // Runtime repair: the engine reported a crash for the code we just applied → one hidden turn.
  useEffect(() => {
    if (!repairOnError || !engineError || !lastApplied.current) return;
    const la = lastApplied.current;
    if (la.repaired || engineError.code !== la.code || Date.now() - la.at > REPAIR_WINDOW_MS || busyRef.current) return;
    la.repaired = true;
    const where = engineError.stage === 'run' ? 'while starting' : 'while running';
    const msg = `The view you just generated crashed ${where} with this error: "${String(engineError.message || '').slice(0, 400)}". Fix the cause, keep the same design and layout, and return the complete corrected code.`;
    run(msg, { hidden: true, repair: true });
  }, [engineError, repairOnError, run]);

  const cancel = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
  }, []);

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (typeof prev !== 'string') return false;
    lastApplied.current = null;
    setUi(prev, { carryState: true });
    return true;
  }, [setUi]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    setError(null);
  }, []);

  const reset = useCallback(() => {
    undoStack.current = [];
    lastApplied.current = null;
    setHistory([]);
    setError(null);
    resetUi();
  }, [resetUi]);

  const visible = history.filter((m) => !m.hidden);
  const last = visible.length ? visible[visible.length - 1] : null;
  return {
    generate,
    cancel,
    busy,
    error,
    history,
    reply: last && last.role === 'assistant' ? last.content : null,
    undo,
    canUndo: undoStack.current.length > 0,
    clearHistory,
    reset,
    violation,
    clearViolation,
    currentUI: ui,
  };
}

/**
 * @returns {Promise<{ ok: true } | { ok: false, reason: string, message: string }>}
 */
async function checkLicense(token, registry, publicKeys) {
  if (token === DEV_TOKEN) {
    const host = typeof window !== 'undefined' && window.location ? window.location.hostname : '';
    if (isLocalHost(host)) return { ok: true };
    return {
      ok: false,
      reason: 'dev-token',
      message:
        'The server runs Veneer unlicensed (license: false), which only works on localhost. Add a license key or use Veneer Cloud for this deployment.',
    };
  }
  const v = await verifyLicenseToken(token, { registryHash: hashRegistryShape(registry), ...(publicKeys ? { publicKeys } : {}) });
  if (v.ok) return { ok: true };
  // No WebCrypto (insecure origins, very old browsers): the server already enforced the license,
  // so fail open rather than breaking the product for that visitor.
  if (v.reason === 'unsupported-runtime') return { ok: true };
  const detail = v.reason === 'missing' ? 'no license token came back' : `token ${v.reason}`;
  return { ok: false, reason: v.reason, message: `This response was not licensed by Veneer (${detail}), so it was not applied.` };
}
