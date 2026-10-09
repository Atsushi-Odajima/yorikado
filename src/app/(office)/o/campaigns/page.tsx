import type { Metadata } from 'next';
import Link from 'next/link';
import { CAMPAIGN_STATUS, MODE_LABEL } from '@/components/office/labels';
import { OfficeShell } from '@/components/office/Shell';
import o from '@/components/office/office.module.css';
import { d, StateBadge, ui } from '@/components/ui';
import { requireOffice } from '@/server/auth/page';

export const metadata: Metadata = { title: '地域券事業' };


export default async function CampaignsPage() {
  const { db, me, office, can } = await requireOffice();
  const { data } = await db
    .from('campaigns')
    .select('id, name, mode, environment, status, starts_at, ends_at, denominations, submitted_at')
    .eq('tenant_id', office.tenantId)
    .order('created_at', { ascending: false });
  return (
    <OfficeShell me={me} office={office} tab="vouchers">
      <div className={o.toolbar}>
        <h1 className={o.h1} style={{ margin: 0 }}>地域券事業</h1>
        <div className={ui.row}>
          <Link href="/o/settlements" className={`${ui.secondary} ${ui.inline}`}>精算・照合</Link>
          {can(['office_operator', 'tenant_admin']) && <Link href="/o/campaigns/new" className={`${ui.btn} ${ui.inline}`}>新しい事業</Link>}
        </div>
      </div>
      <div className={ui.tableWrap}>
        <table className={ui.table}>
          <thead>
            <tr>
              <th>事業</th>
              <th>方式</th>
              <th>環境</th>
              <th>状態</th>
              <th>期間</th>
              <th>額面</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((c) => (
              <tr key={c.id}>
                <td><Link href={`/o/campaigns/${c.id}`}>{c.name}</Link></td>
                <td>{MODE_LABEL[c.mode]}</td>
                <td>{c.environment === 'DEMO' ? '練習(DEMO)' : '本番(LIVE)'}</td>
                <td>
                  <StateBadge tone={c.status === 'active' ? 'done' : c.status === 'suspended' ? 'error' : 'muted'}>{CAMPAIGN_STATUS[c.status]}</StateBadge>
                  {c.status === 'draft' && c.submitted_at && <span className={ui.meta}> 承認待ち</span>}
                </td>
                <td>{d(c.starts_at)}〜{d(c.ends_at)}</td>
                <td className={ui.num}>{(c.denominations as number[]).map((x) => x.toLocaleString('ja-JP')).join(' / ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data?.length && <p>まだ事業はありません</p>}
    </OfficeShell>
  );
}
