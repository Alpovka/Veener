// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { VeneerProvider, useVeneer, hashRegistry } from '../src/context.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const registry = { dataSources: [{ id: 'tasks' }], actions: [{ id: 'createTask', args: [{ name: 'title' }] }] };

function mount(props) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  const ref = { current: null };
  function Probe() {
    ref.current = useVeneer();
    return null;
  }
  act(() => {
    root.render(
      <VeneerProvider registry={registry} actions={{}} data={{}} defaultUI="DEFAULT" {...props}>
        <Probe />
      </VeneerProvider>
    );
  });
  return { ctx: () => ref.current, unmount: () => act(() => root.unmount()) };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('VeneerProvider persistence', () => {
  it('hydrates, persists an envelope, and bumps generation on setUi/reset', () => {
    const { ctx } = mount({ persist: 'local', storageKey: 'k1' });
    expect(ctx().loaded).toBe(true);
    expect(ctx().ui).toBe('DEFAULT');
    const g0 = ctx().generation;
    act(() => ctx().setUi('CODE A'));
    expect(ctx().ui).toBe('CODE A');
    expect(ctx().generation).toBe(g0 + 1);
    const stored = JSON.parse(localStorage.getItem('k1'));
    expect(stored).toMatchObject({ v: 1, code: 'CODE A', registryHash: hashRegistry(registry) });
    act(() => ctx().setUi(42)); // ignored
    expect(ctx().ui).toBe('CODE A');
    act(() => ctx().reset());
    expect(ctx().ui).toBe('DEFAULT');
    expect(localStorage.getItem('k1')).toBeNull();
    expect(ctx().generation).toBe(g0 + 2);
  });

  it('isolates providers by storageKey and ignores values that are not envelopes', () => {
    localStorage.setItem('k1', JSON.stringify({ v: 1, code: 'SAVED' }));
    localStorage.setItem('junk', 'not an envelope');
    const a = mount({ persist: 'local', storageKey: 'k1' });
    const b = mount({ persist: 'local', storageKey: 'other' });
    const c = mount({ persist: 'local', storageKey: 'junk' });
    expect(a.ctx().ui).toBe('SAVED');
    expect(b.ctx().ui).toBe('DEFAULT');
    expect(c.ctx().ui).toBe('DEFAULT');
  });

  it('ignores stored UIs saved under a different registry', () => {
    localStorage.setItem('k2', JSON.stringify({ v: 1, code: 'STALE', registryHash: 'nope' }));
    const { ctx } = mount({ persist: 'local', storageKey: 'k2' });
    expect(ctx().ui).toBe('DEFAULT');
  });

  it('uses sessionStorage or memory when asked', () => {
    const s = mount({ persist: 'session', storageKey: 'k3' });
    act(() => s.ctx().setUi('S'));
    expect(JSON.parse(sessionStorage.getItem('k3')).code).toBe('S');
    expect(localStorage.getItem('k3')).toBeNull();
    const m = mount({ persist: 'memory', storageKey: 'k4' });
    act(() => m.ctx().setUi('M'));
    expect(localStorage.getItem('k4')).toBeNull();
    expect(sessionStorage.getItem('k4')).toBeNull();
    expect(m.ctx().ui).toBe('M');
  });
});

describe('branding', () => {
  it('exposes resolved theme tokens, mode and the frame payload', () => {
    const onThemeError = vi.fn();
    const { ctx } = mount({ persist: 'memory', theme: { mode: 'dark', colors: { primary: '#112233', danger: 'url(x)' }, radius: { md: '14px' } }, onThemeError });
    expect(ctx().theme.colors.primary).toEqual({ light: '#112233', dark: '#112233' });
    expect(ctx().theme.radius.md).toBe('14px');
    expect(ctx().resolvedMode).toBe('dark');
    expect(ctx().themePayload).toMatchObject({ mode: 'dark', fonts: [] });
    expect(ctx().themePayload.vars.dark['--veneer-primary']).toBe('#112233');
    expect(onThemeError).toHaveBeenCalledWith(expect.objectContaining({ type: 'theme-invalid' }));
    expect(ctx().theme.colors.danger.light).toBe('#ef4444');
  });
  it('defaults to the system mode and the default palette', () => {
    const { ctx } = mount({ persist: 'memory' });
    expect(['light', 'dark']).toContain(ctx().resolvedMode);
    expect(ctx().theme.mode).toBe('system');
    expect(ctx().themePayload.vars.light['--veneer-primary']).toBe('#4f46e5');
  });
});

describe('violations', () => {
  it('quarantines the offending code, reverts to the default UI in a new generation and reports', () => {
    const onSecurityViolation = vi.fn();
    const { ctx } = mount({ persist: 'local', storageKey: 'v1', onSecurityViolation });
    act(() => ctx().setUi('EVIL'));
    const g = ctx().generation;
    act(() => ctx().flagViolation({ reason: 'frame-navigated', code: 'EVIL' }));
    expect(ctx().ui).toBe('DEFAULT');
    expect(ctx().generation).toBe(g + 1);
    expect(localStorage.getItem('v1')).toBeNull();
    expect(JSON.parse(localStorage.getItem('v1:quarantine'))).toMatchObject({ code: 'EVIL', reason: 'frame-navigated' });
    expect(ctx().violation).toMatchObject({ reason: 'frame-navigated', remounted: true, quarantined: true });
    expect(onSecurityViolation).toHaveBeenCalledWith(expect.objectContaining({ reason: 'frame-navigated' }));
    let restored;
    act(() => { restored = ctx().restoreQuarantined(); });
    expect(restored).toBe(true);
    expect(ctx().ui).toBe('EVIL');
    expect(localStorage.getItem('v1:quarantine')).toBeNull();
  });

  it('does not remount in a loop when the default UI itself is the offender', () => {
    const { ctx } = mount({ persist: 'memory' });
    const g = ctx().generation;
    act(() => ctx().flagViolation({ reason: 'scan-violation', code: 'DEFAULT' }));
    expect(ctx().generation).toBe(g);
    expect(ctx().violation.remounted).toBe(false);
    expect(ctx().ui).toBe('DEFAULT');
  });

  it('stops remounting after repeated violations in a short window', () => {
    const { ctx } = mount({ persist: 'memory' });
    for (let i = 0; i < 3; i++) {
      act(() => ctx().setUi('BAD' + i));
      act(() => ctx().flagViolation({ reason: 'frame-unresponsive', code: 'BAD' + i }));
      expect(ctx().violation.remounted).toBe(true);
    }
    act(() => ctx().setUi('BAD4'));
    act(() => ctx().flagViolation({ reason: 'frame-unresponsive', code: 'BAD4' }));
    expect(ctx().violation.remounted).toBe(false);
    expect(ctx().ui).toBe('DEFAULT');
  });
});
