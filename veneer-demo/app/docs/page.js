'use client';

import { useEffect, useState } from 'react';
import { SiteNav } from '../_components/site-nav';
import { EditorFrame, Check, Shield, kw, str, com, fn, prop, num, pl } from '../_components/visuals';

const NAV = [
  {
    group: 'Getting started',
    items: [
      ['Introduction', 'introduction'],
      ['Installation', 'installation'],
      ['Quick start', 'quick-start'],
    ],
  },
  {
    group: 'Concepts',
    items: [
      ['How it works', 'how-it-works'],
      ['The registry', 'registry'],
      ['In-frame API', 'in-frame-api'],
    ],
  },
  {
    group: 'Reference',
    items: [
      ['Components', 'components'],
      ['Security model', 'security'],
    ],
  },
];

const COMPONENTS = [
  ['VeneerProvider', 'Holds the registry, the real action implementations, and live data. Persists the current UI (localStorage / sessionStorage / memory via the persist prop).'],
  ['VeneerFrame', 'Renders the sandboxed iframe, injects generated code + the in-frame runtime, and runs the parent-side bridge.'],
  ['VeneerChat', 'The floating “redesign with AI” chat. Posts to /api/veneer, swaps in the returned UI. Accepts suggestions and endpoint props.'],
  ['useVeneer()', 'Access { registry, actions, data, ui, setUi, reset } inside the provider.'],
  ['VeneerLogo', 'The product mark, with an optional wordmark.'],
];

function Ic({ children }) {
  return (
    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.85em] text-brand-700 dark:bg-white/10 dark:text-brand-300">
      {children}
    </code>
  );
}

function H({ id, children }) {
  return (
    <h2 id={id} className="scroll-mt-28 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
      {children}
    </h2>
  );
}

function P({ children }) {
  return <p className="mt-3 leading-relaxed text-slate-600 dark:text-slate-400">{children}</p>;
}

export default function DocsPage() {
  const [active, setActive] = useState('introduction');

  useEffect(() => {
    document.title = 'Docs · Veneer';
  }, []);

  useEffect(() => {
    const ids = NAV.flatMap((g) => g.items.map(([, id]) => id));
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean);
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActive(e.target.id);
        });
      },
      { rootMargin: '-30% 0px -60% 0px', threshold: 0 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-[#070b18] dark:text-slate-200">
      <SiteNav linkPrefix="/" />

      <main className="mx-auto max-w-6xl px-5 pt-28">
        {/* header */}
        <div className="border-b border-slate-200 pb-10 dark:border-white/10">
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-brand-600 dark:border-white/10 dark:bg-white/5 dark:text-brand-300">
            Documentation
          </span>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-900 dark:text-white">
            Build with Veneer
          </h1>
          <p className="mt-3 max-w-2xl text-lg text-slate-600 dark:text-slate-400">
            Register the capabilities your app exposes, drop in three components, and let your users
            redesign the UI with AI — safely sandboxed.
          </p>
        </div>

        <div className="grid gap-12 py-12 lg:grid-cols-[220px_1fr]">
          {/* sidebar */}
          <aside className="hidden lg:block">
            <nav className="sticky top-28 space-y-7">
              {NAV.map((g) => (
                <div key={g.group}>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    {g.group}
                  </div>
                  <ul className="space-y-0.5 border-l border-slate-200 dark:border-white/10">
                    {g.items.map(([label, id]) => (
                      <li key={id}>
                        <a
                          href={`#${id}`}
                          className={`-ml-px block border-l-2 py-1 pl-3.5 text-sm transition-colors ${
                            active === id
                              ? 'border-brand-500 font-medium text-brand-600 dark:text-brand-300'
                              : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                          }`}
                        >
                          {label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </aside>

          {/* content */}
          <div className="min-w-0 max-w-2xl">
            <section>
              <H id="introduction">Introduction</H>
              <P>
                Veneer is an open-source React npm package — an “MCP for the UI layer.” Instead of shipping
                toggles for every layout, you expose a typed surface of <Ic>data sources</Ic> and{' '}
                <Ic>actions</Ic>; your users describe how they want a page to look, and the model
                writes real component code. That code runs inside a hard security sandbox and can only
                ever use what you registered.
              </P>
            </section>

            <section className="mt-12">
              <H id="installation">Installation</H>
              <P>
                Install the package and add its peer dependencies (<Ic>react</Ic> ≥ 18,{' '}
                <Ic>react-dom</Ic> ≥ 18).
              </P>
              <div className="mt-4">
                <EditorFrame file="bash">
                  <span className="select-none text-slate-500">$ </span>npm install veneer-sdk
                </EditorFrame>
              </div>
              <Callout>
                <strong>Preview Notice:</strong> The <Ic>veneer-sdk</Ic> package name is a placeholder for this live demo and private preview. The public npm package name and structure may change upon the package’s official release.
              </Callout>
              <P>
                The package ships untranspiled JSX. With Next.js, add{' '}
                <Ic>transpilePackages: ['veneer-sdk']</Ic> to <Ic>next.config.js</Ic>.
              </P>
            </section>

            <section className="mt-12">
              <H id="quick-start">Quick start</H>
              <P>
                Declare a registry, pass your real implementations, and render the three components.
                The registry’s plain-English descriptions are handed to the model; its ids are what
                the bridge enforces at runtime.
              </P>
              <div className="mt-4">
                <EditorFrame file="page.jsx">
                  <div>
                    {kw('const')} {pl('registry = {')}
                    {'\n'}
                    {'  '}{prop('dataSources')}{pl(': [{ ')}{prop('id')}{pl(': ')}{str("'tasks'")}{pl(', ')}{prop('description')}{pl(': ')}{str('"The user\'s tasks."')}{pl(' }],')}
                    {'\n'}
                    {'  '}{prop('actions')}{pl(': [')}
                    {'\n'}
                    {'    '}{pl('{ ')}{prop('id')}{pl(': ')}{str("'createTask'")}{pl(', ')}{prop('description')}{pl(': ')}{str("'Create a task.'")}{pl(' },')}
                    {'\n'}
                    {'    '}{pl('{ ')}{prop('id')}{pl(': ')}{str("'updateTask'")}{pl(', ')}{prop('description')}{pl(': ')}{str("'Update a task.'")}{pl(' },')}
                    {'\n'}
                    {'    '}<span>{com('// no deleteTask → generated UIs can never delete')}</span>
                    {'\n'}
                    {'  '}{pl('],')}
                    {'\n'}
                    {pl('};')}
                    {'\n\n'}
                    {pl('<')}{fn('VeneerProvider')} {prop('registry')}{pl('={registry} ')}{prop('actions')}{pl('={actions} ')}{prop('data')}{pl('={{ tasks }}>')}
                    {'\n'}
                    {'  '}{pl('<')}{fn('VeneerFrame')} {prop('style')}{pl('={{ ')}{prop('height')}{pl(': ')}{num('620')}{pl(' }} />')}
                    {'\n'}
                    {'  '}{pl('<')}{fn('VeneerChat')} {pl('/>')}
                    {'\n'}
                    {pl('</')}{fn('VeneerProvider')}{pl('>')}
                  </div>
                </EditorFrame>
              </div>
              <P>
                You also implement the generator endpoint (<Ic>POST /api/veneer</Ic>) that calls your
                LLM and returns <Ic>{'{ code, reply }'}</Ic>.
              </P>
            </section>

            <section className="mt-12">
              <H id="how-it-works">How it works</H>
              <ol className="mt-4 space-y-4">
                {[
                  ['You set the rules', 'List the data and actions your app allows, and plug in the real functions. That list is the only thing the AI can use.'],
                  ['Users describe it', 'They open the chat and say how they want the page to look. The model writes a self-contained component.'],
                  ['It runs safely', 'The component renders in a sandboxed iframe whose only channel is a validated bridge to your registered actions.'],
                ].map(([t, b], i) => (
                  <li key={t} className="flex gap-3">
                    <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-violet-600 text-xs font-bold text-white">
                      {i + 1}
                    </span>
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-white">{t}</div>
                      <div className="text-sm text-slate-600 dark:text-slate-400">{b}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section className="mt-12">
              <H id="registry">The registry</H>
              <P>
                The registry is the contract. A generated UI can only ever invoke an action whose id
                appears in <Ic>registry.actions</Ic>, and read a source whose id appears in{' '}
                <Ic>registry.dataSources</Ic>. If there is no <Ic>deleteTask</Ic>, code that calls it is
                refused before it runs and the bridge rejects it at runtime. Declare <Ic>args</Ic> with
                types — the bridge validates them — and add <Ic>returns</Ic> to the actions whose return
                value generated code may see.
              </P>
              <P>
                Treat each registered action like a public endpoint the user can call with arbitrary
                arguments — always validate and authorize on the server side inside your
                implementation.
              </P>
            </section>

            <section className="mt-12">
              <H id="in-frame-api">In-frame API</H>
              <P>Generated code is plain JSX with these globals available (no imports):</P>
              <ul className="mt-4 space-y-2.5">
                {[
                  ['veneer.data(sourceId)', 'Read a registered data source (returns the current value).'],
                  ['veneer.action(id, args)', 'Trigger a registered action (returns a Promise).'],
                  ['render(<App />)', 'Mount the component.'],
                ].map(([c, d]) => (
                  <li key={c} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                    <Ic>{c}</Ic>
                    <span className="text-sm text-slate-600 dark:text-slate-400">{d}</span>
                  </li>
                ))}
              </ul>
              <P>
                <Ic>fetch</Ic>, cookies, storage, and any external resource do not work inside the
                sandbox — all I/O goes through a private <Ic>MessageChannel</Ic> to the bridge. The server
                endpoint (<Ic>createVeneerHandler</Ic> from <Ic>veneer-sdk/server</Ic>) owns the registry,
                caps and rate-limits requests, and scans generated code before returning it.
              </P>
            </section>

            <section className="mt-12">
              <H id="components">Components &amp; API</H>
              <div className="mt-4 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 dark:divide-white/10 dark:border-white/10">
                {COMPONENTS.map(([name, desc]) => (
                  <div key={name} className="grid gap-1 p-4 sm:grid-cols-[200px_1fr] sm:gap-4">
                    <div>
                      <Ic>{name}</Ic>
                    </div>
                    <div className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">{desc}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-12">
              <H id="security">Security model</H>
              <P>Three independent layers, none of which depend on the model behaving, plus a static scan and a watchdog:</P>
              <ul className="mt-4 space-y-3">
                {[
                  ['Opaque origin', 'sandbox="allow-scripts allow-forms" with no allow-same-origin — no access to the parent’s cookies, DOM, or storage; no popups, downloads or top-level navigation.'],
                  ['No network', "A strict CSP sets connect-src 'none' and pins the four runtime scripts by exact URL (with SRI), so generated code can’t fetch, XHR, open a WebSocket, send a beacon, or import anything."],
                  ['Validated bridge', 'A private MessageChannel. Every action is validated — registered id, declared args and types, rate limit — before the real implementation runs; only declared return values and registered data cross back.'],
                  ['Scan + watchdog', 'Generated code is parsed and refused if it reaches for window, document, location, network globals, this, imports or unregistered ids. If a frame navigates itself or hangs, the canvas is reset and onSecurityViolation fires.'],
                  ['Known limit', 'A sandboxed frame can always navigate itself, and no browser lets a host prevent that — Veneer detects it and shuts the frame down, but data already inside the frame could leave in that first URL. Serve the frame from a URL (frameSrc) if your page has a strict CSP; see the SDK README for every residual.'],
                ].map(([t, b]) => (
                  <li key={t} className="flex gap-3">
                    <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-white">{t}</div>
                      <div className="text-sm text-slate-600 dark:text-slate-400">{b}</div>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-6 flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-white/10 dark:bg-white/[0.03]">
                <Shield className="mt-0.5 h-5 w-5 flex-none text-brand-600 dark:text-brand-300" />
                <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  The sandbox is a capability boundary, not a replacement for server-side authorization.
                  Validate arguments and enforce permissions inside every action implementation.
                </p>
              </div>
            </section>

            {/* footer CTA */}
            <div className="mt-16 flex flex-col items-start gap-4 border-t border-slate-200 pt-10 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-600 dark:text-slate-400">Ready to try it on your own app?</p>
              <div className="flex gap-3">
                <a
                  href="/#demo"
                  className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-white/15 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
                >
                  See the live demo
                </a>
                <a
                  href="/#pricing"
                  className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                >
                  Start 7 days free
                </a>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Callout({ children }) {
  return (
    <div className="mt-4 flex gap-3.5 rounded-xl border border-amber-200/50 bg-amber-50/50 p-4 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/5 dark:text-amber-300">
      <span className="mt-0.5 text-base">⚠️</span>
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}
