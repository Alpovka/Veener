/**
 * License tokens.
 *
 * A generation is licensed when the response carries a token signed by Veneer: a compact
 * `base64url(header).base64url(payload).base64url(signature)` string, Ed25519 over
 * `header.payload`. The server (self-hosted @veneer/server, or Veneer Cloud) obtains or mints it
 * per generation; the client verifies it against the embedded public keys before accepting the
 * generated code. Verification uses WebCrypto (browsers, Node 18+, Deno, Bun) and needs no
 * dependencies.
 *
 * This is a licensing control, not a security boundary: the client code is open, and a determined
 * developer can remove the check. Its job is to make unlicensed use a deliberate act.
 */

/** Veneer's public keys (raw Ed25519, base64url). Newest first; rotation keeps old keys here. */
export const LICENSE_PUBLIC_KEYS = ['3pCfCqRKqaywA5ojT-CDJw87U-5UKj9jF1qoCFMP5mI'];

export const DEV_TOKEN = 'dev';
export const TOKEN_TTL_SECONDS = 3600;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64urlEncode(bytes) {
  const bin = typeof bytes === 'string' ? bytes : bytesToBinary(bytes);
  const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64urlDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToBinary(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return bin;
}

function subtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new Error('WebCrypto is not available in this runtime');
  return c.subtle;
}

/** Import a raw base64url Ed25519 public key for verification. */
export async function importPublicKey(rawB64url) {
  return subtle().importKey('raw', b64urlDecode(rawB64url), { name: 'Ed25519' }, false, ['verify']);
}
/** Import a pkcs8 base64url Ed25519 private key for signing (server/cloud only). */
export async function importPrivateKey(pkcs8B64url) {
  return subtle().importKey('pkcs8', b64urlDecode(pkcs8B64url), { name: 'Ed25519' }, false, ['sign']);
}
/** Generate a keypair (for tests and for provisioning a new signing key). Returns base64url strings. */
export async function generateKeyPair() {
  const kp = await subtle().generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  return {
    publicKey: b64urlEncode(new Uint8Array(await subtle().exportKey('raw', kp.publicKey))),
    privateKey: b64urlEncode(new Uint8Array(await subtle().exportKey('pkcs8', kp.privateKey))),
  };
}

/**
 * Sign a license token.
 * @param {{ sub: string, plan?: string, evt?: string, reg?: string, iat?: number, exp?: number }} claims
 * @param {CryptoKey} privateKey
 * @param {{ kid?: string, now?: () => number, ttl?: number }} [opts]
 */
export async function signLicenseToken(claims, privateKey, { kid, now = () => Date.now(), ttl = TOKEN_TTL_SECONDS } = {}) {
  const iat = Math.floor(now() / 1000);
  const payload = { evt: 'generation', ...claims, iat: claims.iat ?? iat, exp: claims.exp ?? iat + ttl };
  const header = { alg: 'EdDSA', typ: 'veneer-license', ...(kid ? { kid } : {}) };
  const signingInput = `${b64urlEncode(enc.encode(JSON.stringify(header)))}.${b64urlEncode(enc.encode(JSON.stringify(payload)))}`;
  const sig = new Uint8Array(await subtle().sign({ name: 'Ed25519' }, privateKey, enc.encode(signingInput)));
  return `${signingInput}.${b64urlEncode(sig)}`;
}

/**
 * Verify a license token against the embedded (or given) public keys.
 * @returns {Promise<{ ok: true, claims: object } | { ok: false, reason: string }>}
 */
export async function verifyLicenseToken(token, { publicKeys = LICENSE_PUBLIC_KEYS, now = () => Date.now(), registryHash, clockSkewSeconds = 300 } = {}) {
  if (typeof token !== 'string') return { ok: false, reason: 'missing' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  let header;
  let claims;
  try {
    header = JSON.parse(dec.decode(b64urlDecode(parts[0])));
    claims = JSON.parse(dec.decode(b64urlDecode(parts[1])));
  } catch (e) {
    return { ok: false, reason: 'malformed' };
  }
  if (!header || header.alg !== 'EdDSA' || header.typ !== 'veneer-license') return { ok: false, reason: 'unsupported' };
  const data = enc.encode(`${parts[0]}.${parts[1]}`);
  const sig = b64urlDecode(parts[2]);
  let valid = false;
  for (const raw of publicKeys) {
    try {
      const key = await importPublicKey(raw);
      if (await subtle().verify({ name: 'Ed25519' }, key, sig, data)) {
        valid = true;
        break;
      }
    } catch (e) {
      /* try the next key */
    }
  }
  if (!valid) return { ok: false, reason: 'bad-signature' };
  const t = Math.floor(now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + clockSkewSeconds < t) return { ok: false, reason: 'expired' };
  if (typeof claims.iat === 'number' && claims.iat - clockSkewSeconds > t) return { ok: false, reason: 'not-yet-valid' };
  if (claims.evt !== 'generation') return { ok: false, reason: 'wrong-event' };
  if (registryHash && claims.reg && claims.reg !== registryHash) return { ok: false, reason: 'registry-mismatch' };
  return { ok: true, claims };
}

/** True for hosts where an unsigned dev token is acceptable (local development). */
export function isLocalHost(hostname) {
  if (!hostname) return false;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost');
}
