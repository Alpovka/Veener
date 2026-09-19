// State carry-over and browser-API shims, exercised in a real QuickJS instance (Node wasm variant).
import { describe, it, expect, beforeAll } from 'vitest';
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
import nodeVariant from '@jitl/quickjs-wasmfile-release-sync';
import { createBox, mergeLimits, LIMITS } from '../src/engine/vm.js';

const here = dirname(fileURLToPath(import.meta.url));
let QuickJS;
let guest;

beforeAll(async () => {
  QuickJS = await newQuickJSWASMModuleFromVariant(nodeVariant);
  const out = await build({ entryPoints: [resolve(here, '../src/engine/guest.js')], bundle: true, write: false, format: 'iife', target: ['es2020'], platform: 'neutral', mainFields: ['module', 'main'], logLevel: 'silent' });
  guest = out.outputFiles[0].text;
}, 60000);

function mkBox(code, cfg = {}) {
  const io = { posts: [], logs: [], timers: new Map() };
  io.post = (s) => io.posts.push(JSON.parse(s));
  io.log = (level, text) => io.logs.push({ level, text });
  io.schedule = (id, ms) => io.timers.set(id, ms);
  io.unschedule = (id) => io.timers.delete(id);
  io.now = () => performance.now();
  const box = createBox(QuickJS, guest, io);
  expect(box.boot().error).toBeUndefined();
  expect(box.configure({ actionIds: ['createTask'], dataIds: ['tasks'], data: { tasks: [{ id: 't1', title: 'A' }] }, ...cfg }).error).toBeUndefined();
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
const texts = (ops) => ops.filter((o) => (o.t === 'ins' && o.text !== undefined) || o.t === 'txt').map((o) => o.text);

const APP = `
function VeneerUI() {
  const [title, setTitle] = useState('');
  const [n, setN] = useState(0);
  const [open, setOpen] = useState(() => true);
  return (
    <div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} />
      <span id="echo">{title}</span>
      <span id="n">{String(n)}</span>
      <span id="open">{String(open)}</span>
      <button onClick={() => { setN(n + 1); setOpen(false); }}>go</button>
    </div>
  );
}
render(<VeneerUI />);
`;

describe('state carry-over', () => {
  it('snapshots live useState values keyed by component and hook index', () => {
    const { box } = mkBox(APP);
    const first = flush(box);
    const input = first.ops.find((o) => o.t === 'ins' && o.tag === 'input');
    const button = first.ops.find((o) => o.t === 'ins' && o.tag === 'button');
    expect(box.dispatch(input.id, 'input', { value: 'hello' }).error).toBeUndefined();
    expect(box.dispatch(button.id, 'click', {}).error).toBeUndefined();
    flush(box);
    const snap = box.snapshot();
    expect(snap.error).toBeUndefined();
    const state = JSON.parse(snap.state);
    expect(state).toEqual({ 'VeneerUI#0': 'hello', 'VeneerUI#1': 1, 'VeneerUI#2': false });
    box.dispose();
  });

  it('restores carried values as initial state in a fresh box (same code)', () => {
    const { box } = mkBox(APP, { restore: { 'VeneerUI#0': 'hello', 'VeneerUI#1': 7, 'VeneerUI#2': false } });
    const t = texts(flush(box).ops);
    expect(t).toContain('hello');
    expect(t).toContain('7');
    expect(t).toContain('false');
    box.dispose();
  });

  it('ignores carried values whose type does not match the code\'s initial value (hook order changed)', () => {
    const { box } = mkBox(APP, { restore: { 'VeneerUI#0': 42, 'VeneerUI#1': 'text', 'VeneerUI#2': 'nope' } });
    const t = texts(flush(box).ops);
    expect(t).not.toContain('42');
    expect(t).toContain('0');
    expect(t).toContain('true'); // lazy initialiser is run once and its type (boolean) rejects the carried string
    expect(t).not.toContain('nope');
    box.dispose();
  });

  it('survives an edit that changes markup but not hook order', () => {
    const edited = APP.replace('<button onClick', '<button className="text-xs" onClick').replace('>go<', '>Go!<');
    const { box } = mkBox(edited, { restore: { 'VeneerUI#0': 'kept', 'VeneerUI#1': 3, 'VeneerUI#2': true } });
    const t = texts(flush(box).ops);
    expect(t).toContain('kept');
    expect(t).toContain('3');
    expect(t).toContain('Go!');
    box.dispose();
  });

  it('keys instances of the same component apart by vnode key', () => {
    const code = `
      function Row({ id }) { const [v, setV] = useState('init-' + id); return <li id={id} onClick={() => setV('clicked-' + id)}>{v}</li>; }
      function VeneerUI() { return <ul>{['a', 'b'].map((id) => <Row key={id} id={id} />)}</ul>; }
      render(<VeneerUI />);`;
    const { box } = mkBox(code);
    const first = flush(box);
    const lis = first.ops.filter((o) => o.t === 'ins' && o.tag === 'li');
    box.dispatch(lis[1].id, 'click', {});
    flush(box);
    const state = JSON.parse(box.snapshot().state);
    expect(state).toEqual({ 'Row@a#0': 'init-a', 'Row@b#0': 'clicked-b' });
    box.dispose();
  });
});

describe('browser-API shims', () => {
  it('observers, matchMedia, getComputedStyle, requestIdleCallback and DOM constructors exist and are inert', () => {
    const code = `
      function VeneerUI() {
        const ref = useRef(null);
        const [info, setInfo] = useState('');
        useEffect(() => {
          const ro = new ResizeObserver(() => {}); ro.observe(ref.current); ro.disconnect();
          const io = new IntersectionObserver(() => {}); io.observe(ref.current);
          const mq = matchMedia('(min-width: 640px)'); mq.addEventListener('change', () => {});
          const cs = getComputedStyle(ref.current);
          requestIdleCallback(() => {});
          const el = ref.current;
          setInfo([mq.matches, typeof cs.getPropertyValue, el instanceof HTMLElement, el instanceof Node, typeof el.getBoundingClientRect().width, typeof navigator.clipboard.writeText].join(','));
        }, []);
        return <div ref={ref} style={{ color: 'red' }}>{info}</div>;
      }
      render(<VeneerUI />);`;
    const { box, io } = mkBox(code);
    flush(box);
    // useEffect runs on Preact's rAF → our timer shim: fire whatever is scheduled.
    for (const id of [...io.timers.keys()]) box.fireTimer(id);
    const t = texts(flush(box).ops);
    expect(t).toContain('false,function,true,true,number,function');
    box.dispose();
  });

  it('mergeLimits clamps host overrides and keeps the rest', () => {
    expect(mergeLimits({ entryMs: 1000, initialEvalMs: 99999, memoryMB: 1, maxOpsPerFlush: 5 })).toMatchObject({ entryMs: 1000, initialEvalMs: 10000, memoryBytes: 16 * 1024 * 1024, maxOpsPerFlush: 1000, bootMs: LIMITS.bootMs, stackBytes: LIMITS.stackBytes });
    expect(mergeLimits(undefined)).toEqual(LIMITS);
    expect(mergeLimits({ entryMs: 'x' }).entryMs).toBe(LIMITS.entryMs);
  });
});
