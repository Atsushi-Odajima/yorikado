import type { Metadata } from 'next';
import { CampaignForm } from '@/components/office/CampaignForm';
import { OfficeShell } from '@/components/office/Shell';
import o from '@/components/office/office.module.css';
import { requireOffice } from '@/server/auth/page';

export const metadata: Metadata = { title: '新しい地域券事業' };

export default async function NewCampaignPage() {
  const { db, me, office } = await requireOffice();
  const { data: shops } = await db.from('shops').select('id, display_name, status').eq('tenant_id', office.tenantId).eq('status', 'active').order('display_name');
  return (
    <OfficeShell me={me} office={office} tab="vouchers">
      <h1 className={o.h1}>新しい地域券事業（下書き）</h1>
      <CampaignForm tenantId={office.tenantId} environment={me.environment ?? 'DEMO'} shops={(shops ?? []).map((s) => ({ id: s.id, name: s.display_name }))} />
    </OfficeShell>
  );
}
