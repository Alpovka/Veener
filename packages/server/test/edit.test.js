import { describe, it, expect, vi } from 'vitest';
import { runGeneration, applyEdits, classifyScope, createVeneerHandler } from '../src/index.js';

const registry = {
  dataSources: [{ id: 'tasks', fields: [{ name: 'id', type: 'string' }] }],
  actions: [{ id: 'createTask', args: [{ name: 'title', type: 'string', required: true }] }],
};

const CURRENT = `function VeneerUI() {
  const tasks = veneer.data('tasks');
  const [title, setTitle] = useState('');
  return (
    <div className="p-4">
      <h1 className="text-xl">Tasks ({tasks.length})</h1>
      <button onClick={() => veneer.action('createTask', { title: 'x' })}>Add</button>
    </div>
  );
}
render(<VeneerUI />);`;

const GOOD_EDIT = { search: `<button onClick={() => veneer.action('createTask', { title: 'x' })}>Add</button>`, replace: `<button className="text-xs" onClick={() => veneer.action('createTask', { title: 'x' })}>Add</button>` };
const BAD_EDIT = { search: '<button>Nope</button>', replace: '<button>Still nope</button>' };
const EDITED = CURRENT.replace(GOOD_EDIT.search, GOOD_EDIT.replace);

function req(body) {
  return new Request('http://host.test/api/veneer', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body) });
}

describe('classifyScope', () => {
  const ctx = { currentUI: CURRENT };
  it('reads small tweaks to the current UI as edits', () => {
    for (const m of ['make the add button collapsible', 'make the add button smaller', 'change the look of the header', 'hide the title', 'add a tooltip to the add button', 'rename Add to Create', 'make the cards rounder with a shadow', 'darker text please']) {
      expect(classifyScope(m, ctx), m).toBe('edit');
    }
  });
  it('reads new views and big changes as design', () => {
    for (const m of ['make it a kanban board', 'show a calendar by due date', 'redesign the whole page', 'turn this into a dashboard with charts', 'group the tasks by status in three columns', 'start over with a timeline view', 'sort by due date']) {
      expect(classifyScope(m, ctx), m).toBe('design');
    }
  });
  it('is design without a current UI, for undo/vague requests, and for long messages', () => {
    expect(classifyScope('make the button smaller', {})).toBe('design');
    expect(classifyScope('undo', ctx)).toBe('design');
    expect(classifyScope('make it better', ctx)).toBe('design');
    expect(classifyScope(Array(30).fill('smaller').join(' '), ctx)).toBe('design');
  });
});

describe('applyEdits', () => {
  it('applies exact, unique edits in order and can delete', () => {
    const r = applyEdits(CURRENT, [GOOD_EDIT, { search: `      <h1 className="text-xl">Tasks ({tasks.length})</h1>\n`, replace: '' }]);
    expect(r.ok).toBe(true);
    expect(r.code).toContain('className="text-xs"');
    expect(r.code).not.toContain('<h1');
  });
  it('tolerates re-indented search text', () => {
    const r = applyEdits(CURRENT, [{ search: `<h1 className="text-xl">Tasks ({tasks.length})</h1>\n<button onClick={() => veneer.action('createTask', { title: 'x' })}>Add</button>`, replace: '<p>gone</p>' }]);
    expect(r.ok).toBe(true);
    expect(r.code).toContain('      <p>gone</p>\n    </div>');
    expect(r.code).not.toContain('<h1');
  });
  it('refuses missing, ambiguous, empty and too many edits with actionable messages', () => {
    expect(applyEdits(CURRENT, [BAD_EDIT])).toMatchObject({ ok: false, error: expect.stringMatching(/edit 1: .*not found/) });
    expect(applyEdits(CURRENT + '\n' + CURRENT, [{ search: 'render(<VeneerUI />);', replace: '' }])).toMatchObject({ ok: false, error: expect.stringMatching(/more than once/) });
    expect(applyEdits(CURRENT, [{ search: '   ', replace: 'x' }])).toMatchObject({ ok: false, error: expect.stringMatching(/empty/) });
    expect(applyEdits(CURRENT, [])).toMatchObject({ ok: false });
    expect(applyEdits(CURRENT, Array(31).fill(GOOD_EDIT), { maxEdits: 30 })).toMatchObject({ ok: false, error: expect.stringMatching(/too many/) });
  });
});

describe('runGeneration edit mode', () => {
  const message = 'make the add button smaller';

  it('asks for edits, applies them, scans the result and reports mode/edited', async () => {
    const generate = vi.fn(async () => JSON.stringify({ intent: 'design', edits: [GOOD_EDIT], reply: 'Smaller button.' }));
    const out = await runGeneration({ registry, generate, message, currentUI: CURRENT });
    expect(out).toMatchObject({ code: EDITED, intent: 'design', reply: 'Smaller button.', mode: 'edit', edited: true });
    expect(generate).toHaveBeenCalledTimes(1);
    const call = generate.mock.calls[0][0];
    expect(call.mode).toBe('edit');
    expect(call.messages.at(-1).content).toMatch(/SMALL change/);
    expect(call.messages.at(-1).content).toContain(CURRENT);
  });

  it('gives the model one chance to fix edits that do not apply', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ intent: 'design', edits: [BAD_EDIT], reply: 'v1' }))
      .mockResolvedValueOnce(JSON.stringify({ intent: 'design', edits: [GOOD_EDIT], reply: 'v2' }));
    const out = await runGeneration({ registry, generate, message, currentUI: CURRENT });
    expect(out).toMatchObject({ code: EDITED, mode: 'edit', edited: true, reply: 'v2' });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][0].mode).toBe('edit');
    expect(generate.mock.calls[1][0].messages.at(-1).content).toMatch(/could not be applied: edit 1/);
  });

  it('falls back to a full design generation when the edits fail twice', async () => {
    const FULL = 'render(<div>{veneer.data("tasks").length}</div>)';
    const generate = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ intent: 'design', edits: [BAD_EDIT], reply: 'v1' }))
      .mockResolvedValueOnce(JSON.stringify({ intent: 'design', edits: [BAD_EDIT], reply: 'v2' }))
      .mockResolvedValueOnce(JSON.stringify({ intent: 'design', code: FULL, reply: 'full' }));
    const out = await runGeneration({ registry, generate, message, currentUI: CURRENT });
    expect(out).toMatchObject({ code: FULL, mode: 'design', edited: false, reply: 'full' });
    expect(generate).toHaveBeenCalledTimes(3);
    expect(generate.mock.calls[2][0].mode).toBe('design');
    expect(generate.mock.calls[2][0].messages.at(-1).content).not.toMatch(/SMALL change/);
  });

  it('accepts full code from the model in edit mode (it judged the change too large)', async () => {
    const FULL = 'render(<div>{veneer.data("tasks").length}</div>)';
    const generate = vi.fn(async () => JSON.stringify({ intent: 'design', code: FULL, reply: 'rewrote' }));
    const out = await runGeneration({ registry, generate, message, currentUI: CURRENT });
    expect(out).toMatchObject({ code: FULL, mode: 'edit', edited: false });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('still runs the intent gate: a chat reply in edit mode changes nothing', async () => {
    const generate = vi.fn(async () => JSON.stringify({ intent: 'chat', code: null, reply: 'Looks fine to me.' }));
    const out = await runGeneration({ registry, generate, message: 'what do you think of the button size?', currentUI: CURRENT });
    expect(out).toMatchObject({ code: null, intent: 'chat', reply: 'Looks fine to me.' });
  });

  it('scans edited code like generated code and repairs through the normal loop', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ intent: 'design', edits: [{ search: "const [title, setTitle] = useState('');", replace: 'const w = window.innerWidth;' }], reply: 'v1' }))
      .mockResolvedValueOnce(JSON.stringify({ code: EDITED, reply: 'fixed' }));
    const out = await runGeneration({ registry, generate, message, currentUI: CURRENT });
    expect(out).toMatchObject({ code: EDITED, repaired: true, mode: 'edit' });
    expect(generate.mock.calls[1][0].messages.at(-1).content).toMatch(/rejected by the sandbox/);
  });

  it('uses design mode for new views, first UIs, and when editMode is off', async () => {
    const FULL = 'render(<div>{veneer.data("tasks").length}</div>)';
    const generate = vi.fn(async () => JSON.stringify({ intent: 'design', code: FULL, reply: 'ok' }));
    await runGeneration({ registry, generate, message: 'make it a kanban board', currentUI: CURRENT });
    await runGeneration({ registry, generate, message, currentUI: '' });
    await runGeneration({ registry, generate, message, currentUI: CURRENT, editMode: false });
    for (const c of generate.mock.calls) {
      expect(c[0].mode).toBe('design');
      expect(c[0].messages.at(-1).content).not.toMatch(/SMALL change/);
    }
  });

  it('is wired through createVeneerHandler with editMode and mode in the response', async () => {
    const generate = vi.fn(async ({ mode }) => (mode === 'edit' ? JSON.stringify({ intent: 'design', edits: [GOOD_EDIT], reply: 'e' }) : JSON.stringify({ intent: 'design', code: 'render(<i/>)', reply: 'd' })));
    const h = createVeneerHandler({ registry, generate, license: false, rateLimit: false });
    const body = await (await h(req({ message, currentUI: CURRENT }))).json();
    expect(body).toMatchObject({ code: EDITED, mode: 'edit', edited: true, token: 'dev' });
    const off = createVeneerHandler({ registry, generate, license: false, rateLimit: false, editMode: false });
    const body2 = await (await off(req({ message, currentUI: CURRENT }))).json();
    expect(body2).toMatchObject({ code: 'render(<i/>)', mode: 'design' });
  });
});
