'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { useAction } from '@/components/forms/useAction';
import { Button, ui } from '@/components/ui';
import { api, newKey } from '@/lib/api-client';

export function BankChangeForm({ shopId }: { shopId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ bankName: '', branchName: '', accountType: 'ordinary', accountNumber: '', holderName: '' });
  const key = useRef(newKey());
  const { busy, error, run, fieldError } = useAction();
  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        口座の変更を申請する
      </Button>
    );
  }
  const field = (k: keyof typeof f, label: string, props: Record<string, unknown> = {}) => (
    <div className={ui.field}>
      <label className={ui.label} htmlFor={k}>{label}</label>
      <input id={k} className={ui.input} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} aria-invalid={!!fieldError(k)} {...props} />
      {fieldError(k) && <p className={ui.fieldError}>{fieldError(k)}</p>}
    </div>
  );
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(() => api('/bank-change-requests', { body: { shopId, ...f }, idempotencyKey: key.current }));
        if (r) router.refresh();
      }}
    >
      <ErrorNotice error={error} />
      <p className={ui.help}>申請の前に認証コードの入力を求めます。事務局の承認者が確認するまで、精算には使われません。</p>
      {field('bankName', '金融機関名')}
      {field('branchName', '支店名')}
      <div className={ui.field}>
        <label className={ui.label} htmlFor="accountType">種別</label>
        <select id="accountType" className={ui.select} value={f.accountType} onChange={(e) => setF({ ...f, accountType: e.target.value })}>
          <option value="ordinary">普通</option>
          <option value="current">当座</option>
        </select>
      </div>
      {field('accountNumber', '口座番号（7桁）', { inputMode: 'numeric', autoComplete: 'off' })}
      {field('holderName', '口座名義（カナ）', { autoComplete: 'off' })}
      <Button type="submit" busy={busy}>
        変更を申請する
      </Button>
    </form>
  );
}
