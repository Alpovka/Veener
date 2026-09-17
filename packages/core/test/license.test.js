import { describe, it, expect } from 'vitest';
import { generateKeyPair, importPrivateKey, signLicenseToken, verifyLicenseToken, isLocalHost, b64urlEncode, b64urlDecode } from '../src/license.js';

describe('license tokens', () => {
  it('round-trips base64url', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(b64urlDecode(b64urlEncode(bytes))).toEqual(bytes);
    expect(b64urlEncode(bytes)).not.toMatch(/[+/=]/);
  });

  it('signs and verifies, rejects tampering, wrong keys and expiry', async () => {
    const a = await generateKeyPair();
    const b = await generateKeyPair();
    const priv = await importPrivateKey(a.privateKey);
    let t = 1_800_000_000_000;
    const now = () => t;
    const token = await signLicenseToken({ sub: 'key_1', plan: 'pro', reg: 'r1' }, priv, { kid: 'k1', now, ttl: 60 });
    expect(token.split('.').length).toBe(3);

    const ok = await verifyLicenseToken(token, { publicKeys: [a.publicKey], now, registryHash: 'r1' });
    expect(ok.ok).toBe(true);
    expect(ok.claims).toMatchObject({ sub: 'key_1', plan: 'pro', evt: 'generation', reg: 'r1' });

    expect((await verifyLicenseToken(token, { publicKeys: [b.publicKey], now })).reason).toBe('bad-signature');
    expect((await verifyLicenseToken(token, { publicKeys: [b.publicKey, a.publicKey], now })).ok).toBe(true); // rotation

    const [h, p, s] = token.split('.');
    const tampered = `${h}.${b64urlEncode(new TextEncoder().encode(JSON.stringify({ sub: 'key_1', plan: 'enterprise', evt: 'generation', iat: 1, exp: 9e12 })))}.${s}`;
    expect((await verifyLicenseToken(tampered, { publicKeys: [a.publicKey], now })).reason).toBe('bad-signature');

    expect((await verifyLicenseToken(token, { publicKeys: [a.publicKey], now, registryHash: 'other' })).reason).toBe('registry-mismatch');

    t += 61_000 + 300_000 + 1000; // past exp + skew
    expect((await verifyLicenseToken(token, { publicKeys: [a.publicKey], now })).reason).toBe('expired');

    expect((await verifyLicenseToken('dev', { publicKeys: [a.publicKey] })).reason).toBe('malformed');
    expect((await verifyLicenseToken(undefined, { publicKeys: [a.publicKey] })).reason).toBe('missing');
    expect((await verifyLicenseToken('a.b.c', { publicKeys: [a.publicKey] })).reason).toBe('malformed');
  });

  it('knows local hosts', () => {
    expect(isLocalHost('localhost')).toBe(true);
    expect(isLocalHost('127.0.0.1')).toBe(true);
    expect(isLocalHost('app.localhost')).toBe(true);
    expect(isLocalHost('app.example.com')).toBe(false);
    expect(isLocalHost('')).toBe(false);
  });
});
