'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { useAction } from '@/components/forms/useAction';
import { Button, ui } from '@/components/ui';
import { api } from '@/lib/api-client';

export function WelcomeForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [agree, setAgree] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(() => api<{ next: string }>('/profile', { method: 'PUT', body: { displayName: name, acceptTerms: agree } }));
        if (r) router.replace(r.next);
      }}
    >
      <h1 className={ui.h1}>はじめに</h1>
      <ErrorNotice error={error} />
      <div className={ui.field}>
        <label className={ui.label} htmlFor="name">表示名</label>
        <input id="name" className={ui.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      </div>
      <div className={ui.field}>
        <label className={ui.choice} aria-checked={agree}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ width: 24, height: 24 }} />
          <span>
            <Link href="/terms" target="_blank">利用条件</Link>を確認し、同意します
          </span>
        </label>
      </div>
      <Button type="submit" busy={busy} disabled={!name.trim() || !agree}>
        始める
      </Button>
    </form>
  );
}
