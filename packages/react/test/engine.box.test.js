// Runs the real guest runtime inside a real QuickJS instance (Node wasm variant), through the same
// `createBox` the worker uses. No browser, no worker: this is the interpreter boundary itself.
import { describe, it, expect, beforeAll } from 'vitest';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
import nodeVariant from '@jitl/quickjs-wasmfile-release-sync';
import { createBox, LIMITS } from '../src/engine/vm.js';
import { createTailwind, isSafeClassToken, safeClassTokens } from '../src/engine/tailwind.js';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let QuickJS;
let guest;

beforeAll(async () => {
  QuickJS = await newQuickJSWASMModuleFromVariant(nodeVariant);
  const out = await build({
    entryPoints: [resolve(here, '../src/engine/guest.js')],
    bundle: true,
    write: false,
    format: 'iife',
    target: ['es2020'],
    platform: 'neutral',
    mainFields: ['module', 'main'],
    logLevel: 'silent',
  });
  guest = out.outputFiles[0].text;
}, 60000);

function makeIo() {
  const io = { posts: [], logs: [], timers: new Map() };
  io.post = (s) => io.posts.push(JSON.parse(s));
  io.log = (level, text) => io.logs.push({ level, text });
  io.schedule = (id, ms) => io.timers.set(id, ms);
  io.unschedule = (id) => io.timers.delete(id);
  io.now = () => performance.now();
  return io;
}
function mkBox(code, cfg = {}) {
  const io = makeIo();
  const box = createBox(QuickJS, guest, io);
  const b = box.boot();
  expect(b.error, JSON.stringify(b.error)).toBeUndefined();
  const c = box.configure({ actionIds: ['createTask', 'updateTask', 'archiveTask'], dataIds: ['tasks'], data: { tasks: [{ id: 't1', title: 'A', status: 'todo' }, { id: 't2', title: 'B', status: 'done' }] }, ...cfg });
  expect(c.error, JSON.stringify(c.error)).toBeUndefined();
  if (code) {
    const r = box.run(code);
    expect(r.error, JSON.stringify(r.error)).toBeUndefined();
  }
  return { box, io };
}
const flush = (box) => {
  const f = box.flush();
  expect(f.error, JSON.stringify(f.error)).toBeUndefined();
  return f;
};
const findIns = (ops, tag) => ops.find((o) => o.t === 'ins' && o.tag === tag);

const APP = `
function VeneerUI() {
  const tasks = veneer.data('tasks') || [];
  const [title, setTitle] = useState('');
  const [n, setN] = useState(0);
  useEffect(() => { const t = setTimeout(() => setN(100), 5); return () => clearTimeout(t); }, []);
  async function add() { const created = await veneer.action('createTask', { title }); setTitle('created:' + created.id); }
  return (
    <div className="grid gap-4 p-4 bg-background text-foreground" style={{ padding: '8px', backgroundColor: 'red' }}>
      <h2 className="text-2xl font-bold">Count: {n} · {tasks.length} tasks</h2>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task…" className="rounded-md border" />
      <span id="echo">{title}</span>
      <button className="bg-primary text-primary-foreground" onClick={() => setN(n + 1)}>add</button>
      <button id="go" onClick={add}>go</button>
      <ul>{tasks.map((t) => <li key={t.id} className={t.status === 'done' ? 'line-through' : ''}>{t.title}</li>)}</ul>
      <label htmlFor="x">L</label>
      <svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" stroke-width="2" /></svg>
    </div>
  );
}
render(<VeneerUI />);
`;

describe('engine box: guest inside QuickJS', () => {
  it('boots, renders generated JSX to ops, exposes React-shaped globals', () => {
    const { box } = mkBox(APP);
    const { root, ops } = flush(box);
    expect(typeof root).toBe('number');
    const div = findIns(ops, 'div');
    expect(div).toBeTruthy();
    expect(div.p).toBe(root);
    expect(ops.some((o) => o.t === 'attr' && o.n === 'class' && /bg-primary/.test(o.v))).toBe(true);
    expect(ops.some((o) => o.t === 'style' && o.n === 'backgroundColor' && o.v === 'red')).toBe(true);
    expect(ops.some((o) => o.t === 'on' && o.n === 'click' && o.on)).toBe(true);
    expect(ops.some((o) => o.t === 'on' && o.n === 'change')).toBe(true); // React onChange → change (input falls through)
    expect(ops.some((o) => o.t === 'attr' && o.n === 'placeholder')).toBe(true);
    expect(ops.some((o) => o.t === 'attr' && o.n === 'htmlFor')).toBe(true);
    const svg = findIns(ops, 'svg');
    expect(svg && svg.ns).toBe('svg');
    expect(findIns(ops, 'circle').ns).toBe('svg');
    expect(ops.filter((o) => o.t === 'ins' && o.tag === 'li')).toHaveLength(2);
    expect(ops.some((o) => o.t === 'ins' && o.text === 'A')).toBe(true);
    box.dispose();
  });

  it('dispatches a click, re-renders, emits a text diff; input events reach React onChange with the value', () => {
    const { box } = mkBox(APP);
    const first = flush(box);
    const btn = first.ops.filter((o) => o.t === 'ins' && o.tag === 'button')[0];
    const r = box.dispatch(btn.id, 'click', {});
    expect(r.error).toBeUndefined();
    const second = flush(box);
    expect(second.ops.some((o) => o.t === 'txt' && o.text === '1')).toBe(true);
    const input = findIns(first.ops, 'input');
    box.dispatch(input.id, 'input', { value: 'hello' });
    const third = flush(box);
    // The state changed (echoed into the span). No `value` op is emitted for the input itself:
    // the real input already holds what the user typed, so text never round-trips.
    expect(third.ops.some((o) => o.t === 'txt' && o.text === 'hello') || third.ops.some((o) => o.t === 'ins' && o.text === 'hello')).toBe(true);
    expect(third.ops.some((o) => o.t === 'prop' && o.n === 'value')).toBe(false);
    // Clearing from state DOES emit a value op (dom.value 'hello' → '')
    const go = first.ops.find((o) => o.t === 'ins' && o.tag === 'button' && first.ops.some((a) => a.t === 'attr' && a.id === o.id && a.n === 'id' && a.v === 'go'));
    void go;
    box.dispose();
  });

  it('veneer.action posts a request and resumes on the result; unregistered actions are refused inside the box', () => {
    const { box, io } = mkBox(APP);
    const first = flush(box);
    const go = first.ops.find((o) => o.t === 'ins' && o.tag === 'button' && first.ops.some((a) => a.t === 'attr' && a.id === o.id && a.n === 'id' && a.v === 'go'));
    box.dispatch(go.id, 'click', {});
    const req = io.posts.find((p) => p.type === 'action');
    expect(req).toMatchObject({ type: 'action', action: 'createTask', args: { title: '' } });
    box.actionResult(req.callId, true, { id: 'new1' });
    const after = flush(box);
    expect(after.ops.some((o) => o.t === 'prop' && o.n === 'value' && o.v === 'created:new1')).toBe(true);
    // not registered → rejected without ever posting
    const before = io.posts.length;
    const r = box.run(`veneer.action('deleteTask', {}).catch((e) => console.log('refused ' + e.message));`);
    expect(r.error).toBeUndefined();
    expect(io.posts.length).toBe(before);
    expect(io.logs.some((l) => /refused Action "deleteTask" is not registered/.test(l.text))).toBe(true);
    box.dispose();
  });

  it('data pushes re-render the tree with keyed moves instead of remove+insert', () => {
    const { box } = mkBox(APP);
    flush(box);
    box.setData({ tasks: [{ id: 't2', title: 'B', status: 'done' }, { id: 't1', title: 'A', status: 'todo' }, { id: 't3', title: 'C', status: 'todo' }] });
    const { ops } = flush(box);
    expect(ops.some((o) => o.t === 'mv')).toBe(true);
    expect(ops.some((o) => o.t === 'ins' && o.text === 'C')).toBe(true);
    // `{tasks.length} tasks` is two adjacent text nodes; only the number changes
    expect(ops.some((o) => o.t === 'txt' && o.text === '3')).toBe(true);
    box.dispose();
  });

  it('timers go through the glue and fire on demand', () => {
    const { box, io } = mkBox(APP);
    flush(box);
    expect(io.timers.size).toBeGreaterThan(0);
    // Preact schedules effects through requestAnimationFrame (a glue timer), and the effect then
    // schedules its own setTimeout: fire timers until none are left, as the worker would.
    let guard = 0;
    while (io.timers.size && guard++ < 10) {
      const [id] = [...io.timers.keys()];
      io.timers.delete(id);
      const r = box.fireTimer(id);
      expect(r.error, JSON.stringify(r.error)).toBeUndefined();
    }
    const { ops } = flush(box);
    expect(ops.some((o) => o.t === 'txt' && /Count: 100/.test(o.text) || (o.t === 'txt' && o.text === '100'))).toBe(true);
    box.dispose();
  });

  it('has no ambient browser or network globals and no way to eval outside the box', () => {
    const { box, io } = mkBox();
    const r = box.run(`console.log([typeof fetch, typeof XMLHttpRequest, typeof WebSocket, typeof window, typeof location, typeof importScripts, typeof postMessage, typeof __glue, typeof indexedDB, typeof localStorage].join(','));`);
    expect(r.error).toBeUndefined();
    expect(io.logs.at(-1).text).toBe('undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined');
    box.dispose();
  });

  it('interrupts a hot loop and stays usable; reports the timeout', () => {
    const { box } = mkBox();
    const t = Date.now();
    const r = box.run('while (true) {}');
    expect(r.error && r.error.timeout).toBe(true);
    expect(Date.now() - t).toBeLessThan(LIMITS.initialEvalMs + 1500);
    expect(box.consecutiveTimeouts).toBe(1);
    expect(box.alive()).toBe(true);
    box.dispose();
  });

  it('turns a memory blow-up and deep recursion into errors, not crashes', () => {
    const { box } = mkBox();
    // Allocation and GC run in native code where QuickJS does not poll the interrupt handler, so
    // the memory cap (not the deadline) is what ends this, after a few seconds of GC thrash. The
    // worker's wall-clock watchdog terminates a box that stays busy this long in production.
    let r = box.run('const a = []; while (true) a.push(new Array(1e5).fill(1));');
    expect(r.error).toBeTruthy();
    expect(r.error.message).toMatch(/memory|interrupt/i);
    expect(box.alive()).toBe(true);
    r = box.run('function f(){ return f() + 1 } f()');
    expect(r.error).toBeTruthy();
    expect(r.error.message).toMatch(/stack/i);
    expect(box.alive()).toBe(true);
    box.dispose();
  }, 20000);

  it('ships the formatting shims AI code reaches for', () => {
    const { box, io } = mkBox();
    const r = box.run(`
      console.log(new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(1234.5));
      console.log((1234567.891).toLocaleString());
      console.log(new Date('2026-06-18T10:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      console.log(typeof crypto.randomUUID(), crypto.randomUUID().length);
      console.log(JSON.stringify(structuredClone({ a: [1, { b: 2 }] })));
    `);
    expect(r.error).toBeUndefined();
    const texts = io.logs.map((l) => l.text);
    expect(texts[0]).toBe('$1,234.50');
    expect(texts[1]).toBe('1,234,567.891');
    expect(texts[2]).toMatch(/^Jun 1[78]$/);
    expect(texts[3]).toBe('string 36');
    expect(texts[4]).toBe('{"a":[1,{"b":2}]}');
    box.dispose();
  });

  it('a render error inside a component becomes a friendly fallback + error post, not a dead box', () => {
    const { box, io } = mkBox();
    const r = box.run(`function Boom(){ throw new Error('kaboom'); } render(<Boom />);`);
    expect(r.error).toBeUndefined();
    const { ops } = flush(box);
    expect(ops.some((o) => o.t === 'ins' && typeof o.text === 'string' && /Couldn't render/.test(o.text))).toBe(true);
    expect(io.posts.some((p) => p.type === 'error' && p.kind === 'render' && /kaboom/.test(p.message))).toBe(true);
    box.dispose();
  });

  it('ignores innerHTML (dangerouslySetInnerHTML) instead of crashing', () => {
    const { box, io } = mkBox();
    const r = box.run(`render(<div dangerouslySetInnerHTML={{ __html: '<img src=x onerror=alert(1)>' }} />);`);
    expect(r.error).toBeUndefined();
    const { ops } = flush(box);
    expect(ops.some((o) => o.t === 'ins' && o.tag === 'img')).toBe(false);
    expect(io.logs.some((l) => /innerHTML is not supported/.test(l.text))).toBe(true);
    box.dispose();
  });
});

describe('engine styling: Tailwind in the box', () => {
  const twDir = dirname(require.resolve('tailwindcss/package.json'));
  const read = (f) => readFileSync(resolve(twDir, f), 'utf8');

  it('class grammar admits real utilities and refuses anything that can carry a URL or code', () => {
    for (const ok of ['grid', 'grid-cols-3', 'gap-2.5', 'hover:bg-primary', 'sm:grid-cols-3', 'bg-primary/50', '-mt-2', 'w-1/2', 'text-[11px]', 'w-[240px]', 'bg-[#0f766e]', 'hover:-translate-y-0.5', 'group-hover:opacity-100', 'dark:bg-surface', '!p-0', 'focus:ring-2', 'min-h-full', 'py-0.5']) {
      expect(isSafeClassToken(ok), ok).toBe(true);
    }
    for (const bad of ['bg-[url(https://evil)]', "content-['x']", '[mask-image:url(x)]', 'bg-[image:var(--x)]', 'w-[calc(100%-1px)]', 'a b', 'foo(', 'x\\y', 'bg-[attr(data-x)]', 'x'.repeat(90), 'Grid']) {
      expect(isSafeClassToken(bad), bad).toBe(false);
    }
    expect(safeClassTokens('grid  bg-[url(x)] gap-4')).toEqual(['grid', 'gap-4']);
  });

  it('compiles only the seen classes, prefixed and scoped, with brand tokens and dark variant; trips on url()', async () => {
    const tw = await createTailwind({ indexCss: read('index.css'), themeCss: read('theme.css'), utilitiesCss: read('utilities.css'), preflightCss: read('preflight.css') });
    expect(tw.add(['grid', 'grid-cols-3', 'bg-primary', 'text-primary-foreground', 'rounded-md', 'dark:bg-surface', 'bg-primary/50', 'hover:opacity-90', 'bg-[url(https://evil)]'])).toBe(true);
    const css = tw.css();
    expect(css).toMatch(/\.veneer-canvas \.v\\:grid\{/);
    expect(css).toMatch(/\.veneer-canvas \.v\\:grid-cols-3\{/);
    expect(css).toContain('var(--veneer-primary)');
    expect(css).toMatch(/veneer-dark/);
    expect(css).not.toMatch(/evil/);
    expect(css).not.toMatch(/url\s*\(/i);
    // theme variables and preflight land on the canvas root, never on the host page
    expect(css).toMatch(/\.veneer-canvas\{[^}]*--v-color-primary: var\(--veneer-primary\)/);
    expect(css).not.toMatch(/(^|\n)(html|body|:root|:host)\b/);
    expect(css).not.toMatch(/(^|\n)\*\s*[,{]/); // `*` preflight is `.veneer-canvas *`
    expect(css).not.toMatch(/@layer/); // flattened: our rules must not lose to unlayered host CSS
    expect(css).toMatch(/\.veneer-canvas \*, \.veneer-canvas ::after/);
    expect(tw.add(['grid'])).toBe(false); // nothing new
    expect(tw.add(['p-4'])).toBe(true);
    expect(tw.css()).toMatch(/\.v\\:p-4/);
  }, 30000);
});
