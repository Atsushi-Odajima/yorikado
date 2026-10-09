import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ConfirmPanel, type Draft } from '@/components/merchant/ConfirmPanel';
import { MerchantShell } from '@/components/merchant/Shell';
import { ui } from '@/components/ui';
import { load, requireMerchant } from '@/server/auth/page';

export const metadata: Metadata = { title: '受取の確認' };

export default async function ConfirmPage({ params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await params;
  const { db, me, shop } = await requireMerchant();
  const draft = await load<Draft>(db, 'api_receipt_draft_get', { p_draft: draftId });
  if (draft.operationId) redirect(`/m/receipts/${draft.operationId}`);
  return (
    <MerchantShell shop={shop} environment={me.environment} nav="none">
      <h1 className={ui.h1}>受け取る金額の確認</h1>
      <ConfirmPanel draft={draft} />
    </MerchantShell>
  );
}
