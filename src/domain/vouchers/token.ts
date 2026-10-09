import { randomBytes } from 'node:crypto';
import { hmacHex, subKey } from '@/domain/identity/crypto';
import type { KeyRing } from '@/domain/identity/keys';

/**
 * Coupon tokens: 128-bit CSPRNG values encoded as 26 Crockford Base32 chars.
 * QR payload is "YK1:<token>". Only HMAC-SHA256 digests reach the database.
 */
export const QR_PREFIX = 'YK1:';
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function encodeCrockford(bytes: Uint8Array): string {
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  const totalBits = bytes.length * 8;
  const chars = Math.ceil(totalBits / 5);
  let out = '';
  for (let i = chars - 1; i >= 0; i--) {
    out += ALPHABET[Number((bits >> BigInt(i * 5)) & 31n)];
  }
  return out;
}

export function generateToken(): string {
  return encodeCrockford(randomBytes(16)); // 128 bits -> 26 chars
}

export function qrText(token: string): string {
  return QR_PREFIX + token;
}

/**
 * Normalize scanned or typed input. Explicitly allowed normalization only:
 * full-width ASCII -> half-width, remove spaces/hyphens, uppercase, and
 * Crockford aliases (I/L -> 1, O -> 0). Returns null when not a Yorikado token.
 */
export function normalizeTokenInput(raw: string): string | null {
  let s = raw.normalize('NFKC').trim();
  if (s.toUpperCase().startsWith(QR_PREFIX)) s = s.slice(QR_PREFIX.length);
  else if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null; // other schemes / URLs are never opened
  s = s.replace(/[\s\-‐‑–—ー]/g, '').toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0');
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(s)) return null;
  // 26 chars carry 130 bits; a 128-bit value always starts with 0-7.
  if (!/^[0-7]/.test(s)) return null;
  return s;
}

/** Group a token for printing/typing: XXXXX-XXXXX-... */
export function formatTokenForPrint(token: string): string {
  return token.match(/.{1,5}/g)?.join('-') ?? token;
}

export function tokenDigest(key: Buffer, token: string): string {
  return hmacHex(subKey(key, 'coupon-token'), token);
}

/** Digests under every active key version, for lookup during rotation. */
export function tokenDigests(ring: KeyRing, token: string): string[] {
  return ring.all.map((k) => tokenDigest(k.key, token));
}
