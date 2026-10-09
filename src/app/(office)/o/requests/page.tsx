import type { Metadata } from 'next';
import Link from 'next/link';
import { OfficeShell } from '@/components/office/Shell';
import o from '@/components/office/office.module.css';
import m from '@/components/merchant/merchant.module.css';
import { dt, StateBadge, ui } from '@/components/ui';
import { CATEGORY_LABEL, REQUEST_STATUS_LABEL, type RequestCategory } from '@/domain/requests/categories';
import { requireOffice } from '@/server/auth/page';

export const metadata: Metadata = { title: '相談' };

const FILTERS = [['open', '未完了'], ['received', '受付'], ['in_progress', '対応中'], ['awaiting_shop', '返事待ち'], ['resolved', '完了']] as const;

export default async function OfficeRequestsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const status = FILTERS.some(([k]) => k === sp.status) ? sp.status! : 'open';
  const { db, me, office } = await requireOffice();
  let q = db.from('requests').select('id, request_number, category, subject, status, assigned_to, last_shop_activity_at, updated_at, shops(display_name)').eq('tenant_id', office.tenantId).order('last_shop_activity_at', { ascending: false }).limit(200);
  q = status === 'open' ? q.neq('status', 'resolved') : q.eq('status', status);
  const [{ data }, { data: profiles }] = await Promise.all([q, db.rpc('api_office_members', { p_tenant: office.tenantId })]);
  const names = new Map(((profiles as { userId: string; displayName: string }[] | null) ?? []).map((p) => [p.userId, p.displayName]));
  return (
    <OfficeShell me={me} office={office} tab="requests">
      <h1 className={o.h1}>相談</h1>
      <nav className={m.filters} aria-label="状態で絞り込み">
        {FILTERS.map(([k, label]) => <Link key={k} href={`/o/requests?status=${k}`} className={m.filter} aria-current={status === k ? 'page' : undefined}>{label}</Link>)}
      </nav>
      <div className={ui.tableWrap}>
        <table className={ui.table}>
          <thead><tr><th>受付番号</th><th>件名</th><th>店舗</th><th>分類</th><th>状態</th><th>担当</th><th>店の最終更新</th></tr></thead>
          <tbody>
            {(data ?? []).map((r) => (
              <tr key={r.id}>
                <td>{r.request_number}</td>
                <td><Link href={`/o/requests/${r.id}`}>{r.subject}</Link></td>
                <td>{(r.shops as unknown as { display_name: string }).display_name}</td>
                <td>{CATEGORY_LABEL[r.category as RequestCategory]}</td>
                <td><StateBadge tone={r.status === 'resolved' ? 'done' : r.status === 'received' ? 'todo' : 'muted'}>{REQUEST_STATUS_LABEL[r.status]}</StateBadge></td>
                <td>{r.assigned_to ? names.get(r.assigned_to) ?? '—' : '未割当'}</td>
                <td>{dt(r.last_shop_activity_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data?.length && <p>該当する相談はありません</p>}
    </OfficeShell>
  );
}
