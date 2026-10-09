import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { payloadSchema, TEMPLATES } from '@/domain/tasks/templates';
import { fromDbError } from '@/server/errors';
import { nextReminderWindow } from '@/server/jobs/runner';

describe('reminder window (09:00-18:00 JST)', () => {
  it('allows inside and defers outside', () => {
    expect(nextReminderWindow(new Date('2026-10-09T01:00:00Z'))).toBeNull(); // 10:00 JST
    expect(nextReminderWindow(new Date('2026-10-09T09:30:00Z'))?.toISOString()).toBe('2026-10-10T00:00:00.000Z'); // 18:30 JST -> next 09:00
    expect(nextReminderWindow(new Date('2026-10-08T20:00:00Z'))?.toISOString()).toBe('2026-10-09T00:00:00.000Z'); // 05:00 JST -> 09:00 same day
  });
});

describe('task payload schema', () => {
  it('validates required answers and options', () => {
    const s = payloadSchema(TEMPLATES.event);
    expect(s.safeParse({ attend: '参加', people: 2 }).success).toBe(true);
    expect(s.safeParse({ people: 2 }).success).toBe(false);
    expect(s.safeParse({ attend: 'たぶん' }).success).toBe(false);
    expect(s.safeParse({ attend: '参加', extra: 1 }).success).toBe(false);
  });
});

describe('DB error mapping', () => {
  it('maps app.fail codes and never leaks unknown errors', () => {
    const e = fromDbError({ message: 'ALREADY_USED', hint: '使用済み', details: '{"items":[{"index":0,"code":"ALREADY_USED"}]}' });
    expect(e.code).toBe('ALREADY_USED');
    expect(e.status).toBe(409);
    expect(e.details?.items).toBeTruthy();
    expect(fromDbError({ message: 'relation x does not exist', code: '42P01' }).code).toBe('INTERNAL');
  });
});

describe('PWA assets match the spec', () => {
  it('manifest fields', () => {
    const m = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
    expect(m).toMatchObject({ name: 'Yorikado', short_name: 'ヨリカド', lang: 'ja', start_url: '/m', scope: '/', display: 'standalone', theme_color: '#F7F4EB', background_color: '#F7F4EB' });
    expect(m.icons.every((i: { purpose: string }) => i.purpose === 'any')).toBe(true);
  });
  it('icon dimensions', async () => {
    for (const [f, s] of [['pwa_icon_192.png', 192], ['pwa_icon_512.png', 512], ['apple_touch_icon_180.png', 180], ['favicon_32.png', 32]] as const) {
      const meta = await sharp(`public/brand/${f}`).metadata();
      expect([meta.width, meta.height]).toEqual([s, s]);
    }
  });
  it('service worker never caches API/auth/business routes', () => {
    const sw = readFileSync('public/sw.js', 'utf8');
    const cacheable = /const CACHEABLE = (.*);/.exec(sw)![1]!;
    const re = eval(cacheable) as RegExp;
    for (const p of ['/api/v1/me', '/auth/confirm', '/m', '/o', '/m/receipts/x', '/api/v1/attachments/x/download', '/api/v1/settlements/x/export-worklist']) expect(re.test(p)).toBe(false);
    for (const p of ['/offline.html', '/brand/logo_mark.png', '/fonts/BIZUDPGothic-Regular.woff2']) expect(re.test(p)).toBe(true);
    expect(sw).toContain("if (req.method !== 'GET') return;");
  });
});
