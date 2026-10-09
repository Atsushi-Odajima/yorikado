/**
 * Pure token formatting/normalisation (no Node APIs; safe for the browser).
 * Coupon tokens: 128-bit values as 26 Crockford Base32 chars; QR text "YK1:<token>".
 */
export const QR_PREFIX = 'YK1:';
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function encodeCrockford(bytes: Uint8Array): string {
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  const chars = Math.ceil((bytes.length * 8) / 5);
  let out = '';
  for (let i = chars - 1; i >= 0; i--) out += ALPHABET[Number((bits >> BigInt(i * 5)) & 31n)];
  return out;
}

export function qrText(token: string): string {
  return QR_PREFIX + token;
}

/**
 * Normalise scanned or typed input. Only explicitly allowed normalisation:
 * full-width -> half-width (NFKC), drop spaces/hyphens, uppercase, Crockford
 * aliases (I/L -> 1, O -> 0). Returns null for anything that is not a
 * Yorikado token (URLs and other schemes are never opened).
 */
export function normalizeTokenInput(raw: string): string | null {
  let s = raw.normalize('NFKC').trim();
  if (s.toUpperCase().startsWith(QR_PREFIX)) s = s.slice(QR_PREFIX.length);
  else if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null;
  s = s.replace(/[\s\-‐‑–—ー]/g, '').toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0');
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(s)) return null;
  if (!/^[0-7]/.test(s)) return null; // 128-bit value: top two of 130 bits are zero
  return s;
}

export function formatTokenForPrint(token: string): string {
  return token.match(/.{1,5}/g)?.join('-') ?? token;
}
