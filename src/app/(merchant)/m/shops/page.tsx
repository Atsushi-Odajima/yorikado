import type { Metadata } from 'next';
import Link from 'next/link';
import { AccountActions, ShopSwitcher } from '@/components/merchant/ShopSwitcher';
import { DemoBanner, ui } from '@/components/ui';
import m from '@/components/merchant/merchant.module.css';
import { getMe } from '@/server/auth/page';

export const metadata: Metadata = { title: '店舗の切替・アカウント' };

export default async function ShopsPage() {
  const { me } = await getMe();
  return (
    <>
      <DemoBanner environment={me.environment} />
      <main className={m.wrap}>
        <Link href="/m" className={m.back}>← ホームへ</Link>
        <h1 className={ui.h1}>店舗の切替・アカウント</h1>
        {me.shops.length > 0 && (
          <>
            <h2 className={ui.h2}>店舗を選ぶ</h2>
            <ShopSwitcher shops={me.shops.map((s) => ({ id: s.shopId, name: s.shopName, tenant: s.tenantName, roles: s.roles }))} />
          </>
        )}
        {me.offices.length > 0 && (
          <p style={{ marginTop: 16 }}>
            <Link href="/o">事務局の画面へ</Link>
          </p>
        )}
        <h2 className={ui.h2}>アカウント</h2>
        <p className={ui.help}>表示名: {me.profile?.displayName}</p>
        <ul className={ui.list}>
          <li className={ui.listItem}>
            <Link className={ui.rowLink} href="/m/settings">口座・二段階認証の設定</Link>
          </li>
        </ul>
        <AccountActions />
      </main>
    </>
  );
}
