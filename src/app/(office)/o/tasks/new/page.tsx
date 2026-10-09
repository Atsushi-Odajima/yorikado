import type { Metadata } from 'next';
import { TaskEditor } from '@/components/office/TaskEditor';
import { OfficeShell } from '@/components/office/Shell';
import o from '@/components/office/office.module.css';
import { requireOffice } from '@/server/auth/page';

export const metadata: Metadata = { title: '新しい依頼' };

export default async function NewTaskPage() {
  const { db, me, office } = await requireOffice();
  const { data: shops } = await db.from('shops').select('id, display_name').eq('tenant_id', office.tenantId).eq('status', 'active').order('display_name');
  return (
    <OfficeShell me={me} office={office} tab="tasks">
      <h1 className={o.h1}>新しい依頼（下書き）</h1>
      <TaskEditor tenantId={office.tenantId} shops={(shops ?? []).map((s) => ({ id: s.id, name: s.display_name }))} />
    </OfficeShell>
  );
}
