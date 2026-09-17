/**
 * Canonical public URL of this deployment. Set NEXT_PUBLIC_SITE_URL in production (no trailing
 * slash); on Vercel previews it falls back to the deployment URL, locally to the dev server.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.NEXT_PUBLIC_VERCEL_URL ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}` : '') ||
  'https://veener.vercel.app'
).replace(/\/+$/, '');
