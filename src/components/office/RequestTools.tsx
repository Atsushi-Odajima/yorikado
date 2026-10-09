'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { PhotoPicker } from '@/components/forms/PhotoPicker';
import { useAction } from '@/components/forms/useAction';
import { Button, ui } from '@/components/ui';
import { REQUEST_STATUS_LABEL } from '@/domain/requests/categories';
import { api, newKey } from '@/lib/api-client';
import o from './office.module.css';

/** Reply to the shop and internal memo are separate forms, visually and by API. */
export function OfficeReply({ requestId, tenantId }: { requestId: string; tenantId: string }) {
  const router = useRouter();
  const [reply, setReply] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [memo, setMemo] = useState('');
  const k1 = useRef(newKey());
  const k2 = useRef(newKey());
  const a = useAction();
  const b = useAction();
  return (
    <div className={ui.stack}>
      <form className={o.section} onSubmit={async (e) => {
        e.preventDefault();
        const r = await a.run(() => api(`/requests/${requestId}/messages`, { body: { body: reply, attachmentIds: photos }, idempotencyKey: k1.current }));
        if (r) { setReply(''); setPhotos([]); k1.current = newKey(); router.refresh(); }
      }}>
        <h2 className={ui.h2} style={{ marginTop: 0 }}>店舗へ返信する</h2>
        <ErrorNotice error={a.error} />
        <label className="sr-only" htmlFor="reply">店舗への返信</label>
        <textarea id="reply" className={ui.textarea} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={4000} />
        <PhotoPicker shopId={null} tenantId={tenantId} purpose="request_message" value={photos} onChange={setPhotos} />
        <Button type="submit" inline busy={a.busy} disabled={!reply.trim()}>店舗へ送る</Button>
      </form>
      <form className={o.memo} onSubmit={async (e) => {
        e.preventDefault();
        const r = await b.run(() => api(`/office/requests/${requestId}/internal-notes`, { body: { body: memo }, idempotencyKey: k2.current }));
        if (r) { setMemo(''); k2.current = newKey(); router.refresh(); }
      }}>
        <h2 className={ui.h2} style={{ marginTop: 0 }}>内部メモ（店舗には表示されません）</h2>
        <ErrorNotice error={b.error} />
        <label className="sr-only" htmlFor="memo">内部メモ</label>
        <textarea id="memo" className={ui.textarea} style={{ minHeight: 96 }} value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={4000} />
        <Button type="submit" inline variant="secondary" busy={b.busy} disabled={!memo.trim()}>内部メモを残す</Button>
      </form>
    </div>
  );
}

export function RequestStatusPanel({ requestId, version, status, assignedTo, members }: { requestId: string; version: number; status: string; assignedTo: string | null; members: { id: string; name: string }[] }) {
  const router = useRouter();
  const [st, setSt] = useState(status);
  const [who, setWho] = useState(assignedTo ?? '');
  const [note, setNote] = useState('');
  const { busy, error, run } = useAction();
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const r = await run(() => api(`/requests/${requestId}`, { method: 'PATCH', body: { expectedVersion: version, status: st, assignedTo: who || null, resolutionNote: note } }));
      if (r) { setNote(''); router.refresh(); }
    }}>
      <h2 className={ui.h2} style={{ marginTop: 0 }}>状態・担当</h2>
      <ErrorNotice error={error} />
      <div className={ui.field}>
        <label className={ui.label} htmlFor="st">状態</label>
        <select id="st" className={ui.select} value={st} onChange={(e) => setSt(e.target.value)}>
          {Object.entries(REQUEST_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="who">担当者</label>
        <select id="who" className={ui.select} value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">未割当</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>
      {st === 'resolved' && (
        <div className={ui.field}>
          <label className={ui.label} htmlFor="note">完了の理由<span className={ui.required}>必須</span></label>
          <textarea id="note" className={ui.textarea} style={{ minHeight: 96 }} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}
      <Button type="submit" busy={busy} disabled={st === 'resolved' && status !== 'resolved' && !note.trim()}>保存する</Button>
    </form>
  );
}
