/**
 * The box: one QuickJS runtime hosting one generated UI. Platform-neutral so the same code runs in
 * the Web Worker (production) and in Node (tests). The worker's job is only to move messages.
 *
 * Boundary rules (see the engine v2 write-up):
 *  - only strings cross into and out of the interpreter; handles never escape a Scope;
 *  - every entry (guest boot, generated code, an event, a timer, a data push, an action result)
 *    runs under a deadline enforced by QuickJS's interrupt handler, followed by a bounded drain of
 *    the promise job queue;
 *  - memory and stack are capped; a cap hit is a catchable error and the runtime stays usable;
 *  - the glue hands the guest exactly five functions: post, setTimer, clearTimer, now, log.
 */
import { Scope } from 'quickjs-emscripten-core';
import { transform } from 'sucrase';

export const LIMITS = {
  memoryBytes: 64 * 1024 * 1024,
  stackBytes: 256 * 1024, // 1 MB crashes the wasm host; measured in the M0 spike
  bootMs: 3000,
  initialEvalMs: 2000,
  entryMs: 250,
  maxJobRounds: 200,
  maxCodeChars: 200000,
  maxOpsPerFlush: 20000,
};

/** Host-tunable subset of LIMITS, clamped so a host can loosen the deadlines for heavy views but never remove them. */
export function mergeLimits(overrides) {
  const o = overrides && typeof overrides === 'object' ? overrides : {};
  const clamp = (v, min, max, dflt) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : dflt);
  return {
    ...LIMITS,
    entryMs: clamp(o.entryMs, 50, 2000, LIMITS.entryMs),
    initialEvalMs: clamp(o.initialEvalMs, 500, 10000, LIMITS.initialEvalMs),
    memoryBytes: clamp(o.memoryMB != null ? Number(o.memoryMB) * 1024 * 1024 : undefined, 16 * 1024 * 1024, 256 * 1024 * 1024, LIMITS.memoryBytes),
    maxOpsPerFlush: clamp(o.maxOpsPerFlush, 1000, 100000, LIMITS.maxOpsPerFlush),
  };
}

/** JSX (and the odd TS-free modern syntax) → plain JS, classic runtime against `React.createElement`. */
export function compileGenerated(code) {
  return (
    '"use strict";\n' +
    transform(code, {
      transforms: ['jsx'],
      production: true,
      jsxRuntime: 'classic',
      jsxPragma: 'React.createElement',
      jsxFragmentPragma: 'React.Fragment',
    }).code
  );
}

/**
 * @param {object} QuickJS  module from newQuickJSWASMModuleFromVariant
 * @param {string} guestSource  the bundled guest runtime
 * @param {object} io  { post(msg), schedule(id, ms), unschedule(id), now(), log(level, text) }
 */
export function createBox(QuickJS, guestSource, io, limits = LIMITS) {
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(limits.memoryBytes);
  runtime.setMaxStackSize(limits.stackBytes);
  let deadline = Infinity;
  let interrupted = false;
  runtime.setInterruptHandler(() => {
    if (Date.now() > deadline) {
      interrupted = true;
      return true;
    }
    return false;
  });
  const vm = runtime.newContext();
  const timers = new Map(); // id → fn handle
  let timerSeq = 0;
  let disposed = false;
  let consecutiveTimeouts = 0;

  // ---- glue: the only host functions the guest ever sees --------------------------------------
  const glue = vm.newObject();
  vm.newFunction('post', (h) => {
    let s;
    try {
      s = vm.getString(h);
    } catch (e) {
      return;
    }
    io.post(s);
  }).consume((f) => vm.setProp(glue, 'post', f));
  vm.newFunction('setTimer', (fnH, msH) => {
    const id = ++timerSeq;
    const ms = Math.max(0, Math.min(2147483647, vm.getNumber(msH) || 0));
    timers.set(id, fnH.dup());
    io.schedule(id, ms);
    return vm.newNumber(id);
  }).consume((f) => vm.setProp(glue, 'setTimer', f));
  vm.newFunction('clearTimer', (idH) => {
    const id = vm.getNumber(idH);
    const fn = timers.get(id);
    if (fn) {
      fn.dispose();
      timers.delete(id);
      io.unschedule(id);
    }
  }).consume((f) => vm.setProp(glue, 'clearTimer', f));
  vm.newFunction('now', () => vm.newNumber(io.now())).consume((f) => vm.setProp(glue, 'now', f));
  vm.newFunction('log', (levelH, textH) => {
    let level = 'log';
    let text = '';
    try {
      level = vm.getString(levelH);
      text = vm.getString(textH);
    } catch (e) {
      /* ignore */
    }
    io.log(level, String(text).slice(0, 2000));
  }).consume((f) => vm.setProp(glue, 'log', f));
  vm.setProp(vm.global, '__glue', glue);
  glue.dispose();

  function drain() {
    let rounds = 0;
    while (runtime.hasPendingJob() && rounds++ < limits.maxJobRounds) {
      const r = runtime.executePendingJobs(200);
      if (r.error) {
        const e = dump(r.error);
        r.error.dispose();
        return { error: e };
      }
      r.value; // count
      if (Date.now() > deadline) return { error: { name: 'InternalError', message: 'interrupted: job queue exceeded its deadline' } };
    }
    if (runtime.hasPendingJob()) return { error: { name: 'InternalError', message: 'interrupted: job queue runaway' } };
    return {};
  }
  function dump(h) {
    try {
      const v = vm.dump(h);
      if (v && typeof v === 'object') return { name: String(v.name || 'Error'), message: String(v.message || ''), stack: typeof v.stack === 'string' ? v.stack.slice(0, 2000) : undefined };
      return { name: 'Error', message: String(v) };
    } catch (e) {
      return { name: 'Error', message: 'unprintable error' };
    }
  }
  /** Run `fn` under a deadline; returns { error? }. Also drains the job queue. */
  function entry(budgetMs, fn) {
    if (disposed) return { error: { name: 'Error', message: 'box disposed' } };
    interrupted = false;
    deadline = Date.now() + budgetMs;
    let out;
    try {
      out = fn() || {};
      if (!out.error) {
        const d = drain();
        if (d.error) out = d;
      }
    } catch (e) {
      out = { error: { name: 'Error', message: String((e && e.message) || e) } };
    } finally {
      deadline = Infinity;
    }
    if (out.error && (interrupted || /interrupt/i.test(String(out.error.message)))) {
      out.error.timeout = true;
      consecutiveTimeouts++;
    } else consecutiveTimeouts = 0;
    return out;
  }
  function evalCode(code, filename) {
    const r = vm.evalCode(code, filename, { type: 'global' });
    if (r.error) {
      const e = dump(r.error);
      r.error.dispose();
      return { error: e };
    }
    r.value.dispose();
    return {};
  }
  /** Call `__veneer_rt[method](...args)` with string/number/boolean args; returns { value?, error? }. */
  function rt(method, ...args) {
    return Scope.withScope((scope) => {
      const rtObj = scope.manage(vm.getProp(vm.global, '__veneer_rt'));
      const fn = scope.manage(vm.getProp(rtObj, method));
      const handles = args.map((a) => scope.manage(typeof a === 'number' ? vm.newNumber(a) : typeof a === 'boolean' ? (a ? vm.true : vm.false) : vm.newString(String(a))));
      const r = vm.callFunction(fn, rtObj, ...handles);
      if (r.error) {
        const e = dump(r.error);
        r.error.dispose();
        return { error: e };
      }
      const v = vm.dump(r.value);
      r.value.dispose();
      return { value: v };
    });
  }

  return {
    get consecutiveTimeouts() {
      return consecutiveTimeouts;
    },
    /** Evaluate the guest runtime. */
    boot() {
      return entry(limits.bootMs, () => evalCode(guestSource, 'veneer-guest.js'));
    },
    configure(cfg) {
      return entry(limits.entryMs, () => rt('configure', JSON.stringify(cfg)));
    },
    /** Compile + evaluate generated code. Returns { error? } with error.kind 'compile' | 'runtime'. */
    run(code) {
      if (typeof code !== 'string' || code.length > limits.maxCodeChars) return { error: { kind: 'compile', name: 'Error', message: 'code is not a string or exceeds ' + limits.maxCodeChars + ' characters' } };
      let compiled;
      try {
        compiled = compileGenerated(code);
      } catch (e) {
        return { error: { kind: 'compile', name: 'SyntaxError', message: String((e && e.message) || e) } };
      }
      const r = entry(limits.initialEvalMs, () => evalCode(compiled, 'generated.js'));
      if (r.error) r.error.kind = r.error.kind || 'runtime';
      return r;
    },
    dispatch(id, name, payload) {
      return entry(limits.entryMs, () => rt('dispatch', Number(id), String(name), JSON.stringify(payload || {})));
    },
    setData(data) {
      return entry(limits.entryMs, () => rt('setData', JSON.stringify(data || {})));
    },
    actionResult(callId, ok, payload) {
      return entry(limits.entryMs, () => rt('actionResult', Number(callId), !!ok, JSON.stringify(payload === undefined ? null : payload)));
    },
    /** Fire a timer the guest scheduled. */
    fireTimer(id) {
      const fn = timers.get(id);
      if (!fn) return {};
      timers.delete(id);
      return entry(limits.entryMs, () => {
        const r = vm.callFunction(fn, vm.undefined);
        fn.dispose();
        if (r.error) {
          const e = dump(r.error);
          r.error.dispose();
          return { error: e };
        }
        r.value.dispose();
        return {};
      });
    },
    fallback(message) {
      return entry(limits.entryMs, () => rt('fallback', String(message || '')));
    },
    /** Live `useState` values as a JSON string, for carrying into the next box. Returns { state } or { error }. */
    snapshot() {
      const r = entry(limits.entryMs, () => rt('snapshot'));
      if (r.error) return { error: r.error };
      return { state: typeof r.value === 'string' ? r.value : '{}' };
    },
    /** Pull the recorded ops. Returns { root, ops } or { error }. */
    flush() {
      const r = rt('flushOps');
      if (r.error) return { error: r.error };
      try {
        const parsed = JSON.parse(r.value);
        if (!parsed || !Array.isArray(parsed.ops)) return { error: { name: 'Error', message: 'bad ops payload' } };
        if (parsed.ops.length > limits.maxOpsPerFlush) return { error: { name: 'Error', message: 'too many ops in one flush (' + parsed.ops.length + ')', flood: true } };
        return parsed;
      } catch (e) {
        return { error: { name: 'Error', message: 'ops are not JSON' } };
      }
    },
    /** `true` when the guest is still healthy enough to keep going (simple probe). */
    alive() {
      if (disposed) return false;
      const r = entry(50, () => evalCode('1', 'probe.js'));
      return !r.error;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const fn of timers.values()) fn.dispose();
      timers.clear();
      try {
        vm.dispose();
      } catch (e) {
        /* ignore */
      }
      try {
        runtime.dispose();
      } catch (e) {
        /* ignore */
      }
    },
  };
}
