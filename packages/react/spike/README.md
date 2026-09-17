# M0 spike — interpreter-in-worker engine (go/no-go)

Run: `node spike/quickjs-spike.mjs` and `node spike/tailwind-spike.mjs` (after `npm install`).
Guest bundle: `npx esbuild spike/guest.js --bundle --format=iife --target=es2020 --minify --outfile=spike/guest.bundle.js`.

## Result: GO (17/17)

| Check | Result |
| --- | --- |
| Boot QuickJS (wasmfile release variant) in Node | ~8 ms after wasm compile |
| Evaluate Preact + fake DOM guest bundle (16 KB) inside the interpreter | ~15 ms |
| Compile generated JSX with sucrase, render to ops | 6 ms + 3 ms, 13 ops |
| Dispatch a click → setState → re-render → diff ops | ~1 ms, 3 ops |
| setTimeout shim through glue | works |
| Raw glue can be hidden from later code | works |
| `while(true)` | interrupted at the deadline, VM reusable |
| Microtask storm | bounded by the drain cap |
| `/(a+)+$/` catastrophic regex | interrupted (QuickJS checks the interrupt every 10k backtracks) |
| Allocation loop with 64 MB cap | `InternalError: out of memory`, VM reusable |
| Deep recursion | `InternalError: stack overflow` when `setMaxStackSize` ≤ 384 KB; **1 MB crashes the host process** (Wasm stack is smaller). Use 256 KB. |
| Ambient globals | `fetch XMLHttpRequest location document window importScripts WebSocket` all undefined |
| Missing conveniences to shim in M1 | `Intl crypto structuredClone URL TextEncoder` |
| Tailwind v4 `compile()` in Node with `@import "tailwindcss" prefix(v)` | ~10 ms; emits `v:`-prefixed utilities, `@theme` maps `--color-primary` to `var(--veneer-primary)`, `bg-primary/50` → `color-mix`, arbitrary `bg-[url(...)]` passes (must be filtered by candidate grammar) |

## Learnings that change M1

- Preact resolves event names by checking `'onclick' in dom`; the fake DOM must expose known
  `on*` properties or listeners are registered under the wrong name.
- Preact's event proxy needs the element as `this`; dispatch with `listener.call(el, event)`.
- sucrase must run with `production: true` or it injects `__self`/`__source` attributes.
- `build()` of Tailwind's `compile`/`compileAst` returns a CSS string in 4.3; scoping and
  `@layer` flattening will be done on the string with a small block parser.
- Prefix must be declared on the root `@import "tailwindcss"`; it also prefixes theme variables
  (`--v-color-primary`).

## Browser check (Chromium)

- `WebAssembly.compileStreaming` of the QuickJS wasm in a worker: ~8 ms; posting the compiled
  `WebAssembly.Module` to the page and into a second worker works (reuse ~0.1 ms). Warm starts
  are therefore compile-free.
- Worker served with `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self';
  worker-src 'none'`: external `fetch` blocked; same-origin `importScripts` and nested `new Worker`
  still allowed by Chromium (they fall under `script-src 'self'`). Irrelevant to the boundary
  (generated code never runs in the worker realm) but documented; the worker code itself never
  calls either.
