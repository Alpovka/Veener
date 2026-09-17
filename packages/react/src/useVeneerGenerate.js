'use client';
import { useCallback, useRef, useState } from 'react';
import { useVeneer } from './context';
import { verifyLicenseToken, DEV_TOKEN, isLocalHost, hashRegistryShape } from '@veneer/core';

const MAX_HISTORY_TURNS = 20;

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
 * Licensing: a response is accepted only with a valid Veneer license token (signed by Veneer,
 * verified here against the embedded public keys). The unsigned DEV token issued by
 * `createVeneerHandler({ license: false })` is accepted on localhost only. Pass
 * `requireLicense: false` to skip the check (e.g. in tests); this is a licensing control, not a
 * security boundary.
 */
export function useVeneerGenerate({ endpoint = '/api/veneer', headers, fetch: fetchImpl, requireLicense = true, publicKeys } = {}) {
  const { ui, setUi, reset: resetUi, violation, clearViolation, registry } = useVeneer();
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const undoStack = useRef([]);
  const abortRef = useRef(null);

  const generate = useCallback(
    async (input) => {
      const message = typeof input === 'string' ? input.trim() : '';
      if (!message || busy) return null;
      const priorHistory = history.slice(-MAX_HISTORY_TURNS);
      const previousUi = ui;
      setError(null);
      setHistory((h) => [...h, { role: 'user', content: message }]);
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
        if (!res.ok || !json || typeof json !== 'object' || json.error) {
          const msg = json && typeof json.error === 'string' ? json.error : `The design service returned an error (${res.status}).`;
          setError(msg);
          setHistory((h) => [...h, { role: 'assistant', content: msg, error: true }]);
          outcome = { ok: false, error: msg, code: json && json.code };
        } else if (requireLicense && !(await isLicensed(json.token, registry, publicKeys))) {
          const msg = 'This response was not licensed by Veneer, so it was not applied.';
          setError(msg);
          setHistory((h) => [...h, { role: 'assistant', content: msg, error: true }]);
          outcome = { ok: false, error: msg, code: 'unlicensed' };
        } else {
          const changed = typeof json.code === 'string' && json.code.trim().length > 0;
          if (changed) {
            undoStack.current.push(previousUi);
            setUi(json.code);
          }
          const reply = typeof json.reply === 'string' && json.reply ? json.reply : changed ? 'Done.' : 'No changes made.';
          setHistory((h) => [...h, { role: 'assistant', content: reply, changed }]);
          outcome = { ok: true, changed, reply, blocked: json.blocked };
        }
      } catch (e) {
        const msg = e && e.name === 'AbortError' ? 'Cancelled.' : 'Network error. Please try again.';
        setError(msg);
        setHistory((h) => [...h, { role: 'assistant', content: msg, error: true }]);
        outcome = { ok: false, error: msg };
      }
      abortRef.current = null;
      setBusy(false);
      return outcome;
    },
    [busy, history, ui, endpoint, headers, fetchImpl, setUi, requireLicense, publicKeys, registry]
  );

  const cancel = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
  }, []);

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (typeof prev !== 'string') return false;
    setUi(prev);
    return true;
  }, [setUi]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    setError(null);
  }, []);

  const reset = useCallback(() => {
    undoStack.current = [];
    setHistory([]);
    setError(null);
    resetUi();
  }, [resetUi]);

  const last = history.length ? history[history.length - 1] : null;
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

async function isLicensed(token, registry, publicKeys) {
  if (token === DEV_TOKEN) {
    const host = typeof window !== 'undefined' && window.location ? window.location.hostname : '';
    return isLocalHost(host);
  }
  const v = await verifyLicenseToken(token, { registryHash: hashRegistryShape(registry), ...(publicKeys ? { publicKeys } : {}) });
  return v.ok;
}
