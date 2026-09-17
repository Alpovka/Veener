# veneer-sdk

**An MCP for in-app personalization.** Embed Veneer in your React app, register the
capabilities your app exposes, and let your end users redesign the page with AI — inside a
sandbox whose only exit is a validated bridge to the capabilities you registered.

The AI has full creative freedom over the UI: it generates real component code. That code runs
in a sandboxed iframe with no network and no access to your page; it reaches your app only
through a private message channel whose every request is checked against your registry. The AI
can invent any layout, but a generated UI can only trigger the actions you registered, with the
arguments you declared. No registered `deleteTask` ⇒ the bridge refuses every attempt to delete.

## Install

```bash
npm install veneer-sdk
# peer deps: react >= 18, react-dom >= 18
```

> Ships untranspiled JSX source. With Next.js add `transpilePackages: ['veneer-sdk']` to
> `next.config.js` (other bundlers transpile `node_modules` as needed).

## Usage

The registry is one plain object, imported by **both** the client and the server:

```js
// veneer.config.js
export const registry = {
  dataSources: [
    { id: 'tasks', description: "The user's tasks.", fields: [
      { name: 'id', type: 'string' },
      { name: 'title', type: 'string' },
      { name: 'status', type: '"todo" | "doing" | "done"' },
    ] },
  ],
  actions: [
    { id: 'createTask', description: 'Create a task.', returns: 'The created task.',
      args: [{ name: 'title', type: 'string', required: true }] },
    { id: 'updateTask', description: 'Update a task.',
      args: [{ name: 'id', type: 'string', required: true }, { name: 'status', type: '"todo" | "doing" | "done"' }] },
    // No deleteTask → the bridge rejects any attempt to delete.
  ],
};
```

```jsx
// app/page.js
'use client';
import { useState, useMemo } from 'react';
import { VeneerProvider, VeneerFrame, VeneerChat } from 'veneer-sdk';
import { registry } from './veneer.config';

export default function Page({ userId }) {
  const [tasks, setTasks] = useState([]);
  const actions = useMemo(() => ({
    createTask: ({ title }) => { const t = { id: crypto.randomUUID(), title, status: 'todo' }; setTasks((p) => [...p, t]); return t; },
    updateTask: ({ id, ...c }) => setTasks((p) => p.map((t) => (t.id === id ? { ...t, ...c } : t))),
  }), []);
  const data = useMemo(() => ({ tasks }), [tasks]);

  return (
    <VeneerProvider registry={registry} actions={actions} data={data} storageKey={`veneer-ui:${userId}`}>
      <VeneerFrame frameSrc="/veneer-frame" style={{ height: 600 }} />
      <VeneerChat /> {/* POSTs to /api/veneer by default; override with endpoint="..." */}
    </VeneerProvider>
  );
}
```

```js
// app/api/veneer/route.js  — the generator endpoint
import { createVeneerHandler } from 'veneer-sdk/server';
import { registry } from '../../veneer.config';

export const POST = createVeneerHandler({
  registry,
  // Call any LLM. `messages` is [{ role: 'user' | 'assistant', content }]; resolve with its raw text.
  generate: async ({ system, messages, signal }) => callYourModel(system, messages, { signal }),
});
```

```js
// app/veneer-frame/route.js  — serves the sandbox document (recommended; see "Host CSP" below)
import { buildFrameResponse } from 'veneer-sdk/server';
export const GET = () => buildFrameResponse({ frameAncestors: "'self'" });
```

## API

### `veneer-sdk`

| Export | What it does |
| --- | --- |
| `VeneerProvider({ registry, actions, data, defaultUI, persist, storageKey, theme, onThemeError, onSecurityViolation })` | Holds the registry, the real action impls, and live data. Persists the current generated UI (`persist`: `'local'` default, `'session'`, `'memory'`) under `storageKey` (default `veneer-ui`; use a per-user key on shared devices). Stored UIs are tagged with a hash of the registry and ignored if the registry changes. |
| `VeneerFrame({ frameSrc, autoHeight, minHeight, maxHeight, onError, onSecurityViolation, actionTimeoutMs, heartbeatMs, maxMissedHeartbeats, readyTimeoutMs, validation, rateLimit })` | Renders the sandboxed iframe and runs the bridge. Every UI change mounts a **fresh document**. `frameSrc` loads the sandbox from a URL you serve with `buildFrameResponse()` instead of `srcDoc`. `autoHeight` sizes the iframe to its content. |
| `VeneerChat({ endpoint, suggestions, anchor, headers })` | Floating chat. Sends `{ message, history, currentUI }` (never the registry). Shows a notice when a generated UI was reverted for safety. |
| `useVeneer()` | `{ registry, actions, data, ui, setUi, reset, loaded, defaultUI, generation, violation, flagViolation, restoreQuarantined, clearViolation }`. |
| `runBridgeAction`, `validateArgs`, `typeChecker`, `pickRegisteredData`, `filterActionResult`, `createRateLimiter`, `BridgeError` | The bridge's validators, exported for testing and custom hosts. |
| `buildFrameSrcDoc()`, `FRAME_CSP`, `FRAME_SANDBOX`, `RUNTIME_SCRIPTS`, `PROTOCOL_VERSION` | The sandbox document and its policy. |
| `createScanner(parser, traverse)`, `registryIds(registry)` | The static scanner (see below). |
| `resolveTheme`, `themeFromCSSVariables`, `loadThemeFonts`, `DEFAULT_THEME`, `THEME_UTILITIES` | Branding helpers (see "Branding"). |

### `veneer-sdk/server` (no React; Fetch-API `Request`/`Response`)

| Export | What it does |
| --- | --- |
| `createVeneerHandler({ registry, generate, brand, rateLimit, allowedOrigins, authorize, onError, maxHistory, maxMessageChars, maxCurrentUIChars, maxBodyBytes, timeoutMs })` | Returns `(request) => Promise<Response>` with `{ code, intent, reply }`. Applies the intent gate (below). Builds the prompt from **your** registry (the client's copy is ignored), requires `Content-Type: application/json` and same-origin Fetch Metadata, caps every input, rate-limits per IP (`rateLimit` may be `{ limit, windowMs }`, an `async (key) => boolean` backed by your store, or `false`), aborts the model call after `timeoutMs`, statically scans the generated code and refuses anything that reaches outside the registry, and never returns provider error text. |
| `buildFrameResponse({ frameAncestors })` | The sandbox document as a `Response` with a header CSP (including `sandbox` and `frame-ancestors`), `Referrer-Policy: no-referrer`. |
| `scanGeneratedCode(code, registry)` | `{ ok, violations }` for a code string. |
| `buildSystemPrompt(registry)`, `buildUserPrompt(message, currentUI, heuristic)`, `extractJson(text)`, `classifyIntent(message)` | Prompt building blocks and the local intent classifier, if you run your own pipeline. |
| `checkRequestOrigin(request, opts)`, `createMemoryRateLimiter(opts)`, `clientKey(request)` | Reusable guards for your other routes. |

## Branding

Generated UI and the SDK's widgets take the host's brand. Pass a `theme` to the provider:

```jsx
<VeneerProvider
  registry={registry} actions={actions} data={data}
  theme={{
    mode: isDark ? 'dark' : 'light',              // or 'system'
    colors: {
      primary: '#4f46e5', primaryForeground: '#fff', accent: '#7c3aed',
      background: { light: '#fff', dark: '#0b1020' },   // any token may differ per mode
      surface: { light: '#f8fafc', dark: '#111a2e' },
      border: { light: '#e2e8f0', dark: '#243047' },
      foreground: { light: '#0f172a', dark: '#e2e8f0' },
      muted: { light: '#64748b', dark: '#94a3b8' },
      success: '#10b981', warning: '#f59e0b', danger: '#e11d48',
    },
    radius: { sm: '8px', md: '12px', lg: '18px' },
    font: { sans: 'Inter, ui-sans-serif, system-ui, sans-serif', size: '14px' },
    fonts: [{ family: 'Inter', src: '/fonts/inter-latin-400-normal.woff2', weight: '400' }],
  }}
>
  <VeneerFrame frameSrc="/veneer-frame" autoHeight minHeight={480} />
  <VeneerChat />
</VeneerProvider>
```

How it works:

- The provider validates the theme (`resolveTheme`), turns it into `--veneer-*` CSS variables for a
  light and a dark variant, and ships them into the sandbox with `init` and later `theme` messages.
  Inside the frame, Tailwind's brand utilities map onto those variables, so generated code writes
  `bg-primary text-primary-foreground rounded-md font-sans` and gets your brand. The system prompt
  built by `createVeneerHandler` tells the model to use exactly that vocabulary
  (`THEME_UTILITIES`), and `brand: { name, tone }` adds a sentence about your brand.
- **Fonts** are fetched by the host page and inlined as `data:` URIs, which the frame's CSP already
  allows. Nothing else changes in the CSP; a theme can never load a remote resource or inject CSS
  (colours must be colours, lengths must be lengths, `url(` and braces are rejected).
- **Dark mode:** `mode: 'system'` follows `prefers-color-scheme`; hosts with a class-based toggle
  pass `'light'` / `'dark'` explicitly. The chat widget uses the same tokens and flips with it.
- **Auto-height:** with `autoHeight` (default) the frame reports its content height and the iframe
  is resized, so the canvas flows with the page instead of scrolling inside a box. `minHeight` and
  `maxHeight` clamp it; when content exceeds `maxHeight` the frame scrolls.
- `themeFromCSSVariables({ colors: { primary: '--brand-600' } })` reads tokens you already define
  as CSS custom properties.

Limits: brand colours do not support Tailwind opacity modifiers (`bg-primary/50`); overlays
inside the canvas are clipped to the iframe rectangle; the frame cannot use your React components
(it gets your tokens, not your component library).

## Intent gate: the canvas changes only when asked

The assistant is conversational. "Hey, how are you?", "what do you think of this design?", "what can
you do?" or "thanks!" get a reply and leave the canvas untouched; "make this a kanban board" changes
it; "make it better" gets one clarifying question. Two signals decide, and both must agree before
any code is applied:

1. the model labels its answer (`"intent": "design" | "chat" | "clarify"`), and
2. a local, rule-based classifier reads the message (`classifyIntent`, exported from
   `veneer-sdk/server` for your own UI hints or tests).

If the model says "design" but the local read is confidently "chat" (an opinion question, a
greeting), the code is dropped and logged via `onError` so prompts can be tuned. Responses carry
`intent`, so a chat UI can show "Canvas updated" only when something changed.

## The in-frame API (what generated code may call)

Generated code is plain JSX with these globals available (no imports): `React`, `useState`,
`useEffect`, `useMemo`, `useCallback`, `useRef`, `veneer`, `render`.

- `veneer.data(sourceId)` — read a registered data source (string-literal id).
- `veneer.action(id, args)` — trigger a registered action (string-literal id). Returns a Promise;
  it resolves with the implementation's return value **only if** the registry entry declares
  `returns`, otherwise with `undefined`. Rejected with a clear message when the id, the args, or
  the rate limit fail validation, or after `actionTimeoutMs`.
- `render(<App/>)` — mount the component.

Forms work (`onSubmit` fires) but never navigate. `fetch`, cookies, storage, `window`,
`document`, `location`, `this`, imports and external resources are rejected by the scanner and,
independently, blocked by the sandbox.

## Security model

Four layers. Each is described with what it actually stops.

1. **Opaque origin.** `sandbox="allow-scripts allow-forms"`, never `allow-same-origin`. Generated
   code cannot read your cookies, storage, or DOM, cannot open popups, downloads or modals, and
   cannot navigate your page.
2. **CSP.** `default-src 'none'; connect-src 'none'; form-action 'none'` — no fetch, XHR,
   WebSocket, beacon, images, fonts, frames or form posts. `script-src` lists the four runtime
   scripts by exact URL (React 18.3.1, ReactDOM 18.3.1, Babel standalone 7.29.8 with SRI hashes;
   Tailwind Play CDN 3.4.19 version-pinned), so generated code cannot import anything else.
3. **Bridge over a private MessageChannel.** The host hands the frame a `MessagePort` in a single
   `init` message and then ignores window messages. The port belongs to that document: if the
   frame is navigated away, the new document has no channel to the host. Every `action` on the
   port is validated (registered id, declared args only, required args, type checks inferred
   from your `type` text or your own `validate(args)` hook, no `__proto__`/`constructor` keys,
   64 KB / depth-8 caps, token-bucket rate limit) before the real implementation runs, and only
   declared return values go back. Only registered data sources are pushed in.
4. **Static scan before eval.** The frame parses generated code and refuses anything that
   touches `window`/`document`/`location`/network globals, `this`, imports, `dangerouslySetInnerHTML`,
   string-argument timers, or a non-literal/unregistered `veneer.action`/`veneer.data` id. The
   server runs the same scan before returning code. This is lint and a tamper speed bump; the
   boundary is layers 1–3.

**Detection and reset.** Any iframe `load` after `init`, or three missed heartbeats, means the
document is gone or stuck. The host closes the port, quarantines the code under
`${storageKey}:quarantine`, reverts to `defaultUI` in a fresh document, and calls
`onSecurityViolation({ reason: 'frame-navigated' | 'frame-unresponsive' | 'scan-violation', code })`.
It never remounts in a loop (not if the default UI is the offender, not after 3 violations in
30 s).

### Known limits (read these)

- **Self-navigation.** A sandboxed frame may always navigate *itself*, and CSP does not govern
  navigations. Anchor clicks and form submissions are neutralised and the scanner rejects
  `location`, but a deliberate bypass (`'unsafe-eval'` is required for Babel, so static checks
  are not airtight) can encode data *already inside the frame* into a URL. Veneer detects this
  and shuts the frame down, but the first request has left the browser. Push only data you would
  show that user on screen anyway.
- **Host CSP inheritance.** A `srcDoc` frame inherits your page's CSP. If your page has a strict
  policy the runtime cannot start (you get `onError({ type: 'runtime-timeout' })`). Serve the
  frame with `buildFrameResponse()` and pass `frameSrc` instead; a separate origin/site is best
  (process isolation on browsers that support it, and an accidental `allow-same-origin` can never
  mean *your* origin).
- **CPU.** A hot loop in generated code freezes the frame; on browsers that run sandboxed frames
  in-process it can also stall the host tab. `frameSrc` on a separate site helps where site
  isolation exists.
- **UI spoofing.** Generated UI can draw anything, including a fake login form. Its only sinks are
  action args and the residual above. Do not register actions that accept secrets.
- **Other listeners.** Generated code can `postMessage` to `top` and sibling frames. Your own
  `message` listeners must validate `event.source` and `event.origin` (they should already).
- **Third-party CDN.** The runtime loads from unpkg.com and cdn.tailwindcss.com. SRI covers the
  three npm-published scripts; the Tailwind Play CDN build cannot be hashed. Self-host the four
  URLs behind your own origin if that is unacceptable, by overriding `RUNTIME_SCRIPTS`.

## Testing

```bash
npm test          # vitest: bridge, scanner, frame document, server handler, context
npm run test:e2e  # Chromium: handshake, bridge, CSP, scanner, navigation detection, SRI, host-CSP modes
```

## License

MIT
