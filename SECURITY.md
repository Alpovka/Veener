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

In scope: `@veneer/react`, `@veneer/server` (including the bundled `packages/core` internals), the
reference `@veneer/cloud`, and the sandbox document they serve.

Reports about the documented residual risks are welcome only when they show something new. The
known limits are listed in the root README (self-navigation of a sandboxed frame, host CSP
inheritance in `srcDoc` mode, CPU hot loops, UI spoofing inside the canvas) and in
`packages/react/README.md`.

Licensing is a commercial control, not a security boundary. Bypassing the license check is a
license violation, not a vulnerability report.

## Supported versions

The latest minor release of each package receives fixes.
