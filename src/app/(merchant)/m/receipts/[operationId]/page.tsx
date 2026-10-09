import type { Metadata } from 'next';
import Link from 'next/link';
import { ReversalRequest } from '@/components/merchant/ReversalRequest';
import { MerchantShell } from '@/components/merchant/Shell';
import m from '@/components/merchant/merchant.module.css';
import { dt, Icon, Notice, ui, yen } from '@/components/ui';
import { load, requireMerchant } from '@/server/auth/page';

export const metadata: Metadata = { title: '受付の結果' };

interface Op {
  operationId: string | null;
  status: string;
  receipt: null | {
    redemptionId: string;
    receiptNumber: string;
    amount: number;
    occurredAt: string;
    shopName: string;
    campaignName: string;
    status: string;
    count: number;
    items: { displayNumber: string; faceValue: number }[];
    reversal: null | { status: string; reason: string; createdAt: string };
  };
}

export default async function ReceiptPage({ params }: { params: Promise<{ operationId: string }> }) {
  const { operationId } = await params;
  const { db, me, shop } = await requireMerchant();
  const op = await load<Op>(db, 'api_operation_get', { p_id: operationId });
  const r = op.receipt;
  const isOwner = shop.roles.includes('shop_owner');
  return (
    <MerchantShell shop={shop} environment={me.environment} nav="none">
      {!r ? (
        <>
          <h1 className={ui.h1}>受付の結果</h1>
          <Notice tone="warning" title="この受付は記録されていません">
            確定した記録が見つかりません。お客様の券はまだ使用済みになっていません。必要なら読み直してください。
          </Notice>
          <Link className={ui.btn} href="/m">ホームへ</Link>
        </>
      ) : (
        <>
          <h1 className={ui.h1}>受付の結果</h1>
          <section className={m.slip} aria-label="受付票">
            {r.status === 'reversed' ? (
              <p className={m.statusPending}>取消済み</p>
            ) : (
              <p className={m.status}>
                <Icon name="check" /> 受付完了
              </p>
            )}
            <p className={ui.money}>{yen(r.amount)}</p>
            <dl className={ui.dl} style={{ marginTop: 16 }}>
              <dt>店舗</dt>
              <dd>{r.shopName}</dd>
              <dt>地域券</dt>
              <dd>{r.campaignName}（{r.count}枚）</dd>
              <dt>受付番号</dt>
              <dd className="tabular">{r.receiptNumber}</dd>
              <dt>日時</dt>
              <dd>{dt(r.occurredAt)}</dd>
            </dl>
            <p style={{ marginTop: 16 }}>{r.status === 'reversed' ? '取消は地域券報告に反映済みです。' : '地域券報告に反映済みです。入金は事務局の確認後になります。'}</p>
          </section>
          {r.reversal && (
            <Notice tone={r.reversal.status === 'approved' ? 'success' : 'warning'} title={`取消申請: ${{ requested: '事務局で確認中', approved: '承認済み', rejected: '承認されませんでした' }[r.reversal.status] ?? r.reversal.status}`}>
              理由: {r.reversal.reason}
            </Notice>
          )}
          <div className={ui.stack} style={{ marginTop: 24 }}>
            <Link className={ui.btn} href="/m/vouchers">次の券を読み取る</Link>
            <Link className={ui.secondary} href="/m">ホームへ</Link>
          </div>
          {isOwner && r.status === 'confirmed' && !r.reversal && <ReversalRequest redemptionId={r.redemptionId} />}
          {!isOwner && r.status === 'confirmed' && !r.reversal && (
            <p className={ui.help} style={{ marginTop: 24 }}>
              取り消しが必要な場合は店主に申請を依頼するか、<Link href={`/m/requests/new?category=voucher_payment&receipt=${r.receiptNumber}`}>事務局へ相談</Link>してください。
            </p>
          )}
        </>
      )}
    </MerchantShell>
  );
}
