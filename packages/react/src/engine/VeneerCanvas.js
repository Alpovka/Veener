'use client';
import React, { useRef, useEffect, useLayoutEffect, useCallback, useState } from 'react';
import { useVeneer } from '../context.js';
import { runBridgeAction, pickRegisteredData, createRateLimiter, BridgeError, PROTOCOL_VERSION } from '@veneer/core';
import { createTree } from './tree.js';
import { sanitizeTag, sanitizeAttrs, sanitizeClass, sanitizeStyle, EVENT_PROP, isTextControl, eventPayload } from './sanitize.js';

export const DEFAULT_WORKER_URL = '/veneer-worker.js';

// ---------------------------------------------------------------------------------------------
// Warm spare workers. Booting a worker (QuickJS wasm + the Tailwind compiler) costs ~1 s cold. The
// canvas keeps ONE spare per worker URL booted in the background while a UI is showing, so the
// next generation swaps in almost immediately. A spare is still a fresh interpreter that has never
// seen any generated code: the one-fresh-worker-per-UI rule is unchanged, it just boots early.
// Messages the spare sends before it is adopted (`ready`, a boot failure) are buffered and replayed.
// ---------------------------------------------------------------------------------------------
const spares = new Map(); // workerUrl → { worker, buffer, failed }

function warmSpare(workerUrl) {
  if (typeof Worker === 'undefined' || spares.has(workerUrl)) return;
  let worker;
  try {
    worker = new Worker(workerUrl, { name: 'veneer-engine' });
  } catch (e) {
    return;
  }
  const spare = { worker, buffer: [], failed: false };
  worker.onmessage = (ev) => spare.buffer.push(ev.data);
  worker.onerror = () => {
    spare.failed = true;
  };
  spares.set(workerUrl, spare);
}

function takeSpare(workerUrl) {
  const spare = spares.get(workerUrl);
  if (!spare) return null;
  spares.delete(workerUrl);
  if (spare.failed) {
    try {
      spare.worker.terminate();
    } catch (e) {
      /* ignore */
    }
    return null;
  }
  return spare;
}

/** Test/diagnostic hook: is a spare worker currently warm for this URL? */
export function hasWarmWorker(workerUrl = DEFAULT_WORKER_URL) {
  return spares.has(workerUrl);
}

/**
 * The worker engine's canvas. Generated code runs inside a QuickJS interpreter in a Web Worker
 * and only ever sends back a description of what to draw; this component redraws that description
 * with the host's own React, in the host's own DOM, through an allowlist. No iframe: the result is
 * real elements in your page with your fonts, theme, focus order and overlays.
 *
 * Every UI (each generation, each reset) gets a FRESH worker: `VeneerCanvas` re-keys the inner
 * instance on `generation`, so nothing from a previous UI (timers, state, a stuck interpreter) can
 * touch the next one.
 *
 * Walls, in order: the interpreter has no window/document/fetch/location (they do not exist);
 * this component drops any element, attribute, style or class that could load a URL or escape the
 * canvas; the bridge validates every `veneer.action` against the registry; the watchdog pings the
 * worker and terminates it when it stops answering (a hot loop or a memory-thrash loop that the
 * interpreter's own deadline cannot interrupt).
 *
 * Serve `dist/veneer-worker.js` from your origin (default path `/veneer-worker.js`, or pass
 * `workerUrl`). The worker compiles WebAssembly, so a host Content-Security-Policy needs
 * `script-src 'wasm-unsafe-eval'` (and `worker-src 'self'` if you set `worker-src`).
 */
export function VeneerCanvas(props) {
  const { generation, loaded } = useVeneer();
  // The last rendered height survives the swap to a new instance, so the page does not collapse
  // and jump while the next UI boots.
  const heightRef = useRef(0);
  if (!loaded) {
    return <div className={props.className} style={Object.assign({ minHeight: props.minHeight || 120 }, props.style)} aria-busy="true" />;
  }
  return <CanvasInstance key={generation} {...props} heightRef={heightRef} />;
}

function CanvasInstance({
  className,
  style,
  workerUrl = DEFAULT_WORKER_URL,
  onError,
  onLog,
  onSecurityViolation,
  actionTimeoutMs = 30000,
  heartbeatMs = 2000,
  maxMissedHeartbeats = 3,
  readyTimeoutMs = 15000,
  validation = 'on',
  rateLimit,
  minHeight = 120,
  /** How far generated UI (dropdowns, popovers) may hang below the canvas before it is clipped. */
  bleed = 280,
  /** Keep a spare worker booted for the next UI (default true). */
  warm = true,
  heightRef,
}) {
  const ctx = useVeneer();
  const { ui, registry, actions, data, flagViolation, themeVars, resolvedMode, violation } = ctx;
  const [version, setVersion] = useState(0);
  const [started, setStarted] = useState(false);
  const [dead, setDead] = useState(null);
  const treeRef = useRef(null);
  if (treeRef.current === null) treeRef.current = createTree();
  const rootRef = useRef(null);

  const st = useRef(null);
  if (st.current === null) {
    st.current = {
      worker: null,
      ready: false,
      dead: false,
      missed: 0,
      awaitingPong: false,
      pingSeq: 0,
      heartbeat: null,
      readyTimer: null,
      lastSent: null,
      inflight: 0,
      limiter: createRateLimiter(rateLimit || {}),
      sheet: null,
      styleEl: null,
      warmed: false,
    };
  }
  // Once this UI is up, boot the spare for the next one (off the critical path of first paint).
  const scheduleWarm = useCallback(() => {
    const s = st.current;
    if (!warm || s.warmed) return;
    s.warmed = true;
    setTimeout(() => {
      if (!s.dead) warmSpare(workerUrl);
    }, 150);
  }, [warm, workerUrl]);
  const latest = useRef({ ui, registry, actions, data, onError, onLog, onSecurityViolation, flagViolation });
  useLayoutEffect(() => {
    latest.current = { ui, registry, actions, data, onError, onLog, onSecurityViolation, flagViolation };
  });

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

  const removeCss = useCallback(() => {
    const s = st.current;
    if (s.sheet && typeof document !== 'undefined' && document.adoptedStyleSheets) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((x) => x !== s.sheet);
      s.sheet = null;
    }
    if (s.styleEl) {
      s.styleEl.remove();
      s.styleEl = null;
    }
  }, []);
  const installCss = useCallback(
    (css) => {
      const s = st.current;
      if (typeof document === 'undefined') return;
      const canAdopt = typeof CSSStyleSheet !== 'undefined' && 'adoptedStyleSheets' in document && typeof CSSStyleSheet.prototype.replaceSync === 'function';
      if (canAdopt) {
        try {
          if (!s.sheet) {
            s.sheet = new CSSStyleSheet();
            document.adoptedStyleSheets = [...document.adoptedStyleSheets, s.sheet];
          }
          s.sheet.replaceSync(css);
          return;
        } catch (e) {
          report({ type: 'style-error', message: String((e && e.message) || e) });
        }
      }
      if (!s.styleEl) {
        s.styleEl = document.createElement('style');
        s.styleEl.setAttribute('data-veneer-canvas', '');
        document.head.appendChild(s.styleEl);
      }
      s.styleEl.textContent = css;
    },
    [report]
  );

  const teardown = useCallback(() => {
    const s = st.current;
    s.dead = true;
    if (s.heartbeat) clearInterval(s.heartbeat);
    if (s.readyTimer) clearTimeout(s.readyTimer);
    s.heartbeat = null;
    s.readyTimer = null;
    if (s.worker) {
      try {
        s.worker.postMessage({ type: 'dispose' });
      } catch (e) {
        /* ignore */
      }
      try {
        s.worker.terminate();
      } catch (e) {
        /* ignore */
      }
      s.worker = null;
    }
    removeCss();
  }, [removeCss]);

  const violate = useCallback(
    (reason, detail) => {
      const s = st.current;
      if (s.dead) return;
      teardown();
      const info = { reason, detail, code: latest.current.ui, protocol: PROTOCOL_VERSION, engine: 'worker' };
      setDead({ reason });
      const cb = latest.current.onSecurityViolation;
      if (typeof cb === 'function') {
        try {
          cb(info);
        } catch (e) {
          /* ignore */
        }
      }
      latest.current.flagViolation(info);
    },
    [teardown]
  );

  const post = useCallback(
    (msg) => {
      const s = st.current;
      if (!s.worker || s.dead) return false;
      try {
        s.worker.postMessage(msg);
        return true;
      } catch (e) {
        report({ type: 'post-failed', message: String((e && e.message) || e), payloadType: msg && msg.type });
        return false;
      }
    },
    [report]
  );

  const onMessage = useCallback(
    (ev) => {
      const s = st.current;
      if (s.dead) return;
      const d = ev.data;
      if (!d || typeof d.type !== 'string') return;
      const { registry, actions } = latest.current;
      if (d.type === 'ready') {
        if (s.ready) return;
        s.ready = true;
        if (s.readyTimer) clearTimeout(s.readyTimer);
        s.readyTimer = null;
        const { ui, registry: reg, data } = latest.current;
        const registered = pickRegisteredData(reg, data);
        s.lastSent = registered;
        post({
          type: 'init',
          v: PROTOCOL_VERSION,
          code: ui,
          data: registered,
          actionIds: ((reg && reg.actions) || []).map((a) => a.id),
          dataIds: ((reg && reg.dataSources) || []).map((x) => x.id),
          options: { actionTimeoutMs },
        });
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
              violate('worker-unresponsive', { missedHeartbeats: s.missed });
              return;
            }
          }
          s.awaitingPong = true;
          post({ type: 'ping', seq: ++s.pingSeq });
        }, heartbeatMs);
      } else if (d.type === 'pong') {
        s.awaitingPong = false;
        s.missed = 0;
      } else if (d.type === 'ops') {
        const r = treeRef.current.apply(d);
        if (r.error) {
          if (r.flood) return violate('ops-flood', { message: r.error });
          report({ type: 'engine-error', message: r.error });
          return;
        }
        if (typeof d.css === 'string') installCss(d.css);
        setStarted(true);
        setVersion((v) => v + 1);
        scheduleWarm();
      } else if (d.type === 'started') {
        setStarted(true);
        scheduleWarm();
      } else if (d.type === 'action') {
        const callId = d.callId;
        const reply = (ok, payload) => post(ok ? { type: 'action-result', callId, ok: true, result: payload } : { type: 'action-result', callId, ok: false, error: payload });
        if (!s.limiter.take()) return reply(false, 'Too many actions; slow down.');
        if (s.inflight >= 16) return reply(false, 'Too many actions in flight.');
        s.inflight++;
        runBridgeAction({ registry, actions, action: d.action, args: d.args, validation })
          .then((result) => {
            s.inflight--;
            reply(true, result === undefined ? null : result);
          })
          .catch((err) => {
            s.inflight--;
            report({ type: 'action-rejected', action: d.action, code: err && err.code, message: String((err && err.message) || err) });
            const safe = err instanceof BridgeError || (err && typeof err.code === 'string' && err.name === 'BridgeError');
            reply(false, safe ? String(err.message) : 'The action failed.');
          });
      } else if (d.type === 'error') {
        report({ type: 'engine-error', kind: d.kind, stage: d.stage, message: String(d.message || '') });
      } else if (d.type === 'log') {
        const cb = latest.current.onLog;
        if (typeof cb === 'function') {
          try {
            cb(String(d.level || 'log'), String(d.text || ''));
          } catch (e) {
            /* ignore */
          }
        }
      } else if (d.type === 'fatal') {
        violate('engine-fatal', { reason: d.reason, message: String(d.message || '') });
      }
    },
    [post, report, violate, installCss, scheduleWarm, actionTimeoutMs, heartbeatMs, maxMissedHeartbeats, validation]
  );
  const onMessageRef = useRef(onMessage);
  useLayoutEffect(() => {
    onMessageRef.current = onMessage;
  });

  // Spawn the worker once per instance (StrictMode double-invokes effects: guard via the ref).
  useEffect(() => {
    const s = st.current;
    if (s.worker || s.dead) return undefined;
    if (typeof Worker === 'undefined') {
      report({ type: 'runtime-timeout', message: 'Web Workers are not available in this environment.' });
      return undefined;
    }
    // Adopt the warm spare if there is one (already booted, or about to be); otherwise cold start.
    const spare = warm ? takeSpare(workerUrl) : null;
    let worker = spare ? spare.worker : null;
    if (!worker) {
      try {
        worker = new Worker(workerUrl, { name: 'veneer-engine' });
      } catch (e) {
        report({ type: 'runtime-timeout', message: `Could not start the Veneer engine worker from ${workerUrl}: ${String((e && e.message) || e)}` });
        return undefined;
      }
    }
    s.worker = worker;
    worker.onmessage = (ev) => onMessageRef.current(ev);
    worker.onerror = (ev) => {
      report({ type: s.ready ? 'engine-error' : 'runtime-timeout', message: (ev && ev.message) || `The Veneer engine worker failed to load from ${workerUrl}.` });
      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
    };
    if (spare) for (const data of spare.buffer) onMessageRef.current({ data });
    s.readyTimer = setTimeout(() => {
      if (!s.ready && !s.dead) {
        report({
          type: 'runtime-timeout',
          message: `The Veneer engine did not start. Serve @veneer/react's dist/veneer-worker.js at ${workerUrl} on this origin, and allow 'wasm-unsafe-eval' in script-src if the page sets a Content-Security-Policy.`,
        });
      }
    }, readyTimeoutMs);
    return undefined;
  }, [workerUrl, readyTimeoutMs, report, warm]);

  // Remember the rendered height for the next instance (see VeneerCanvas).
  useEffect(() => {
    if (!started || !rootRef.current || !heightRef) return;
    const h = rootRef.current.getBoundingClientRect().height;
    if (h > 0) heightRef.current = h;
  }, [version, started, heightRef]);

  // Real unmount (not StrictMode's simulated one): tear the worker down.
  const mountedAgain = useRef(false);
  useEffect(() => {
    mountedAgain.current = true;
    return () => {
      mountedAgain.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    return () => {
      cancelled = true;
      Promise.resolve().then(() => {
        if (cancelled && !mountedAgain.current) teardown();
      });
    };
  }, [teardown]);

  // Push data into the box when a registered source changes.
  useEffect(() => {
    const s = st.current;
    if (!s.ready || s.dead) return;
    const registered = pickRegisteredData(registry, data);
    const prev = s.lastSent || {};
    const keys = new Set([...Object.keys(prev), ...Object.keys(registered)]);
    let changed = false;
    for (const k of keys) if (prev[k] !== registered[k]) changed = true;
    if (!changed) return;
    s.lastSent = registered;
    post({ type: 'data', data: registered });
  }, [data, registry, post]);

  // Programmatic focus requested by generated code.
  useEffect(() => {
    const ids = treeRef.current.takeFocus();
    if (!ids.length || !rootRef.current) return;
    const id = ids[ids.length - 1];
    const el = rootRef.current.querySelector(`[data-vid="${id}"]`);
    if (el && typeof el.focus === 'function') el.focus({ preventScroll: true });
  }, [version]);

  const dispatch = useCallback(
    (id, name, e) => {
      if (name === 'submit' || name === 'drop' || name === 'dragover') e.preventDefault();
      if (name === 'dragstart' && e.dataTransfer) {
        try {
          e.dataTransfer.setData('text/plain', 'veneer');
          e.dataTransfer.effectAllowed = 'move';
        } catch (err) {
          /* ignore */
        }
      }
      post({ type: 'event', id, name, payload: eventPayload(e) });
    },
    [post]
  );

  const vars = (themeVars && themeVars[resolvedMode]) || {};
  // Until this UI has drawn, hold the previous UI's height so the swap does not move the page.
  const heldHeight = started ? minHeight : Math.max(Number(minHeight) || 0, (heightRef && heightRef.current) || 0);
  const rootStyle = Object.assign(
    {
      position: 'relative',
      isolation: 'isolate',
      contain: 'layout',
      clipPath: `inset(-16px -16px -${Math.max(0, Number(bleed) || 0)}px -16px)`,
      minHeight: heldHeight,
      color: 'var(--veneer-foreground)',
      fontFamily: 'var(--veneer-font-sans)',
      fontSize: 'var(--veneer-font-size)',
    },
    vars,
    style
  );
  const rootClass = ['veneer-canvas', resolvedMode === 'dark' ? 'veneer-dark' : '', className || ''].filter(Boolean).join(' ');

  if (dead) {
    const stayingDown = violation && violation.remounted === false;
    return (
      <div className={className} role="status" style={Object.assign({ minHeight: heldHeight, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontFamily: 'ui-sans-serif, system-ui', fontSize: 13 }, style)}>
        {stayingDown ? 'This view was stopped for safety. Reset the canvas to continue.' : 'This view was stopped for safety and is being reset.'}
      </div>
    );
  }

  const tree = treeRef.current;
  const children = started && tree.root != null ? renderChildren(tree, tree.root, dispatch) : null;
  return (
    <div ref={rootRef} className={rootClass} style={rootStyle} data-veneer-engine="worker" aria-busy={started ? undefined : 'true'}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Rendering the mirrored tree through the allowlist
// ---------------------------------------------------------------------------------------------
function renderChildren(tree, id, dispatch) {
  const n = tree.nodes.get(id);
  if (!n) return null;
  const out = [];
  for (const cid of n.children) {
    const el = renderNode(tree, cid, dispatch);
    if (el !== null) out.push(el);
  }
  return out;
}

function renderNode(tree, id, dispatch) {
  const n = tree.nodes.get(id);
  if (!n) return null;
  if (n.tag === null) return typeof n.text === 'string' ? n.text : null;
  const t = sanitizeTag(n.tag, n.ns);
  if (t.drop) return null;
  // A demoted element (`a` → span) keeps its safe attributes (id, aria-*, data-*, title); the ones
  // that made it dangerous (href, target, download…) are not in the allowlist for any tag.
  const tag = t.tag || t.demote;
  const props = sanitizeAttrs(tag, n.attrs);
  props.key = id;
  props['data-vid'] = id;
  const cls = sanitizeClass(n.attrs.class);
  if (cls) props.className = cls;
  const styl = sanitizeStyle(n.style);
  if (Object.keys(styl).length) props.style = styl;

  // events
  const isControl = tag === 'input' || tag === 'textarea' || tag === 'select';
  const textControl = isTextControl(tag, props.type);
  for (const name of n.listeners) {
    if (name === 'input' || name === 'change') continue; // handled below, once
    const prop = EVENT_PROP[name];
    if (!prop || prop === 'onInput' || prop === 'onChange') continue;
    props[prop] = (e) => dispatch(id, name, e);
  }
  if (n.listeners.has('input') || n.listeners.has('change')) {
    if (textControl) props.onInput = (e) => dispatch(id, 'input', e);
    else props.onChange = (e) => dispatch(id, 'change', e);
  }
  if (tag === 'form' && !n.listeners.has('submit')) props.onSubmit = (e) => e.preventDefault(); // never navigate

  const children = tag === 'textarea' || tag === 'input' ? null : renderChildren(tree, id, dispatch);

  if (isControl) {
    const value = n.props.value !== undefined ? n.props.value : props.value !== undefined ? props.value : props.defaultValue;
    const checked = n.props.checked !== undefined ? n.props.checked : props.checked !== undefined ? props.checked : props.defaultChecked;
    delete props.value;
    delete props.defaultValue;
    delete props.checked;
    delete props.defaultChecked;
    return <Control key={id} tag={tag} props={props} value={value} checked={checked}>{children}</Control>;
  }
  if (tag === 'option' && n.props.value !== undefined) props.value = n.props.value;
  return React.createElement(tag, props, children);
}

/**
 * Semi-controlled form control: the DOM owns the text while the user types (no round trip through
 * the interpreter per keystroke), and the interpreter's value wins whenever it changes.
 */
function Control({ tag, props, value, checked, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (value !== undefined && el.value !== value) el.value = value;
    if (checked !== undefined && el.checked !== checked) el.checked = checked;
  }, [value, checked]);
  const p = Object.assign({}, props, { ref });
  if (value !== undefined) p.defaultValue = value;
  if (checked !== undefined) p.defaultChecked = checked;
  return React.createElement(tag, p, children);
}
