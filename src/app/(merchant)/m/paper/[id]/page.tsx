import type { Metadata } from 'next';
import { PaperForm } from '@/components/merchant/PaperForm';
import { BackLink, MerchantShell } from '@/components/merchant/Shell';
import { d, Notice, StateBadge, ui, yen } from '@/components/ui';
import { requireMerchant } from '@/server/auth/page';
import { notFound } from 'next/navigation';

export const metadata: Metadata = { title: '紙券の申告' };

const STATUS: Record<string, string> = { draft: '下書き', submitted: '事務局で原本確認中', returned: '差戻し', verified: '原本確認済み', rejected: '受理されませんでした' };

export default async function PaperPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sent?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { db, me, shop } = await requireMerchant();
  const { data: p } = await db.from('paper_reports').select('*, campaigns(name, denominations)').eq('id', id).eq('shop_id', shop.shopId).maybeSingle();
  if (!p) notFound();
  const c = p.campaigns as { name: string; denominations: number[] };
  return (
    <MerchantShell shop={shop} environment={me.environment} nav="none">
      <BackLink href="/m/history?kind=voucher" label="履歴へ" />
      {sp.sent && <Notice tone="success" title="申告を受け付けました">事務局が原本を確認してから換金対象になります。まだ入金は確定していません。</Notice>}
      <h1 className={ui.h1}>紙券の申告</h1>
      <p style={{ marginBottom: 16 }}>
        <StateBadge tone={p.status === 'verified' ? 'done' : p.status === 'returned' || p.status === 'rejected' ? 'error' : 'muted'}>{STATUS[p.status]}</StateBadge>
      </p>
      <dl className={ui.dl}>
        <dt>地域券</dt>
        <dd>{c.name}</dd>
        <dt>受け取った日</dt>
        <dd>{d(p.received_date)}</dd>
        <dt>枚数</dt>
        <dd>{Object.entries(p.denomination_counts as Record<string, number>).filter(([, n]) => n > 0).map(([k, n]) => `${yen(Number(k))}×${n}枚`).join('、')}</dd>
        <dt>申告額</dt>
        <dd className="tabular">{yen(p.claimed_amount)}</dd>
        {p.verified_amount !== null && (
          <>
            <dt>確認額</dt>
            <dd className="tabular">{yen(p.verified_amount)}</dd>
          </>
        )}
        <dt>束番号</dt>
        <dd>{p.original_bundle_ref || '—'}</dd>
      </dl>
      {p.difference_reason && <Notice tone="warning" title="申告額と確認額が違います">{p.difference_reason}</Notice>}
      {p.status === 'returned' && (
        <>
          <Notice tone="error" title="事務局から差し戻されました">{p.return_reason}</Notice>
          <h2 className={ui.h2}>直して再提出する</h2>
          <PaperForm
            shopId={shop.shopId}
            campaignId={p.campaign_id}
            denominations={c.denominations}
            initial={{ id: p.id, version: p.version, receivedDate: p.received_date, counts: p.denomination_counts, photoIds: p.photo_ids, bundleRef: p.original_bundle_ref }}
          />
        </>
      )}
    </MerchantShell>
  );
}
