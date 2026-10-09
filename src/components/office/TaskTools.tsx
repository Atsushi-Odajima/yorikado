'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { useAction } from '@/components/forms/useAction';
import { Button, ui } from '@/components/ui';
import type { Question, TaskType } from '@/domain/tasks/templates';
import { api, newKey } from '@/lib/api-client';

export function ExtendDue({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [due, setDue] = useState('');
  const { busy, error, run } = useAction();
  if (!open) return <Button inline variant="secondary" onClick={() => setOpen(true)}>期限を延長・再開する</Button>;
  return (
    <form className={ui.row} onSubmit={async (e) => {
      e.preventDefault();
      const r = await run(() => api(`/office/tasks/${taskId}/extend`, { body: { dueAt: new Date(`${due}:00+09:00`).toISOString() } }));
      if (r) { setOpen(false); router.refresh(); }
    }}>
      <label className="sr-only" htmlFor="ext">新しい期限</label>
      <input id="ext" type="datetime-local" className={ui.input} style={{ width: 'auto' }} value={due} onChange={(e) => setDue(e.target.value)} />
      <Button type="submit" inline busy={busy} disabled={!due}>延長する</Button>
      <ErrorNotice error={error} />
    </form>
  );
}

/** Phone/paper proxy answer: operator, original shop, channel and reason are recorded. */
export function ProxyResponse({ taskId, shopId, shopName, type, questions, expectedRevision }: { taskId: string; shopId: string; shopName: string; type: TaskType; questions: Question[]; expectedRevision: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [channel, setChannel] = useState('phone');
  const key = useRef(newKey());
  const { busy, error, run } = useAction();
  if (!open) return <button type="button" className={ui.linkBtn} onClick={() => setOpen(true)}>代理入力</button>;
  const simple = questions.filter((q) => q.kind !== 'photos');
  return (
    <form className={ui.stack8} style={{ minWidth: 240 }} onSubmit={async (e) => {
      e.preventDefault();
      const payload: Record<string, unknown> = {};
      for (const q of simple) {
        const v = values[q.id];
        if (!v) continue;
        payload[q.id] = q.kind === 'number' ? Number(v) : q.kind === 'dates' ? v.split(/[,、\s]+/).filter(Boolean) : v;
      }
      const r = await run(() => api(`/office/tasks/${taskId}/proxy-response`, { body: { shopId, expectedRevision, payload, proxyReason: reason, proxyChannel: channel }, idempotencyKey: key.current }));
      if (r) { setOpen(false); router.refresh(); }
    }}>
      <strong>{shopName}の代理入力</strong>
      {type !== 'notice' && simple.map((q) => (
        <label key={q.id} className={ui.help}>
          {q.label}{q.required ? '（必須）' : ''}
          {q.kind === 'choice' ? (
            <select className={ui.select} value={values[q.id] ?? ''} onChange={(e) => setValues({ ...values, [q.id]: e.target.value })}>
              <option value="">選ぶ</option>
              {(q.options ?? []).map((o) => <option key={o}>{o}</option>)}
            </select>
          ) : (
            <input className={ui.input} placeholder={q.kind === 'dates' ? '2026-12-30, 2026-12-31' : ''} value={values[q.id] ?? ''} onChange={(e) => setValues({ ...values, [q.id]: e.target.value })} />
          )}
        </label>
      ))}
      <label className={ui.help}>受付方法
        <select className={ui.select} value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="phone">電話</option><option value="paper">紙</option><option value="in_person">対面</option><option value="other">その他</option>
        </select>
      </label>
      <label className={ui.help}>理由（必須）<input className={ui.input} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <ErrorNotice error={error} />
      <Button type="submit" inline busy={busy} disabled={!reason.trim()}>代理で記録する</Button>
    </form>
  );
}
