# veneer-sdk

**An MCP for in-app personalization.** Embed Veneer in your React app, register the
capabilities your app exposes, and let your end users redesign the page with AI — safely.

The AI has full creative freedom over the UI: it generates real component code. That code
runs in a **securely sandboxed iframe** whose only connection to your app is a message bridge
exposing exactly the capabilities you registered. The AI can invent any layout, but a generated
UI can only ever trigger actions you registered. No registered `deleteTask` ⇒ deleting is
impossible, by construction.

## Install

```bash
npm install veneer-sdk
# peer deps: react >= 18, react-dom >= 18
```

> Ships untranspiled JSX source. With Next.js add `transpilePackages: ['veneer-sdk']` to
> `next.config.js` (other bundlers transpile `node_modules` as needed).

## Usage

```jsx
'use client';
import { useState, useMemo } from 'react';
import { VeneerProvider, VeneerFrame, VeneerChat } from 'veneer-sdk';

const registry = {
  dataSources: [
    { id: 'tasks', description: "The user's tasks.", fields: [
      { name: 'id', type: 'string' },
      { name: 'title', type: 'string' },
      { name: 'status', type: '"todo" | "doing" | "done"' },
    ] },
  ],
  actions: [
    { id: 'createTask', description: 'Create a task.', args: [{ name: 'title', type: 'string', required: true }] },
    { id: 'updateTask', description: 'Update a task.', args: [{ name: 'id', type: 'string' }, { name: 'status', type: 'string' }] },
    // No deleteTask → generated UIs can never delete.
  ],
};

export default function Page() {
  const [tasks, setTasks] = useState([]);
  const actions = useMemo(() => ({
    createTask: ({ title }) => setTasks((p) => [...p, { id: crypto.randomUUID(), title, status: 'todo' }]),
    updateTask: ({ id, ...c }) => setTasks((p) => p.map((t) => (t.id === id ? { ...t, ...c } : t))),
  }), []);
  const data = useMemo(() => ({ tasks }), [tasks]);

  return (
    <VeneerProvider registry={registry} actions={actions} data={data}>
      <VeneerFrame style={{ height: 600 }} />
      <VeneerChat /> {/* POSTs to /api/veneer by default; override with endpoint="..." */}
    </VeneerProvider>
  );
}
```

You also implement the generator endpoint (`POST /api/veneer`) that calls your LLM and returns
`{ code, reply }`. See the `veneer-demo` app in this repo for a complete, runnable example.

## API

| Export | What it does |
| --- | --- |
| `VeneerProvider({ registry, actions, data, defaultUI })` | Holds the registry, the real action impls, and live data. Persists the current generated UI to `localStorage["veneer-ui"]`; exposes it + a setter via context. |
| `VeneerFrame` | Renders the sandboxed iframe, injects generated code + the in-frame runtime, and runs the parent-side bridge. Has an error boundary so a bad generation just shows “couldn’t render, try again”. |
| `VeneerChat({ endpoint })` | Floating “Talk with AI to change the look of this page” button + chat panel. Swaps in + persists returned UI; has “Reset to default”. |
| `VeneerLogo({ size, withWordmark })` | The product mark. |
| `useVeneer()` | Access `{ registry, actions, data, ui, setUi, reset }` inside the provider. |
| `runBridgeAction`, `readDataSource` | The validators the bridge uses; exported for testing. |

## The in-frame API (what generated code may call)

Generated code is plain JSX with these globals available (no imports): `React`, `useState`,
`useEffect`, `useMemo`, `useCallback`, `useRef`, `veneer`, `render`.

- `veneer.data(sourceId)` — read a registered data source (returns the current value).
- `veneer.action(id, args)` — trigger a registered action (returns a Promise).
- `render(<App/>)` — mount the component.

`fetch`, cookies, storage, and any external resource do **not** work inside the sandbox.

## Security model

- The iframe is `sandbox="allow-scripts"` with **no** `allow-same-origin` → opaque origin: no
  access to parent cookies, localStorage, or DOM. (Never combine `allow-scripts` with
  `allow-same-origin`.)
- A strict CSP sets `connect-src 'none'` (and `img/font 'none'`), so generated code cannot
  `fetch`, XHR, open a WebSocket, or load any external resource. All I/O is `postMessage` only.
- The parent **bridge** validates every `{ action, args }` message against the registry and runs
  the real implementation only if the action id is registered. Unregistered ids are rejected.

The result: even if generated code *tried* to delete via the network, the sandbox +
`connect-src 'none'` + bridge validation make it impossible.

## License

MIT
