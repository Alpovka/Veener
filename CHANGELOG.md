# Changelog

All notable changes to the Veneer packages. Versions follow semver; the three published packages
(`@veneer/core`, `@veneer/react`, `@veneer/server`) are released together with the same version.

## Unreleased

### Fixed

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
  similar elements and computed member access built from expressions.

### Changed

- `@veneer/react` now publishes a compiled ESM bundle (`dist/`) with TypeScript declarations;
  `transpilePackages` is no longer needed. `@veneer/core` and `@veneer/server` ship declarations
  too. All packages declare `engines.node >= 20` and MIT `LICENSE` files where applicable.
- Demo: security headers (CSP, HSTS, nosniff, referrer and permissions policies) on every page
  except the sandbox document; canonical site URL from `NEXT_PUBLIC_SITE_URL`; the API route
  declares `maxDuration = 60`; the chat requires a license unless
  `NEXT_PUBLIC_VENEER_REQUIRE_LICENSE=false`.
- CI: unit tests, type check, Chromium e2e, demo build and `npm pack` dry runs on every PR.

## 0.3.0

- Split into `@veneer/core`, `@veneer/react` and `@veneer/server`; headless `useVeneerGenerate`.
- License layer: Ed25519 tokens, license client with 24 h grace, cloud mode, reference Veneer Cloud.
- Intent gate: the canvas changes only when the user asks for a change.
- Theme contract (`--veneer-*` variables, brand Tailwind utilities, inlined fonts, `autoHeight`).
