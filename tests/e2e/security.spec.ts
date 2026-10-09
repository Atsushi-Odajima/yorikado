import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { login } from './support';

const env = Object.fromEntries(
  readFileSync('.env.test', 'utf8').split(/\r?\n/).map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m![1], m![2]]),
);

test.describe('HTTP security', () => {
  test('state-changing API requires the CSRF header and same origin', async ({ request, baseURL }) => {
    const noHeader = await request.post('/api/v1/auth/login', { data: { email: 'a.staff@example.com', password: 'x' }, headers: { origin: baseURL! } });
    expect(noHeader.status()).toBe(403);
    const foreign = await request.post('/api/v1/auth/login', { data: { email: 'a.staff@example.com', password: 'x' }, headers: { origin: 'https://evil.example', 'x-requested-with': 'yorikado' } });
    expect(foreign.status()).toBe(403);
    expect((await foreign.json()).error.code).toBe('CSRF');
  });

  test('unauthenticated API calls are rejected without leaking data', async ({ request }) => {
    const r = await request.get('/api/v1/me');
    expect(r.status()).toBe(401);
    const body = await r.json();
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(r.headers()['cache-control']).toContain('no-store');
  });

  test('job runner only with the cron secret', async ({ request }) => {
    expect((await request.post('/api/v1/internal/jobs/run')).status()).toBe(403);
    expect((await request.post('/api/v1/internal/jobs/run', { headers: { authorization: 'Bearer wrong-secret-wrong-secret-wrong-secret' } })).status()).toBe(403);
    const ok = await request.post('/api/v1/internal/jobs/run', { headers: { authorization: `Bearer ${env.JOB_RUNNER_SECRET}` } });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).data).toHaveProperty('claimed');
  });

  test('pages send CSP and hardening headers; session cookies are HttpOnly', async ({ page }) => {
    const res = await page.goto('/login');
    const h = res!.headers();
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['content-security-policy']).toMatch(/script-src 'self' 'nonce-/);
    expect(h['x-content-type-options']).toBe('nosniff');
    await login(page, 'a.staff@example.com');
    const cookies = await page.context().cookies();
    const auth = cookies.filter((c) => c.name.startsWith('sb-'));
    expect(auth.length).toBeGreaterThan(0);
    for (const c of auth) {
      expect(c.httpOnly).toBe(true);
      expect(c.sameSite).toBe('Lax');
    }
    const ls = await page.evaluate(() => JSON.stringify(window.localStorage));
    expect(ls).not.toMatch(/access_token|refresh_token|sb-/);
  });

  test('logout everywhere invalidates the session', async ({ page }) => {
    await login(page, 'b.staff@example.com', { fresh: true });
    await page.goto('/m/shops');
    await page.getByRole('button', { name: /すべての端末からログアウト/ }).click();
    await page.getByRole('button', { name: 'すべての端末からログアウトする' }).click();
    await page.waitForURL('**/login');
    await page.goto('/m');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('PWA / offline (AC18)', () => {
  test('service worker caches only the public shell; offline shows the notice', async ({ page }) => {
    await login(page, 'a.staff@example.com');
    await page.goto('/m');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    const keys = await page.evaluate(async () => {
      const out: string[] = [];
      for (const name of await caches.keys()) {
        const c = await caches.open(name);
        for (const r of await c.keys()) out.push(new URL(r.url).pathname);
      }
      return out;
    });
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k).toMatch(/^\/(offline\.html|manifest\.webmanifest|brand\/|fonts\/)/);
    // Playwright's offline mode does not apply to fetches made by the service worker itself,
    // so the offline fallback logic is covered by tests/unit/sw.test.ts. Here: the notice page exists.
    await page.goto('/offline.html');
    await expect(page.getByRole('heading', { name: '通信が必要です' })).toBeVisible();
    await expect(page.getByText('後から自動で送られることはありません')).toBeVisible();
  });

  test('manifest matches the spec', async ({ request }) => {
    const m = await (await request.get('/manifest.webmanifest')).json();
    expect(m).toMatchObject({ name: 'Yorikado', short_name: 'ヨリカド', start_url: '/m', display: 'standalone' });
  });
});
