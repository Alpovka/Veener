const isProd = process.env.NODE_ENV === 'production';

/**
 * Security headers for the site. The Veneer engine runs generated code in a QuickJS interpreter
 * compiled to WebAssembly, inside a same-origin Web Worker (`/veneer-worker.js`, copied from
 * `@veneer/react/dist` by the `prebuild`/`predev` scripts). That needs exactly two allowances:
 * `'wasm-unsafe-eval'` in `script-src` (compiling wasm, never JavaScript eval) and `worker-src 'self'`.
 * Generated code itself never gets a CSP because it never runs in a browser realm at all.
 */
const csp = [
  "default-src 'self'",
  // Next.js needs inline bootstrap scripts; Vercel Analytics loads from va.vercel-scripts.com.
  // Dev mode additionally needs eval for React Refresh.
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://va.vercel-scripts.com${isProd ? '' : " 'unsafe-eval'"}`,
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // The waitlist toast asks ipapi.co for a coarse location; analytics beacons go to Vercel.
  "connect-src 'self' https://ipapi.co https://va.vercel-scripts.com https://vitals.vercel-insights.com",
  "frame-src 'none'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      {
        // The engine worker is a versioned build product; a fresh deploy ships a fresh copy, and the
        // canvas fetches it by a stable path, so it may be cached for a day.
        source: '/veneer-worker.:ext(js|wasm)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, must-revalidate' }],
      },
    ];
  },
};

module.exports = nextConfig;
