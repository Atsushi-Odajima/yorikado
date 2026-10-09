'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { useAction } from '@/components/forms/useAction';
import { Button, ui } from '@/components/ui';
import { api, newKey } from '@/lib/api-client';

/** Full reversal request (shop owner). Approval is done by a different office person. */
export function ReversalRequest({ redemptionId }: { redemptionId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const key = useRef(newKey());
  const { busy, error, run } = useAction();
  if (!open) {
    return (
      <button type="button" className={ui.linkBtn} style={{ marginTop: 24 }} onClick={() => setOpen(true)}>
        この受付の取消を申請する
      </button>
    );
  }
  return (
    <form
      style={{ marginTop: 24 }}
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(() => api(`/redemptions/${redemptionId}/reversal-requests`, { body: { reason }, idempotencyKey: key.current }));
        if (r) router.refresh();
      }}
    >
      <h2 className={ui.h2}>取消の申請（全額）</h2>
      <p className={ui.help}>事務局の別の担当者が確認します。取り消した券はもう一度使えません。</p>
      <ErrorNotice error={error} />
      <div className={ui.field}>
        <label className={ui.label} htmlFor="reason">理由<span className={ui.required}>必須</span></label>
        <textarea id="reason" className={ui.textarea} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </div>
      <Button type="submit" variant="danger" busy={busy} disabled={!reason.trim()}>
        取消を申請する
      </Button>
    </form>
  );
}
