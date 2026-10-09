import Link from 'next/link';
import type { ReactNode } from 'react';
import { DemoBanner, Icon } from '@/components/ui';
import type { MeShop } from '@/server/auth/page';
import m from './merchant.module.css';

/** Merchant page frame: header (商店街・店名 → 切替/アカウント), optional bottom nav (ホーム/履歴). */
export function MerchantShell({
  shop,
  environment,
  nav,
  unread,
  children,
}: {
  shop: MeShop;
  environment: string | null;
  nav?: 'home' | 'history' | 'none';
  unread?: number;
  children: ReactNode;
}) {
  const withNav = nav && nav !== 'none';
  return (
    <>
      <DemoBanner environment={environment} />
      <header className={m.header}>
        <Link href="/m/shops" className={m.shopLink} aria-label={`${shop.tenantName} ${shop.shopName}。店舗の切替とアカウント`}>
          <span className={m.tenantName}>{shop.tenantName}</span>
          <span className={m.shopName}>{shop.shopName}</span>
          <span className={m.switchHint}>店舗切替・アカウント</span>
        </Link>
        {typeof unread === 'number' && unread > 0 && (
          <Link href="/m/notifications" className={m.notif}>
            お知らせ {unread}件
          </Link>
        )}
      </header>
      <main className={`${m.wrap} ${withNav ? m.withNav : ''}`}>{children}</main>
      {withNav && (
        <nav className={m.nav} aria-label="メイン">
          <div className={m.navInner}>
            <Link href="/m" className={m.navItem} aria-current={nav === 'home' ? 'page' : undefined}>
              <Icon name="home" />
              ホーム
            </Link>
            <Link href="/m/history" className={m.navItem} aria-current={nav === 'history' ? 'page' : undefined}>
              <Icon name="history" />
              履歴
            </Link>
          </div>
        </nav>
      )}
    </>
  );
}

export function BackLink({ href, label = '戻る' }: { href: string; label?: string }) {
  return (
    <Link href={href} className={m.back}>
      ← {label}
    </Link>
  );
}
