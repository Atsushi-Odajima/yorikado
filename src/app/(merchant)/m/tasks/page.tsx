import type { Metadata } from 'next';
import { BackLink, MerchantShell } from '@/components/merchant/Shell';
import { d, RowLink, StateBadge, ui } from '@/components/ui';
import { TASK_STATE_LABEL, TASK_TYPE_LABEL, type TaskType } from '@/domain/tasks/templates';
import { load, requireMerchant } from '@/server/auth/page';

export const metadata: Metadata = { title: '報告・返事' };

interface Item {
  id: string;
  type: TaskType;
  title: string;
  dueAt: string | null;
  status: string;
  state: string;
  officeName: string;
}

export default async function TasksPage() {
  const { db, me, shop } = await requireMerchant();
  const tasks = await load<Item[]>(db, 'api_tasks_for_shop', { p_shop: shop.shopId });
  const now = Date.now();
  return (
    <MerchantShell shop={shop} environment={me.environment} nav="home">
      <BackLink href="/m" label="ホームへ" />
      <h1 className={ui.h1}>報告・返事</h1>
      {tasks.length === 0 ? (
        <p>今のところ返事はありません</p>
      ) : (
        <ul className={ui.list}>
          {tasks.map((t) => {
            const overdue = t.dueAt && Date.parse(t.dueAt) < now && t.state === 'unanswered';
            return (
              <RowLink
                key={t.id}
                href={`/m/tasks/${t.id}`}
                title={t.title}
                meta={`${TASK_TYPE_LABEL[t.type]}・${t.officeName}・期限 ${d(t.dueAt)}${overdue ? '（期限切れ）' : ''}${t.status === 'closed' ? '・締切済み' : ''}`}
                aside={<StateBadge tone={t.state === 'done' ? 'done' : t.state === 'returned' || overdue ? 'error' : t.state === 'pending_review' ? 'muted' : 'todo'}>{TASK_STATE_LABEL[t.state] ?? t.state}</StateBadge>}
              />
            );
          })}
        </ul>
      )}
    </MerchantShell>
  );
}
