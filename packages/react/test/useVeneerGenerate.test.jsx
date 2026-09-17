// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { VeneerProvider } from '../src/context.js';
import { useVeneerGenerate } from '../src/useVeneerGenerate.js';
import { generateKeyPair, importPrivateKey, signLicenseToken, hashRegistryShape } from '@veneer/core';

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

const jsonResponse = (body, status = 200) => ({ ok: status < 400, status, json: async () => ({ token: 'dev', ...body }) });

describe('useVeneerGenerate', () => {
  it('posts message/history/currentUI (never the registry), swaps in code, records reply and undo', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 'render(<b/>)', reply: 'Board ready.' }));
    const hook = mount({ endpoint: '/gen', fetch: fetchImpl });
    let out;
    await act(async () => {
      out = await hook().generate('make a board');
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/gen');
    const body = JSON.parse(init.body);
    expect(body).toEqual({ message: 'make a board', currentUI: 'DEFAULT', history: [] });
    expect(body.registry).toBeUndefined();
    expect(out).toMatchObject({ ok: true, changed: true, reply: 'Board ready.' });
    expect(hook().currentUI).toBe('render(<b/>)');
    expect(hook().history.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(hook().reply).toBe('Board ready.');
    expect(hook().canUndo).toBe(true);
    act(() => {
      hook().undo();
    });
    expect(hook().currentUI).toBe('DEFAULT');
  });

  it('keeps the UI on code:null and surfaces errors without throwing', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: null, reply: 'Not available.' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Too many requests.' }, 429))
      .mockRejectedValueOnce(new Error('offline'));
    const hook = mount({ fetch: fetchImpl });
    await act(async () => {
      await hook().generate('delete everything');
    });
    expect(hook().currentUI).toBe('DEFAULT');
    expect(hook().history[1]).toMatchObject({ role: 'assistant', content: 'Not available.', changed: false });
    expect(hook().canUndo).toBe(false);
    let r;
    await act(async () => {
      r = await hook().generate('again');
    });
    expect(r).toMatchObject({ ok: false, error: 'Too many requests.' });
    expect(hook().error).toBe('Too many requests.');
    await act(async () => {
      r = await hook().generate('again');
    });
    expect(r.ok).toBe(false);
    expect(hook().history.at(-1).error).toBe(true);
  });

  it('ignores empty input and concurrent calls while busy, and sends bounded history', async () => {
    let resolve;
    const fetchImpl = vi.fn(() => new Promise((res) => (resolve = res)));
    const hook = mount({ fetch: fetchImpl });
    expect(await hook().generate('   ')).toBeNull();
    let p;
    act(() => {
      p = hook().generate('first');
    });
    expect(hook().busy).toBe(true);
    expect(await hook().generate('second')).toBeNull();
    await act(async () => {
      resolve(jsonResponse({ code: null, reply: 'ok' }));
      await p;
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(hook().busy).toBe(false);
  });

  it('reset clears history, undo stack and restores the default UI', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 'render(<i/>)', reply: 'x' }));
    const hook = mount({ fetch: fetchImpl });
    await act(async () => {
      await hook().generate('go');
    });
    act(() => hook().reset());
    expect(hook().currentUI).toBe('DEFAULT');
    expect(hook().history).toEqual([]);
    expect(hook().canUndo).toBe(false);
  });
});

describe('license tokens', () => {
  it('accepts a signed token for this registry, rejects unsigned/foreign ones off localhost', async () => {
    const kp = await generateKeyPair();
    const other = await generateKeyPair();
    const priv = await importPrivateKey(kp.privateKey);
    const good = await signLicenseToken({ sub: 'k', reg: hashRegistryShape(registry) }, priv);
    const foreign = await signLicenseToken({ sub: 'k', reg: hashRegistryShape(registry) }, await importPrivateKey(other.privateKey));
    const wrongReg = await signLicenseToken({ sub: 'k', reg: 'nope' }, priv);
    const responses = [{ code: 'A', reply: 'a', token: good }, { code: 'B', reply: 'b', token: foreign }, { code: 'C', reply: 'c', token: wrongReg }, { code: 'D', reply: 'd' }];
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => responses.shift() }));
    const hook = mount({ fetch: fetchImpl, publicKeys: [kp.publicKey] });
    await act(async () => { await hook().generate('1'); });
    expect(hook().currentUI).toBe('A');
    let r;
    await act(async () => { r = await hook().generate('2'); });
    expect(r.code).toBe('unlicensed');
    expect(hook().currentUI).toBe('A');
    await act(async () => { r = await hook().generate('3'); });
    expect(r.code).toBe('unlicensed');
    await act(async () => { r = await hook().generate('4'); });
    expect(r.code).toBe('unlicensed');
  });
  it('accepts the dev token on localhost only', async () => {
    // jsdom's default URL is http://localhost:3000 → dev token accepted (the earlier tests rely on this)
    expect(window.location.hostname).toBe('localhost');
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ code: 'X', reply: 'x', token: 'dev' }) }));
    const hook = mount({ fetch: fetchImpl });
    await act(async () => { await hook().generate('go'); });
    expect(hook().currentUI).toBe('X');
    const strict = mount({ fetch: fetchImpl, requireLicense: false });
    await act(async () => { await strict().generate('go'); });
    expect(strict().currentUI).toBe('X');
  });
});
