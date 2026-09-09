/**
 * The parent-side bridge.
 *
 * This is the ONLY path between generated code (running in a sandboxed, opaque-origin
 * iframe) and the host application. Every action request that arrives over postMessage
 * is validated against the registry here: an action runs its real implementation ONLY
 * if its id is registered. Anything unregistered is rejected.
 *
 * Because the iframe has no same-origin access and its CSP sets connect-src 'none',
 * this validated message channel is the generated UI's entire universe of capabilities.
 * If the host never registered a `deleteTask` action, no generated UI can ever delete a
 * task — there is no code path that reaches one.
 */

export async function runBridgeAction({ registry, actions, action, args }) {
  const def = (registry.actions || []).find((a) => a.id === action);
  if (!def) {
    throw new Error(`Action "${action}" is not registered. Refusing to run it.`);
  }
  const impl = actions && actions[action];
  if (typeof impl !== 'function') {
    throw new Error(`Action "${action}" is registered but has no implementation.`);
  }
  return await impl(args || {});
}

export function readDataSource({ registry, data, source }) {
  const def = (registry.dataSources || []).find((d) => d.id === source);
  if (!def) {
    throw new Error(`Data source "${source}" is not registered.`);
  }
  return data ? data[source] : undefined;
}
