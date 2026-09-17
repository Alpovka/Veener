// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://app.example.com/" }
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { VeneerProvider } from '../src/context.js';
import { useVeneerGenerate } from '../src/useVeneerGenerate.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const registry = { dataSources: [{ id: 'tasks' }], actions: [{ id: 'createTask' }] };

function mount(hookOpts) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  const ref = { current: null };
  function Probe() {
    ref.current = useVeneerGenerate(hookOpts);
    return null;
  }
  act(() => {
    root.render(
      <VeneerProvider registry={registry} actions={{}} data={{}} defaultUI="DEFAULT" persist="memory">
        <Probe />
      </VeneerProvider>
    );
  });
  return () => ref.current;
}

describe('useVeneerGenerate on a deployed origin', () => {
  it('explains the dev token off localhost instead of a generic license error', async () => {
    expect(window.location.hostname).toBe('app.example.com');
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ code: 'X', reply: 'x', token: 'dev' }) }));
    const hook = mount({ fetch: fetchImpl });
    let r;
    await act(async () => {
      r = await hook().generate('go');
    });
    expect(r.code).toBe('unlicensed');
    expect(r.reason).toBe('dev-token');
    expect(r.error).toMatch(/localhost/);
    expect(hook().currentUI).toBe('DEFAULT');
  });

  it('still lets chat turns through without any token', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ code: null, reply: 'Hi!', intent: 'chat' }) }));
    const hook = mount({ fetch: fetchImpl });
    let r;
    await act(async () => {
      r = await hook().generate('hello');
    });
    expect(r).toMatchObject({ ok: true, changed: false, intent: 'chat' });
  });
});
