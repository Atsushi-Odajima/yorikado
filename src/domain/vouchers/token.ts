import { randomBytes } from 'node:crypto';
import { hmacHex, subKey } from '@/domain/identity/crypto';
import type { KeyRing } from '@/domain/identity/keys';
import { encodeCrockford } from './tokenFormat';

export { encodeCrockford, formatTokenForPrint, normalizeTokenInput, qrText, QR_PREFIX } from './tokenFormat';

/** 128-bit CSPRNG token (26 Crockford Base32 chars). Server only. */
export function generateToken(): string {
  return encodeCrockford(randomBytes(16));
}

/** HMAC-SHA256 digest stored in the DB; the raw token is never stored. */
export function tokenDigest(key: Buffer, token: string): string {
  return hmacHex(subKey(key, 'coupon-token'), token);
}

/** Digests under every active key version (lookup during key rotation). */
export function tokenDigests(ring: KeyRing, token: string): string[] {
  return ring.all.map((k) => tokenDigest(k.key, token));
}
