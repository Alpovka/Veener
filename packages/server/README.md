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

Options: `rateLimit` (`{ limit, windowMs }`, a pluggable `async (key) => boolean`, or `false`),
`allowedOrigins`, `authorize(request)`, `onError`, size caps, `timeoutMs`.
