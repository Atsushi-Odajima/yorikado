import { expect, test } from '@playwright/test';
import { login, tokens } from './support';

test.describe('M1-M4 voucher acceptance', () => {
  test('home has exactly three main entries and a practice banner', async ({ page }) => {
    await login(page, 'a.staff@example.com');
    await expect(page.getByText('練習用・実際の券には使えません')).toBeVisible();
    const main = page.locator('main');
    await expect(main.getByRole('link', { name: /券を(受け付ける|読み取る)/ })).toBeVisible();
    await expect(main.getByRole('link', { name: /報告・返事をする/ })).toBeVisible();
    await expect(main.getByRole('link', { name: /事務局に相談する/ })).toBeVisible();
    await expect(main.getByRole('link', { name: '地域券の入金予定を見る' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'メイン' }).getByRole('link')).toHaveCount(2);
  });

  test('one coupon by number -> confirm -> receipt; reuse is refused', async ({ page }) => {
    const { campaignId, t500 } = tokens();
    await login(page, 'a.staff@example.com');
    await page.goto(`/m/vouchers/scan?campaignId=${campaignId}`);
    await page.waitForLoadState('networkidle'); // hydrated before typing
    await page.getByText('写真から読み取る・番号を入力する').click();
    await page.getByLabel('券の番号（QRの下の26文字）').fill(t500[0]!.match(/.{1,5}/g)!.join('-').toLowerCase());
    await page.getByRole('button', { name: 'この番号を追加する' }).click();
    await page.waitForURL('**/m/vouchers/confirm/**');
    await expect(page.getByText('500円 × 1枚')).toBeVisible();
    await page.getByRole('button', { name: '500円を受け取る' }).click();
    await page.waitForURL('**/m/receipts/**');
    await expect(page.getByText('受付完了')).toBeVisible();
    await expect(page.getByText('地域券報告に反映済みです。入金は事務局の確認後になります。')).toBeVisible();
    await expect(page.getByText(/入金済み/)).toHaveCount(0);
    // same coupon again
    await page.goto(`/m/vouchers/scan?campaignId=${campaignId}`);
    await page.waitForLoadState('networkidle'); // hydrated before typing
    await page.getByText('写真から読み取る・番号を入力する').click();
    await page.getByLabel('券の番号（QRの下の26文字）').fill(t500[0]!);
    await page.getByRole('button', { name: 'この番号を追加する' }).click();
    await expect(page.getByText(/使用済みです/)).toBeVisible();
  });

  test('ten coupons in one receipt: amounts add up', async ({ page }) => {
    const { campaignId, t500, t1000 } = tokens();
    await login(page, 'a.staff@example.com');
    await page.goto(`/m/vouchers/scan?campaignId=${campaignId}`);
    await page.waitForLoadState('networkidle'); // hydrated before typing
    await page.getByText('複数枚をまとめて読み取る（最大10枚）').click();
    await page.getByText('写真から読み取る・番号を入力する').click();
    const list = [...t500.slice(1, 6), ...t1000.slice(0, 5)];
    for (const [i, t] of list.entries()) {
      await page.getByLabel('券の番号（QRの下の26文字）').fill(t);
      await page.getByRole('button', { name: 'この番号を追加する' }).click();
      await expect(page.getByText(`${i + 1}枚目を読み取りました`)).toBeVisible();
    }
    await page.getByLabel('券の番号（QRの下の26文字）').fill(t500[6]!);
    await page.getByRole('button', { name: 'この番号を追加する' }).click();
    await expect(page.getByText(/10枚までです/)).toBeVisible();
    await page.getByRole('button', { name: '確認へ進む（7,500円）' }).click();
    await page.waitForURL('**/m/vouchers/confirm/**');
    await expect(page.getByText('500円 × 5枚')).toBeVisible();
    await expect(page.getByText('1,000円 × 5枚')).toBeVisible();
    await page.getByRole('button', { name: '7,500円を受け取る' }).click();
    await page.waitForURL('**/m/receipts/**');
    await expect(page.getByText('受付完了')).toBeVisible();
    await expect(page.getByText('練習地域券（10枚）')).toBeVisible();
  });

  test('unsupported QR content is never opened as a URL', async ({ page }) => {
    const { campaignId } = tokens();
    await login(page, 'a.staff@example.com');
    await page.goto(`/m/vouchers/scan?campaignId=${campaignId}`);
    await page.waitForLoadState('networkidle'); // hydrated before typing
    await page.getByText('写真から読み取る・番号を入力する').click();
    await page.getByLabel('券の番号（QRの下の26文字）').fill('https://evil.example/pay');
    await page.getByRole('button', { name: 'この番号を追加する' }).click();
    await expect(page.getByText('この地域券には対応していません')).toBeVisible();
    expect(page.url()).toContain('/m/vouchers/scan');
  });

  test('network loss during confirmation shows "checking", never a fake success', async ({ page }) => {
    const { campaignId, t500 } = tokens();
    await login(page, 'a.staff@example.com');
    await page.goto(`/m/vouchers/scan?campaignId=${campaignId}`);
    await page.waitForLoadState('networkidle'); // hydrated before typing
    await page.getByText('写真から読み取る・番号を入力する').click();
    await page.getByLabel('券の番号（QRの下の26文字）').fill(t500[10]!);
    await page.getByRole('button', { name: 'この番号を追加する' }).click();
    await page.waitForURL('**/m/vouchers/confirm/**');
    // let the request reach the server but drop the response
    await page.route('**/api/v1/redemptions', async (route) => {
      await route.fetch();
      await route.abort('connectionreset');
    });
    await page.getByRole('button', { name: '500円を受け取る' }).click();
    await expect(page.getByText('結果を確認しています')).toBeVisible();
    await page.unroute('**/api/v1/redemptions');
    // polling finds the confirmed operation recorded by the server
    await page.waitForURL('**/m/receipts/**', { timeout: 20_000 });
    await expect(page.getByText('受付完了')).toBeVisible();
  });
});
