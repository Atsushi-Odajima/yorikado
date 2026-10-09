'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { PhotoPicker } from '@/components/forms/PhotoPicker';
import { useAction } from '@/components/forms/useAction';
import { Button, ui } from '@/components/ui';
import { CATEGORY_LABEL, type RequestCategory } from '@/domain/requests/categories';
import { api, newKey } from '@/lib/api-client';

export function RequestForm({ shopId, officeHours, initialCategory, receipt, related }: { shopId: string; officeHours: string; initialCategory?: string; receipt?: string; related?: string }) {
  const router = useRouter();
  const [category, setCategory] = useState<RequestCategory | null>(initialCategory && initialCategory in CATEGORY_LABEL ? (initialCategory as RequestCategory) : null);
  const [body, setBody] = useState(receipt ? `受付番号 ${receipt} について:\n` : '');
  const [photos, setPhotos] = useState<string[]>([]);
  const key = useRef(newKey()); // same request re-sent = one consultation
  const { busy, error, run, fieldError } = useAction();
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(() =>
          api<{ id: string }>('/requests', {
            body: { shopId, category, body, attachmentIds: photos, relatedReceiptNumber: receipt ?? '', relatedRequestId: related ?? null },
            idempotencyKey: key.current,
          }),
        );
        if (r) router.replace(`/m/requests/${r.id}?sent=1`);
      }}
    >
      <ErrorNotice error={error} />
      <fieldset className={ui.field} style={{ border: 0, padding: 0 }}>
        <legend className={ui.label}>種類<span className={ui.required}>必須</span></legend>
        <div className={ui.choices} role="radiogroup">
          {(Object.keys(CATEGORY_LABEL) as RequestCategory[]).map((c) => (
            <button key={c} type="button" role="radio" aria-checked={category === c} className={ui.choice} onClick={() => setCategory(c)}>
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      </fieldset>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="body">内容<span className={ui.required}>必須</span></label>
        <textarea id="body" className={ui.textarea} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} aria-invalid={!!fieldError('body')} />
        <p className={ui.help}>キーボードのマイクで音声入力もできます。</p>
        {fieldError('body') && <p className={ui.fieldError}>{fieldError('body')}</p>}
      </div>
      <PhotoPicker shopId={shopId} purpose="request_message" value={photos} onChange={setPhotos} />
      <Button type="submit" busy={busy} disabled={!category || !body.trim()}>
        事務局へ送る
      </Button>
      <p className={ui.help} style={{ marginTop: 16 }}>
        受付時間: {officeHours || '事務局の営業時間内'}。この相談は他の店舗には公開されません。急ぎの事故・急病などは、この画面ではなく電話や119番等をご利用ください。
      </p>
    </form>
  );
}
