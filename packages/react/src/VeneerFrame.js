'use client';
import React, { useRef, useEffect, useLayoutEffect, useCallback, useMemo, useState } from 'react';
import { useVeneer } from './context';
import { buildFrameSrcDoc, FRAME_SANDBOX, PROTOCOL_VERSION, runBridgeAction, pickRegisteredData, createRateLimiter } from '@veneer/core';

/**
 * Mounts the sandboxed iframe and runs the parent-side bridge.
 *
 * Every UI (each generation, each reset) gets a FRESH document: `VeneerFrame` re-keys the inner
 * `FrameInstance` on `generation`, so stale timers/state from a previous generation cannot leak
 * into the next one and the handshake invariants below hold for every document.
 *
 * Handshake (per document):
 *  1. The in-frame runtime posts `ready` via window.postMessage. Only the trusted runtime has run.
 *  2. We wait for BOTH that `ready` (from our iframe's contentWindow, first one only) AND the
 *     iframe element's first `load` event. `ready` fires before `load`; if we initialised on
 *     `ready` alone, generated code could navigate before `load` and the first `load` we saw
 *     would belong to the attacker's document.
 *  3. We post `init` carrying a fresh MessagePort plus the code, the registered data and the
 *     registered ids. From here on we ignore window messages entirely; the port is the bridge.
 *  4. Generated code calls veneer.action(id, args) → `action` on the port → validated by
 *     bridge.js → real impl → `action-result` back. Host data changes → `data` on the port.
 *
 * Branding: `init` carries the provider's theme payload (validated tokens, mode, inlined fonts) and
 * later changes go over the port as `theme` messages. With `autoHeight` the frame reports its
 * content height (`size` messages) and the iframe is resized, so the canvas flows with the page.
 *
 * Detection: any `load` after `init` means the frame navigated (the port died with the old
 * document, so it was already cut off). Missed heartbeats mean it navigated to something that
 * never finished loading, or is stuck in a hot loop. Either way we tear down, quarantine the
 * code, revert to the default UI in a new document, and report via onSecurityViolation.
 */
export function VeneerFrame({
  className,
  style,
  frameSrc,
  onError,
  onSecurityViolation,
  actionTimeoutMs = 30000,
  heartbeatMs = 2000,
  maxMissedHeartbeats = 3,
  readyTimeoutMs = 8000,
  validation = 'on',
  rateLimit,
  autoHeight = true,
  minHeight = 240,
  maxHeight,
}) {
  const { generation, loaded } = useVeneer();
  // Remembered across fresh-document remounts so the page does not jump while the new UI boots.
  const lastHeightRef = useRef(null);
  if (!loaded) {
    return <div className={className} style={Object.assign({ width: '100%', display: 'block' }, style)} aria-busy="true" />;
  }
  return (
    <FrameInstance
      key={generation}
      autoHeight={autoHeight}
      minHeight={minHeight}
      maxHeight={maxHeight}
      lastHeightRef={lastHeightRef}
      className={className}
      style={style}
      frameSrc={frameSrc}
      onError={onError}
      onSecurityViolation={onSecurityViolation}
      actionTimeoutMs={actionTimeoutMs}
      heartbeatMs={heartbeatMs}
      maxMissedHeartbeats={maxMissedHeartbeats}
      readyTimeoutMs={readyTimeoutMs}
      validation={validation}
      rateLimit={rateLimit}
    />
  );
}

function FrameInstance({
  className,
  style,
  frameSrc,
  onError,
  onSecurityViolation,
  actionTimeoutMs,
  heartbeatMs,
  maxMissedHeartbeats,
  readyTimeoutMs,
  validation,
  rateLimit,
  autoHeight,
  minHeight,
  maxHeight,
  lastHeightRef,
}) {
  const ctx = useVeneer();
  const { ui, registry, actions, data, flagViolation, themePayload } = ctx;
  const [height, setHeight] = useState(() => (lastHeightRef && lastHeightRef.current) || minHeight);
  const [clipped, setClipped] = useState(false); // content taller than maxHeight → let the frame scroll
  const clampHeight = useCallback(
    (h) => Math.max(minHeight || 0, maxHeight ? Math.min(maxHeight, h) : h),
    [minHeight, maxHeight]
  );
  const iframeRef = useRef(null);
  const [attached, setAttached] = useState(false); // iframe gets its document only once listeners exist
  const [dead, setDead] = useState(null); // { reason } once torn down

  // Handshake/bridge state lives in a ref: StrictMode's double-invoked effects share it.
  const st = useRef(null);
  if (st.current === null) {
    st.current = {
      loadCount: 0,
      ready: false,
      inited: false,
      dead: false,
      port: null,
      awaitingPong: false,
      missed: 0,
      pingSeq: 0,
      inflight: 0,
      lastSent: null,
      readyTimer: null,
      heartbeat: null,
      limiter: createRateLimiter(rateLimit || {}),
    };
  }

  // Latest props/context reachable from stable handlers, without a write-during-render.
  const latest = useRef({ ui, registry, actions, data, onError, onSecurityViolation, flagViolation, themePayload });
  useLayoutEffect(() => {
    latest.current = { ui, registry, actions, data, onError, onSecurityViolation, flagViolation, themePayload };
  });

  const srcDoc = useMemo(() => (frameSrc ? undefined : buildFrameSrcDoc()), [frameSrc]);
  const sentThemeRef = useRef(null); // last theme payload delivered to this document

  const report = useCallback((err) => {
    const cb = latest.current.onError;
    if (typeof cb === 'function') {
      try {
        cb(err);
      } catch (e) {
        /* host callback errors must not break the SDK */
      }
    }
  }, []);

  const teardown = useCallback(() => {
    const s = st.current;
    s.dead = true;
    if (s.port) {
      try {
        s.port.close();
      } catch (e) {
        /* ignore */
      }
      s.port = null;
    }
    if (s.heartbeat) clearInterval(s.heartbeat);
    if (s.readyTimer) clearTimeout(s.readyTimer);
    s.heartbeat = null;
    s.readyTimer = null;
  }, []);

  const violate = useCallback(
    (reason, detail) => {
      const s = st.current;
      if (s.dead) return;
      teardown();
      const info = { reason, detail, code: latest.current.ui, protocol: PROTOCOL_VERSION };
      setDead({ reason });
      const cb = latest.current.onSecurityViolation;
      if (typeof cb === 'function') {
        try {
          cb(info);
        } catch (e) {
          /* ignore */
        }
      }
      // Context quarantines the code, reverts to the default UI and remounts a fresh instance.
      latest.current.flagViolation(info);
    },
    [teardown]
  );

  const portSend = useCallback(
    (msg) => {
      const s = st.current;
      if (!s.port || s.dead) return false;
      try {
        s.port.postMessage(msg);
        return true;
      } catch (e) {
        // DataCloneError: host passed something non-cloneable (function, DOM node, Proxy…).
        report({ type: 'post-failed', message: String((e && e.message) || e), payloadType: msg && msg.type });
        return false;
      }
    },
    [report]
  );

  const onPortMessage = useCallback(
    (ev) => {
      const s = st.current;
      if (s.dead) return;
      const d = ev.data;
      if (!d || typeof d.type !== 'string') return;
      const { registry, actions } = latest.current;

      if (d.type === 'pong') {
        s.awaitingPong = false;
        s.missed = 0;
      } else if (d.type === 'size') {
        if (autoHeight && typeof d.height === 'number' && Number.isFinite(d.height) && d.height >= 0) {
          const raw = Math.ceil(d.height);
          const next = clampHeight(raw);
          if (lastHeightRef) lastHeightRef.current = next;
          setHeight(next);
          setClipped(!!maxHeight && raw > maxHeight);
        }
      } else if (d.type === 'action') {
        const callId = d.callId;
        const reply = (ok, payload) =>
          portSend(ok ? { type: 'action-result', callId, ok: true, result: payload } : { type: 'action-result', callId, ok: false, error: payload });
        if (!s.limiter.take()) return reply(false, 'Too many actions; slow down.');
        if (s.inflight >= 16) return reply(false, 'Too many actions in flight.');
        s.inflight++;
        runBridgeAction({ registry, actions, action: d.action, args: d.args, validation })
          .then((result) => {
            s.inflight--;
            reply(true, result);
          })
          .catch((err) => {
            s.inflight--;
            report({ type: 'action-rejected', action: d.action, code: err && err.code, message: String((err && err.message) || err) });
            reply(false, String((err && err.message) || err));
          });
      } else if (d.type === 'error') {
        report({ type: 'frame-error', kind: d.kind, message: String(d.message || '') });
      } else if (d.type === 'scan-violation') {
        report({ type: 'scan-violation', violations: Array.isArray(d.violations) ? d.violations.map(String) : [] });
        violate('scan-violation', { violations: Array.isArray(d.violations) ? d.violations.map(String) : [] });
      }
    },
    [portSend, report, validation, violate, autoHeight, clampHeight, lastHeightRef, maxHeight]
  );

  const tryInit = useCallback(() => {
    const s = st.current;
    const frame = iframeRef.current;
    if (s.dead || s.inited || !s.ready || s.loadCount < 1 || !frame || !frame.contentWindow) return;
    const { ui, registry, data, themePayload } = latest.current;
    const channel = new MessageChannel();
    s.port = channel.port1;
    s.port.onmessage = onPortMessage;
    s.inited = true;
    if (s.readyTimer) clearTimeout(s.readyTimer);
    s.readyTimer = null;
    const registered = pickRegisteredData(registry, data);
    s.lastSent = registered;
    sentThemeRef.current = themePayload;
    try {
      // '*' is required: the frame is an opaque origin. The port is what makes this safe — only
      // the document present right now receives it, and it dies with that document.
      frame.contentWindow.postMessage(
        {
          source: 'veneer-host',
          type: 'init',
          v: PROTOCOL_VERSION,
          code: ui,
          data: registered,
          actionIds: ((registry && registry.actions) || []).map((a) => a.id),
          dataIds: ((registry && registry.dataSources) || []).map((d) => d.id),
          options: { actionTimeoutMs, autoHeight: !!autoHeight },
          theme: themePayload,
        },
        '*',
        [channel.port2]
      );
    } catch (e) {
      report({ type: 'post-failed', message: String((e && e.message) || e), payloadType: 'init' });
      teardown();
      return;
    }
    s.heartbeat = setInterval(() => {
      if (s.dead) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        s.awaitingPong = false;
        s.missed = 0;
        return;
      }
      if (s.awaitingPong) {
        s.missed++;
        if (s.missed >= maxMissedHeartbeats) {
          violate('frame-unresponsive', { missedHeartbeats: s.missed });
          return;
        }
      }
      s.awaitingPong = true;
      portSend({ type: 'ping', seq: ++s.pingSeq });
    }, heartbeatMs);
  }, [onPortMessage, portSend, report, teardown, violate, actionTimeoutMs, heartbeatMs, maxMissedHeartbeats, autoHeight]);

  // Push theme changes (mode flip, fonts arriving, host re-branding) into the running frame.
  useEffect(() => {
    const s = st.current;
    if (!s.inited || s.dead) return;
    if (sentThemeRef.current === themePayload) return;
    sentThemeRef.current = themePayload;
    portSend({ type: 'theme', theme: themePayload });
  }, [themePayload, portSend]);

  // Window listener: attached BEFORE the iframe receives a document, so `ready` cannot be missed.
  useLayoutEffect(() => {
    function onMessage(ev) {
      const s = st.current;
      const frame = iframeRef.current;
      if (s.dead || !frame || ev.source !== frame.contentWindow) return;
      const d = ev.data;
      if (!d || d.source !== 'veneer-frame' || d.type !== 'ready') return;
      if (s.ready) return; // a second `ready` can only come from a document we did not create
      s.ready = true;
      tryInit();
    }
    window.addEventListener('message', onMessage);
    setAttached(true);
    return () => window.removeEventListener('message', onMessage);
  }, [tryInit]);

  // Real unmount (not StrictMode's simulated one): release the port and timers.
  useEffect(() => {
    let cancelled = false;
    return () => {
      cancelled = true;
      // Defer so StrictMode's immediate re-run (same tick) keeps a live bridge.
      Promise.resolve().then(() => {
        if (cancelled && !mountedAgain.current) teardown();
      });
    };
  }, [teardown]);
  const mountedAgain = useRef(false);
  useEffect(() => {
    mountedAgain.current = true;
    return () => {
      mountedAgain.current = false;
    };
  }, []);

  const onLoad = useCallback(() => {
    const s = st.current;
    if (s.dead) return;
    s.loadCount++;
    if (s.inited) {
      // The document we initialised is gone: generated code navigated the frame.
      violate('frame-navigated', { loadCount: s.loadCount });
      return;
    }
    if (s.loadCount === 1) {
      s.readyTimer = setTimeout(() => {
        if (!s.ready && !s.dead) {
          report({
            type: 'runtime-timeout',
            message:
              'The sandbox runtime did not start. If the host page sets a Content-Security-Policy, serve the frame from a URL (frameSrc) or allow the runtime origins.',
          });
        }
      }, readyTimeoutMs);
      tryInit();
    }
  }, [tryInit, violate, report, readyTimeoutMs]);

  // Push data into the frame when a registered source changes.
  useEffect(() => {
    const s = st.current;
    if (!s.inited || s.dead) return;
    const registered = pickRegisteredData(registry, data);
    const prev = s.lastSent || {};
    const keys = new Set([...Object.keys(prev), ...Object.keys(registered)]);
    let changed = false;
    for (const k of keys) if (prev[k] !== registered[k]) changed = true;
    if (!changed) return;
    s.lastSent = registered;
    portSend({ type: 'data', data: registered });
  }, [data, registry, portSend]);

  if (dead) {
    return (
      <div
        className={className}
        role="status"
        style={Object.assign(
          { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontFamily: 'ui-sans-serif, system-ui', fontSize: 13 },
          style
        )}
      >
        This view was stopped for safety and is being reset.
      </div>
    );
  }

  const frameProps = {
    ref: iframeRef,
    onLoad,
    sandbox: FRAME_SANDBOX,
    referrerPolicy: 'no-referrer',
    title: 'Veneer canvas',
    className,
    style: Object.assign(
      { width: '100%', border: 'none', display: 'block' },
      style,
      autoHeight ? { height, overflow: clipped ? 'auto' : 'hidden' } : null
    ),
  };
  if (autoHeight) frameProps.scrolling = clipped ? 'auto' : 'no';
  if (attached) {
    if (frameSrc) frameProps.src = frameSrc;
    else frameProps.srcDoc = srcDoc;
  }
  return <iframe {...frameProps} />;
}
