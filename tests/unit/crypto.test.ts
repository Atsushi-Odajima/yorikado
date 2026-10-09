import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, keyVersionOf } from '@/domain/identity/crypto';
import { parseKeyRing } from '@/domain/identity/keys';

const K1 = Buffer.alloc(32, 7).toString('base64');
const K2 = Buffer.alloc(32, 9).toString('base64');

describe('AES-256-GCM envelope', () => {
  it('round-trips and binds the purpose', () => {
    const ring = parseKeyRing(K1);
    const c = encrypt(ring, 'bank-account', '{"accountNumber":"1234567"}');
    expect(c).not.toContain('1234567');
    expect(decrypt(ring, 'bank-account', c).toString()).toContain('1234567');
    expect(() => decrypt(ring, 'issuance:x', c)).toThrow();
  });

  it('detects tampering', () => {
    const ring = parseKeyRing(K1);
    const c = encrypt(ring, 'p', 'secret');
    const parts = c.split('.');
    const ct = Buffer.from(parts[3]!, 'base64url');
    ct[0] = ct[0]! ^ 1;
    parts[3] = ct.toString('base64url');
    expect(() => decrypt(ring, 'p', parts.join('.'))).toThrow();
  });

  it('decrypts with an old key after rotation', () => {
    const old = parseKeyRing(K1, '1');
    const c = encrypt(old, 'p', 'x');
    const rotated = parseKeyRing(K2, '2', `1:${K1}`);
    expect(keyVersionOf(c)).toBe(1);
    expect(decrypt(rotated, 'p', c).toString()).toBe('x');
    expect(keyVersionOf(encrypt(rotated, 'p', 'y'))).toBe(2);
  });
});
