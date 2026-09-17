import { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline, Scope } from 'quickjs-emscripten-core';
import releaseVariant from '@jitl/quickjs-wasmfile-release-sync';
import { readFileSync } from 'node:fs';
import { transform } from 'sucrase';

const ms = (t) => Math.round((performance.now() - t) * 10) / 10;
const results = [];
const check = (name, ok, detail = "") => { const line = `${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`; results.push(line); console.log(line); };

let t = performance.now();
const QuickJS = await newQuickJSWASMModuleFromVariant(releaseVariant);
check('boot wasm module', true, `${ms(t)} ms`);

function makeVm({ memoryLimit = 64 * 1024 * 1024, stack = 256 * 1024 } = {}) {
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(memoryLimit);
  runtime.setMaxStackSize(stack);
  let deadline = Infinity;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const vm = runtime.newContext();
  const timers = new Map(); let timerSeq = 0; const posts = [];
  // glue: the ONLY host functions the guest ever sees
  const g = vm.newObject();
  vm.newFunction('post', (h) => { posts.push(vm.getString(h)); }).consume((f) => vm.setProp(g, 'post', f));
  vm.newFunction('setTimer', (fnH, msH) => { const id = ++timerSeq; timers.set(id, { fn: fnH.dup(), at: Date.now() + vm.getNumber(msH) }); return vm.newNumber(id); }).consume((f) => vm.setProp(g, 'setTimer', f));
  vm.newFunction('clearTimer', (idH) => { const e = timers.get(vm.getNumber(idH)); if (e) { e.fn.dispose(); timers.delete(vm.getNumber(idH)); } }).consume((f) => vm.setProp(g, 'clearTimer', f));
  vm.newFunction('now', () => vm.newNumber(performance.now())).consume((f) => vm.setProp(g, 'now', f));
  vm.newFunction('log', (h) => { console.log('[guest]', vm.getString(h)); }).consume((f) => vm.setProp(g, 'log', f));
  vm.setProp(vm.global, '__glue', g); g.dispose();

  function run(code, { budgetMs = 250, label = 'eval' } = {}) {
    deadline = Date.now() + budgetMs;
    const r = vm.evalCode(code, `${label}.js`);
    let out;
    if (r.error) { const e = vm.dump(r.error); r.error.dispose(); out = { error: e }; }
    else { out = { value: vm.dump(r.value) }; r.value.dispose(); }
    // drain the job queue (promises) under the same deadline, bounded
    let jobs = 0;
    for (let i = 0; i < 100; i++) {
      const jr = runtime.executePendingJobs(1000);
      if (jr.error) { const e = vm.dump(jr.error); jr.error.dispose(); out.jobError = e; break; }
      jobs += jr.value; if (!runtime.hasPendingJob()) break;
      if (Date.now() > deadline) { out.jobsRunaway = true; break; }
    }
    deadline = Infinity;
    out.jobs = jobs;
    return out;
  }
  function fireDueTimers(budgetMs = 250) {
    const now = Date.now(); let fired = 0;
    for (const [id, e] of [...timers]) if (e.at <= now) {
      timers.delete(id); deadline = Date.now() + budgetMs;
      const r = vm.callFunction(e.fn, vm.undefined); if (r.error) r.error.dispose(); else r.value.dispose();
      e.fn.dispose(); fired++;
      let n = 0; while (runtime.hasPendingJob() && n++ < 100 && Date.now() <= deadline) { const jr = runtime.executePendingJobs(1000); if (jr.error) { jr.error.dispose(); break; } jr.value; }
      deadline = Infinity;
    }
    return fired;
  }
  function callGlobal(name, ...args) {
    return Scope.withScope((scope) => {
      const fn = scope.manage(vm.getProp(vm.global, name));
      const handles = args.map((a) => scope.manage(typeof a === 'number' ? vm.newNumber(a) : typeof a === 'string' ? vm.newString(a) : vm.unwrapResult(vm.evalCode('(' + JSON.stringify(a) + ')'))));
      deadline = Date.now() + 250;
      const r = vm.callFunction(fn, vm.undefined, ...handles);
      deadline = Infinity;
      if (r.error) { const e = vm.dump(r.error); r.error.dispose(); return { error: e }; }
      const v = vm.dump(r.value); r.value.dispose(); return { value: v };
    });
  }
  return { vm, runtime, run, fireDueTimers, callGlobal, posts, timers, dispose() { for (const e of timers.values()) e.fn.dispose(); vm.dispose(); runtime.dispose(); } };
}

// ---- 1. Guest runtime + render + event ----
{
  const g = makeVm();
  t = performance.now();
  const shims = `
    globalThis.setTimeout = (fn, ms) => __glue.setTimer(fn, ms || 0);
    globalThis.clearTimeout = (id) => __glue.clearTimer(id);
    globalThis.queueMicrotask = (fn) => Promise.resolve().then(fn);
    globalThis.performance = { now: () => __glue.now() };
    globalThis.console = { log: (...a) => __glue.log(a.map(String).join(' ')), warn: (...a) => __glue.log('warn ' + a.join(' ')), error: (...a) => __glue.log('error ' + a.join(' ')) };
  `;
  let r = g.run(shims, { label: 'shims' }); check('shims eval', !r.error, JSON.stringify(r.error || ''));
  r = g.run(readFileSync('spike/guest.bundle.js', 'utf8'), { budgetMs: 2000, label: 'guest' });
  check('guest bundle (Preact + fake DOM) evaluates', !r.error, `${ms(t)} ms ${JSON.stringify(r.error || '')}`);

  const jsx = `
    function VeneerUI() {
      const [n, setN] = useState(1);
      const items = useMemo(() => Array.from({ length: n }, (_, i) => 'item ' + i), [n]);
      return (
        <div className="grid gap-4" style={{ padding: '8px' }}>
          <h2>Count: {n}</h2>
          <button className="bg-primary" onClick={() => setN(n + 1)}>add</button>
          <ul>{items.map((it) => <li key={it}>{it}</li>)}</ul>
        </div>
      );
    }
    render(<VeneerUI />);
  `;
  t = performance.now();
  const compiled = transform(jsx, { transforms: ['jsx'], production: true, jsxRuntime: 'classic', jsxPragma: 'React.createElement', jsxFragmentPragma: 'React.Fragment' }).code;
  const tCompile = ms(t);
  t = performance.now();
  r = g.run(compiled, { budgetMs: 2000, label: 'generated' });
  const ops1 = JSON.parse(g.callGlobal('__flushOps').value);
  check('generated JSX renders to ops', !r.error && ops1.some((o) => o.t === 'ins' && o.tag === 'button') && ops1.some((o) => o.t === 'on' && o.name === 'click'), `sucrase ${tCompile} ms · render ${ms(t)} ms · ${ops1.length} ops`);
  const btn = ops1.find((o) => o.t === 'ins' && o.tag === 'button');
  t = performance.now();
  const d = g.callGlobal('__dispatch', btn.id, 'click', {});
  // Preact debounces via Promise → drain
  g.run('0', { label: 'drain' });
  const ops2 = JSON.parse(g.callGlobal('__flushOps').value);
  check('click → setState → re-render → diff ops', d.value === true && ops2.some((o) => o.t === 'txt' && /2/.test(o.text)) && ops2.some((o) => o.t === 'ins' && o.tag === 'li'), `${ms(t)} ms · ${ops2.length} ops: ${JSON.stringify(ops2).slice(0, 120)}…`);
  // effects via setTimeout shim
  r = g.run(`setTimeout(() => __glue.post('timer fired'), 5); 'ok'`, { label: 'timer' });
  await new Promise((res) => setTimeout(res, 15));
  g.fireDueTimers();
  check('setTimeout shim fires through glue', g.posts.includes('timer fired'));
  // glue is reachable now; M1 hides it. Confirm hiding works:
  r = g.run(`(function(){ const glue = __glue; delete globalThis.__glue; globalThis.__probe = () => typeof __glue; })(); __probe()`, { label: 'hide' });
  check('raw glue can be hidden from later code', r.value === 'undefined', String(r.value));
  g.dispose();
}

// ---- 2. Abuse cases ----
{
  const g = makeVm();
  t = performance.now(); let r = g.run('while (true) {}', { budgetMs: 100, label: 'hotloop' });
  check('infinite loop interrupted', !!r.error && /interrupt/i.test(JSON.stringify(r.error)), `${ms(t)} ms · ${JSON.stringify(r.error).slice(0, 80)}`);
  r = g.run('1+1'); check('VM usable after interrupt', r.value === 2);

  t = performance.now(); r = g.run('function f(){ Promise.resolve().then(f); } f(); "started"', { budgetMs: 100, label: 'storm' });
  check('microtask storm bounded', r.jobsRunaway === true || r.jobs >= 1000, `${ms(t)} ms · jobs ${r.jobs} runaway ${r.jobsRunaway}`);

  t = performance.now(); r = g.run('/(a+)+$/.test("a".repeat(40) + "b")', { budgetMs: 100, label: 'redos' });
  check('catastrophic regex interrupted', !!r.error && /interrupt/i.test(JSON.stringify(r.error)), `${ms(t)} ms`);

  t = performance.now(); r = g.run('const a = []; while (true) a.push(new Array(1e5).fill(1));', { budgetMs: 5000, label: 'oom' });
  check('memory cap hit is a catchable error', !!r.error && /memory|out of/i.test(JSON.stringify(r.error)), `${ms(t)} ms · ${JSON.stringify(r.error).slice(0, 80)}`);
  r = g.run('1+1'); check('VM usable after OOM', r.value === 2);

  r = g.run('function r(){ return r() + 1 } r()', { budgetMs: 1000, label: 'stack' });
  check('deep recursion is a RangeError, not a crash', !!r.error && /stack|range/i.test(JSON.stringify(r.error)), JSON.stringify(r.error).slice(0, 80));
  r = g.run('1+1'); check('VM usable after stack overflow', r.value === 2);

  r = g.run('typeof fetch + "," + typeof XMLHttpRequest + "," + typeof location + "," + typeof document + "," + typeof window + "," + typeof importScripts + "," + typeof WebSocket', { label: 'globals' });
  check('no ambient network/DOM globals', r.value === 'undefined,undefined,undefined,undefined,undefined,undefined,undefined', r.value);
  r = g.run('typeof Intl + "," + typeof crypto + "," + typeof structuredClone + "," + typeof URL + "," + typeof TextEncoder', { label: 'missing' });
  check('inventory of missing conveniences (to shim in M1)', true, r.value);
  g.dispose();
}


console.log(`\n${results.filter((r) => r.startsWith('PASS')).length} passed, ${results.filter((r) => r.startsWith('FAIL')).length} failed`);
