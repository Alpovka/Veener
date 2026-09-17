// The Veneer registry for this demo app: what the AI is allowed to see and do.
// Note there is NO deleteTask action — so the bridge will refuse any attempt to delete a task.
// `returns` marks the actions whose return value generated code may see; the rest resolve undefined.

export const registry = {
  dataSources: [
    {
      id: 'tasks',
      description: "The current user's tasks.",
      fields: [
        { name: 'id', type: 'string' },
        { name: 'title', type: 'string' },
        { name: 'status', type: 'enum: "todo" | "doing" | "done"' },
        { name: 'dueDate', type: 'string (YYYY-MM-DD) or null' },
      ],
    },
  ],
  actions: [
    {
      id: 'createTask',
      description: 'Create a new task.',
      returns: 'The created task.',
      args: [
        { name: 'title', type: 'string', required: true },
        { name: 'status', type: '"todo" | "doing" | "done"', required: false, default: 'todo' },
        { name: 'dueDate', type: 'string (YYYY-MM-DD)', required: false },
      ],
    },
    {
      id: 'updateTask',
      description: "Update a task's fields, e.g. change its status or due date.",
      args: [
        { name: 'id', type: 'string', required: true },
        { name: 'title', type: 'string', required: false },
        { name: 'status', type: '"todo" | "doing" | "done"', required: false },
        { name: 'dueDate', type: 'string (YYYY-MM-DD)', required: false },
      ],
    },
    {
      id: 'archiveTask',
      description: 'Archive a task (remove it from the list).',
      args: [{ name: 'id', type: 'string', required: true }],
    },
  ],
};

// The demo brand, handed to <VeneerProvider theme>. Generated UIs and the chat widget use these
// tokens (bg-primary, text-foreground, rounded-md, …) instead of hardcoded colours, and follow
// the site's light/dark toggle. Inter ships from /public/fonts and is inlined into the sandbox.
export const theme = {
  colors: {
    primary: '#4f46e5',
    primaryForeground: '#ffffff',
    accent: '#7c3aed',
    background: { light: '#ffffff', dark: '#0b1020' },
    surface: { light: '#f8fafc', dark: '#111a2e' },
    border: { light: '#e2e8f0', dark: '#243047' },
    foreground: { light: '#0f172a', dark: '#e2e8f0' },
    muted: { light: '#64748b', dark: '#94a3b8' },
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#e11d48',
  },
  radius: { sm: '8px', md: '12px', lg: '18px', full: '9999px' },
  font: { sans: 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif', size: '14px' },
  fonts: [
    { family: 'Inter', src: '/fonts/inter-latin-400-normal.woff2', weight: '400' },
    { family: 'Inter', src: '/fonts/inter-latin-600-normal.woff2', weight: '600' },
    { family: 'Inter', src: '/fonts/inter-latin-700-normal.woff2', weight: '700' },
  ],
};

export const initialTasks = [
  { id: 't1', title: 'Draft the investor update', status: 'doing', dueDate: '2026-06-18' },
  { id: 't2', title: 'Review pull requests', status: 'todo', dueDate: '2026-06-17' },
  { id: 't3', title: 'Ship the onboarding flow', status: 'todo', dueDate: '2026-06-22' },
  { id: 't4', title: 'Fix the billing webhook', status: 'done', dueDate: '2026-06-15' },
  { id: 't5', title: 'Plan Q3 roadmap', status: 'todo', dueDate: '2026-06-30' },
  { id: 't6', title: 'Record product demo', status: 'doing', dueDate: '2026-06-20' },
];

// The default view, rendered inside the same sandbox as any generated UI.
// "Reset to default" reverts to this. It demonstrates the full bridge working out of the box.
export const defaultUI = `function VeneerUI() {
  const tasks = veneer.data('tasks') || [];
  const [title, setTitle] = useState('');
  const today = new Date().toISOString().slice(0, 10);

  const columns = [
    { key: 'todo', label: 'To do', dot: 'bg-slate-400' },
    { key: 'doing', label: 'In progress', dot: 'bg-amber-400' },
    { key: 'done', label: 'Done', dot: 'bg-emerald-400' },
  ];
  const inCol = function (k) { return tasks.filter(function (t) { return t.status === k; }); };
  const doneCount = inCol('done').length;
  const pct = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;
  const overdue = tasks.filter(function (t) {
    return t.dueDate && t.dueDate < today && t.status !== 'done';
  }).length;

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const fmt = function (d) {
    if (!d) return '';
    const p = d.split('-');
    return months[parseInt(p[1], 10) - 1] + ' ' + parseInt(p[2], 10);
  };

  async function add() {
    const t = title.trim();
    if (!t) return;
    await veneer.action('createTask', { title: t, status: 'todo' });
    setTitle('');
  }

  const stats = [
    { label: 'Open', value: tasks.length - doneCount, tone: 'text-foreground' },
    { label: 'In progress', value: inCol('doing').length, tone: 'text-amber-600' },
    { label: 'Done', value: doneCount, tone: 'text-emerald-600' },
    { label: 'Overdue', value: overdue, tone: overdue ? 'text-danger' : 'text-muted' },
  ];

  return (
    <div className="min-h-full bg-background p-5 font-sans text-foreground sm:p-7">
      <div className="mx-auto max-w-4xl">
        {/* Header + quick add */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">Workspace</div>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-foreground">Product Sprint</h1>
            <p className="mt-0.5 text-sm text-muted">Week of {fmt(today)} · {tasks.length} active tasks</p>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder="Add a task…"
              className="w-full rounded-md border border-border bg-surface px-4 py-2.5 text-sm text-foreground shadow-sm outline-none focus:ring-2 focus:ring-primary sm:w-64"
            />
            <button onClick={add} className="shrink-0 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90">
              Add
            </button>
          </div>
        </div>

        {/* Stat cards */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border border-border bg-surface p-4 shadow-sm">
              <div className={'text-2xl font-bold tracking-tight ' + s.tone}>{s.value}</div>
              <div className="mt-0.5 text-xs font-medium text-muted">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Completion bar */}
        <div className="mt-5 rounded-lg border border-border bg-surface p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted">
            <span>Sprint completion</span>
            <span className="text-foreground">{pct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-background ring-1 ring-border">
            <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: pct + '%' }} />
          </div>
        </div>

        {/* Board */}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {columns.map((col) => (
            <div key={col.key} className="rounded-lg border border-border bg-surface p-3">
              <div className="mb-3 flex items-center justify-between px-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <span className={'h-2 w-2 rounded-full ' + col.dot} />
                  {col.label}
                </div>
                <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted shadow-sm">
                  {inCol(col.key).length}
                </span>
              </div>
              <div className="space-y-2.5">
                {inCol(col.key).map((t) => {
                  const isOverdue = t.dueDate && t.dueDate < today && t.status !== 'done';
                  return (
                    <div key={t.id} className="group rounded-md border border-border bg-background p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-medium leading-snug text-foreground">{t.title}</div>
                        <button
                          onClick={() => veneer.action('archiveTask', { id: t.id })}
                          className="shrink-0 text-muted opacity-0 transition hover:text-danger group-hover:opacity-100"
                          title="Archive"
                        >
                          ✕
                        </button>
                      </div>
                      {t.dueDate && (
                        <div className={'mt-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ' + (isOverdue ? 'bg-rose-50 text-danger' : 'bg-surface text-muted')}>
                          {isOverdue ? 'Overdue · ' : 'Due '}{fmt(t.dueDate)}
                        </div>
                      )}
                      <div className="mt-2.5 flex flex-wrap gap-1">
                        {columns.map((c) => (
                          <button
                            key={c.key}
                            onClick={() => veneer.action('updateTask', { id: t.id, status: c.key })}
                            className={'rounded-md px-2 py-1 text-[11px] font-medium transition ' + (t.status === c.key ? 'bg-primary text-primary-foreground' : 'bg-surface text-muted hover:text-foreground')}
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {inCol(col.key).length === 0 && (
                  <div className="rounded-md border border-dashed border-border py-6 text-center text-xs text-muted">
                    Nothing here yet
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
render(<VeneerUI />);`;
