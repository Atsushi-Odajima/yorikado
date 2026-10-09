'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { useAction } from '@/components/forms/useAction';
import { Button, ui } from '@/components/ui';
import { BankInput } from '@/domain/settlements/bank';
import { api, newKey } from '@/lib/api-client';

type Form = { bankName: string; branchName: string; accountType: 'ordinary' | 'current'; accountNumber: string; holderName: string };

/** React Hook Form + the same Zod schema the server uses (BankInput). The server re-validates. */
export function BankChangeForm({ shopId }: { shopId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [idemKey] = useState(() => newKey());
  const { busy, error, run, fieldError } = useAction();
  const { register, handleSubmit, formState } = useForm<Form>({
    resolver: zodResolver(BankInput) as never,
    defaultValues: { bankName: '', branchName: '', accountType: 'ordinary', accountNumber: '', holderName: '' },
  });
  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        口座の変更を申請する
      </Button>
    );
  }
  const msg = (k: keyof Form) => formState.errors[k]?.message ?? fieldError(k);
  const field = (k: keyof Form, label: string, props: Record<string, unknown> = {}) => (
    <div className={ui.field}>
      <label className={ui.label} htmlFor={k}>{label}</label>
      <input id={k} className={ui.input} aria-invalid={!!msg(k)} aria-describedby={msg(k) ? `${k}-err` : undefined} {...register(k)} {...props} />
      {msg(k) && <p id={`${k}-err`} className={ui.fieldError}>{msg(k)}</p>}
    </div>
  );
  return (
    <form
      noValidate
      onSubmit={handleSubmit(async (values) => {
        const r = await run(() => api('/bank-change-requests', { body: { shopId, ...values }, idempotencyKey: idemKey }));
        if (r) router.refresh();
      })}
    >
      <ErrorNotice error={error} />
      <p className={ui.help}>申請の前に認証コードの入力を求めます。事務局の承認者が確認するまで、精算には使われません。</p>
      {field('bankName', '金融機関名')}
      {field('branchName', '支店名')}
      <div className={ui.field}>
        <label className={ui.label} htmlFor="accountType">種別</label>
        <select id="accountType" className={ui.select} {...register('accountType')}>
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
