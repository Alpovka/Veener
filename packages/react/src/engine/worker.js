/**
 * The Web Worker: boots QuickJS, owns one box per generated UI, and moves messages. It never
 * evaluates generated code itself (no eval, no Function): generated code only ever runs inside the
 * interpreter. Everything that crosses to the page is plain JSON.
 *
 * Host → worker:  init · event · data · action-result · ping · dispose
 * Worker → host:  ready · started · ops (with css when new classes appeared) · action · error ·
 *                 fatal · pong · log
 *
 * Wall-clock watchdog: native allocation/GC inside QuickJS does not poll the interrupt handler, so
 * a memory-thrash loop can hold this thread for seconds despite the deadline. The host pings us;
 * while we are stuck we cannot pong, the host terminates the worker, and a fresh one is spawned.
 * That is the design ("terminate() as the last word"), not a gap.
 */
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-singlefile-browser-release-sync';
import GUEST from '../../dist/guest.bundle.txt';
import indexCss from 'tailwindcss/index.css';
import themeCss from 'tailwindcss/theme.css';
import utilitiesCss from 'tailwindcss/utilities.css';
import preflightCss from 'tailwindcss/preflight.css';
import { createBox, LIMITS } from './vm.js';
import { createTailwind } from './tailwind.js';
import { safeClassTokens } from './classGrammar.js';

const MAX_TIMEOUTS_IN_A_ROW = 3;
const CSS_MAX_CHARS = 400000;

const send = (msg) => self.postMessage(msg);

let box = null;
let tailwind = null;
let disposed = false;
const timerHandles = new Map(); // guest timer id → real setTimeout handle

const bootPromise = (async () => {
  const [QuickJS, tw] = await Promise.all([
    newQuickJSWASMModuleFromVariant(variant),
    createTailwind({ indexCss, themeCss, utilitiesCss, preflightCss }).catch((e) => {
      send({ type: 'error', kind: 'style', message: 'Tailwind failed to start: ' + String((e && e.message) || e) });
      return null;
    }),
  ]);
  tailwind = tw;
  return QuickJS;
})();
bootPromise.then(
  () => send({ type: 'ready' }),
  (e) => send({ type: 'fatal', reason: 'boot-failed', message: String((e && e.message) || e) })
);

const io = {
  post(s) {
    let msg;
    try {
      msg = JSON.parse(s);
    } catch (e) {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;
    // Only the shapes the guest legitimately produces are forwarded.
    if (msg.type === 'action') send({ type: 'action', callId: Number(msg.callId), action: String(msg.action), args: msg.args && typeof msg.args === 'object' ? msg.args : {} });
    else if (msg.type === 'error') send({ type: 'error', kind: String(msg.kind || 'runtime'), message: String(msg.message || '').slice(0, 2000) });
  },
  schedule(id, ms) {
    const h = setTimeout(() => {
      timerHandles.delete(id);
      if (disposed || !box) return;
      const r = box.fireTimer(id);
      afterEntry(r, 'timer');
    }, ms);
    timerHandles.set(id, h);
  },
  unschedule(id) {
    const h = timerHandles.get(id);
    if (h !== undefined) {
      clearTimeout(h);
      timerHandles.delete(id);
    }
  },
  now: () => performance.now(),
  log(level, text) {
    send({ type: 'log', level: String(level), text: String(text).slice(0, 2000) });
  },
};

/** After any VM entry: report errors, decide if the box is finished, flush ops + css. */
function afterEntry(result, stage) {
  if (disposed || !box) return;
  if (result && result.error) {
    const e = result.error;
    send({ type: 'error', kind: e.kind || (e.timeout ? 'timeout' : 'runtime'), stage, message: String(e.message || ''), name: e.name });
    if (box.consecutiveTimeouts >= MAX_TIMEOUTS_IN_A_ROW) {
      fatal('too-many-timeouts', 'Generated code kept exceeding its time budget.');
      return;
    }
  }
  flushOps();
}

function flushOps() {
  const f = box.flush();
  if (f.error) {
    if (f.error.flood) return fatal('ops-flood', f.error.message);
    send({ type: 'error', kind: 'runtime', stage: 'flush', message: f.error.message });
    return;
  }
  if (!f.ops.length) return;
  let css;
  if (tailwind) {
    const tokens = [];
    for (const op of f.ops) if (op.t === 'attr' && op.n === 'class' && typeof op.v === 'string') tokens.push(...safeClassTokens(op.v));
    if (tokens.length && tailwind.add(tokens)) {
      try {
        css = tailwind.css();
        if (css.length > CSS_MAX_CHARS) {
          send({ type: 'error', kind: 'style', message: 'stylesheet too large; styling frozen' });
          css = undefined;
        }
      } catch (e) {
        send({ type: 'error', kind: 'style', message: String((e && e.message) || e) });
      }
    }
  }
  const msg = { type: 'ops', root: f.root, ops: f.ops };
  if (css !== undefined) msg.css = css;
  send(msg);
}

function fatal(reason, message) {
  if (disposed) return;
  send({ type: 'fatal', reason, message: String(message || '') });
  dispose();
}

function dispose() {
  disposed = true;
  for (const h of timerHandles.values()) clearTimeout(h);
  timerHandles.clear();
  if (box) {
    try {
      box.dispose();
    } catch (e) {
      /* ignore */
    }
    box = null;
  }
}

self.onmessage = async (ev) => {
  const d = ev.data;
  if (!d || typeof d.type !== 'string' || disposed) return;
  if (d.type === 'ping') {
    send({ type: 'pong', seq: d.seq });
    return;
  }
  if (d.type === 'dispose') {
    dispose();
    return;
  }
  if (d.type === 'init') {
    if (box) return; // one UI per worker
    let QuickJS;
    try {
      QuickJS = await bootPromise;
    } catch (e) {
      return; // fatal already sent
    }
    if (disposed) return;
    box = createBox(QuickJS, GUEST, io, LIMITS);
    let r = box.boot();
    if (r.error) return fatal('guest-boot-failed', r.error.message);
    r = box.configure({
      actionIds: Array.isArray(d.actionIds) ? d.actionIds : [],
      dataIds: Array.isArray(d.dataIds) ? d.dataIds : [],
      data: d.data && typeof d.data === 'object' ? d.data : {},
      actionTimeoutMs: d.options && d.options.actionTimeoutMs,
    });
    if (r.error) return fatal('guest-config-failed', r.error.message);
    if (!d.code) {
      box.fallback('Ask the AI to design this page.');
      flushOps();
      send({ type: 'started' });
      return;
    }
    r = box.run(d.code);
    if (r.error) {
      send({ type: 'error', kind: r.error.kind || 'runtime', stage: 'run', message: String(r.error.message || ''), name: r.error.name });
      if (r.error.timeout) return fatal('initial-eval-timeout', 'Generated code did not finish starting in time.');
      if (r.error.kind === 'compile') box.fallback("Couldn't render this view. Try asking again.");
      else if (!box.alive()) return fatal('runtime-dead', r.error.message);
      else box.fallback();
    }
    flushOps();
    send({ type: 'started' });
    return;
  }
  if (!box) return;
  if (d.type === 'event') afterEntry(box.dispatch(d.id, d.name, d.payload), 'event');
  else if (d.type === 'data') afterEntry(box.setData(d.data), 'data');
  else if (d.type === 'action-result') afterEntry(box.actionResult(d.callId, !!d.ok, d.ok ? d.result : d.error), 'action-result');
};
