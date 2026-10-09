'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { useAction } from '@/components/forms/useAction';
import { Button, ui, yen } from '@/components/ui';
import { api } from '@/lib/api-client';

export function PaperReview({ id, claimed, version }: { id: string; claimed: number; version: number }) {
  const router = useRouter();
  const [amount, setAmount] = useState(String(claimed));
  const [reason, setReason] = useState('');
  const [present, setPresent] = useState<boolean | null>(null);
  const [storage, setStorage] = useState('');
  const [ret, setRet] = useState('');
  const { busy, error, run } = useAction();
  const differs = Number(amount) !== claimed;
  const send = async (action: 'verify' | 'return' | 'reject') => {
    const r = await run(() => api(`/paper-reports/${id}/review`, { body: { action, verifiedAmount: action === 'verify' ? Number(amount) : null, reason, originalPresent: present, originalStorage: storage, originalReturnStatus: ret, expectedVersion: version } }));
    if (r) router.refresh();
  };
  return (
    <div>
      <h2 className={ui.h2} style={{ marginTop: 0 }}>原本を確認する</h2>
      <ErrorNotice error={error} />
      <div className={ui.field}>
        <label className={ui.label} htmlFor="amt">原本で確認した金額（円）</label>
        <input id="amt" className={ui.input} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} />
        {differs && <p className={ui.fieldError}>申告額 {yen(claimed)} と違います。理由が必要です。</p>}
      </div>
      <fieldset className={ui.field} style={{ border: 0, padding: 0 }}>
        <legend className={ui.label}>原本</legend>
        <div className={ui.row}>
          <button type="button" className={ui.choice} aria-pressed={present === true} onClick={() => setPresent(true)}>あり</button>
          <button type="button" className={ui.choice} aria-pressed={present === false} onClick={() => setPresent(false)}>なし</button>
        </div>
      </fieldset>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="st">保管場所</label>
        <input id="st" className={ui.input} value={storage} onChange={(e) => setStorage(e.target.value)} />
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="ret">返却状態</label>
        <input id="ret" className={ui.input} value={ret} onChange={(e) => setRet(e.target.value)} />
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="rs">理由・差戻し内容</label>
        <textarea id="rs" className={ui.textarea} style={{ minHeight: 96 }} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className={ui.stack8}>
        <Button busy={busy} disabled={!amount || present === null || (differs && !reason.trim())} onClick={() => send('verify')}>
          {yen(Number(amount))}で確認済みにする
        </Button>
        <Button variant="secondary" busy={busy} disabled={!reason.trim()} onClick={() => send('return')}>店舗へ差し戻す</Button>
        <Button variant="danger" busy={busy} disabled={!reason.trim()} onClick={() => send('reject')}>受理しない</Button>
      </div>
    </div>
  );
}
