# @veneer/core (internal)

Framework-free building blocks shared by `@veneer/react` and `@veneer/server`:

- `runBridgeAction`, `validateArgs`, `typeChecker`, `pickRegisteredData`, `filterActionResult`,
  `createRateLimiter` — the bridge's validation of generated-code requests against a registry.
- `createScanner(parser, traverse)`, `registryIds(registry)` — the AST scan of generated code.
- `buildFrameSrcDoc` / `FRAME_CSP` / `FRAME_SANDBOX` — the sandbox document and its policy.
- `resolveTheme`, `themePayload`, `loadThemeFonts` — the branding contract.
- `signLicenseToken`, `verifyLicenseToken`, `LICENSE_PUBLIC_KEYS` — Ed25519 license tokens.

This workspace is **not published**. Each published package bundles it at build time (see
`packages/react/build.mjs` and `packages/server/build.mjs`), so users install exactly two
packages and never see this one. Its tests run with the rest of the workspace (`npm test`).
