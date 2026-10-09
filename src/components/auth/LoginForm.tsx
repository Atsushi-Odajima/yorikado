'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { useAction } from '@/components/forms/useAction';
import { Button, ui } from '@/components/ui';
import { api } from '@/lib/api-client';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();
  return (
    <form
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(() => api<{ next: string }>('/auth/login', { body: { email, password } }));
        if (r) {
          router.replace(r.next);
          router.refresh();
        }
      }}
    >
      <ErrorNotice error={error} saved />
      <div className={ui.field}>
        <label className={ui.label} htmlFor="email">メールアドレス</label>
        <input id="email" className={ui.input} type="email" autoComplete="username" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="password">パスワード</label>
        <input id="password" className={ui.input} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <Button type="submit" busy={busy} busyLabel="確認中です" disabled={!email || !password}>
        ログインする
      </Button>
      <p style={{ marginTop: 24 }}>
        <Link href="/login/recover">パスワードを忘れたとき</Link>
      </p>
      <p className={ui.help} style={{ marginTop: 16 }}>
        初めての方は、事務局から届いた招待メールのリンクから登録してください。
      </p>
    </form>
  );
}
