import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VeneerProvider, VeneerFrame, useVeneer } from '../../src/index.js';

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
  async function add() { const t = await veneer.action('createTask', { title: 'new ' + tasks.length }); setLast(t ? t.id : 'undefined'); }
  return (
    <div>
      <div id="count">{tasks.length}</div>
      <div id="last">{last}</div>
      <button id="add" onClick={add}>add</button>
      <button id="bad" onClick={() => veneer.action('archiveTask', { id: 42 }).catch((e) => setLast('rejected: ' + e.message))}>bad args</button>
      <form id="form" onSubmit={(e) => { e.preventDefault(); setLast('submitted'); }}><button id="submit" type="submit">submit</button></form>
      <a id="link" href="/steal?via=anchor">link</a>
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
  const mode = params.get('mode') || 'srcdoc';
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
  return (
    <VeneerProvider
      registry={registry}
      actions={actions}
      data={data}
      defaultUI={DEFAULT_UI}
      persist="memory"
      onSecurityViolation={(v) => window.__events.push({ kind: 'violation', reason: v.reason })}
    >
      <Probe />
      <VeneerFrame
        frameSrc={mode === 'url' ? '/veneer-frame' : undefined}
        heartbeatMs={500}
        maxMissedHeartbeats={3}
        style={{ height: 300 }}
        onError={(e) => window.__events.push({ kind: 'error', ...e })}
        onSecurityViolation={(v) => window.__events.push({ kind: 'frame-violation', reason: v.reason })}
      />
      <iframe id="sibling" title="sibling" sandbox="allow-scripts" srcDoc="<script>window.addEventListener('message', (e) => { if (e.data && e.data.go) { const ch = new MessageChannel(); parent.frames[0].postMessage({ source: 'veneer-host', type: 'init', v: 2, code: 'render(React.createElement(\'div\', {id: \'pwned\'}, \'pwned\'))', data: {}, actionIds: [], dataIds: [] }, '*', [ch.port2]); parent.postMessage({ siblingDone: true }, '*'); } });</script>" />
    </VeneerProvider>
  );
}

createRoot(document.getElementById('app')).render(<App />);
