/** Stable, cheap hash of the parts of the registry that define the capability surface. */
export function hashRegistryShape(registry) {
  const r = registry || {};
  const shape = JSON.stringify({
    a: (r.actions || []).map((a) => [a.id, (a.args || []).map((x) => x.name), !!a.returns]),
    d: (r.dataSources || []).map((d) => d.id),
  });
  let h = 5381;
  for (let i = 0; i < shape.length; i++) h = ((h * 33) ^ shape.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

