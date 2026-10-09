import type { Metadata } from 'next';
import { TaskAnswer, type TaskDetail } from '@/components/merchant/TaskAnswer';
import { BackLink, MerchantShell } from '@/components/merchant/Shell';
import { d, StateBadge, ui } from '@/components/ui';
import { TASK_STATE_LABEL, TASK_TYPE_LABEL } from '@/domain/tasks/templates';
import { load, requireMerchant } from '@/server/auth/page';

export const metadata: Metadata = { title: '依頼の詳細' };

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, me, shop } = await requireMerchant();
  const t = await load<TaskDetail>(db, 'api_task_for_shop', { p_task: id, p_shop: shop.shopId });
  return (
    <MerchantShell shop={shop} environment={me.environment} nav="none">
      <BackLink href="/m/tasks" label="一覧へ" />
      <p className={ui.meta}>{TASK_TYPE_LABEL[t.type]}・期限 {d(t.dueAt)}</p>
      <h1 className={ui.h1}>{t.title}</h1>
      <p style={{ marginBottom: 16 }}>
        <StateBadge tone={t.state === 'done' ? 'done' : t.state === 'returned' ? 'error' : t.state === 'pending_review' ? 'muted' : 'todo'}>{TASK_STATE_LABEL[t.state]}</StateBadge>
      </p>
      {t.body && <div style={{ whiteSpace: 'pre-wrap', marginBottom: 24 }}>{t.body}</div>}
      <TaskAnswer task={t} shopId={shop.shopId} />
    </MerchantShell>
  );
}
