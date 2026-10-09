'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { PhotoPicker } from '@/components/forms/PhotoPicker';
import { useAction } from '@/components/forms/useAction';
import { Button, ui } from '@/components/ui';
import { api, newKey } from '@/lib/api-client';

export function RequestReply({ requestId, shopId, resolved }: { requestId: string; shopId: string; resolved: boolean }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const key = useRef(newKey());
  const { busy, error, run } = useAction();
  return (
    <form
      style={{ marginTop: 24 }}
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(() => api(`/requests/${requestId}/messages`, { body: { body, attachmentIds: photos }, idempotencyKey: key.current }));
        if (r) {
          setBody('');
          setPhotos([]);
          key.current = newKey();
          router.refresh();
        }
      }}
    >
      <h2 className={ui.h2}>{resolved ? '返信して相談を再開する' : '返信する'}</h2>
      <ErrorNotice error={error} />
      <div className={ui.field}>
        <label className={ui.label} htmlFor="reply">内容</label>
        <textarea id="reply" className={ui.textarea} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} />
      </div>
      <PhotoPicker shopId={shopId} purpose="request_message" value={photos} onChange={setPhotos} />
      <Button type="submit" busy={busy} disabled={!body.trim()}>
        {resolved ? '返信して再開する' : '返信を送る'}
      </Button>
    </form>
  );
}
