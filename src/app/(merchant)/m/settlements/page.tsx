import type { Metadata } from 'next';
import Link from 'next/link';
import { DeclareReceived } from '@/components/merchant/DeclareReceived';
import { BackLink, MerchantShell } from '@/components/merchant/Shell';
import m from '@/components/merchant/merchant.module.css';
import { d, StateBadge, ui, yen } from '@/components/ui';
import { load, requireMerchant } from '@/server/auth/page';

export const metadata: Metadata = { title: '入金予定・明細' };

interface Line {
  lineId: string;
  batchNumber: number;
  campaignName: string;
  periodStart: string;
  periodEnd: string;
  grossAmount: number;
  reversalAmount: number;
  netAmount: number;
  expectedDate: string | null;
  state: 'aggregating' | 'office_confirmed' | 'payment_in_progress' | 'bank_confirmed' | 'needs_check' | 'resolved';
  shopDeclaredAt: string | null;
  sources: { type: string; amount: number; occurredAt: string; receiptNumber: string | null }[] | null;
}

const STATE: Record<Line['state'], { label: string; tone: 'todo' | 'done' | 'error' | 'muted' }> = {
  aggregating: { label: '集計中', tone: 'muted' },
  office_confirmed: { label: '事務局確認済み', tone: 'todo' },
  payment_in_progress: { label: '振込手続き中', tone: 'todo' },
  bank_confirmed: { label: '振込結果確認済み', tone: 'done' },
  needs_check: { label: '要確認', tone: 'error' },
  resolved: { label: '処理済み（事務局判断）', tone: 'muted' },
};
const SRC: Record<string, string> = { redemption: 'QR受付', redemption_reversal: '取消', paper: '紙券（原本確認済み）', external: '外部実績' };

export default async function SettlementsPage() {
  const { db, me, shop } = await requireMerchant();
  const lines = await load<Line[]>(db, 'api_settlements_for_shop', { p_shop: shop.shopId });
  const isOwner = shop.roles.includes('shop_owner');
  return (
    <MerchantShell shop={shop} environment={me.environment} nav="home">
      <BackLink href="/m" label="ホームへ" />
      <h1 className={ui.h1}>地域券の入金予定・明細</h1>
      <p className={ui.lead}>地域券の換金分だけを表示します（お店の売上全体ではありません）。</p>
      {lines.length === 0 && <p>まだ精算の明細はありません</p>}
      {lines.map((l) => (
        <section key={l.lineId} className={m.band} aria-label={`${l.campaignName} ${d(l.periodStart)}〜`}>
          <div className={ui.row} style={{ justifyContent: 'space-between' }}>
            <strong>{l.campaignName}</strong>
            <StateBadge tone={STATE[l.state].tone}>{STATE[l.state].label}</StateBadge>
          </div>
          <p className={ui.meta}>
            精算 #{l.batchNumber}・対象 {d(l.periodStart)}〜{d(new Date(Date.parse(l.periodEnd) - 1).toISOString())}
          </p>
          <p className={ui.money} style={{ fontSize: 32 }}>{yen(l.netAmount)}</p>
          {l.reversalAmount > 0 && <p className={ui.meta}>額面合計 {yen(l.grossAmount)} − 取消 {yen(l.reversalAmount)}</p>}
          <p>振込予定日: {l.expectedDate ? d(l.expectedDate) : '事務局で調整中'}</p>
          {l.state !== 'bank_confirmed' && <p className={ui.help}>入金済みではありません。銀行の振込結果を事務局が確認すると「振込結果確認済み」になります。</p>}
          {l.shopDeclaredAt && l.state !== 'bank_confirmed' && <p className={ui.help}>店舗から入金の申告あり（事務局の照合とは別です）</p>}
          <details>
            <summary>明細を開く</summary>
            <table className={ui.table}>
              <tbody>
                {(l.sources ?? []).map((s, i) => (
                  <tr key={i}>
                    <td>{SRC[s.type] ?? s.type}{s.receiptNumber ? ` ${s.receiptNumber}` : ''}<br /><span className={ui.meta}>{d(s.occurredAt)}</span></td>
                    <td className={ui.num}>{yen(s.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <div className={ui.row} style={{ marginTop: 8 }}>
            <Link href={`/m/requests/new?category=voucher_payment`}>金額が違う・不明点を相談する</Link>
            {isOwner && (l.state === 'payment_in_progress' || l.state === 'office_confirmed') && !l.shopDeclaredAt && <DeclareReceived lineId={l.lineId} />}
          </div>
        </section>
      ))}
    </MerchantShell>
  );
}
