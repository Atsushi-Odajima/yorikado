import type { Metadata } from 'next';
import Link from 'next/link';
import { BackLink, MerchantShell } from '@/components/merchant/Shell';
import { Notice, RowLink, ui } from '@/components/ui';
import { load, requireMerchant } from '@/server/auth/page';

export const metadata: Metadata = { title: '券を受け付ける' };

interface Campaign {
  id: string;
  name: string;
  mode: string;
  usable: boolean;
  reason: string | null;
  externalServiceUrl: string;
}

const MODE: Record<string, string> = { owned_qr: 'QRを読み取る', paper_count: '紙券の枚数を登録する', external_csv: '公式の券サービスを開く' };

export default async function VoucherChooser() {
  const { db, me, shop } = await requireMerchant();
  const home = await load<{ campaigns: Campaign[] }>(db, 'api_merchant_home', { p_shop: shop.shopId });
  const usable = home.campaigns.filter((c) => c.usable).slice(0, 3);
  return (
    <MerchantShell shop={shop} environment={me.environment} nav="none">
      <BackLink href="/m" label="ホームへ" />
      <h1 className={ui.h1}>どの地域券ですか</h1>
      {usable.length === 0 && <Notice tone="warning" title="受け付けられる地域券はありません" />}
      <ul className={ui.list}>
        {usable.map((c) =>
          c.mode === 'external_csv' ? (
            <li key={c.id} className={ui.listItem}>
              <a className={ui.rowLink} href={c.externalServiceUrl} target="_blank" rel="noopener noreferrer">
                <span className={ui.rowMain}>
                  <span className={ui.rowTitle}>{c.name}</span>
                  <span className={ui.meta}>{MODE[c.mode]}（外部サービスが開きます。受付はそちらで完了します）</span>
                </span>
              </a>
            </li>
          ) : (
            <RowLink key={c.id} href={c.mode === 'owned_qr' ? `/m/vouchers/scan?campaignId=${c.id}` : `/m/paper/new?campaignId=${c.id}`} title={c.name} meta={MODE[c.mode]} />
          ),
        )}
      </ul>
      <p style={{ marginTop: 16 }}>
        <Link href="/m">ホームへ戻る</Link>
      </p>
    </MerchantShell>
  );
}
