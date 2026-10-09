import type { Metadata } from 'next';
import Link from 'next/link';
import { BackLink, MerchantShell } from '@/components/merchant/Shell';
import { dt, RowLink, StateBadge, ui } from '@/components/ui';
import { CATEGORY_LABEL, REQUEST_STATUS_LABEL, type RequestCategory } from '@/domain/requests/categories';
import { requireMerchant } from '@/server/auth/page';

export const metadata: Metadata = { title: '事務局に相談' };

export default async function RequestsPage() {
  const { db, me, shop } = await requireMerchant();
  const { data, error } = await db
    .from('requests')
    .select('id, request_number, category, subject, status, updated_at')
    .eq('shop_id', shop.shopId)
    .order('updated_at', { ascending: false })
    .limit(50);
  return (
    <MerchantShell shop={shop} environment={me.environment} nav="home">
      <BackLink href="/m" label="ホームへ" />
      <h1 className={ui.h1}>事務局に相談</h1>
      <Link href="/m/requests/new" className={ui.btn}>新しく相談する</Link>
      <h2 className={ui.h2}>これまでの相談</h2>
      {error ? (
        <p>相談の一覧を読み込めませんでした。画面を再読み込みしてください。</p>
      ) : !data?.length ? (
        <p>まだ相談はありません</p>
      ) : (
        <ul className={ui.list}>
          {data.map((r) => (
            <RowLink
              key={r.id}
              href={`/m/requests/${r.id}`}
              title={r.subject}
              meta={`${r.request_number}・${CATEGORY_LABEL[r.category as RequestCategory]}・${dt(r.updated_at)}`}
              aside={<StateBadge tone={r.status === 'resolved' ? 'done' : r.status === 'awaiting_shop' ? 'todo' : 'muted'}>{REQUEST_STATUS_LABEL[r.status]}</StateBadge>}
            />
          ))}
        </ul>
      )}
    </MerchantShell>
  );
}
