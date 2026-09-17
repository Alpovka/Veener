/**
 * The class-name grammar shared by the host allowlist (SDK bundle) and the worker's Tailwind
 * compiler. Kept dependency-free so the SDK never pulls the compiler in.
 *
 * Admits: letters, digits, dashes, dots, up to four `variant:` prefixes, an optional `/opacity`,
 * and arbitrary values only when they are a numeric length or a hex colour. Refuses anything with
 * parentheses, quotes, backslashes, spaces, or the words url/image/attr/var/calc.
 */
export const CLASS_TOKEN_MAX = 80;
const TOKEN_RE = /^!?(?:[a-z][a-z0-9-]*(?:\[[a-z0-9.]{1,24}\])?:){0,4}-?[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[0-9]+)?(?:\/[0-9]{1,3})?(?:-?\[(?:[0-9.]{1,10}(?:px|rem|em|%|vh|vw|fr|ch|svh|dvh)|#[0-9a-f]{3,8})\])?(?:\/[0-9]{1,3})?$/;
const FORBIDDEN_SUBSTR = /url|image|attr\(|var\(|calc\(|\\|['"()<>;{}\s]/i;

/** Is this one class token safe to hand to the compiler and to the DOM? */
export function isSafeClassToken(t) {
  if (typeof t !== 'string' || !t || t.length > CLASS_TOKEN_MAX) return false;
  if (FORBIDDEN_SUBSTR.test(t)) return false;
  return TOKEN_RE.test(t);
}

/** Split a class attribute into the safe tokens it contains (order preserved, duplicates kept). */
export function safeClassTokens(value) {
  if (typeof value !== 'string') return [];
  return value.split(/\s+/).filter(isSafeClassToken);
}
