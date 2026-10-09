import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PaperForm } from '@/components/merchant/PaperForm';
import { BackLink, MerchantShell } from '@/components/merchant/Shell';
import { ui } from '@/components/ui';
import { requireMerchant } from '@/server/auth/page';

export const metadata: Metadata = { title: '紙券を登録する' };

export default async function NewPaperPage({ searchParams }: { searchParams: Promise<{ campaignId?: string }> }) {
  const { campaignId } = await searchParams;
  const { db, me, shop } = await requireMerchant();
  if (!campaignId) notFound();
  const { data: c } = await db.from('campaigns').select('id, name, denominations, mode, rules_text').eq('id', campaignId).maybeSingle();
  if (!c || c.mode !== 'paper_count') notFound();
  return (
    <MerchantShell shop={shop} environment={me.environment} nav="none">
      <BackLink href="/m" label="ホームへ" />
      <h1 className={ui.h1}>紙券を登録する</h1>
      <p className={ui.lead}>{c.name}。申告は「受付」です。事務局が原本を確認してから換金対象になります。</p>
      <PaperForm shopId={shop.shopId} campaignId={c.id} denominations={c.denominations as number[]} />
    </MerchantShell>
  );
}
