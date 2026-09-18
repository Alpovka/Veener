// Harness for the worker engine: the same registry/actions as host.jsx, rendered through
// <VeneerCanvas> (no iframe). Generated UI lands in THIS document, so tests query the page DOM.
import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VeneerProvider, VeneerCanvas, useVeneer, hasWarmWorker } from '../../src/index.js';

window.__veneerWarm = () => hasWarmWorker();

const registry = {
  dataSources: [{ id: 'tasks', description: 'Tasks', fields: [{ name: 'id', type: 'string' }, { name: 'title', type: 'string' }] }],
  actions: [
    { id: 'createTask', description: 'Create', returns: 'The task.', args: [{ name: 'title', type: 'string', required: true }] },
    { id: 'archiveTask', description: 'Archive', args: [{ name: 'id', type: 'string', required: true }] },
  ],
};

export const DEFAULT_UI = `function VeneerUI() {
  const tasks = veneer.data('tasks');
  const [last, setLast] = useState('');
  const [title, setTitle] = useState('');
  async function add() { const t = await veneer.action('createTask', { title: 'new ' + tasks.length }); setLast(t ? t.id : 'undefined'); }
  return (
    <div className="p-4 grid gap-2">
      <div id="count" className="text-2xl font-bold">{tasks.length}</div>
      <div id="brand" className="bg-primary text-primary-foreground rounded-md p-2 dark:bg-accent">brand</div>
      <div id="last">{last}</div>
      <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="type" className="border rounded-md" />
      <span id="echo">{title}</span>
      <button id="add" onClick={add}>add</button>
      <button id="bad" onClick={() => veneer.action('archiveTask', { id: 42 }).catch((e) => setLast('rejected: ' + e.message))}>bad args</button>
      <button id="del" onClick={() => veneer.action('deleteTask', { id: 't1' }).then(() => setLast('ran'), (e) => setLast('rejected: ' + e.message))}>delete</button>
      <button id="globals" onClick={() => setLast([typeof fetch, typeof location, typeof window, typeof document.cookie, typeof XMLHttpRequest, typeof WebAssembly, typeof importScripts].join(','))}>globals</button>
      <form id="form" onSubmit={(e) => { e.preventDefault(); setLast('submitted'); }}><button id="submit" type="submit">submit</button></form>
      <a id="link" href="/steal?via=anchor">link text</a>
      <img id="img" src="/steal?via=img" alt="x" />
      <div id="sty" style={{ backgroundImage: 'url(/steal?via=css)', color: 'rgb(1, 2, 3)', position: 'fixed', zIndex: 99999 }}>styled</div>
      <div id="cls" className="bg-[url(/steal?via=class)] text-[11px]">cls</div>
      <ul>{tasks.map((t) => <li key={t.id} className="task">{t.title}</li>)}</ul>
    </div>
  );
}
render(<VeneerUI />);`;

function Probe() {
  const ctx = useVeneer();
  window.__veneer = ctx;
  return <pre id="state">{JSON.stringify({ ui: ctx.ui.slice(0, 40), generation: ctx.generation, violation: ctx.violation && ctx.violation.reason })}</pre>;
}

function App() {
  const params = new URLSearchParams(location.search);
  const dark = params.get('dark') === '1';
  const theme = {
    mode: dark ? 'dark' : 'light',
    colors: { primary: '#0f766e', primaryForeground: '#ffffff', accent: '#7c3aed', background: { light: '#fffdf7', dark: '#101418' } },
    radius: { md: '2px' },
    font: { sans: 'Georgia, serif' },
  };
  const [tasks, setTasks] = useState([{ id: 't1', title: 'one' }]);
  const actions = useMemo(
    () => ({
      createTask: ({ title }) => {
        const t = { id: 't' + Math.random().toString(36).slice(2, 8), title };
        setTasks((p) => [...p, t]);
        return t;
      },
      archiveTask: ({ id }) => setTasks((p) => p.filter((t) => t.id !== id)),
      deleteTask: () => {
        window.__deleted = true;
      },
    }),
    []
  );
  const data = useMemo(() => ({ tasks, secrets: ['do-not-leak'] }), [tasks]);
  window.__events = window.__events || [];
  window.__logs = window.__logs || [];
  return (
    <VeneerProvider registry={registry} actions={actions} data={data} defaultUI={DEFAULT_UI} persist="memory" theme={theme} onSecurityViolation={(v) => window.__events.push({ kind: 'violation', reason: v.reason })}>
      <Probe />
      <div id="host-h1-probe">
        <h1 id="host-h1">host heading</h1>
      </div>
      <VeneerCanvas
        heartbeatMs={500}
        maxMissedHeartbeats={4}
        minHeight={40}
        onError={(e) => window.__events.push({ kind: 'error', type: e.type, errKind: e.kind, stage: e.stage, message: e.message })}
        onLog={(level, text) => window.__logs.push({ level, text })}
        onSecurityViolation={(v) => window.__events.push({ kind: 'canvas-violation', reason: v.reason })}
      />
    </VeneerProvider>
  );
}

createRoot(document.getElementById('app')).render(<App />);
