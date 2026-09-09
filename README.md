<h1 align="center">Veneer</h1>

<p align="center"><em>An MCP for in-app personalization.</em><br/>
An embeddable React SDK that lets your end users redesign your app's UI with AI — inside a hard security sandbox.</p>

---

## The concept

Veneer flips personalization around. Instead of you predicting every layout a user might want
and shipping toggles for them, you **register the capabilities your app exposes** — its data
sources and actions, each described in plain English — and pass in the real implementations.

Your end users then open an AI chat and just *describe how they want the page to look*. The AI
has **full creative freedom over the UI**: it generates real component code. That code runs in a
**securely sandboxed iframe** whose only connection to your app is a message bridge exposing
exactly the capabilities you registered — nothing else.

So the AI can invent any layout it likes — a kanban board, a calendar, a dashboard, a timeline —
but a generated UI **can only ever trigger actions that were registered.** If there is no
registered delete action, deleting a record is impossible *by construction*, even though the AI
writes free-form code.

It's "MCP for the UI layer": you expose a typed, described capability surface; the model composes
against it; a sandbox enforces the boundary.

This repo has two **separate** projects:

```
veneer/
├── veneer-sdk/     # the embeddable React SDK (publishable npm package, plain JavaScript)
└── veneer-demo/    # a polished Next.js demo app that consumes the SDK locally
```

The website (`veneer-demo`) depends on the local package via `"veneer-sdk": "file:../veneer-sdk"`,
so you develop against the real SDK source.

---

## The security model (the core of the product)

This is the part that matters. Three layers, each load-bearing:

1. **Opaque origin.** Generated code renders inside `<iframe sandbox="allow-scripts">` with **no**
   `allow-same-origin`. The frame runs at an opaque origin: no access to the parent's cookies,
   `localStorage`, or DOM. (Combining `allow-scripts` with `allow-same-origin` would defeat the
   sandbox — Veneer never does this.)

2. **No network.** The iframe document carries a strict Content-Security-Policy including
   `connect-src 'none'` (plus `img-src`/`font-src` locked down). Code inside the frame **cannot
   `fetch`, XHR, open a WebSocket, or send a beacon** to anything. The runtime libraries
   (React/Babel/Tailwind) load from two pinned, trusted CDN origins in `script-src`; the generated
   component itself is inline and has no other way to reach the network.

3. **Validated bridge.** A bridge runs in the parent. It receives `{ action, args }` messages from
   the iframe, validates the action id against the registry, runs the **real** implementation only
   if it's registered, and posts results back. Live data is pushed *into* the frame the same way.
   The generated code has no other path to anything.

Put together: even if a generated UI *tried* to delete a task by calling the network directly, the
opaque origin blocks host access, `connect-src 'none'` blocks the request, and — since no
`deleteTask` action is registered — the bridge would reject the call anyway. Deletion is impossible
on every layer at once.

Customizations are **per-user and private**: the generated UI is stored in `localStorage` only.
No sharing in this version.

---

## How a developer registers capabilities

```jsx
const registry = {
  dataSources: [
    { id: 'tasks', description: "The user's tasks.", fields: [
      { name: 'id', type: 'string' },
      { name: 'title', type: 'string' },
      { name: 'status', type: '"todo" | "doing" | "done"' },
      { name: 'dueDate', type: 'string (YYYY-MM-DD) or null' },
    ] },
  ],
  actions: [
    { id: 'createTask',  description: 'Create a new task.',  args: [/* … */] },
    { id: 'updateTask',  description: "Update a task's fields.", args: [/* … */] },
    { id: 'archiveTask', description: 'Archive a task.',     args: [/* … */] },
    // No deleteTask — so no generated UI can ever delete a task.
  ],
};

// The REAL implementations live in your app (here, in-memory React state):
const actions = {
  createTask:  ({ title, status = 'todo', dueDate = null }) => { /* … setTasks … */ },
  updateTask:  ({ id, ...changes }) => { /* … */ },
  archiveTask: ({ id }) => { /* … */ },
};

<VeneerProvider registry={registry} actions={actions} data={{ tasks }} defaultUI={defaultUI}>
  <VeneerFrame style={{ height: 620 }} />
  <VeneerChat />
</VeneerProvider>
```

The registry's plain-English descriptions are handed to the model so it knows what it can do; the
registry's ids are what the bridge enforces at runtime. Generated code reads data via
`veneer.data('tasks')` and triggers actions via `veneer.action('updateTask', { id, status })`.

See **`veneer-sdk/README.md`** for the full SDK API.

---

## Running it

You'll need **Node 18+** and a **Google Gemini API key** ([get one here](https://aistudio.google.com/apikey)).

```bash
# 1. Install the SDK's own (it has none beyond peer deps, but this primes the local link)
cd veneer-sdk
npm install

# 2. Install the demo (this links the local veneer-sdk via file:../veneer-sdk)
cd ../veneer-demo
npm install

# 3. Add your API key
cp .env.local.example .env.local
#   then edit .env.local and set GEMINI_API_KEY=...

# 4. Run
npm run dev
# open http://localhost:3000
```

The demo uses the model `gemini-2.5-flash` via Google's `@google/genai` SDK.

### Try the acceptance scenarios

Click **“Talk with AI to change the look of this page”** (bottom-right) and try:

- **“Make this a kanban board grouped by status.”** → the AI generates a board; dragging status /
  archiving works through the bridge; refresh persists the layout (`localStorage`).
- **“Show a calendar by due date.”** → the AI invents a calendar view by reading `tasks` and
  grouping by `dueDate` (not from a fixed list).
- **“Add a delete button on each task.”** → politely refused — no `deleteTask` is registered, so it
  keeps the prior UI and explains. And even if the generated code *tried* to delete via the
  network, the sandbox + `connect-src 'none'` + bridge validation make it impossible.

---

## Stack

Next.js (App Router) · React 18 · Tailwind CSS · `@google/genai` (model `gemini-2.5-flash`).
Both projects are plain JavaScript.

## Notes

- Generated UI is stored per-user in `localStorage["veneer-ui"]`. “Reset to default” reverts it.
- The demo's task data is in-memory — “Reset data” restores the sample tasks.
- The product logo is the layered-"V" mark in `veneer-sdk/src/VeneerLogo.js` (a thin *veneer*
  laid over the real material underneath).
