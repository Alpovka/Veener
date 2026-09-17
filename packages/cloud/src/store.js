/**
 * Key store interface. The reference implementation is in-memory, seeded from env or code;
 * production swaps in a database with the same four methods.
 *
 *   key record: { id, secret, plan, monthlyQuota, active, owner? }
 *   usage:      per key, per calendar month (UTC)
 */
export function createMemoryStore({ keys = [], now = () => Date.now() } = {}) {
  const byKey = new Map(keys.map((k) => [k.secret, { ...k }]));
  const usage = new Map(); // `${id}:${period}` → count
  const period = () => {
    const d = new Date(now());
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  return {
    async findBySecret(secret) {
      const k = byKey.get(secret);
      return k ? { ...k } : null;
    },
    async getUsage(id) {
      return usage.get(`${id}:${period()}`) || 0;
    },
    async increment(id) {
      const k = `${id}:${period()}`;
      const n = (usage.get(k) || 0) + 1;
      usage.set(k, n);
      return n;
    },
    async upsert(record) {
      byKey.set(record.secret, { ...record });
    },
    period,
  };
}

/**
 * Parse `VENEER_KEYS="vn_live_abc:pro:10000,vn_live_def:starter:500"` into key records.
 * A third field may be omitted (defaults to the plan's quota below). Ids derive from the secret, so
 * reordering or removing entries never reassigns usage counters between customers.
 */
export const PLAN_QUOTAS = { free: 100, starter: 1000, pro: 10000, enterprise: 1000000, dev: 1000000 };

export function keysFromEnv(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [secret, plan = 'starter', quota] = entry.split(':');
      const parsed = quota ? Number(quota) : PLAN_QUOTAS[plan];
      const monthlyQuota = Number.isFinite(parsed) && parsed > 0 ? parsed : PLAN_QUOTAS.starter;
      return { id: `key_${fnv1a(secret)}`, secret, plan, monthlyQuota, active: true };
    });
}

function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = ((h ^ s.charCodeAt(i)) * 0x01000193) >>> 0;
  return h.toString(36);
}
