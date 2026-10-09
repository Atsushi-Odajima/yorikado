'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { useAction } from '@/components/forms/useAction';
import { Button, Notice, ui } from '@/components/ui';
import { api } from '@/lib/api-client';

const ROLE: Record<string, string> = {
  shop_staff: '店員',
  shop_owner: '店主',
  office_operator: '事務局（担当）',
  office_approver: '事務局（承認）',
  tenant_admin: '管理者',
  auditor: '監査',
};

interface Info {
  state: string;
  tenantName: string;
  shopName: string | null;
  role: string;
  email: string;
  userExists: boolean;
}

export function InviteForm() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [agree, setAgree] = useState(false);
  const lookup = useAction();
  const accept = useAction();

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token');
    // keep the one-time token out of history/referrers once read
    window.history.replaceState(null, '', '/invite');
    if (!t) return;
    // Read the one-time token from the URL once on mount (not available during SSR).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(t);
    void lookup.run(() => api<Info>('/invitations/lookup', { body: { token: t } })).then((r) => r && setInfo(r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!token) {
    return (
      <Notice tone="warning" title="招待リンクを開いてください">
        事務局から届いたメールのリンクを、そのまま開いてください。
      </Notice>
    );
  }
  if (lookup.error) return <ErrorNotice error={lookup.error} />;
  if (!info) return <p aria-busy="true">確認中です</p>;
  if (info.state !== 'pending') {
    return (
      <Notice tone="warning" title={info.state === 'expired' ? '招待の有効期限（72時間）が切れています' : 'この招待は使用済みです'}>
        事務局へ招待の再発行を依頼してください。同じリンクを使って権限を付け直すことはできません。
      </Notice>
    );
  }
  return (
    <>
      <h1 className={ui.h1}>招待を受け取る</h1>
      <dl className={ui.dl} style={{ marginBottom: 24 }}>
        <dt>商店街</dt>
        <dd>{info.tenantName}</dd>
        {info.shopName && (
          <>
            <dt>店名</dt>
            <dd>{info.shopName}</dd>
          </>
        )}
        <dt>役割</dt>
        <dd>{ROLE[info.role] ?? info.role}</dd>
        <dt>メール</dt>
        <dd>{info.email}</dd>
      </dl>
      {info.userExists && (
        <Notice tone="info" title="既にアカウントがあります">
          <Link href="/login">招待されたメールアドレスでログイン</Link>してから、もう一度メールのリンクを開いてください。
        </Notice>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await accept.run(() =>
            api<{ next: string }>('/invitations/accept', { body: { token, displayName, password: info.userExists ? undefined : password, acceptTerms: agree } }),
          );
          if (r) {
            router.replace(r.next);
            router.refresh();
          }
        }}
      >
        <ErrorNotice error={accept.error} />
        <div className={ui.field}>
          <label className={ui.label} htmlFor="name">表示名（事務局に表示されます）</label>
          <input id="name" className={ui.input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} autoComplete="name" />
        </div>
        {!info.userExists && (
          <div className={ui.field}>
            <label className={ui.label} htmlFor="pw">パスワード（10文字以上）</label>
            <input id="pw" className={ui.input} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            {accept.fieldError('password') && <p className={ui.fieldError}>{accept.fieldError('password')}</p>}
          </div>
        )}
        <div className={ui.field}>
          <label className={ui.choice} data-checked={agree}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ width: 24, height: 24 }} />
            <span>
              <Link href="/terms" target="_blank">利用条件</Link>を確認し、同意します
            </span>
          </label>
        </div>
        <Button type="submit" busy={accept.busy} disabled={!displayName || !agree || (!info.userExists && password.length < 10)}>
          登録して始める
        </Button>
      </form>
    </>
  );
}
