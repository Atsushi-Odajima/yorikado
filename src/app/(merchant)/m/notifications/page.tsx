import type { Metadata } from 'next';
import { BackLink, MerchantShell } from '@/components/merchant/Shell';
import { NotificationList } from '@/components/feedback/NotificationList';
import { ui } from '@/components/ui';
import { load, requireMerchant } from '@/server/auth/page';

export const metadata: Metadata = { title: 'お知らせ' };

export default async function NotificationsPage() {
  const { db, me, shop } = await requireMerchant();
  const list = await load<{ id: string; title: string; link: string; readAt: string | null; createdAt: string }[]>(db, 'api_notifications_list', { p_limit: 30 });
  return (
    <MerchantShell shop={shop} environment={me.environment} nav="home">
      <BackLink href="/m" label="ホームへ" />
      <h1 className={ui.h1}>お知らせ</h1>
      <NotificationList items={list} />
    </MerchantShell>
  );
}
