# @veneer/server

The generation endpoint for Veneer, for any Fetch-API runtime (Next.js route handlers, Remix,
Hono, Bun, Deno, Node 20+). It owns the registry, builds the prompt, guards the request, calls
**your** LLM through a callback, scans the generated code and never leaks provider errors.

Commercial license: requires a Veneer license key. Prefer Veneer Cloud if you do not want to
self-host; both return the same `{ code, reply }` to `@veneer/react`.

```js
import { createVeneerHandler } from '@veneer/server';
import { registry } from '../../veneer.config';

export const POST = createVeneerHandler({
  registry,
  licenseKey: process.env.VENEER_LICENSE_KEY,
  generate: ({ system, messages, signal }) => callYourModel(system, messages, { signal }),
  brand: { name: 'Acme', tone: 'calm, precise' },
});
```

That is the whole server side. The client's `VeneerCanvas` runs generated code in a Web Worker it
loads from your own origin (`dist/veneer-worker.js`), so no other route is needed. The system
prompt this package builds already describes the interpreter to the model: no browser globals, no
links or images, Tailwind classes only. (`buildFrameResponse` is still exported for hosts on the
legacy `VeneerFrame` iframe engine; it goes away with that engine.)

## Three ways to run it

| Mode | Options | Where the pipeline runs | What reaches Veneer |
| --- | --- | --- | --- |
| Self-hosted | `licenseKey` + `generate` | your server | one `POST /v1/license/verify` per generation: key, event, registry hash. Signed token back. |
| Veneer Cloud | `cloud: { apiKey, llm: { provider, key, model? } }` | Veneer Cloud, with **your** LLM key passed through | registry, brand, message, history, current UI, LLM key (for that request only) |
| Local development | `license: false` + `generate` | your machine | nothing. Issues a DEV token that `@veneer/react` accepts on localhost only. |

Both licensed modes return `{ code, intent, reply, token }`; the client verifies `token` against Veneer's
public keys before applying the code. If the license service is unreachable, self-hosted mode
keeps generating for 24 hours on the last successful check (`licenseStale: true` in responses).

## Intent gate: the canvas changes only when asked

The assistant is conversational. "Hey, how are you?", "what do you think of this design?", "what can
you do?" or "thanks!" get a reply and leave the canvas untouched; "make this a kanban board" changes
it; "make it better" gets one clarifying question. Two signals decide, and both must agree before
any code is applied:

1. the model labels its answer (`"intent": "design" | "chat" | "clarify"`), and
2. a local, rule-based classifier reads the message (`classifyIntent`, exported for your own UI
   hints or tests).

If the model says "design" but the local read is confidently "chat" (an opinion question, a
greeting), the code is dropped and logged via `onError` so prompts can be tuned. Responses carry
`intent`; `useVeneerGenerate` exposes it per history turn as `intent` and `changed`, so a chat UI
can show "Canvas updated" only when something changed.

## Edit mode: small changes are fast

Every request is classified as **design** (a new view; the model returns the whole component) or
**edit** (a tweak to the current UI — "make the add button collapsible", "hide the footer", "rounder
cards"; the model returns a few `{ search, replace }` edits against `currentUI`). Edits are a few
hundred output tokens instead of a few thousand, so they come back several times faster. The handler
applies them (tolerating re-indentation), scans the result exactly like generated code, gives the
model one repair round if a search text does not match, and falls back to a full regeneration if
that fails too — the canvas never sees a half-applied change.

Your `generate` callback receives `mode`. Route edits to a fast configuration:

```js
generate: async ({ system, messages, signal, mode }) => {
  const edit = mode === 'edit';
  const res = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: toGemini(messages),
    config: { systemInstruction: system, responseMimeType: 'application/json', abortSignal: signal,
              maxOutputTokens: edit ? 4000 : 12000,
              ...(edit ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
  });
  return res.text;
}
```

Responses carry `mode: 'edit' | 'design'`, `edited: true` when the code is the current UI plus
the model's edits, and `fallback: true` when edits could not be applied and the view was
regenerated instead (watch that rate). Matching is three-tiered — verbatim, per-line trimmed, then
whitespace-collapsed with quote style normalised — so re-spaced JSX or `'`→`"` still applies.
`editMode: false` turns the fast path off (everything regenerates), `maxEdits` caps the number of
edits accepted (default 30). `classifyScope(message, { currentUI })` and `applyEdits(code, edits)`
are exported for tests and custom pipelines.

## Images and links

By default the prompt tells the model there are no images and no links (the client renderer drops
them). If the host opts in on the client (`<VeneerProvider allow={{ images, links }}>`), pass the
same object here — `createVeneerHandler({ allow })` — and the prompt describes exactly which
sources are allowed, so the model uses them and nothing else.

## Verify → repair

Generated code is parsed and checked against the registry before it is returned. A fixable
failure (a stray `window`, `this`, an import) is sent back to the model once with the exact
violations; an unregistered capability is refused with a friendly reply instead. `maxRepairRounds`
controls the budget (default 1).

Other options: `rateLimit` (`{ limit, windowMs }`, a pluggable `async (key) => boolean`, or
`false`), `allowedOrigins`, `authorize(request)`, `onError`, size caps, `timeoutMs`, `brand`.
