'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { useAction } from '@/components/forms/useAction';
import { Button, ui } from '@/components/ui';
import { api } from '@/lib/api-client';

const ROLE: Record<string, string> = { shop_staff: '店員', shop_owner: '店主' };

export function ShopSwitcher({ shops }: { shops: { id: string; name: string; tenant: string; roles: string[] }[] }) {
  const router = useRouter();
  const { error, run } = useAction();
  return (
    <>
      <ErrorNotice error={error} />
      <div className={ui.choices}>
        {shops.map((s) => (
          <button
            key={s.id}
            type="button"
            className={ui.choice}
            onClick={async () => {
              const r = await run(() => api('/context/shop', { body: { shopId: s.id } }));
              if (r) {
                router.push('/m');
                router.refresh();
              }
            }}
          >
            <span>
              <strong>{s.name}</strong>
              <br />
              <span className={ui.meta}>
                {s.tenant}・{s.roles.map((r) => ROLE[r] ?? r).join('・')}
              </span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

export function AccountActions() {
  const router = useRouter();
  const [confirmAll, setConfirmAll] = useState(false);
  const { busy, error, run } = useAction();
  const logout = async (scope: 'local' | 'global') => {
    const r = await run(() => api<{ next: string }>('/auth/logout', { body: { scope } }));
    if (r) {
      router.replace('/login');
      router.refresh();
    }
  };
  return (
    <div className={ui.stack} style={{ marginTop: 24 }}>
      <ErrorNotice error={error} />
      <Button variant="secondary" busy={busy} onClick={() => logout('local')}>
        この端末でログアウトする
      </Button>
      {!confirmAll ? (
        <button type="button" className={ui.linkBtn} onClick={() => setConfirmAll(true)}>
          端末をなくしたとき：すべての端末からログアウト
        </button>
      ) : (
        <div className={ui.stack8}>
          <p>スマホ・パソコンなど、すべての端末でログインが切れます。</p>
          <Button variant="danger" busy={busy} onClick={() => logout('global')}>
            すべての端末からログアウトする
          </Button>
        </div>
      )}
    </div>
  );
}
