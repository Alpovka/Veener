/**
 * The parent-side bridge.
 *
 * This is the ONLY path between generated code and the host application. Generated code runs in
 * a QuickJS interpreter inside a Web Worker (see packages/react/src/engine) — or, on the legacy
 * engine, in an opaque-origin iframe reached over a MessageChannel — and every `veneer.action`
 * call it makes arrives here as plain JSON.
 *
 * Every action request is validated here:
 *   1. the action id must be registered;
 *   2. the args must match the registry definition (plain object, declared keys only, required
 *      keys present, lenient type checks derived from the `type` text, no prototype-polluting
 *      keys, bounded size and depth) — or pass the action's own `validate(args)` hook;
 *   3. only then does the real implementation run;
 *   4. its return value crosses back into the sandbox ONLY if the definition declares `returns`.
 *
 * Data flows the other way through `pickRegisteredData`, so unregistered keys of the host's
 * `data` object never reach generated code.
 */

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const DEFAULT_LIMITS = { maxBytes: 64 * 1024, maxDepth: 8 };

export class BridgeError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'BridgeError';
    this.code = code || 'bridge_error';
  }
}

function isPlainObject(v) {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function depthOf(v, depth = 0, limit = 64) {
  if (depth > limit) return depth;
  if (Array.isArray(v)) {
    let max = depth + 1;
    for (const x of v) max = Math.max(max, depthOf(x, depth + 1, limit));
    return max;
  }
  if (isPlainObject(v)) {
    let max = depth + 1;
    for (const k of Object.keys(v)) max = Math.max(max, depthOf(v[k], depth + 1, limit));
    return max;
  }
  return depth;
}

function findDangerousKey(v) {
  if (Array.isArray(v)) {
    for (const x of v) { const k = findDangerousKey(x); if (k) return k; }
    return null;
  }
  if (isPlainObject(v)) {
    for (const k of Object.keys(v)) {
      if (DANGEROUS_KEYS.has(k)) return k;
      const inner = findDangerousKey(v[k]);
      if (inner) return inner;
    }
  }
  return null;
}

/**
 * Derive a checker from the free-text `type` a developer wrote in the registry, e.g.
 *   'string' | 'number' | 'boolean' | 'integer' | 'object' | 'array'
 *   '"todo" | "doing" | "done"'  or  'enum: "a" | "b"'      → enum of the quoted literals
 *   'string (YYYY-MM-DD) or null' / 'string | null'          → nullable
 * Anything we cannot parse is not checked (the shape rules above still apply).
 */
export function typeChecker(typeText) {
  if (typeof typeText !== 'string') return null;
  const text = typeText.trim();
  const nullable = /\bnull\b|\bundefined\b|\?$/i.test(text);
  const quoted = text.match(/(["'])(?:(?!\1).)*\1/g);
  if (quoted && quoted.length >= 1 && (quoted.length > 1 || /\|/.test(text) || /^enum\b/i.test(text))) {
    const literals = new Set(quoted.map((q) => q.slice(1, -1)));
    return { kind: 'enum', nullable, literals, test: (v) => literals.has(v) };
  }
  const m = text.match(/^(string|number|integer|boolean|object|array)\b/i);
  if (!m) return null;
  const kind = m[1].toLowerCase();
  const tests = {
    string: (v) => typeof v === 'string',
    number: (v) => typeof v === 'number' && Number.isFinite(v),
    integer: (v) => Number.isInteger(v),
    boolean: (v) => typeof v === 'boolean',
    object: (v) => isPlainObject(v),
    array: (v) => Array.isArray(v),
  };
  return { kind, nullable, test: tests[kind] };
}

/**
 * Validate `args` against an action definition. Throws BridgeError on the first problem.
 * @returns the validated args (same object; never mutated)
 */
export function validateArgs(def, args, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
  if (args === undefined || args === null) args = {};
  if (!isPlainObject(args)) throw new BridgeError('args must be a plain object', 'invalid_args');

  let serialized;
  try {
    serialized = JSON.stringify(args);
  } catch (e) {
    throw new BridgeError('args must be JSON-serializable', 'invalid_args');
  }
  if (serialized === undefined || serialized.length > limits.maxBytes) {
    throw new BridgeError(`args exceed ${limits.maxBytes} bytes`, 'args_too_large');
  }
  if (depthOf(args) > limits.maxDepth) throw new BridgeError(`args exceed depth ${limits.maxDepth}`, 'args_too_deep');
  const bad = findDangerousKey(args);
  if (bad) throw new BridgeError(`args contain forbidden key "${bad}"`, 'invalid_args');

  if (typeof def.validate === 'function') {
    // Developer-supplied validator (zod-compatible: may throw, return false, or return
    // { success: false }). Takes precedence over the inferred checks.
    const r = def.validate(args);
    if (r === false || (r && typeof r === 'object' && r.success === false)) {
      const detail = r && r.error ? `: ${String(r.error.message || r.error)}` : '';
      throw new BridgeError(`args rejected by validator${detail}`, 'invalid_args');
    }
    if (r && typeof r === 'object' && r.success === true && 'data' in r) return r.data;
    return args;
  }

  if (!Array.isArray(def.args)) return args; // nothing declared → shape rules only

  const declared = new Map(def.args.map((a) => [a.name, a]));
  for (const key of Object.keys(args)) {
    if (!declared.has(key)) throw new BridgeError(`unexpected arg "${key}" for action "${def.id}"`, 'invalid_args');
  }
  for (const a of def.args) {
    const present = Object.prototype.hasOwnProperty.call(args, a.name) && args[a.name] !== undefined;
    if (!present) {
      if (a.required) throw new BridgeError(`missing required arg "${a.name}" for action "${def.id}"`, 'invalid_args');
      continue;
    }
    const v = args[a.name];
    const checker = typeChecker(a.type);
    if (!checker) continue;
    if (v === null) {
      if (checker.nullable) continue;
      throw new BridgeError(`arg "${a.name}" must not be null`, 'invalid_args');
    }
    if (!checker.test(v)) {
      const expected = checker.kind === 'enum' ? `one of ${[...checker.literals].map((l) => JSON.stringify(l)).join(', ')}` : checker.kind;
      throw new BridgeError(`arg "${a.name}" must be ${expected}`, 'invalid_args');
    }
  }
  return args;
}

/**
 * Run a registered action. Rejects unregistered ids, invalid args and missing implementations.
 * `validation: 'off'` skips arg validation (not recommended).
 */
export async function runBridgeAction({ registry, actions, action, args, validation = 'on', limits }) {
  if (typeof action !== 'string') throw new BridgeError('action id must be a string', 'unregistered_action');
  const def = ((registry && registry.actions) || []).find((a) => a.id === action);
  if (!def) throw new BridgeError(`Action "${action}" is not registered. Refusing to run it.`, 'unregistered_action');
  const impl = actions && actions[action];
  if (typeof impl !== 'function') throw new BridgeError(`Action "${action}" is registered but has no implementation.`, 'no_impl');
  const safeArgs = validation === 'off' ? (args || {}) : validateArgs(def, args, { limits });
  const result = await impl(safeArgs);
  return filterActionResult(def, result);
}

/** Only declared return values cross into the sandbox; otherwise the generated code sees undefined. */
export function filterActionResult(def, result) {
  return def && def.returns ? result : undefined;
}

export function readDataSource({ registry, data, source }) {
  const def = ((registry && registry.dataSources) || []).find((d) => d.id === source);
  if (!def) throw new BridgeError(`Data source "${source}" is not registered.`, 'unregistered_source');
  return data ? data[source] : undefined;
}

/** The subset of `data` whose keys are registered data sources. Unregistered keys never leave the host. */
export function pickRegisteredData(registry, data) {
  const out = {};
  if (!data) return out;
  for (const d of (registry && registry.dataSources) || []) {
    if (Object.prototype.hasOwnProperty.call(data, d.id)) out[d.id] = data[d.id];
  }
  return out;
}

/** Token bucket. `take()` returns true when a call may proceed. */
export function createRateLimiter({ ratePerSec = 20, burst = 30, now = () => Date.now() } = {}) {
  let tokens = burst;
  let last = now();
  return {
    take() {
      const t = now();
      tokens = Math.min(burst, tokens + ((t - last) / 1000) * ratePerSec);
      last = t;
      if (tokens >= 1) {
        tokens -= 1;
        return true;
      }
      return false;
    },
  };
}
