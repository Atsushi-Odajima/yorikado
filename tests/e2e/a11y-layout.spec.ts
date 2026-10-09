import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { login, noHorizontalScroll, tokens } from './support';

const MERCHANT = ['/m', '/m/tasks', '/m/requests', '/m/requests/new', '/m/settlements', '/m/history', '/m/shops'];

test('axe: no serious/critical violations on key screens (automated check only)', async ({ page }) => {
  const results: Record<string, string[]> = {};
  await page.goto('/login');
  results['/login'] = (await new AxeBuilder({ page }).analyze()).violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')).map((v) => v.id);
  await login(page, 'a.staff@example.com');
  for (const path of [...MERCHANT, `/m/vouchers/scan?campaignId=${tokens().campaignId}`]) {
    await page.goto(path);
    const r = await new AxeBuilder({ page }).analyze();
    results[path] = r.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')).map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  }
  console.log(JSON.stringify(results, null, 1));
  for (const [path, v] of Object.entries(results)) expect(v, path).toEqual([]);
});

test('office screens axe check', async ({ page }) => {
  await login(page, 'a.operator@example.com');
  for (const path of ['/o', '/o/campaigns', '/o/settlements', '/o/tasks', '/o/requests', '/o/shops']) {
    await page.goto(path);
    const v = (await new AxeBuilder({ page }).analyze()).violations.filter((x) => ['serious', 'critical'].includes(x.impact ?? ''));
    expect(v.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`), path).toEqual([]);
  }
});

for (const width of [320, 375, 390, 430, 768, 1280]) {
  test(`no horizontal scroll at ${width}px (merchant)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await login(page, 'a.staff@example.com');
    for (const path of [...MERCHANT, `/m/vouchers/scan?campaignId=${tokens().campaignId}`]) {
      await page.goto(path);
      await noHorizontalScroll(page);
    }
  });
}

test('primary controls meet size rules (58px main button, 44px touch targets)', async ({ page }) => {
  await login(page, 'a.staff@example.com');
  const main = await page.locator('main a').first().boundingBox();
  expect(main!.height).toBeGreaterThanOrEqual(126);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('main a, main button, nav a')]
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.width > 0 && (r.height < 44 || r.width < 44))
      .length,
  );
  expect(small).toBe(0);
});

test('text zoom: 200% browser zoom equivalent (640px desktop) keeps the merchant layout usable', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 450 });
  await login(page, 'a.staff@example.com');
  for (const path of ['/m', '/m/requests/new']) {
    await page.goto(path);
    await noHorizontalScroll(page);
  }
});
