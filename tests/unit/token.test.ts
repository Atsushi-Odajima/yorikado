import { describe, expect, it } from 'vitest';
import { parseKeyRing } from '@/domain/identity/keys';
import { encodeCrockford, formatTokenForPrint, generateToken, normalizeTokenInput, qrText, tokenDigest, tokenDigests } from '@/domain/vouchers/token';

const K1 = Buffer.alloc(32, 1).toString('base64');
const K2 = Buffer.alloc(32, 2).toString('base64');

describe('coupon tokens', () => {
  it('generates 26-char Crockford tokens carrying 128 bits', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const t = generateToken();
      expect(t).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
      seen.add(t);
    }
    expect(seen.size).toBe(500);
  });

  it('encodes known bytes deterministically', () => {
    expect(encodeCrockford(new Uint8Array(16))).toBe('0'.repeat(26));
    expect(encodeCrockford(new Uint8Array(16).fill(255))).toBe('7' + 'Z'.repeat(25));
  });

  it('normalises scanned/typed input explicitly', () => {
    const t = generateToken();
    expect(normalizeTokenInput(qrText(t))).toBe(t);
    expect(normalizeTokenInput(formatTokenForPrint(t))).toBe(t);
    expect(normalizeTokenInput(' ' + t.toLowerCase() + ' ')).toBe(t);
    const fullWidth = t.replace(/[0-9A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
    expect(normalizeTokenInput(fullWidth)).toBe(t);
    expect(normalizeTokenInput('yk1:' + t)).toBe(t);
  });

  it('rejects other QR contents and never treats URLs as tokens', () => {
    expect(normalizeTokenInput('https://example.com/pay?x=1')).toBeNull();
    expect(normalizeTokenInput('PAYPAY:12345')).toBeNull();
    expect(normalizeTokenInput('hello')).toBeNull();
    expect(normalizeTokenInput('8' + 'A'.repeat(25))).toBeNull(); // >128 bits
    expect(normalizeTokenInput('')).toBeNull();
  });

  it('stores only keyed digests; key rotation yields digests for all versions', () => {
    const ring = parseKeyRing(K2, '2', `1:${K1}`);
    const t = generateToken();
    const ds = tokenDigests(ring, t);
    expect(ds).toHaveLength(2);
    expect(ds[0]).toBe(tokenDigest(ring.current.key, t));
    expect(ds[0]).not.toBe(ds[1]);
    expect(ds[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(ds.join('')).not.toContain(t);
  });

  it('rejects short keys', () => {
    expect(() => parseKeyRing(Buffer.alloc(16).toString('base64'))).toThrow();
    expect(() => parseKeyRing(K1, '1', `1:${K2}`)).toThrow();
  });
});
