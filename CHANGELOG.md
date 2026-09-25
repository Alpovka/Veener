# Changelog

All notable changes to the Veneer packages. Versions follow semver; the two published packages
(`@veneer/react`, `@veneer/server`) are released together with the same version.

## Unreleased

### Added

- **Engine v2: `VeneerCanvas`.** Generated code now runs in a QuickJS interpreter (WebAssembly)
  inside a Web Worker and only ever describes what to draw; the page redraws that description with
  its own React through an allowlist (elements, attributes, styles, class names), as real DOM in the
  host page — no iframe. Tailwind v4 is compiled in the worker for exactly the classes used, brand
  tokens map to the `--veneer-*` variables, and the stylesheet is scoped to the canvas and installed
  via `adoptedStyleSheets`. Every entry into the interpreter has a CPU deadline, memory and stack
  are capped, and a heartbeat terminates a worker that stops answering. Ships as
  `dist/veneer-worker.js`; hosts serve it same-origin and, with a CSP, allow `'wasm-unsafe-eval'`
  and `worker-src 'self'`. `VeneerFrame` remains exported for one release.
- The server prompt describes the interpreter (no `alert`/`confirm`/`prompt`, no links or images,
  arbitrary Tailwind values limited to lengths and hex colours).
- **Edit mode (fast path for small changes).** When a message is a tweak to the current UI ("make
  that button collapsible", "hide the footer"), the server asks the model for a few search/replace
  `edits` against `currentUI` instead of the whole component — roughly 10× fewer output tokens.
  Edits are applied on the server (whitespace-tolerant), scanned like generated code, get one repair
  round if a search text does not match, and fall back to a full regeneration if that fails too.
  `generate` receives `mode: 'edit' | 'design'` so hosts route edits to a fast model with thinking
  off (the demo does: Gemini 2.5 Flash, `thinkingBudget: 0`); Veneer Cloud's Gemini adapter does
  the same. Responses carry `mode` and `edited`; `editMode: false` on the handler disables it.
  `classifyScope`, `applyEdits`, `buildEditPrompt`, `buildEditRepairPrompt` are exported.
- **State carry-over.** A small edit no longer throws away what the user was doing. The guest
  runtime keys every `useState` by component name, vnode key and hook index; before the previous
  interpreter is terminated the canvas asks it for a snapshot of those values (JSON only, 300 ms
  budget) and hands it to the next one, which uses a carried value as the initial state when the key
  exists and the type matches. Focus and caret return to the same generated element (matched by
  id). Applied for `mode: 'edit'`, undo and runtime repairs; a new view starts clean.
- **Runtime repair.** If a freshly applied UI crashes (a render error the static scan cannot see),
  the canvas records it on the provider (`engineError`) and `useVeneerGenerate` sends one hidden
  follow-up turn asking the model to fix it, then applies the fix. `repairOnError: false` disables;
  hidden turns carry `hidden: true` in `history`.
- **Images and links, opt-in.** `allow={{ images: [...], links: [...] }}` on the provider/canvas
  (URL prefixes, or `'same-origin'`, `'https:'`, and for images `'data:'`) lets the renderer keep
  `<img>` (lazy, no referrer, not draggable) and `<a href>` (cross-origin → new tab with
  `noopener noreferrer nofollow`) for listed destinations only; everything else is still dropped or
  demoted. Pass the same object to `createVeneerHandler({ allow })` and the prompt tells the model
  what it may use.
- **Spoofing marker.** The canvas draws a small persistent "AI-generated view" badge above anything
  generated code can paint (its z-index is capped below it). `badge` prop: a string, a node, or
  `false`.
- **Smaller, faster engine download.** QuickJS ships as a separate `dist/veneer-worker.wasm`
  (503 kB) next to a 650 kB `veneer-worker.js` instead of a 1.47 MB single file: streaming compile,
  browser-cached compiled module, no base64 decode. Hosts serve both files; a CSP needs
  `connect-src 'self'` for the fetch (plus `'wasm-unsafe-eval'` and `worker-src 'self'`).
- **Tunable limits.** `<VeneerCanvas limits={{ entryMs, initialEvalMs, memoryMB, maxOpsPerFlush }}>`
  for heavy views, clamped in the worker so deadlines can be loosened but never removed.
- **Fewer "it rendered but does nothing" gaps.** The interpreter now provides inert
  `ResizeObserver` / `IntersectionObserver` / `MutationObserver`, `matchMedia`, `getComputedStyle`,
  `requestIdleCallback`, `Event`/`CustomEvent`, `Node`/`Element`/`HTMLElement` constructors for
  `instanceof`, `navigator.clipboard`, `element.click()/dispatchEvent()/closest()/matches()` and
  scroll no-ops; `document.activeElement` follows `focus()`. Controlled text inputs that rewrite what
  the user typed keep the caret in place. The prompt tells the model elements cannot be measured.
- **Edit mode robustness.** A third matching tier compares with whitespace collapsed and quote
  style normalised (mapped back to the original span), so re-spaced JSX or `'`→`"` no longer forces a
  full regeneration; results carry `fallback: true` when one happened. The scope classifier tries
  edit mode for any short change request (the model may still answer with full code) and treats
  multi-part requests as designs.
- **Operational tripwire.** The worker checks once per UI that a plain utility class came out of
  Tailwind scoped under `.veneer-canvas`; a compiler/scoper drift reports a `style` error instead of
  silently unstyled views. Engine dependencies are pinned to exact versions.
- **Warm spare worker.** `VeneerCanvas` keeps one extra engine worker booted in the background
  while a UI is showing and the next UI adopts it, so a swap takes ~100–200 ms instead of the ~1 s
  cold start (QuickJS + Tailwind). Still one fresh interpreter per UI. The previous UI's height is
  held during the swap so the page does not jump. `warm={false}` disables it; `hasWarmWorker()` is
  exported for diagnostics.
- Demo: runs on `VeneerCanvas`; the `/veneer-frame` route is gone; a `prebuild` step copies the
  worker into `public/`.

### Fixed

- The sandbox frame loaded Tailwind from a patch-version Play CDN path
  (`cdn.tailwindcss.com/3.4.19`). The Play CDN does not guarantee every such path is served, and a
  miss failed silently (no SRI) and left every generated view completely unstyled while React still
  rendered. The frame now loads Tailwind from its documented origin, and reports an `error`
  (kind `style`) to the host if the runtime is still missing at init instead of failing silently.

- `useVeneerGenerate` no longer rejects chat and clarification turns for lacking a license token;
  only responses that carry code are checked. Rapid double submits are guarded synchronously.
  The unlicensed DEV token now produces an actionable message when used off localhost, and the
  check is skipped on runtimes without WebCrypto (the server already enforced the license).
- `VeneerFrame` mounts the iframe only after its message listener exists, so an `about:blank`
  load can no longer count as the document's first load. Prop changes after init reach the port
  handler. Host implementation errors are no longer forwarded verbatim into the sandbox; only
  bridge validation messages are. The torn-down state says whether a reset is required.
- `VeneerProvider` reads `onThemeError` / `onSecurityViolation` through refs, so inline callbacks
  do not re-fire theme reports on every render.
- Server: the intent gate no longer lets a greeting or opinion phrasing veto an explicit change
  request ("hi, make it a kanban", "hey add filters"). `design` alone is not a change verb.
- Server: cloud mode fails fast without `fetch`; `license: false` logs a warning in production;
  cross-origin embeds get CORS headers via `allowedOrigins`; cloud 429s are passed through with
  `retry-after`; responses include `remaining` and `licenseStale` where known.
- Cloud reference: generations are metered only after a successful result; API-key ids are
  derived from the secret; invalid quotas fall back to the starter plan; request bodies are
  capped; OpenAI/Anthropic request bodies use the parameters those APIs accept.
- Core: license tokens live 26 h (24 h offline grace + skew); `iat` in the future no longer
  rejects a token; the scanner refuses `<link>`, `<meta>`, `<iframe>`, `<script>`, `<style>` and
  similar elements, and computed member access whose key is built from strings
  (`o['con' + 'structor']`, template literals with expressions, `.join()`/`atob()` results).
  Numeric indexing such as `months[parseInt(x) - 1]` is allowed; an earlier draft of this rule
  refused it and made the sandbox reject the demo's default view on every load.

### Changed

- Exactly two packages are published: `@veneer/react` (MIT) and `@veneer/server` (commercial).
  `@veneer/core` is now a private workspace bundled into both at build time; hosts that need its
  helpers get them re-exported (`runBridgeAction`, `resolveTheme`, … from react;
  `hashRegistryShape`, `verifyLicenseToken`, … from server).
- Both published packages ship compiled ESM bundles (`dist/`, esbuild) with TypeScript
  declarations; `transpilePackages` is no longer needed. `@veneer/react` has no runtime
  dependencies besides React. All packages declare `engines.node >= 20`; MIT `LICENSE` files
  where applicable.
- Demo: security headers (CSP, HSTS, nosniff, referrer and permissions policies) on every page;
  canonical site URL from `NEXT_PUBLIC_SITE_URL`; the API route
  declares `maxDuration = 60`; the chat requires a license unless
  `NEXT_PUBLIC_VENEER_REQUIRE_LICENSE=false`.
- CI: unit tests, type check, Chromium e2e, demo build and `npm pack` dry runs on every PR.

## 0.3.0

- Split into `@veneer/core`, `@veneer/react` and `@veneer/server`; headless `useVeneerGenerate`.
- License layer: Ed25519 tokens, license client with 24 h grace, cloud mode, reference Veneer Cloud.
- Intent gate: the canvas changes only when the user asks for a change.
- Theme contract (`--veneer-*` variables, brand Tailwind utilities, inlined fonts, `autoHeight`).
