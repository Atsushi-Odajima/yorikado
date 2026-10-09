import sharp from 'sharp';
import { expect, test } from '@playwright/test';
import { login } from './support';

test.describe('M5-M7 tasks and requests', () => {
  test('notice is confirmed only by the button; event answer shows a review step', async ({ page }) => {
    await login(page, 'a.staff@example.com');
    await page.goto('/m/tasks');
    await page.getByRole('link', { name: /年末の防犯パトロールのお知らせ/ }).click();
    await expect(page.getByText('未回答')).toBeVisible();
    await page.reload();
    await expect(page.getByText('未回答')).toBeVisible(); // opening twice still not acknowledged
    await page.getByRole('button', { name: '確認しました' }).click();
    await expect(page.getByText('確認済みです')).toBeVisible();

    await page.goto('/m/tasks');
    await page.getByRole('link', { name: /年末年始の休業日/ }).click();
    await page.getByRole('button', { name: '日付を追加する' }).click();
    await page.getByLabel('休業する日 1').fill('2026-12-31');
    await page.getByRole('button', { name: '内容を確認する' }).click();
    await expect(page.getByText('この内容で送ります')).toBeVisible();
    await page.getByRole('button', { name: '休業日を届ける' }).click();
    await page.waitForURL('**/m/tasks');
  });

  test('request with a photo; internal memo stays inside the office', async ({ page, browser }) => {
    const png = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#C59B44' } }).png().toBuffer();
    await login(page, 'a.staff@example.com');
    await page.goto('/m/requests/new');
    await page.waitForLoadState('networkidle');
    await page.getByRole('radio', { name: '設備・清掃' }).click();
    const subject = 'E2E 側溝の清掃 ' + Date.now();
    await page.getByLabel(/内容/).fill(subject);
    await page.locator('input[type=file]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByRole('img', { name: '写真1' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: '事務局へ送る' }).click();
    await page.waitForURL('**/m/requests/**');
    await expect(page.getByText(/受け付けました（受付番号 Q\d+）/)).toBeVisible();
    await expect(page.getByRole('img', { name: '添付写真1' })).toBeVisible();
    const url = page.url().split('?')[0]!;

    const office = await browser.newPage();
    await login(office, 'a.operator@example.com');
    await office.goto('/o/requests');
    await office.getByRole('link', { name: subject.slice(0, 40) }).click();
    await office.getByLabel('内部メモ').fill('E2E 内部メモ（店舗に見せない）');
    await office.getByRole('button', { name: '内部メモを残す' }).click();
    await expect(office.getByText('E2E 内部メモ（店舗に見せない）')).toBeVisible();
    await office.getByLabel('店舗への返信').fill('E2E 確認します');
    await office.getByRole('button', { name: '店舗へ送る' }).click();
    await expect(office.getByText('E2E 確認します')).toBeVisible();

    await page.goto(url);
    await expect(page.getByText('E2E 確認します')).toBeVisible();
    await expect(page.getByText('E2E 内部メモ')).toHaveCount(0);
  });
});

test.describe('O1-O3 office', () => {
  test('queue, settlement detail with a separate approval column', async ({ page }) => {
    await login(page, 'a.operator@example.com');
    await expect(page.getByRole('heading', { name: '対応待ち' })).toBeVisible();
    const tabs = page.getByRole('navigation', { name: '事務局メニュー' }).getByRole('link');
    await expect(tabs).toHaveCount(5);
    await page.goto('/o/settlements');
    await page.getByRole('link', { name: '#1' }).click();
    await expect(page.getByRole('complementary', { name: '確認欄' })).toBeVisible();
    await expect(page.getByText('支払作業票は銀行へそのまま取り込めるファイルではありません')).toBeVisible();
  });

  test('operator cannot see approval actions for a batch they prepared', async ({ page }) => {
    await login(page, 'a.operator@example.com');
    await page.goto('/o/settlements');
    await page.getByRole('link', { name: '#2' }).click();
    await expect(page.getByRole('button', { name: /を承認する/ })).toHaveCount(0);
  });
});
