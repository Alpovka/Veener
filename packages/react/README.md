# @veneer/react

Client SDK for Veneer: let your end users redesign a page with AI, inside a sandbox whose only
exit is a validated bridge to the capabilities you registered. MIT licensed and fully readable;
the security model never depends on this code being secret.

## Install

```bash
npm install @veneer/react @veneer/server
```

These are the only two packages. `@veneer/react` has no runtime dependencies besides React 18 or
19; it ships compiled ESM (JSX already transformed, `'use client'` at the top) and TypeScript
declarations, so it works in Next.js, Vite, Remix and plain webpack without any bundler
configuration.

**Two static files.** The engine runs in a Web Worker. Serve `dist/veneer-worker.js` and
`dist/veneer-worker.wasm` from your origin, side by side — copy them to your public directory (the
demo does it in a `prebuild` script) so they are available at `/veneer-worker.js` and
`/veneer-worker.wasm`, or pass `workerUrl` (the `.wasm` is loaded from the same directory). If your
page sets a Content-Security-Policy, allow `'wasm-unsafe-eval'` in `script-src`, `'self'` in
`worker-src` and `'self'` in `connect-src`; that is all the engine needs (no `'unsafe-eval'`, no
`'unsafe-inline'`, no CDN).

## Three things, no UI opinions

```jsx
'use client';
import { VeneerProvider, VeneerCanvas, useVeneerGenerate } from '@veneer/react';
import { registry } from './veneer.config';

function RedesignBox() {
  const { generate, busy, reply, undo, canUndo, violation } = useVeneerGenerate();
  const [text, setText] = useState('');
  return (
    <div>
      <input value={text} onChange={(e) => setText(e.target.value)}
             onKeyDown={(e) => e.key === 'Enter' && generate(text)} disabled={busy} />
      {reply && <p>{reply}</p>}
      {canUndo && <button onClick={undo}>Undo</button>}
      {violation && <p role="alert">Reverted for safety.</p>}
    </div>
  );
}

export default function Page({ userId }) {
  const [tasks, setTasks] = useState([]);
  const actions = useMemo(() => ({ /* real implementations */ }), []);
  return (
    <VeneerProvider registry={registry} actions={actions} data={{ tasks }} storageKey={`veneer-ui:${userId}`}>
      <VeneerCanvas />
      <RedesignBox />
    </VeneerProvider>
  );
}
```

- **`VeneerProvider`** holds the registry, your real action functions, live data and (optionally)
  a theme; persists the current UI per `storageKey`; quarantines misbehaving UIs.
- **`VeneerCanvas`** is the engine. It spawns a worker per UI, runs the generated code in a QuickJS
  interpreter there, and redraws what that code renders in your page, through an allowlist, with
  your React. Every action from generated code is validated against the registry before your
  function runs. Props: `workerUrl`, `minHeight`, `className`/`style` (applied to the canvas root),
  `onError`, `onLog` (generated code's `console`), `onSecurityViolation`, `actionTimeoutMs`,
  `heartbeatMs`/`maxMissedHeartbeats`, `bleed` (how far popovers may hang below the canvas),
  `warm` (default true: keep one spare worker booted so the next UI swaps in ~100–200 ms instead
  of a ~1 s cold start; the previous height is held during the swap so the page does not jump),
  `allow` (image/link URL prefixes the renderer may load — default none), `limits` (interpreter
  deadlines/memory for heavy views, clamped), `badge` (the persistent "AI-generated view" marker;
  a string, a node or `false`).
- **State carry-over.** Every UI still runs in a fresh interpreter, but for an edit (`mode: 'edit'`),
  undo or a runtime repair the canvas snapshots the previous interpreter's `useState` values (keyed
  by component, vnode key and hook index) and hands them to the next one, and focus returns to the
  same element. Half-typed text and open rows survive small changes; a new view starts clean.
- **`useVeneerGenerate()`** is headless: `generate(message)` posts `{ message, history,
  currentUI }` to your endpoint (default `/api/veneer`) and swaps in the returned code. Build any
  chat box, command palette or button on top. The registry is never sent; the server owns it.

Small requests are fast: the server classifies "make that button collapsible" as an **edit** and
asks the model for a few search/replace edits against the current UI instead of a whole new
component, so tweaks land in a second or two while new layouts take the full generation. Each
history turn carries `mode: 'edit' | 'design'` if your chat UI wants to show it.

If a freshly applied UI crashes at runtime (something the static scan cannot see), the hook sends
one hidden turn asking the model to fix it and applies the fix (`repairOnError: false` to disable;
filter `history` on `hidden` in your chat UI).

The endpoint is `createVeneerHandler` from `@veneer/server` (self-hosted, license key) or
Veneer Cloud (hosted, API key). Both return `{ code, intent, reply, mode, token }`: `code` is `null`
for chat turns, clarifying questions and refusals, and `token` is the signed license token the hook
verifies before applying code (chat turns carry none and need none). Pass
`requireLicense: false` to the hook to skip the check, e.g. in tests. On a runtime without
WebCrypto the check is skipped as well, because the server already enforced the license.

## How the engine works

```
your page ──── postMessage (JSON only) ────► Web Worker
 VeneerCanvas                                 QuickJS interpreter (wasm)
  · replays ops through the allowlist          · Preact + a fake document that records ops
  · installs the scoped stylesheet             · the generated component
  · validates actions, pushes data             · CPU deadline per entry, memory cap
  · heartbeat → terminate() if it stalls       · Tailwind v4 compiled for the classes used
```

Generated code sees React, hooks, `veneer.data(id)`, `veneer.action(id, args)`, `render(...)`,
timers, `console` (forwarded to `onLog`), a minimal `Intl`, and nothing else. What it renders comes
out as a description; the description is replayed with an allowlist that drops `<img>`, `<iframe>`,
`<script>`, `<style>`, `<video>`…, demotes `<a>` to `<span>`, maps attributes to a fixed list (no
`href`/`src`/`on*`), namespaces ids (`#count` → `#v-count`), prefixes classes (`grid` → `v:grid`),
and passes inline styles through a grammar (no `url()`, `fixed` → `absolute`, `z-index` ≤ 100).
Text inputs are semi-controlled: the DOM owns typing, the interpreter's value wins when it changes.

The stylesheet is compiled in the worker from Tailwind v4 for exactly the class names used, with
brand tokens mapped to the `--veneer-*` variables the provider sets on the canvas root, re-rooted
under `.veneer-canvas`, and installed via `adoptedStyleSheets`. Host CSS cannot restyle generated
nodes and generated CSS cannot restyle the host.

## Images and links

Off by default: `<img>` is dropped and `<a href>` becomes plain text, because either would load or
follow a URL with the user's cookies. Opt in per host:

```jsx
<VeneerProvider allow={{ images: ['same-origin', 'https://cdn.acme.com/'], links: ['same-origin'] }} …>
// and on the server, so the model is told what it may use:
createVeneerHandler({ registry, allow: { images: [...], links: [...] }, … })
```

Entries are URL prefixes or the keywords `'same-origin'`, `'https:'` (any https URL) and, for images,
`'data:'` (inline base64 raster/SVG). Allowed images render lazily with `referrerpolicy=no-referrer`;
allowed cross-origin links open in a new tab with `rel="noopener noreferrer nofollow"`. Your page's
own CSP (`img-src`) still applies on top.

## Residual risks

- **UI spoofing.** Generated UI is real DOM in your page and can look like anything, including a
  fake login form. It cannot submit, navigate or reach the network, so what a user types stays on
  their screen. The persistent badge (`badge` prop) marks the area as AI-generated and cannot be
  covered by generated code; still treat generated views like any user-generated content.
- **CPU.** A hot loop is interrupted at its deadline (250 ms per event, 2 s at start-up; three in a
  row end the UI; `limits` loosens these for heavy views, up to 2 s / 10 s). A native allocation
  loop cannot be interrupted mid-allocation and can hold the worker for a few seconds before the
  heartbeat terminates it; the page itself never freezes.
- **No measurement.** Generated code cannot read element sizes or positions
  (`getBoundingClientRect` is all zeros, observers never fire) and cannot scroll; layouts that need
  measuring (virtualised lists, popovers positioned by hand) must be expressed in CSS.
- **State carry-over is best-effort.** It matches `useState` calls by component name, vnode key
  and hook index; an edit that inserts a hook shifts the ones after it, which then fall back to their
  code's initial values. Unkeyed repeated components share a slot.
- **Layout.** Generated content can be tall or wide. The canvas is `contain: layout` with a clip
  and an `isolation` context; give it a `maxHeight` wrapper if your layout needs one.

`VeneerFrame` (the previous iframe engine) is still exported for one release and unchanged; prefer
`VeneerCanvas`.

## Tests

```bash
npm test                 # vitest (engine box, sanitizer, tailwind scoper, provider, hook)
npm run test:e2e         # Chromium end-to-end; E2E_ONLY=canvas or frame to narrow
npm run build            # esbuild → dist/ (guest bundle, worker, SDK; also runs on install and before publish)
```
