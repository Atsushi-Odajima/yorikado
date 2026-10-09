import type { Metadata } from 'next';
import Link from 'next/link';
import { OfficeShell } from '@/components/office/Shell';
import o from '@/components/office/office.module.css';
import { dt, StateBadge, ui } from '@/components/ui';
import { TASK_TYPE_LABEL, type TaskType } from '@/domain/tasks/templates';
import { load, requireOffice } from '@/server/auth/page';

export const metadata: Metadata = { title: '依頼' };

interface T {
  id: string;
  type: TaskType;
  title: string;
  status: string;
  dueAt: string | null;
  recipients: number;
  targets: number;
  unanswered: number;
  pendingReview: number;
  supersededBy: string | null;
}

export default async function OfficeTasksPage() {
  const { db, me, office, can } = await requireOffice();
  const tasks = await load<T[]>(db, 'api_tasks_office_list', { p_tenant: office.tenantId });
  return (
    <OfficeShell me={me} office={office} tab="tasks">
      <div className={o.toolbar}>
        <h1 className={o.h1} style={{ margin: 0 }}>依頼</h1>
        {can(['office_operator']) && <Link href="/o/tasks/new" className={`${ui.btn} ${ui.inline}`}>新しい依頼</Link>}
      </div>
      <div className={ui.tableWrap}>
        <table className={ui.table}>
          <thead><tr><th>件名</th><th>種類</th><th>状態</th><th>期限</th><th className={ui.num}>対象</th><th className={ui.num}>未回答</th><th className={ui.num}>確認待ち</th></tr></thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td><Link href={`/o/tasks/${t.id}`}>{t.title}</Link>{t.supersededBy && <span className={ui.meta}>（改版済み）</span>}</td>
                <td>{TASK_TYPE_LABEL[t.type]}</td>
                <td><StateBadge tone={t.status === 'published' ? 'todo' : 'muted'}>{{ draft: '下書き', published: '公開中', closed: '締切' }[t.status]}</StateBadge></td>
                <td>{dt(t.dueAt)}</td>
                <td className={ui.num}>{t.status === 'draft' ? t.targets : t.recipients}</td>
                <td className={ui.num}>{t.status === 'draft' ? '—' : t.unanswered}</td>
                <td className={ui.num}>{t.status === 'draft' ? '—' : t.pendingReview}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tasks.length === 0 && <p>まだ依頼はありません</p>}
    </OfficeShell>
  );
}
