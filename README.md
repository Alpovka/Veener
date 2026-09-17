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
registered delete action, deleting a record is refused on every layer, even though the AI
writes free-form code.

It's "MCP for the UI layer": you expose a typed, described capability surface; the model composes
against it; a sandbox enforces the boundary.

This repo is an npm workspace:

```
veneer/
├── packages/core/     # @veneer/core   (MIT)  shared validators, scanner, frame document, theme, token verification
├── packages/react/    # @veneer/react  (MIT)  VeneerProvider, VeneerFrame, useVeneerGenerate (built to dist/ by esbuild)
├── packages/server/   # @veneer/server (commercial) createVeneerHandler, buildFrameResponse, license client
├── packages/cloud/    # @veneer/cloud  reference Veneer Cloud: API keys, quota, token signing, hosted generation
└── examples/demo/     # the Next.js demo site (consumes the packages from the workspace)
```

Release notes live in `CHANGELOG.md`; how to report a vulnerability in `SECURITY.md`; what has to be
in place before a production deployment in `docs/PRODUCTION.md`.

Product shape: the client is open and readable (security never depends on secrecy); the
generation endpoint is either self-hosted with `@veneer/server` and a license key, or Veneer
Cloud with an API key. Your LLM key stays yours in both cases.

---

## The security model (the core of the product)

This is the part that matters. Three enforcement layers, a static scan, and a watchdog. Each is
described with what it actually stops; the residual risks are listed too, because a security
product that hides them is not one.

1. **Opaque origin.** Generated code renders inside `<iframe sandbox="allow-scripts allow-forms">`
   with **no** `allow-same-origin`. It cannot read the host's cookies, storage or DOM, cannot open
   popups, downloads or dialogs, and cannot navigate the host page.

2. **No network.** The frame's Content-Security-Policy is `default-src 'none'; connect-src 'none';
   form-action 'none'`, and `script-src` lists the four runtime scripts (React, ReactDOM, Babel,
   Tailwind) by exact, version-pinned URL with SRI hashes where the CDN serves npm bytes. Generated
   code cannot `fetch`, XHR, open a WebSocket, send a beacon, load an image or font, or import any
   other script.

3. **Validated bridge over a private channel.** The host hands the frame a `MessagePort` once, in
   an `init` message, and never listens to the frame's window messages again. Every action request
   on that port is checked against the registry — registered id, declared args only, required args,
   type checks inferred from your `type` text (or your own `validate(args)`), no prototype-polluting
   keys, size/depth caps, a rate limit — *before* your implementation runs. Only declared return
   values go back, and only registered data sources are pushed in.

Then two more things, which are not boundaries but make the boundaries hard to reach:

- **Static scan before eval.** The frame parses the generated code and refuses anything that touches
  `window`, `document`, `location`, network globals, `this`, imports, `dangerouslySetInnerHTML`, or a
  non-literal/unregistered `veneer.action`/`veneer.data` id. The server runs the same scan before
  returning code, so the chat can explain *why* instead of showing a broken canvas.
- **Watchdog.** Every UI runs in a fresh document. If that document is ever replaced (a `load` event
  after init) or stops answering heartbeats, the host closes the channel, quarantines the code,
  restores the default UI and calls `onSecurityViolation`.

**Known limit.** A sandboxed frame may always navigate *itself*, and no browser lets the host
forbid that. Veneer neutralises anchor clicks and form posts, rejects `location` in the scan, and
detects and shuts down any navigation, but a deliberate bypass could encode data *already inside
the frame* into that first URL. Push only data you would show that user on screen anyway. The other
residuals (host CSP inheritance and the `frameSrc` fix, CPU hot loops, UI spoofing) are in
`packages/react/README.md`.

**The server owns the registry.** The client sends `{ message, history, currentUI }` only; the
generator endpoint (`createVeneerHandler` from `@veneer/server`) builds the prompt from *its*
registry, requires same-origin JSON requests, caps sizes, rate-limits, times out the model and scans
the result. It is not an open LLM proxy.

**Branding.** Pass `theme` to the provider (colours per mode, radii, fonts, shadows) and both the
generated UI and the chat widget take the host brand: the tokens become `--veneer-*` variables in the
sandbox, Tailwind utilities like `bg-primary` / `text-foreground` / `rounded-md` resolve to them, the
model is told to use that vocabulary, fonts are inlined as data URIs, and `autoHeight` lets the canvas
flow with the page.

Customizations are **per-user and private**: the generated UI is stored in `localStorage` under a
key you choose (`storageKey`, e.g. `veneer-ui:<userId>`). No sharing in this version.

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
  <VeneerFrame frameSrc="/veneer-frame" autoHeight />
  <YourChatBox />   {/* any UI built on useVeneerGenerate(); the SDK ships no chat widget */}
</VeneerProvider>
```

Install is one command: `npm install @veneer/react @veneer/server`. `@veneer/core` comes along as a
dependency of both (like `scheduler` does for `react-dom`); you never import it directly. The client
ships compiled JavaScript plus TypeScript declarations, so no bundler configuration is needed.

The registry's plain-English descriptions are handed to the model so it knows what it can do; the
registry's ids are what the bridge enforces at runtime. Generated code reads data via
`veneer.data('tasks')` and triggers actions via `veneer.action('updateTask', { id, status })`.

See **`packages/react/README.md`** and **`packages/server/README.md`** for the API.

---

## Running it

You'll need **Node 20+** (`.nvmrc` pins 22) and a **Google Gemini API key** ([get one here](https://aistudio.google.com/apikey)).

```bash
# 1. Install the workspace (this also builds @veneer/react's dist) and run the tests
npm install
npm test                       # unit tests for all packages
npm run typecheck              # the hand-written .d.ts files against a TypeScript smoke file
npm run test:e2e               # browser tests in Chromium (sandbox, bridge, CSP, navigation detection)

# 2. Configure the demo
cd examples/demo

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
- **“Add a delete button on each task.”** → politely refused — no `deleteTask` is registered, so
  the server's scan returns `code: null` with an explanation and the prior UI stays. Had the code
  reached the frame anyway, the in-frame scan refuses to run it, the CSP gives it no network, and
  the bridge rejects the call.

---

## Stack

Next.js (App Router) · React 18 · Tailwind CSS · `@google/genai` (model `gemini-2.5-flash`).
Both projects are plain JavaScript.

## Notes

- Generated UI is stored per-user in `localStorage["veneer-ui"]`. “Reset to default” reverts it.
- The demo's task data is in-memory — “Reset data” restores the sample tasks.
- The product logo is the layered-"V" mark in `examples/demo/app/_components/VeneerLogo.js` (a thin *veneer*
  laid over the real material underneath).
