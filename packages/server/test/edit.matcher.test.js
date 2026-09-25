import { describe, it, expect } from 'vitest';
import { applyEdits, classifyScope, buildSystemPrompt } from '../src/index.js';

const CURRENT = `function VeneerUI() {
  const tasks = veneer.data('tasks');
  return (
    <div className="p-4 grid gap-2">
      <button className="text-sm" onClick={() => veneer.action('createTask', { title: 'x' })}>Add task</button>
    </div>
  );
}
render(<VeneerUI />);`;

describe('applyEdits: whitespace- and quote-tolerant matching', () => {
  it('matches a line the model re-spaced', () => {
    const r = applyEdits(CURRENT, [{ search: `<button className="text-sm"  onClick={ () => veneer.action('createTask', { title: 'x' }) }>Add task</button>`, replace: '<button>Go</button>' }]);
    expect(r.ok).toBe(true);
    expect(r.code).toContain('      <button>Go</button>\n');
    expect(r.code).not.toContain('Add task');
  });
  it('matches when the model switched quote style', () => {
    const r = applyEdits(CURRENT, [{ search: `const tasks = veneer.data("tasks");`, replace: `const tasks = veneer.data('tasks') || [];` }]);
    expect(r.ok).toBe(true);
    expect(r.code).toContain("veneer.data('tasks') || [];");
  });
  it('still refuses ambiguous or very short loose matches', () => {
    const twice = CURRENT + '\n' + CURRENT;
    expect(applyEdits(twice, [{ search: 'const  tasks = veneer.data("tasks");', replace: '' }])).toMatchObject({ ok: false, error: expect.stringMatching(/more than once/) });
    expect(applyEdits(CURRENT, [{ search: '<b>', replace: '' }])).toMatchObject({ ok: false, error: expect.stringMatching(/not found/) });
  });
});

describe('classifyScope: short change requests without a tweak word', () => {
  const ctx = { currentUI: CURRENT };
  it('tries edit mode for short change requests the model can still answer with full code', () => {
    expect(classifyScope('show the tasks as a list', ctx)).toBe('edit');
    expect(classifyScope('put the count next to the name', ctx)).toBe('edit');
  });
  it('keeps design for multi-part requests, long requests and new views', () => {
    expect(classifyScope('show the tasks as a list with a header, a search box, a status filter, an owner filter and a footer with totals', ctx)).toBe('design');
    expect(classifyScope('add a header and a footer and a sidebar', ctx)).toBe('design');
    expect(classifyScope('show the tasks as a kanban board', ctx)).toBe('design');
    expect(classifyScope('make the header blue and the footer smaller', ctx)).toBe('edit'); // two parts is still a tweak
  });
});

describe('buildSystemPrompt: media policy', () => {
  const registry = { dataSources: [], actions: [] };
  it('tells the model that images and links are not available by default', () => {
    const p = buildSystemPrompt(registry);
    expect(p).toMatch(/No images/);
    expect(p).toMatch(/No links/);
  });
  it('describes the allowed sources when the host allows them', () => {
    const p = buildSystemPrompt(registry, { allow: { images: ['same-origin', 'https://cdn.example.com/'], links: ['https:'] } });
    expect(p).toMatch(/<img src alt> IS allowed/);
    expect(p).toContain('https://cdn.example.com/');
    expect(p).toMatch(/own origin/);
    expect(p).toMatch(/<a href> IS allowed, but ONLY to: any https URL/);
  });
});
