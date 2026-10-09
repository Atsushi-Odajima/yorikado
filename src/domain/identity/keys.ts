/**
 * Versioned symmetric keys. Current key from KEY + KEY_VERSION, previous keys
 * from KEYS_OLD as "1:<base64>;2:<base64>". Old keys stay available for
 * verification/decryption during rotation (see docs/SECURITY.txt).
 */
export interface VersionedKey {
  version: number;
  key: Buffer;
}
export interface KeyRing {
  current: VersionedKey;
  all: VersionedKey[];
}

export function decodeKey(raw: string): Buffer {
  const trimmed = raw.trim();
  const buf = Buffer.from(trimmed.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (buf.length < 32) throw new Error('key must be >= 256 bits (base64 of 32+ bytes)');
  return buf;
}

export function parseKeyRing(current: string, versionRaw?: string, oldRaw?: string): KeyRing {
  if (!current) throw new Error('missing');
  const version = Number(versionRaw ?? '1');
  if (!Number.isInteger(version) || version < 1) throw new Error('version must be a positive integer');
  const cur: VersionedKey = { version, key: decodeKey(current) };
  const all: VersionedKey[] = [cur];
  for (const part of (oldRaw ?? '').split(';').map((p) => p.trim()).filter(Boolean)) {
    const idx = part.indexOf(':');
    const v = Number(part.slice(0, idx));
    if (idx < 1 || !Number.isInteger(v) || v < 1 || v === version) throw new Error('old keys must be "<version>:<base64>"');
    all.push({ version: v, key: decodeKey(part.slice(idx + 1)) });
  }
  return { current: cur, all };
}
