import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Scanner } from '@/components/merchant/Scanner';
import { BackLink, MerchantShell } from '@/components/merchant/Shell';
import { Notice, ui } from '@/components/ui';
import { load, requireMerchant } from '@/server/auth/page';

export const metadata: Metadata = { title: '券を読み取る' };

export default async function ScanPage({ searchParams }: { searchParams: Promise<{ campaignId?: string }> }) {
  const { db, me, shop } = await requireMerchant();
  const home = await load<{ campaigns: { id: string; name: string; mode: string; usable: boolean; reason: string | null }[] }>(db, 'api_merchant_home', { p_shop: shop.shopId });
  const qr = home.campaigns.filter((c) => c.mode === 'owned_qr');
  const { campaignId } = await searchParams;
  const campaign = qr.find((c) => c.id === campaignId) ?? (qr.filter((c) => c.usable).length === 1 ? qr.find((c) => c.usable) : undefined);
  if (!campaign) redirect('/m/vouchers');
  return (
    <MerchantShell shop={shop} environment={me.environment} nav="none">
      <BackLink href="/m" label="ホームへ" />
      <h1 className={ui.h1}>券を読み取る</h1>
      {!campaign.usable ? (
        <Notice tone="warning" title={`${campaign.name}は受け付けできません`}>
          {campaign.reason ?? '現在受付できません'}
        </Notice>
      ) : (
        <Scanner shopId={shop.shopId} shopName={shop.shopName} campaignId={campaign.id} campaignName={campaign.name} />
      )}
    </MerchantShell>
  );
}
