const isProd = process.env.NODE_ENV === 'production';

/**
 * Security headers for the site's own pages. `/veneer-frame` is excluded on purpose: that route
 * serves the sandbox document with its own, much stricter Content-Security-Policy (set by
 * `buildFrameResponse`), and a page-level `frame-ancestors`/`X-Frame-Options` would fight it.
 */
const csp = [
  "default-src 'self'",
  // Next.js needs inline bootstrap scripts; Vercel Analytics loads from va.vercel-scripts.com.
  // Dev mode additionally needs eval for React Refresh.
  `script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com${isProd ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // The waitlist toast asks ipapi.co for a coarse location; analytics beacons go to Vercel.
  "connect-src 'self' https://ipapi.co https://va.vercel-scripts.com https://vitals.vercel-insights.com",
  "frame-src 'self'",
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
        // Every path except the sandbox document.
        source: '/((?!veneer-frame$).*)',
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
