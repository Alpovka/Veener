# @veneer/cloud (reference implementation)

The hosted side of Veneer, as a Fetch-API app you can run anywhere (`bin/serve.mjs` for Node,
or mount `createCloudApp()` in a Next.js / Hono / Cloudflare handler).

| Route | Who calls it | What it does |
| --- | --- | --- |
| `POST /v1/license/verify` | self-hosted `@veneer/server` | authenticates the license key, meters one generation against the monthly quota, returns a signed token |
| `POST /v1/generate` | `@veneer/server` in cloud mode | authenticates the API key, meters, runs the generation pipeline (prompt → the customer's LLM → scan → repair) with the customer's LLM key, returns `{ code, reply, token }` |
| `GET /v1/health` | monitoring | `{ ok: true }` |

Tokens are Ed25519 signatures over `{ sub, plan, evt: 'generation', reg, iat, exp }`; clients
verify them offline with the public keys embedded in `@veneer/core`. Rotate by running
`bin/keygen.mjs`, adding the new public key to `LICENSE_PUBLIC_KEYS`, shipping a client release,
then switching `VENEER_SIGNING_KEY`.

Privacy: the customer's LLM key is used for the single request and never stored; prompts and code
are not persisted; the store only holds key records and monthly counts.

```bash
node bin/keygen.mjs                       # prints VENEER_SIGNING_KEY and the public key
VENEER_SIGNING_KEY=... VENEER_KEYS="vn_live_abc:pro:10000" node bin/serve.mjs
```

The in-memory store (`createMemoryStore`) is for development and tests; production implements
the same four methods (`findBySecret`, `getUsage`, `increment`, `upsert`) over a database.
