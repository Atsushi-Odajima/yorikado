import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'yorikado-demo-2026';
export const TOTP_SECRET = 'YORIKADODEMOTOTPSECRETAA';

export function tokens(): { campaignId: string; t500: string[]; t1000: string[] } {
  return JSON.parse(readFileSync('tmp/e2e-tokens.json', 'utf8'));
}

function b32(s: string) {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of s) bits += a.indexOf(c).toString(2).padStart(5, '0');
  const o: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) o.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(o);
}
export function totp(secret = TOTP_SECRET) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac('sha1', b32(secret)).update(b).digest();
  const off = h[h.length - 1]! & 15;
  return String((h.readUInt32BE(off) & 0x7fffffff) % 1e6).padStart(6, '0');
}

const AUTH_DIR = 'tmp/e2e-auth';

/**
 * Log in once per user per run and reuse the cookies (the production login
 * rate limit - 10 per 15 min per IP - is intentionally kept in E2E).
 */
export async function login(page: Page, email: string, opts: { fresh?: boolean } = {}) {
  const file = `${AUTH_DIR}/${email}.json`;
  if (!opts.fresh && existsSync(file)) {
    await page.context().addCookies(JSON.parse(readFileSync(file, 'utf8')));
    const home = /^(a\.staff|b\.staff|a\.owner)/.test(email) ? '/m' : '/o';
    await page.goto(home);
    await page.waitForLoadState('networkidle');
    if (!page.url().includes('/login') && !page.url().includes('/mfa')) return;
    await page.context().clearCookies();
  }
  await uiLogin(page, email);
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(await page.context().cookies()));
}

export async function uiLogin(page: Page, email: string) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード').fill(PASSWORD);
  await page.getByRole('button', { name: 'ログインする' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  if (page.url().includes('/mfa')) {
    await page.getByLabel('認証コード（6桁）').fill(totp());
    await page.getByRole('button', { name: '確認する' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/mfa'));
  }
  if (page.url().includes('/m/shops')) {
    await page.getByRole('button', { name: /山田商店/ }).click();
    await page.waitForURL('**/m');
  }
}

export async function noHorizontalScroll(page: Page) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(r.sw, `scrollWidth ${r.sw} > clientWidth ${r.cw}`).toBeLessThanOrEqual(r.cw);
}
