import { z } from 'zod';

export const AttachmentPurpose = z.enum(['request_message', 'paper_report', 'task_response', 'evidence']);
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_LONG_EDGE = 2400;

export function isAllowedImageType(t: string): boolean {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(t.toLowerCase());
}

/** Magic-byte sniffing: the declared MIME type is never trusted. */
export function sniffImage(buf: Uint8Array): 'jpeg' | 'png' | 'webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'png';
  if (buf.length >= 12 && String.fromCharCode(...buf.slice(0, 4)) === 'RIFF' && String.fromCharCode(...buf.slice(8, 12)) === 'WEBP') return 'webp';
  return null;
}
