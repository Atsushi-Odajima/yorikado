import type { Metadata } from 'next';
import Link from 'next/link';
import { OfficeShell } from '@/components/office/Shell';
import o from '@/components/office/office.module.css';
import { dt, Notice, ui, yen } from '@/components/ui';
import { load, requireOffice } from '@/server/auth/page';

export const metadata: Metadata = { title: '対応待ち' };

interface Item {
  priority: number;
  kind: string;
  id: string;
  shopName: string;
  title: string;
  amount?: number;
  reason?: string;
  status?: string;
  assignedName?: string | null;
  count?: number;
  at: string | null;
  link: string;
}

const KIND: Record<string, string> = {
  reversal: '取消申請', settlement: '精算', bank_change: '口座変更', issuance: '券の発行', paper: '紙券', task_review: '回答確認', request: '相談', task: '依頼',
};

export default async function OfficeQueue() {
  const { db, me, office } = await requireOffice();
  const items = await load<Item[]>(db, 'api_office_queue', { p_tenant: office.tenantId });
  return (
    <OfficeShell me={me} office={office} tab="queue">
      <h1 className={o.h1}>対応待ち</h1>
      <p className={ui.lead}>金額の例外 → 差戻し・確認待ち → 相談 → 通常の依頼 の順に並んでいます。</p>
      {items.length === 0 ? (
        <Notice tone="success" title="今のところ対応待ちはありません" />
      ) : (
        <ul className={o.queue}>
          {items.map((i) => (
            <li key={`${i.kind}-${i.id}`}>
              <Link href={i.link} className={o.queueRow}>
                <span className={o.kind}>{KIND[i.kind] ?? i.kind}</span>
                <span>
                  <strong>{i.title}</strong>
                  {i.reason && <span className={ui.meta}> 理由: {i.reason}</span>}
                  {typeof i.count === 'number' && <span className={ui.meta}> 未回答 {i.count}店</span>}
                </span>
                <span>{i.shopName || '—'}</span>
                <span className="tabular">{typeof i.amount === 'number' ? yen(i.amount) : i.assignedName ? `担当 ${i.assignedName}` : ''}</span>
                <span className={ui.meta}>{i.kind === 'task' ? `期限 ${dt(i.at)}` : dt(i.at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </OfficeShell>
  );
}
