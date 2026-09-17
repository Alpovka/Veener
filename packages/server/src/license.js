/**
 * License client for self-hosted @veneer/server.
 *
 * Before each generation the handler asks the Veneer license API to record the event and return a
 * signed token (see @veneer/core license.js). The token travels to the browser with the generated
 * code. Failure modes:
 *   - 401/402/403 from the API → the generation is refused (invalid key, quota exhausted, disabled).
 *   - network error → within `graceMs` of the last successful check the generation proceeds with
 *     the last token (marked stale) so an outage on our side never takes a customer's product down.
 *   - `license: false` → no network; a DEV token is issued. Only accepted by clients on localhost.
 */
import { DEV_TOKEN } from '@veneer/core';

export const DEFAULT_LICENSE_API = 'https://api.veneer.dev';

export class LicenseError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'LicenseError';
    this.status = status;
    this.code = code;
  }
}

export function createLicenseClient({ licenseKey, apiBase = DEFAULT_LICENSE_API, fetch: fetchImpl, graceMs = 24 * 3600 * 1000, now = () => Date.now(), timeoutMs = 5000, onError = () => {} } = {}) {
  if (!licenseKey || typeof licenseKey !== 'string') throw new LicenseError('createVeneerHandler: `licenseKey` is required (or pass `license: false` for local development).', 500, 'no-key');
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!f) throw new LicenseError('fetch is not available in this runtime', 500, 'no-fetch');
  let last = null; // { token, plan, at }

  return {
    /** Record a generation and get a token. Throws LicenseError when the license does not allow it. */
    async assertGeneration({ registryHash } = {}) {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        const res = await f(`${apiBase.replace(/\/$/, '')}/v1/license/verify`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${licenseKey}` },
          body: JSON.stringify({ event: 'generation', registryHash }),
          signal: controller ? controller.signal : undefined,
        });
        if (res.status === 401 || res.status === 402 || res.status === 403) {
          let body = null;
          try {
            body = await res.json();
          } catch (e) {
            body = null;
          }
          const code = (body && body.code) || (res.status === 402 ? 'quota-exceeded' : 'invalid-key');
          throw new LicenseError((body && body.error) || `License check failed (${res.status}).`, res.status, code);
        }
        if (!res.ok) throw new Error(`license API ${res.status}`);
        const body = await res.json();
        if (!body || typeof body.token !== 'string') throw new Error('license API returned no token');
        last = { token: body.token, plan: body.plan, remaining: body.remaining, at: now() };
        return { token: body.token, plan: body.plan, remaining: body.remaining, stale: false };
      } catch (e) {
        if (e instanceof LicenseError) throw e;
        onError(e);
        if (last && now() - last.at < graceMs) return { token: last.token, plan: last.plan, remaining: last.remaining, stale: true };
        throw new LicenseError('The Veneer license service is unreachable and no recent check is cached.', 503, 'unreachable');
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    get last() {
      return last;
    },
  };
}

/** The no-network client used with `license: false`. */
export function createDevLicenseClient() {
  return { assertGeneration: async () => ({ token: DEV_TOKEN, plan: 'dev', stale: false }), last: null };
}
