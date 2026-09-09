import { buildFrameResponse } from 'veneer-sdk/server';

export const runtime = 'nodejs';
export const dynamic = 'force-static';

/**
 * Serves the sandbox document at /veneer-frame so <VeneerFrame frameSrc="/veneer-frame" /> can
 * use a real URL instead of srcDoc. A URL-served frame does not inherit this site's CSP and gets
 * its policy (including `sandbox` and `frame-ancestors`) as a response header.
 */
export function GET() {
  return buildFrameResponse({ frameAncestors: "'self'" });
}
