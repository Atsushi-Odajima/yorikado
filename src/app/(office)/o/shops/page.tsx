import type { Metadata } from 'next';
import Link from 'next/link';
import { ShopCreate } from '@/components/office/ShopTools';
import { OfficeShell } from '@/components/office/Shell';
import o from '@/components/office/office.module.css';
import { StateBadge, ui } from '@/components/ui';
import { requireOffice } from '@/server/auth/page';

export const metadata: Metadata = { title: '店舗' };

export default async function ShopsPage() {
  const { db, me, office, can } = await requireOffice();
  const { data } = await db.from('shops').select('id, display_name, address, status, external_code').eq('tenant_id', office.tenantId).order('display_name');
  return (
    <OfficeShell me={me} office={office} tab="shops">
      <h1 className={o.h1}>店舗</h1>
      <div className={ui.tableWrap}>
        <table className={ui.table}>
          <thead><tr><th>店名</th><th>店舗コード</th><th>住所</th><th>状態</th></tr></thead>
          <tbody>
            {(data ?? []).map((s) => (
              <tr key={s.id}>
                <td><Link href={`/o/shops/${s.id}`}>{s.display_name}</Link></td>
                <td>{s.external_code ?? '—'}</td>
                <td>{s.address}</td>
                <td><StateBadge tone={s.status === 'active' ? 'done' : 'error'}>{{ active: '利用中', suspended: '停止', closed: '退会' }[s.status as string]}</StateBadge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {can(['office_operator', 'tenant_admin']) && (
        <section className={o.section} style={{ marginTop: 24 }}>
          <h2 className={ui.h2} style={{ marginTop: 0 }}>店舗を登録する</h2>
          <ShopCreate tenantId={office.tenantId} />
        </section>
      )}
    </OfficeShell>
  );
}
