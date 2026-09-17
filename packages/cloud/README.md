# @veneer/cloud (reference implementation)

The hosted side of Veneer, as a Fetch-API app you can run anywhere (`bin/serve.mjs` for Node,
or mount `createCloudApp()` in a Next.js / Hono / Cloudflare handler).

| Route | Who calls it | What it does |
| --- | --- | --- |
| `POST /v1/license/verify` | self-hosted `@veneer/server` | authenticates the license key, meters one generation against the monthly quota, returns a signed token |
| `POST /v1/generate` | `@veneer/server` in cloud mode | authenticates the API key, meters, runs the generation pipeline (prompt → the customer's LLM → scan → repair) with the customer's LLM key, returns `{ code, reply, token }` |
| `GET /v1/health` | monitoring | `{ ok: true }` |

Tokens are Ed25519 signatures over `{ sub, plan, evt: 'generation', reg, iat, exp }` (26 h
lifetime); clients verify them offline with the public keys embedded in `@veneer/core`.

**The public key currently in the repository is a placeholder without a saved private half.**
Before the first production deployment run `node bin/keygen.mjs`, store the printed
`VENEER_SIGNING_KEY` in a secret manager, and replace `LICENSE_PUBLIC_KEYS` with the printed
public key. Rotation runbook: generate a new pair → *add* its public key to the list → release
`@veneer/core`/`@veneer/react` → wait for old clients to update → switch `VENEER_SIGNING_KEY` →
remove the old public key in a later release. See `docs/PRODUCTION.md`.

Only successful generations are metered: chat turns, clarifying questions, refusals and provider
failures are not charged and carry no token.

Privacy: the customer's LLM key is used for the single request and never stored; prompts and code
are not persisted; the store only holds key records and monthly counts.

```bash
node bin/keygen.mjs                       # prints VENEER_SIGNING_KEY and the public key
VENEER_SIGNING_KEY=... VENEER_KEYS="vn_live_abc:pro:10000" node bin/serve.mjs
```

The in-memory store (`createMemoryStore`) is for development and tests; production implements
the same four methods (`findBySecret`, `getUsage`, `increment`, `upsert`) over a database.
