import type { Metadata } from 'next';
import Link from 'next/link';
import { MerchantShell } from '@/components/merchant/Shell';
import m from '@/components/merchant/merchant.module.css';
import { dt, RowLink, StateBadge, ui, yen } from '@/components/ui';
import { load, requireMerchant } from '@/server/auth/page';

export const metadata: Metadata = { title: '履歴' };

interface Item {
  kind: 'voucher' | 'paper' | 'task' | 'request';
  id: string;
  operationId?: string;
  at: string;
  title: string;
  amount?: number;
  status: string;
  actorName?: string;
  proxy?: boolean;
  reversal?: string | null;
}

const FILTERS = [
  ['all', 'すべて'],
  ['voucher', '券'],
  ['task', '返事'],
  ['request', '相談'],
] as const;

const STATUS: Record<string, string> = {
  confirmed: '確定', reversed: '取消済み', submitted: '提出済み', approved: '回答済み', returned: '差戻し', draft: '下書き', verified: '原本確認済み',
  rejected: '不受理', received: '受付', in_progress: '対応中', awaiting_shop: '返事待ち', resolved: '完了',
};

function href(i: Item): string {
  if (i.kind === 'voucher') return `/m/receipts/${i.operationId}`;
  if (i.kind === 'paper') return `/m/paper/${i.id}`;
  if (i.kind === 'task') return `/m/tasks/${i.id}`;
  return `/m/requests/${i.id}`;
}

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ kind?: string; before?: string }> }) {
  const sp = await searchParams;
  const kind = FILTERS.some(([k]) => k === sp.kind) ? sp.kind! : 'all';
  const { db, me, shop } = await requireMerchant();
  const r = await load<{ items: Item[]; nextBefore: string | null }>(db, 'api_history_for_shop', { p_shop: shop.shopId, p_kind: kind, p_before: sp.before ?? null, p_limit: 50 });
  return (
    <MerchantShell shop={shop} environment={me.environment} nav="history">
      <h1 className={ui.h1}>履歴</h1>
      <nav className={m.filters} aria-label="絞り込み">
        {FILTERS.map(([k, label]) => (
          <Link key={k} href={`/m/history?kind=${k}`} className={m.filter} aria-current={kind === k ? 'page' : undefined}>
            {label}
          </Link>
        ))}
      </nav>
      {r.items.length === 0 ? (
        <p>{kind === 'voucher' ? 'まだ券の受付はありません' : 'まだ履歴はありません'}</p>
      ) : (
        <ul className={ui.list}>
          {r.items.map((i) => (
            <RowLink
              key={`${i.kind}-${i.id}-${i.at}`}
              href={href(i)}
              title={i.title}
              meta={`${dt(i.at)}${i.actorName ? `・${i.actorName}` : ''}${i.proxy ? '・事務局が代理入力' : ''}${i.reversal ? `・取消申請(${i.reversal === 'requested' ? '確認中' : i.reversal === 'approved' ? '承認' : '不承認'})` : ''}`}
              aside={
                <>
                  {typeof i.amount === 'number' && <span className="tabular">{yen(i.amount)}</span>}
                  <StateBadge tone={i.status === 'reversed' || i.status === 'returned' ? 'error' : 'muted'}>{STATUS[i.status] ?? i.status}</StateBadge>
                </>
              }
            />
          ))}
        </ul>
      )}
      {r.nextBefore && (
        <p style={{ marginTop: 16 }}>
          <Link href={`/m/history?kind=${kind}&before=${encodeURIComponent(r.nextBefore)}`}>さらに古い履歴を見る</Link>
        </p>
      )}
    </MerchantShell>
  );
}
