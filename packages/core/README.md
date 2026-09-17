# @veneer/core

Framework-free building blocks shared by `@veneer/react` and `@veneer/server`:

- `runBridgeAction`, `validateArgs`, `typeChecker`, `pickRegisteredData`, `filterActionResult`,
  `createRateLimiter` — the bridge's validation of generated-code requests against a registry.
- `createScanner(parser, traverse)`, `registryIds(registry)` — the AST scan of generated code.

MIT licensed. You normally do not install this directly.
