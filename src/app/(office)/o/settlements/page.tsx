import type { Metadata } from 'next';
import Link from 'next/link';
import { SettlementGenerate } from '@/components/office/SettlementGenerate';
import { SETTLEMENT_STATUS } from '@/components/office/labels';
import { OfficeShell } from '@/components/office/Shell';
import o from '@/components/office/office.module.css';
import { d, StateBadge, ui, yen } from '@/components/ui';
import { requireOffice } from '@/server/auth/page';

export const metadata: Metadata = { title: '精算・照合' };

export default async function SettlementsPage() {
  const { db, me, office, can } = await requireOffice();
  const [{ data: batches }, { data: campaigns }] = await Promise.all([
    db.from('settlement_batches').select('id, batch_number, period_start, period_end, status, total_amount, export_count, created_at, campaigns(name)').eq('tenant_id', office.tenantId).order('created_at', { ascending: false }).limit(100),
    db.from('campaigns').select('id, name, status').eq('tenant_id', office.tenantId).neq('status', 'draft').order('name'),
  ]);
  return (
    <OfficeShell me={me} office={office} tab="vouchers">
      <Link href="/o/campaigns">← 地域券事業</Link>
      <h1 className={o.h1} style={{ marginTop: 8 }}>精算・照合</h1>
      <p className={ui.lead}>券実績の集計 → 精算案 → 別担当の承認 → 支払作業票 → 銀行結果の取込・照合 → 店舗の明細。各段階は別の状態として記録します。</p>
      {can(['office_operator']) && (
        <section className={o.section}>
          <h2 className={ui.h2} style={{ marginTop: 0 }}>精算案を作る</h2>
          <SettlementGenerate campaigns={(campaigns ?? []).map((c) => ({ id: c.id, name: c.name }))} />
        </section>
      )}
      <div className={ui.tableWrap}>
        <table className={ui.table}>
          <thead><tr><th>精算</th><th>事業</th><th>対象期間</th><th>状態</th><th className={ui.num}>合計</th></tr></thead>
          <tbody>
            {(batches ?? []).map((b) => (
              <tr key={b.id}>
                <td><Link href={`/o/settlements/${b.id}`}>#{b.batch_number}</Link></td>
                <td>{(b.campaigns as unknown as { name: string }).name}</td>
                <td>{d(b.period_start)}〜{d(new Date(Date.parse(b.period_end) - 1).toISOString())}</td>
                <td><StateBadge tone={b.status === 'confirmed' ? 'done' : b.status === 'exception' ? 'error' : b.status === 'review' ? 'todo' : 'muted'}>{SETTLEMENT_STATUS[b.status]}</StateBadge></td>
                <td className={ui.num}>{yen(b.total_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!batches?.length && <p>まだ精算はありません</p>}
    </OfficeShell>
  );
}
