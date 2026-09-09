'use client';
import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { useVeneer } from './context';
import { buildFrameSrcDoc } from './frameRuntime';
import { runBridgeAction } from './bridge';

/**
 * Mounts the sandboxed iframe and runs the parent-side bridge.
 *
 * Flow:
 *  1. iframe loads, in-frame runtime posts { ready }.
 *  2. We post { init, code, data } — the generated UI + a snapshot of live data.
 *  3. Generated code calls window.veneer.action(id, args) → posts { action } → we validate
 *     against the registry, run the real impl, post { action-result } back.
 *  4. When host data changes (e.g. an action mutated state), we push { data } into the frame,
 *     which re-renders. When the generated UI itself changes, we push { render, code }.
 */
export function VeneerFrame({ className, style }) {
  const { registry, actions, data, ui, loaded } = useVeneer();
  const iframeRef = useRef(null);
  const readyRef = useRef(false);

  // Keep the latest action/registry/data reachable from the (stable) message handler.
  const stateRef = useRef({ registry, actions, data, ui });
  stateRef.current = { registry, actions, data, ui };

  const srcDoc = useMemo(() => buildFrameSrcDoc(), []);

  const post = useCallback((msg) => {
    const w = iframeRef.current && iframeRef.current.contentWindow;
    if (w) w.postMessage(Object.assign({ source: 'veneer-host' }, msg), '*');
  }, []);

  useEffect(() => {
    function onMessage(ev) {
      const frameWin = iframeRef.current && iframeRef.current.contentWindow;
      if (ev.source !== frameWin) return;
      const d = ev.data;
      if (!d || d.source !== 'veneer-frame') return;

      const { registry, actions, ui, data } = stateRef.current;

      if (d.type === 'ready') {
        readyRef.current = true;
        post({ type: 'init', code: ui, data });
      } else if (d.type === 'action') {
        runBridgeAction({ registry, actions, action: d.action, args: d.args })
          .then((result) => post({ type: 'action-result', callId: d.callId, ok: true, result }))
          .catch((err) =>
            post({
              type: 'action-result',
              callId: d.callId,
              ok: false,
              error: String((err && err.message) || err),
            })
          );
      } else if (d.type === 'error') {
        // A generation failed to render; the frame already shows a friendly fallback.
        // Surfaced here for host-side logging if desired.
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [post]);

  // Push fresh data into the frame whenever host data changes.
  useEffect(() => {
    if (readyRef.current) post({ type: 'data', data });
  }, [data, post]);

  // Swap the generated UI when it changes (new generation, or reset to default).
  useEffect(() => {
    if (readyRef.current && loaded) post({ type: 'render', code: ui, data });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      title="Veneer canvas"
      className={className}
      style={Object.assign({ width: '100%', border: 'none', display: 'block' }, style)}
    />
  );
}
