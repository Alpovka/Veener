# Security policy

Veneer runs model-generated code inside customers' products. We treat every report seriously.

## Reporting a vulnerability

Email **security@veneer.dev** (or, until that mailbox is live, open a private security advisory on
GitHub: *Security → Report a vulnerability*). Please include the affected package and version, a
proof of concept, and the impact you believe it has. Do not open a public issue for a security
problem.

You will get an acknowledgement within 2 business days and a fix or mitigation plan within 14 days
for anything that lets generated code escape the sandbox, reach the network, or call an action
that was not registered.

## Scope

In scope: `@veneer/react` (the `VeneerCanvas` engine: the interpreter worker, the guest runtime,
the allowlisted renderer and the bridge; and the legacy `VeneerFrame` engine while it ships),
`@veneer/server` (including the bundled `packages/core` internals) and the reference `@veneer/cloud`.

Especially interesting: anything that makes generated code reach a browser API from inside the
interpreter, a rendered node that escapes the allowlist (a URL-loading element/attribute/style, a
node painted outside the canvas), CSS that reaches the host page, or an action that runs without
having been registered.

Reports about the documented residual risks are welcome only when they show something new. The
known limits are listed in the root README (UI spoofing inside the canvas, native allocation loops
holding the worker until the heartbeat terminates it, `'wasm-unsafe-eval'` in the host CSP) and in
`packages/react/README.md`.

Licensing is a commercial control, not a security boundary. Bypassing the license check is a
license violation, not a vulnerability report.

## Supported versions

The latest minor release of each package receives fixes.
