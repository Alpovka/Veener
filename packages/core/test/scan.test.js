import { describe, it, expect } from 'vitest';
import * as parser from '@babel/parser';
import traverseNs from '@babel/traverse';
import * as Babel from '@babel/standalone';
import { createScanner, registryIds } from '../src/scan.js';

const traverse = typeof traverseNs === 'function' ? traverseNs : traverseNs.default;
const scan = createScanner(parser, traverse);
const ids = registryIds({ dataSources: [{ id: 'tasks' }], actions: [{ id: 'createTask' }, { id: 'updateTask' }] });

const GOOD = `
function VeneerUI() {
  const tasks = veneer.data('tasks') || [];
  const [title, setTitle] = useState('');
  const location = 'Berlin'; // a local named like a global is fine
  const byStatus = useMemo(() => tasks.reduce((acc, t) => { (acc[t.status] ||= []).push(t); return acc; }, {}), [tasks]);
  async function add() { await veneer.action('createTask', { title }); setTitle(''); }
  return (
    <div className="top-0 p-4">
      <form onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </form>
      <p>Choose a location. Your window into the parent company.</p>
      {tasks.map((t) => <div key={t.id} onClick={() => veneer.action('updateTask', { id: t.id, status: 'done' })}>{t.title} {t.location} {t.parentId}</div>)}
      <span>{location}</span>
    </div>
  );
}
render(<VeneerUI />);
`;

describe('scanner (server flavour)', () => {
  it('accepts well-behaved generated code, including shadowed names and JSX text', () => {
    expect(scan(GOOD, ids)).toEqual({ ok: true, violations: [] });
  });
  it('reports syntax errors', () => {
    expect(scan('function (', ids).violations[0]).toMatch(/syntax error/);
    expect(scan(42, ids).ok).toBe(false);
  });
  const cases = [
    ['location.href = "https://evil"', /global `location`/],
    ['window.top.location = 1', /global `window`/],
    ['document.cookie', /global `document`/],
    ['fetch("https://x")', /global `fetch`/],
    ['new XMLHttpRequest()', /global `XMLHttpRequest`/],
    ['new WebSocket("wss://x")', /global `WebSocket`/],
    ['globalThis.x', /global `globalThis`/],
    ['parent.postMessage(1, "*")', /global `parent`/],
    ['top.frames[0]', /global `top`/],
    ['eval("1")', /global `eval`/],
    ['Function("return 1")()', /global `Function`/],
    ['const f = function () { return this; }', /`this` is not allowed/],
    ['import x from "y"', /import is not allowed|syntax error/],
    ['import("https://unpkg.com/x")', /dynamic import/],
    ['export const a = 1', /export is not allowed|syntax error/],
    ['({}).constructor.constructor("return 1")()', /`.constructor`/],
    ['const o = {}; o["__proto__"].x = 1', /`.__proto__`/],
    ['render(<div dangerouslySetInnerHTML={{ __html: "x" }} />)', /dangerouslySetInnerHTML/],
    ['render(<a href="javascript:alert(1)">x</a>)', /javascript:/],
    ['render(<iframe srcDoc="x" />)', /srcDoc/],
    ['render(<meta httpEquiv="refresh" content="0;url=https://e" />)', /httpEquiv/],
    ['veneer.action("deleteTask", { id: 1 })', /"deleteTask"\) is not a registered action/],
    ['veneer.data("secrets")', /"secrets"\) is not a registered data source/],
    ['const id = "createTask"; veneer.action(id, {})', /requires a string-literal id/],
    ['veneer.action(`create${"Task"}`, {})', /requires a string-literal id/],
    ['veneer["ac" + "tion"]("createTask")', /only veneer.action and veneer.data/],
    ['veneer.secret', /only veneer.action and veneer.data/],
    ['debugger', /debugger/],
    ['setTimeout("location.href=1", 0)', /setTimeout\(\) requires a function/],
    ['setInterval(`x`, 10)', /setInterval\(\) requires a function/],
    ['render(React.createElement("div", { dangerouslySetInnerHTML: { __html: "x" } }))', /property `dangerouslySetInnerHTML`/],
    ['render(React.createElement("meta", { httpEquiv: "refresh", content: "0;url=x" }))', /property `httpEquiv`/],
    ['render(React.createElement("meta", { "http-equiv": "refresh" }))', /property `http-equiv`/],
    ['const m = import.meta', /import.meta/],
  ];
  it.each(cases)('rejects %s', (code, re) => {
    const r = scan(code, ids);
    expect(r.ok).toBe(false);
    expect(r.violations.join('\n')).toMatch(re);
  });
  it('accepts function-argument timers', () => {
    expect(scan('useEffect(() => { const t = setTimeout(() => {}, 10); const i = setInterval(tick, 10); function tick(){}; return () => { clearTimeout(t); clearInterval(i); }; }, [])', ids).ok).toBe(true);
  });
  it('accepts template literal ids without expressions', () => {
    expect(scan('veneer.action(`createTask`, {})', ids).ok).toBe(true);
  });
  it('blocks computed keys that build a string, allows numeric indexing and plain lookups', () => {
    const blocked = [
      "o['con' + 'structor']",
      'o[`${a}structor`]',
      "o[['c', 'onstructor'].join('')]",
      "o[String.fromCharCode(99)]",
      "o[atob('Y29uc3RydWN0b3I=')]",
      "o[s.replace('x', '')]",
      "o[dark ? 'con' + x : 'y']",
      "o[k || 'pro' + 'to']",
    ];
    for (const src of blocked) expect(scan(`const r = ${src};`, ids).violations.join('\n'), src).toMatch(/constructed key/);
    const allowed = [
      "months[parseInt(p[1], 10) - 1]",
      'arr[i + 1]',
      'arr[i % 3]',
      'arr[Math.min(i, 3)]',
      "tone[dark ? 'dark' : 'light']",
      "map[key || 'todo']",
      'map[key]',
      "map['todo']",
      'rows[row.id]',
      'cells[n]',
    ];
    for (const src of allowed) expect(scan(`const r = ${src};`, ids).violations.join('\n'), src).not.toMatch(/constructed key/);
  });

  it("accepts the demo's default UI (a regression the frame would otherwise refuse on every load)", async () => {
    const { defaultUI, registry } = await import('../../../examples/demo/app/veneer.config.js');
    expect(scan(defaultUI, registryIds(registry))).toEqual({ ok: true, violations: [] });
  });

  it('does not flag property names that look like globals', () => {
    expect(scan('const t = veneer.data("tasks"); const x = t.window + t.location + t.fetch; render(<b>{x}</b>)', ids).ok).toBe(true);
  });
});

describe('scanner (in-frame flavour via Function.prototype.toString + Babel standalone)', () => {
  it('is self-contained and behaves identically', () => {
    const src = createScanner.toString();
    const factory = new Function('return (' + src + ')')();
    const scan2 = factory(Babel.packages.parser, Babel.packages.traverse.default || Babel.packages.traverse);
    expect(scan2(GOOD, ids).ok).toBe(true);
    expect(scan2('location.href = 1', ids).violations[0]).toMatch(/global `location`/);
    expect(scan2('veneer.action("deleteTask")', ids).ok).toBe(false);
  });
});
