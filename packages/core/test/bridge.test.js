import { describe, it, expect } from 'vitest';
import {
  typeChecker,
  validateArgs,
  runBridgeAction,
  pickRegisteredData,
  createRateLimiter,
  filterActionResult,
  readDataSource,
  BridgeError,
} from '../src/bridge.js';

const registry = {
  dataSources: [{ id: 'tasks', fields: [] }],
  actions: [
    {
      id: 'createTask',
      returns: 'The task.',
      args: [
        { name: 'title', type: 'string', required: true },
        { name: 'status', type: '"todo" | "doing" | "done"', required: false },
        { name: 'dueDate', type: 'string (YYYY-MM-DD) or null', required: false },
      ],
    },
    { id: 'updateTask', args: [{ name: 'id', type: 'string', required: true }, { name: 'status', type: 'enum: "todo" | "doing" | "done"' }] },
    { id: 'strict', validate: (a) => (a.n === 1 ? { success: true, data: { n: 1, normalized: true } } : { success: false, error: new Error('n must be 1') }) },
    { id: 'free' },
  ],
};

describe('typeChecker', () => {
  it('parses primitives, enums and nullability from prose types', () => {
    expect(typeChecker('string').test('x')).toBe(true);
    expect(typeChecker('string').test(1)).toBe(false);
    expect(typeChecker('number').test(1.5)).toBe(true);
    expect(typeChecker('integer').test(1.5)).toBe(false);
    expect(typeChecker('boolean').test(false)).toBe(true);
    expect(typeChecker('array of strings').test([])).toBe(true);
    expect(typeChecker('object').test({})).toBe(true);
    const en = typeChecker('"todo" | "doing" | "done"');
    expect(en.kind).toBe('enum');
    expect(en.test('doing')).toBe(true);
    expect(en.test('deleted')).toBe(false);
    expect(typeChecker("enum: 'a' | 'b'").test('b')).toBe(true);
    expect(typeChecker('string (YYYY-MM-DD) or null').nullable).toBe(true);
    expect(typeChecker('string').nullable).toBe(false);
    expect(typeChecker('something weird')).toBeNull();
    expect(typeChecker(undefined)).toBeNull();
  });
});

describe('validateArgs', () => {
  const def = registry.actions[0];
  it('accepts declared, well-typed args', () => {
    expect(validateArgs(def, { title: 'x', status: 'todo', dueDate: null })).toEqual({ title: 'x', status: 'todo', dueDate: null });
    expect(validateArgs(def, { title: 'x' })).toEqual({ title: 'x' });
  });
  it('rejects non-objects and arrays', () => {
    expect(() => validateArgs(def, [])).toThrow(BridgeError);
    expect(() => validateArgs(def, 'title')).toThrow(/plain object/);
    expect(() => validateArgs(def, new Date())).toThrow(/plain object/);
  });
  it('rejects undeclared keys and missing required keys', () => {
    expect(() => validateArgs(def, { title: 'x', evil: 1 })).toThrow(/unexpected arg "evil"/);
    expect(() => validateArgs(def, {})).toThrow(/missing required arg "title"/);
  });
  it('type-checks primitives and enums, allows declared nulls', () => {
    expect(() => validateArgs(def, { title: 5 })).toThrow(/must be string/);
    expect(() => validateArgs(def, { title: 'x', status: 'deleted' })).toThrow(/one of "todo", "doing", "done"/);
    expect(() => validateArgs(def, { title: null })).toThrow(/must not be null/);
    expect(validateArgs(def, { title: 'x', dueDate: null })).toBeTruthy();
  });
  it('rejects prototype-polluting keys anywhere in the payload', () => {
    const poisoned = JSON.parse('{"title":"x","__proto__":{"polluted":true}}');
    expect(() => validateArgs(registry.actions[3], poisoned)).toThrow(/forbidden key "__proto__"/);
    expect(() => validateArgs(registry.actions[3], { a: { b: { constructor: 1 } } })).toThrow(/forbidden key "constructor"/);
    expect(() => validateArgs(registry.actions[3], { list: [{ prototype: 1 }] })).toThrow(/forbidden key "prototype"/);
    expect({}.polluted).toBeUndefined();
  });
  it('enforces size and depth limits', () => {
    expect(() => validateArgs(registry.actions[3], { s: 'x'.repeat(70000) })).toThrow(/exceed 65536 bytes/);
    let deep = {};
    let cur = deep;
    for (let i = 0; i < 12; i++) {
      cur.n = {};
      cur = cur.n;
    }
    expect(() => validateArgs(registry.actions[3], deep)).toThrow(/depth/);
    expect(validateArgs(registry.actions[3], { s: 'ok' }, { limits: { maxBytes: 100 } })).toBeTruthy();
    expect(() => validateArgs(registry.actions[3], { s: 'x'.repeat(200) }, { limits: { maxBytes: 100 } })).toThrow(/100 bytes/);
  });
  it('rejects non-serializable args', () => {
    expect(() => validateArgs(registry.actions[3], { big: 10n })).toThrow(/JSON-serializable/);
  });
  it('prefers a developer validate() hook and returns its parsed data', () => {
    expect(validateArgs(registry.actions[2], { n: 1 })).toEqual({ n: 1, normalized: true });
    expect(() => validateArgs(registry.actions[2], { n: 2 })).toThrow(/n must be 1/);
  });
  it('applies only shape rules when no args are declared', () => {
    expect(validateArgs(registry.actions[3], { anything: [1, 2] })).toEqual({ anything: [1, 2] });
  });
});

describe('runBridgeAction', () => {
  const actions = {
    createTask: (a) => ({ id: 't1', ...a, secret: 'internal' }),
    updateTask: (a) => ({ ...a, secret: 'internal' }),
    free: () => 'value',
  };
  it('rejects unregistered ids without touching implementations', async () => {
    let called = false;
    await expect(
      runBridgeAction({ registry, actions: { ...actions, deleteTask: () => (called = true) }, action: 'deleteTask', args: { id: 't1' } })
    ).rejects.toThrow(/not registered/);
    expect(called).toBe(false);
    await expect(runBridgeAction({ registry, actions, action: 5, args: {} })).rejects.toThrow(/must be a string/);
  });
  it('rejects registered actions with no implementation', async () => {
    await expect(runBridgeAction({ registry, actions: {}, action: 'createTask', args: { title: 'x' } })).rejects.toThrow(/no implementation/);
  });
  it('validates args before running', async () => {
    let called = false;
    await expect(runBridgeAction({ registry, actions: { createTask: () => (called = true) }, action: 'createTask', args: { title: 'x', nope: 1 } })).rejects.toThrow(/unexpected arg/);
    expect(called).toBe(false);
  });
  it('returns results only for actions that declare `returns`', async () => {
    const r = await runBridgeAction({ registry, actions, action: 'createTask', args: { title: 'x' } });
    expect(r).toMatchObject({ id: 't1', title: 'x' });
    expect(await runBridgeAction({ registry, actions, action: 'updateTask', args: { id: 't1', status: 'done' } })).toBeUndefined();
    expect(await runBridgeAction({ registry, actions, action: 'free', args: {} })).toBeUndefined();
    expect(filterActionResult({ returns: true }, 1)).toBe(1);
    expect(filterActionResult({}, 1)).toBeUndefined();
  });
  it('can skip validation when explicitly asked', async () => {
    const r = await runBridgeAction({ registry, actions, action: 'createTask', args: { title: 'x', extra: 1 }, validation: 'off' });
    expect(r.extra).toBe(1);
  });
});

describe('data helpers', () => {
  it('pickRegisteredData drops unregistered keys', () => {
    expect(pickRegisteredData(registry, { tasks: [1], secrets: ['x'], users: [] })).toEqual({ tasks: [1] });
    expect(pickRegisteredData(registry, null)).toEqual({});
    expect(pickRegisteredData({}, { tasks: [1] })).toEqual({});
  });
  it('readDataSource rejects unregistered sources', () => {
    expect(readDataSource({ registry, data: { tasks: [1] }, source: 'tasks' })).toEqual([1]);
    expect(() => readDataSource({ registry, data: {}, source: 'secrets' })).toThrow(/not registered/);
  });
});

describe('createRateLimiter', () => {
  it('allows a burst then refills over time', () => {
    let t = 0;
    const l = createRateLimiter({ ratePerSec: 10, burst: 3, now: () => t });
    expect([l.take(), l.take(), l.take(), l.take()]).toEqual([true, true, true, false]);
    t = 100; // 1 token refilled
    expect(l.take()).toBe(true);
    expect(l.take()).toBe(false);
    t = 10000;
    expect([l.take(), l.take(), l.take(), l.take()]).toEqual([true, true, true, false]);
  });
});
