'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { useAction } from '@/components/forms/useAction';
import { Button, ui } from '@/components/ui';
import { api } from '@/lib/api-client';

export default function ResetPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const { busy, error, run, fieldError } = useAction();
  return (
    <>
      <h1 className={ui.h1}>新しいパスワード</h1>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await run(() => api<{ next: string }>('/auth/password', { body: { password } }));
          if (r) router.replace(r.next);
        }}
      >
        <ErrorNotice error={error} />
        <div className={ui.field}>
          <label className={ui.label} htmlFor="pw">新しいパスワード（10文字以上）</label>
          <input id="pw" className={ui.input} type="password" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!fieldError('password')} />
          {fieldError('password') && <p className={ui.fieldError}>{fieldError('password')}</p>}
        </div>
        <Button type="submit" busy={busy} disabled={password.length < 10}>
          パスワードを変更する
        </Button>
      </form>
    </>
  );
}
