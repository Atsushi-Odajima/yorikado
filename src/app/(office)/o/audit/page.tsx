import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { OfficeShell } from '@/components/office/Shell';
import o from '@/components/office/office.module.css';
import { dt, ui } from '@/components/ui';
import { load, requireOffice } from '@/server/auth/page';

export const metadata: Metadata = { title: '監査ログ' };

interface Ev { id: string; action: string; entity: string; entityId: string | null; actorName: string | null; shopName: string | null; after: Record<string, unknown> | null; requestId: string | null; occurredAt: string }

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const sp = await searchParams;
  const { db, me, office, can } = await requireOffice();
  if (!can(['tenant_admin', 'auditor', 'office_approver'])) redirect('/o');
  const list = await load<Ev[]>(db, 'api_audit_list', { p_tenant: office.tenantId, p_before: sp.before ?? null, p_limit: 100 });
  return (
    <OfficeShell me={me} office={office} tab={null}>
      <h1 className={o.h1}>監査ログ</h1>
      <p className={ui.lead}>記録は追記のみで、変更・削除できません。秘密のtoken・口座番号・パスワードは記録しません。</p>
      <div className={ui.tableWrap}>
        <table className={ui.table}>
          <thead><tr><th>日時</th><th>操作</th><th>対象</th><th>実行者</th><th>店舗</th><th>内容</th></tr></thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id}>
                <td>{dt(e.occurredAt)}</td>
                <td>{e.action}</td>
                <td>{e.entity}<br /><span className={ui.meta} style={{ fontSize: 12 }}>{e.entityId}</span></td>
                <td>{e.actorName ?? '—'}</td>
                <td>{e.shopName ?? '—'}</td>
                <td style={{ fontSize: 12, maxWidth: 360, wordBreak: 'break-all' }}>{e.after ? JSON.stringify(e.after) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.length === 100 && <p style={{ marginTop: 16 }}><Link href={`/o/audit?before=${encodeURIComponent(list[list.length - 1]!.occurredAt)}`}>さらに古い記録</Link></p>}
    </OfficeShell>
  );
}
