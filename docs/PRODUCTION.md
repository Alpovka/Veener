# Going to production

What has to exist outside this repository before the product can be sold, and how to deploy each
piece. The code paths below are covered by tests; the infrastructure is not created by this repo.

## 1. Signing key (blocking)

`packages/core/src/license.js` embeds `LICENSE_PUBLIC_KEYS`. The value in the repository is a
**placeholder public key whose private half was never saved**, so no real token can be minted yet.

```bash
node packages/cloud/bin/keygen.mjs
# prints VENEER_SIGNING_KEY=<pkcs8, base64url>  and  public key <raw, base64url>
```

1. Store `VENEER_SIGNING_KEY` in the secret manager of the license service. Never in git.
2. Replace the placeholder in `LICENSE_PUBLIC_KEYS` with the printed public key and release
   `@veneer/react` and `@veneer/server` (the key list is bundled into both). Clients verify tokens offline against that list.
3. Rotation: generate a second pair, **add** its public key to the list, ship a client release,
   wait until old clients are gone, then switch `VENEER_SIGNING_KEY` and later remove the old key.
   Tokens live 26 hours, so a switch is safe once the new public key is deployed.

## 2. License / cloud service (blocking for paid modes)

`@veneer/server` calls `https://api.veneer.dev` by default (`DEFAULT_LICENSE_API`,
`DEFAULT_CLOUD_API`). Until that host exists, self-hosted licensed mode and cloud mode fail closed
(24 h grace only applies after one successful check).

Deploy `packages/cloud` (`node bin/serve.mjs`, or mount `createCloudApp()` in your platform of
choice) behind TLS at that host, with:

| Variable | Purpose |
| --- | --- |
| `VENEER_SIGNING_KEY` | private key from step 1 |
| `VENEER_KEYS` | `secret:plan:quota,...` for the in-memory store (dev only) |
| a database-backed store | implement `findBySecret`, `getUsage`, `increment`, `upsert` for production |

Routes: `POST /v1/license/verify`, `POST /v1/generate`, `GET /v1/health`. Put a rate limiter and
request-size cap at the edge as well; the in-process ones are per instance.

## 3. Publishing the packages

```bash
npm run typecheck && npm test && npm run test:e2e
(cd packages/react  && npm publish)   # MIT, prepack builds dist/ (core bundled in)
(cd packages/server && npm publish)   # commercial license, prepack builds dist/ (core bundled in)
```

Exactly two packages are published; `packages/core` is private and bundled into both. The
`@veneer` npm scope must be owned by the company account; `publishConfig.access` is `public` on
both. Decide the spelling (`@veneer` vs `@veener`) before the first publish: npm names are
permanent. Both scopes were free on 2026-09-17; the unscoped name `veneer` is taken.

## 4. Demo site (Vercel)

- Root Directory: `examples/demo`. `vercel.json` runs `npm ci` and the workspace build from the
  repository root.
- Environment: `GEMINI_API_KEY`; then **one of** `VENEER_CLOUD_API_KEY`, `VENEER_LICENSE_KEY`, or
  `NEXT_PUBLIC_VENEER_REQUIRE_LICENSE=false` (the last runs the demo unlicensed; generated code is
  accepted without a token). `NEXT_PUBLIC_SITE_URL` for canonical metadata. `RESEND_API_KEY` and
  the optional waitlist variables.
- Node 24 (`.nvmrc`; the demo's `engines.node` tells Vercel the same). The API route declares `maxDuration = 60`; the model call times out at 45 s.

## 5. Before the first customer

- Change `security@veneer.dev` in `SECURITY.md` to a monitored mailbox, or use GitHub advisories.
- Decide the canonical domain (the demo defaults to `veener.vercel.app`; the license API defaults
  to `api.veneer.dev`) and set both consistently.
- Terms and privacy pages in the demo are placeholders written for the demo, not for the paid
  product.
- The in-process rate limiter in `createVeneerHandler` is per instance; on serverless platforms
  pass a shared `rateLimit(key)` (Redis, Upstash, KV) for real protection.
