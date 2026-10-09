import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import type { KeyRing } from './keys';

/** HKDF sub-key so one secret can serve separated purposes (bank data, export, invite). */
export function subKey(key: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), `yorikado:${purpose}`, 32));
}

/** AES-256-GCM. Output: "v<version>.<iv>.<tag>.<ciphertext>" (base64url parts). */
export function encrypt(ring: KeyRing, purpose: string, plaintext: Buffer | string): string {
  const key = subKey(ring.current.key, purpose);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(purpose));
  const ct = Buffer.concat([cipher.update(typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v' + ring.current.version, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

export function decrypt(ring: KeyRing, purpose: string, payload: string): Buffer {
  const [ver, ivB, tagB, ctB] = payload.split('.');
  if (!ver || !ivB || !tagB || ctB === undefined || !ver.startsWith('v')) throw new Error('malformed ciphertext');
  const version = Number(ver.slice(1));
  const k = ring.all.find((x) => x.version === version);
  if (!k) throw new Error(`no key for version ${version}`);
  const decipher = createDecipheriv('aes-256-gcm', subKey(k.key, purpose), Buffer.from(ivB, 'base64url'));
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64url')), decipher.final()]);
}

export function keyVersionOf(payload: string): number {
  return Number(payload.split('.')[0]?.slice(1));
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function hmacHex(key: Buffer, data: string): string {
  return createHmac('sha256', key).update(data, 'utf8').digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
