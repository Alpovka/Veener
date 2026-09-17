# @veneer/react

Client SDK for Veneer: let your end users redesign a page with AI, inside a sandbox whose only
exit is a validated bridge to the capabilities you registered. MIT licensed and fully readable;
the security model never depends on this code being secret.

## Install

```bash
npm install @veneer/react @veneer/server
```

Ships untranspiled JSX. With Next.js add `transpilePackages: ['@veneer/react', '@veneer/core']`.

## Three things, no UI opinions

```jsx
'use client';
import { VeneerProvider, VeneerFrame, useVeneerGenerate } from '@veneer/react';
import { registry } from './veneer.config';

function RedesignBox() {
  const { generate, busy, reply, undo, canUndo, violation } = useVeneerGenerate();
  const [text, setText] = useState('');
  return (
    <div>
      <input value={text} onChange={(e) => setText(e.target.value)}
             onKeyDown={(e) => e.key === 'Enter' && generate(text)} disabled={busy} />
      {reply && <p>{reply}</p>}
      {canUndo && <button onClick={undo}>Undo</button>}
      {violation && <p role="alert">Reverted for safety.</p>}
    </div>
  );
}

export default function Page({ userId }) {
  const [tasks, setTasks] = useState([]);
  const actions = useMemo(() => ({ /* real implementations */ }), []);
  return (
    <VeneerProvider registry={registry} actions={actions} data={{ tasks }} storageKey={`veneer-ui:${userId}`}>
      <VeneerFrame frameSrc="/veneer-frame" autoHeight />
      <RedesignBox />
    </VeneerProvider>
  );
}
```

- **`VeneerProvider`** holds the registry, your real action functions, live data and (optionally)
  a theme; persists the current UI per `storageKey`; quarantines misbehaving UIs.
- **`VeneerFrame`** renders the sandbox and runs the bridge. Every action from generated code is
  validated against the registry before your function runs.
- **`useVeneerGenerate()`** is headless: `generate(message)` posts `{ message, history,
  currentUI }` to your endpoint (default `/api/veneer`) and swaps in the returned code. Build any
  chat box, command palette or button on top. The registry is never sent; the server owns it.

The endpoint is `createVeneerHandler` from `@veneer/server` (self-hosted, license key) or
Veneer Cloud (hosted, API key). Both return `{ code, reply }`.

## What moved in 0.3

`VeneerChat` and `VeneerLogo` left the SDK; the demo keeps them as examples under
`examples/demo/app/_components`. Bridge validators, the scanner, the frame document and the
theme helpers live in `@veneer/core` and are re-exported here where hosts need them.

## Security model, branding, limits

See the repository README. In short: opaque-origin iframe, `connect-src 'none'` CSP with four
pinned, hash-verified runtime scripts, a private MessageChannel bridge that validates ids, args,
types, sizes and rate, a static scan before eval, and a watchdog that quarantines and resets.
A worker-based engine that renders natively in your page (no iframe) is in development.

## Tests

```bash
npm test                 # vitest
npm run test:e2e         # Chromium end-to-end (uses /opt/pw-browsers or CHROME_PATH)
```
