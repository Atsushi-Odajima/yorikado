'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { useAction } from '@/components/forms/useAction';
import { Button, Notice, ui } from '@/components/ui';
import { api } from '@/lib/api-client';

export default function RecoverPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <>
      <h1 className={ui.h1}>パスワードの再設定</h1>
      {sent ? (
        <Notice tone="success" title="受け付けました">
          登録されているメールアドレスであれば、再設定用のメールが届きます。届かない場合は事務局へご連絡ください（何度も送らないでください）。
        </Notice>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(() => api('/auth/recover', { body: { email } }));
            if (r) setSent(true);
          }}
        >
          <ErrorNotice error={error} />
          <div className={ui.field}>
            <label className={ui.label} htmlFor="email">登録したメールアドレス</label>
            <input id="email" className={ui.input} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <Button type="submit" busy={busy} disabled={!email}>
            再設定のメールを送る
          </Button>
        </form>
      )}
      <p style={{ marginTop: 24 }}>
        <Link href="/login">ログインへ戻る</Link>
      </p>
    </>
  );
}
