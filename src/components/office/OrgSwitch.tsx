'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import o from './office.module.css';

export function OrgSwitch({ current, offices, canAdmin, canAudit, hasShops }: { current: { id: string; name: string }; offices: { id: string; name: string }[]; canAdmin: boolean; canAudit: boolean; hasShops: boolean }) {
  const router = useRouter();
  return (
    <details className={o.orgMenu}>
      <summary aria-label={`${current.name}（組織メニュー）`}>{current.name} ▾</summary>
      <div className={o.orgPanel}>
        {offices.length > 1 &&
          offices.filter((x) => x.id !== current.id).map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={async () => {
                await api('/context/tenant', { body: { tenantId: x.id } });
                router.push('/o');
                router.refresh();
              }}
            >
              {x.name}に切り替える
            </button>
          ))}
        <Link href="/o/settlements">精算・照合</Link>
        {canAdmin && <Link href="/o/settings">組織の設定・メンバー</Link>}
        {canAudit && <Link href="/o/audit">監査ログ</Link>}
        {canAdmin || canAudit ? <Link href="/o/settings#export">データ出力</Link> : null}
        <Link href="/mfa">二段階認証</Link>
        {hasShops && <Link href="/m">店舗の画面へ</Link>}
        <button
          type="button"
          onClick={async () => {
            await api('/auth/logout', { body: { scope: 'local' } }).catch(() => undefined);
            router.replace('/login');
            router.refresh();
          }}
        >
          ログアウト
        </button>
      </div>
    </details>
  );
}
