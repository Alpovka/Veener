# @veneer/server

The generation endpoint for Veneer, for any Fetch-API runtime (Next.js route handlers, Remix,
Hono, Bun, Deno, Node 18+). It owns the registry, builds the prompt, guards the request, calls
**your** LLM through a callback, scans the generated code and never leaks provider errors.

Commercial license: requires a Veneer license key. Prefer Veneer Cloud if you do not want to
self-host; both return the same `{ code, reply }` to `@veneer/react`.

```js
import { createVeneerHandler, buildFrameResponse } from '@veneer/server';
import { registry } from '../../veneer.config';

export const POST = createVeneerHandler({
  registry,
  licenseKey: process.env.VENEER_LICENSE_KEY,
  generate: ({ system, messages, signal }) => callYourModel(system, messages, { signal }),
  brand: { name: 'Acme', tone: 'calm, precise' },
});
export const GET = () => buildFrameResponse({ frameAncestors: "'self'" }); // at /veneer-frame
```

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

## Verify → repair

Generated code is parsed and checked against the registry before it is returned. A fixable
failure (a stray `window`, `this`, an import) is sent back to the model once with the exact
violations; an unregistered capability is refused with a friendly reply instead. `maxRepairRounds`
controls the budget (default 1).

Other options: `rateLimit` (`{ limit, windowMs }`, a pluggable `async (key) => boolean`, or
`false`), `allowedOrigins`, `authorize(request)`, `onError`, size caps, `timeoutMs`, `brand`.
