import type { Metadata } from 'next';
import { RequestForm } from '@/components/merchant/RequestForm';
import { BackLink, MerchantShell } from '@/components/merchant/Shell';
import { ui } from '@/components/ui';
import { load, requireMerchant } from '@/server/auth/page';

export const metadata: Metadata = { title: '相談する' };

export default async function NewRequestPage({ searchParams }: { searchParams: Promise<{ category?: string; receipt?: string; related?: string }> }) {
  const sp = await searchParams;
  const { db, me, shop } = await requireMerchant();
  const home = await load<{ tenant: { officeHours: string } }>(db, 'api_merchant_home', { p_shop: shop.shopId });
  return (
    <MerchantShell shop={shop} environment={me.environment} nav="none">
      <BackLink href="/m/requests" />
      <h1 className={ui.h1}>事務局に相談する</h1>
      <RequestForm shopId={shop.shopId} officeHours={home.tenant.officeHours} initialCategory={sp.category} receipt={sp.receipt} related={sp.related} />
    </MerchantShell>
  );
}
