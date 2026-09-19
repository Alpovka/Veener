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
**JavaScript interpreter inside a Web Worker** — a sandbox with no browser in it — and the only
thing it can do is describe what to draw and call a bridge exposing exactly the capabilities you
registered. Your page redraws that description through an allowlist, as real DOM in your page.

So the AI can invent any layout it likes — a kanban board, a calendar, a dashboard, a timeline —
but a generated UI **can only ever trigger actions that were registered.** If there is no
registered delete action, deleting a record is refused on every layer, even though the AI
writes free-form code.

It's "MCP for the UI layer": you expose a typed, described capability surface; the model composes
against it; a sandbox enforces the boundary.

This repo is an npm workspace:

```
veneer/
├── packages/core/     # internal, not published: validators, scanner, theme, token verification, legacy frame document
├── packages/react/    # @veneer/react  (MIT)        VeneerProvider, VeneerCanvas (+ dist/veneer-worker.js), useVeneerGenerate
├── packages/server/   # @veneer/server (commercial) createVeneerHandler, buildFrameResponse, license client — bundles core
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

1. **An interpreter, not a browser.** Generated code runs in QuickJS (a JavaScript engine compiled
   to WebAssembly) inside a Web Worker. The interpreter's global scope holds React (Preact), a fake
   `document` that records drawing operations, and the `veneer` API — nothing else. `window`,
   `fetch`, `location`, cookies, storage, `XMLHttpRequest`, `WebAssembly`, `importScripts` do not
   exist there; this is not a blocklist, they were never created. Only JSON strings cross the
   boundary in either direction. Every entry into the interpreter (start-up, an event, a timer, an
   action result) runs under a CPU deadline enforced by the engine's interrupt handler, with a
   memory cap and a stack cap.

2. **Allowlisted rendering.** The interpreter never draws; it emits a description (`insert`, `text`,
   `attr`, `style`, `on`…). `VeneerCanvas` replays that with the host's own React through an
   allowlist: elements are allowed, demoted (`<a>` → `<span>`) or dropped (`<img>`, `<iframe>`,
   `<script>`, `<style>`, `<video>`, `<object>`…); attributes map to a fixed list (no `href`, `src`,
   `action`, `on*`, `contenteditable`, `popover`…); ids are namespaced so they cannot collide with
   or target the host's; inline styles pass a grammar (no `url()`, no `var()` outside the brand
   variables, `position: fixed` → `absolute`, `z-index` ≤ 100); class names pass a grammar and are
   prefixed (`grid` → `v:grid`). Tailwind v4 is compiled **inside the worker** for exactly the class
   names used, every rule is re-rooted under `.veneer-canvas`, and the stylesheet is installed via
   `adoptedStyleSheets`, so generated CSS cannot restyle the host and host CSS resets cannot leak in.
   The canvas root is `isolation: isolate` with a clip, so nothing can be painted over your page.

3. **Validated bridge.** Every `veneer.action` call is checked against the registry — registered
   id, declared args only, required args, type checks inferred from your `type` text (or your own
   `validate(args)`), no prototype-polluting keys, size/depth caps, a rate limit — *before* your
   implementation runs. Only declared return values go back, and only registered data sources are
   pushed in. The interpreter checks the id first too, so an unregistered action never leaves it.

Then two more things, which are not boundaries but make the boundaries hard to reach:

- **Static scan before eval.** The generated code is parsed and refused if it touches `window`,
  `document`, `location`, network globals, `this`, imports, `dangerouslySetInnerHTML`, or a
  non-literal/unregistered `veneer.action`/`veneer.data` id. The server runs the same scan before
  returning code, so the chat can explain *why* instead of showing a broken canvas.
- **Watchdog.** Every UI gets a fresh worker. A hot loop is interrupted at its deadline (three in a
  row end the UI); a native allocation loop the interrupt cannot reach is caught by heartbeats: the
  host terminates the worker, quarantines the code, restores the default UI and calls
  `onSecurityViolation`. `Worker.terminate()` is the last word, and nothing generated code does can
  delay it.

**Known limits.** Generated UI is real DOM in your page, so it can *look like* anything — a fake
login form is a spoofing risk, exactly as it would be with any user-generated content; the canvas
draws a persistent "AI-generated view" badge that generated code cannot cover, cannot submit or
navigate, but treat what users type into generated views accordingly. Text is the only channel out
of the interpreter (there is no network and no navigation) unless the host opts into images/links
for listed origins (`allow`), so data you push in can only reach the user's screen; still, push
only registered sources you would show that user anyway. Generated code cannot measure or scroll
elements. The worker compiles WebAssembly fetched from your origin, so a host
Content-Security-Policy needs `script-src 'wasm-unsafe-eval'`, `worker-src 'self'` and
`connect-src 'self'`. The legacy iframe engine (`VeneerFrame`) stays one more release for hosts
that need it; its residuals are in `packages/react/README.md`.

**The server owns the registry.** The client sends `{ message, history, currentUI }` only; the
generator endpoint (`createVeneerHandler` from `@veneer/server`) builds the prompt from *its*
registry, requires same-origin JSON requests, caps sizes, rate-limits, times out the model and scans
the result. It is not an open LLM proxy.

**Branding.** Pass `theme` to the provider (colours per mode, radii, fonts, shadows) and both the
generated UI and your chat take the host brand: the tokens become `--veneer-*` variables on the
canvas root, Tailwind utilities like `bg-primary` / `text-foreground` / `rounded-md` resolve to them,
`dark:` follows the mode, and the model is told to use that vocabulary. Because generated UI is real
DOM in your page, your fonts apply as they are and the canvas flows with the page.

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
  <VeneerCanvas />   {/* generated UI renders here, as real DOM in your page */}
  <YourChatBox />    {/* any UI built on useVeneerGenerate(); the SDK ships no chat widget */}
</VeneerProvider>
```

Install is one command: `npm install @veneer/react @veneer/server`. Those are the only two published
packages: the client (MIT, browser) and the endpoint (commercial, server). Both ship compiled
JavaScript plus TypeScript declarations, so no bundler configuration is needed. The shared internals
live in the private `packages/core` workspace and are bundled into each at build time.

Two static files to serve: copy `node_modules/@veneer/react/dist/veneer-worker.js` and
`veneer-worker.wasm` to your public directory (the demo does it in a `prebuild` script), or pass
`workerUrl` to `VeneerCanvas`. If your page has a Content-Security-Policy, add `'wasm-unsafe-eval'`
to `script-src` and `'self'` to `worker-src` and `connect-src`.

The registry's plain-English descriptions are handed to the model so it knows what it can do; the
registry's ids are what the bridge enforces at runtime. Generated code reads data via
`veneer.data('tasks')` and triggers actions via `veneer.action('updateTask', { id, status })`.

See **`packages/react/README.md`** and **`packages/server/README.md`** for the API.

---

## Running it

You'll need **Node 20+** (`.nvmrc` pins 24) and a **Google Gemini API key** ([get one here](https://aistudio.google.com/apikey)).

```bash
# 1. Install the workspace (this also builds @veneer/react's dist) and run the tests
npm install
npm test                       # unit tests for all packages
npm run typecheck              # the hand-written .d.ts files against a TypeScript smoke file
npm run test:e2e               # browser tests in Chromium (engine, allowlist, bridge, CSP, watchdog; legacy frame)

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
  reached the client anyway, the scan refuses to run it, the interpreter refuses the unregistered
  id, and the bridge rejects the call.

---

## Stack

Next.js (App Router) · React 18 · Tailwind CSS · `@google/genai` (model `gemini-2.5-flash`).
Both projects are plain JavaScript.

## Notes

- Generated UI is stored per-user in `localStorage["veneer-ui"]`. “Reset to default” reverts it.
- The demo's task data is in-memory — “Reset data” restores the sample tasks.
- The product logo is the layered-"V" mark in `examples/demo/app/_components/VeneerLogo.js` (a thin *veneer*
  laid over the real material underneath).
