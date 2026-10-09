import type { Metadata } from 'next';
import { BankChangeForm } from '@/components/merchant/BankChangeForm';
import { BackLink, MerchantShell } from '@/components/merchant/Shell';
import { dt, Notice, StateBadge, ui } from '@/components/ui';
import { load, requireMerchant } from '@/server/auth/page';
import Link from 'next/link';

export const metadata: Metadata = { title: '口座・二段階認証' };

export default async function SettingsPage() {
  const { db, me, shop } = await requireMerchant();
  const isOwner = shop.roles.includes('shop_owner');
  const accounts = isOwner
    ? await load<{ id: string; version: number; label: string; status: string; createdAt: string; decidedAt: string | null }[]>(db, 'api_bank_accounts_for_shop', { p_shop: shop.shopId })
    : [];
  const current = accounts.find((a) => a.status === 'approved');
  const pending = accounts.find((a) => a.status === 'pending');
  return (
    <MerchantShell shop={shop} environment={me.environment} nav="none">
      <BackLink href="/m/shops" />
      <h1 className={ui.h1}>口座・二段階認証</h1>
      <h2 className={ui.h2}>二段階認証</h2>
      <p>
        状態: <strong>{me.aal === 'aal2' ? '認証済み' : '未確認'}</strong>
      </p>
      <p className={ui.help}>口座変更の申請には認証アプリの登録と確認が必要です。毎回の券の受付には不要です。</p>
      <Link href="/mfa" className={ui.secondary} style={{ marginTop: 8 }}>認証アプリの登録・確認</Link>
      <h2 className={ui.h2}>入金先の口座</h2>
      {!isOwner ? (
        <p>口座の確認・変更は店主のみ行えます。</p>
      ) : (
        <>
          <p>
            現在: <strong>{current ? current.label : '未登録'}</strong>
          </p>
          {pending ? (
            <Notice tone="warning" title="口座変更の確認待ちです">
              {pending.label}（{dt(pending.createdAt)} 申請）。事務局の承認後に切り替わります。
            </Notice>
          ) : (
            <BankChangeForm shopId={shop.shopId} />
          )}
          {accounts.length > 0 && (
            <details style={{ marginTop: 16 }}>
              <summary>変更履歴</summary>
              <ul>
                {accounts.map((a) => (
                  <li key={a.id}>
                    版{a.version} {a.label} <StateBadge tone={a.status === 'approved' ? 'done' : a.status === 'pending' ? 'todo' : 'error'}>{{ approved: '承認済み', pending: '確認待ち', rejected: '不承認' }[a.status]}</StateBadge>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </MerchantShell>
  );
}
