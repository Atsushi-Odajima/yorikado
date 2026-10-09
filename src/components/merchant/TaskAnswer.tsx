'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { PhotoPicker } from '@/components/forms/PhotoPicker';
import { useAction } from '@/components/forms/useAction';
import { Button, dt, Notice, ui } from '@/components/ui';
import { TASK_ACTION_LABEL, type Question, type TaskType } from '@/domain/tasks/templates';
import { api, newKey } from '@/lib/api-client';

export interface TaskDetail {
  id: string;
  type: TaskType;
  title: string;
  body: string;
  dueAt: string | null;
  status: string;
  state: string;
  definition: { questions: Question[] };
  acknowledgedAt: string | null;
  current: null | { revision: number; payload: Record<string, unknown>; status: string; submittedAt: string; reviewNote: string | null; proxy: boolean };
  history: { revision: number; status: string; submittedAt: string; proxy: boolean }[];
}

function display(q: Question, v: unknown): string {
  if (v === undefined || v === null || v === '') return '（未入力）';
  if (Array.isArray(v)) return q.kind === 'photos' ? `写真${v.length}枚` : v.join('、');
  return String(v);
}

export function TaskAnswer({ task, shopId }: { task: TaskDetail; shopId: string }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...(task.current?.payload ?? {}) }));
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [conflict, setConflict] = useState<null | { revision: number; payload: Record<string, unknown> }>(null);
  const expected = useRef(task.current?.revision ?? 0);
  const key = useRef(newKey());
  const { busy, error, run, fieldError, setError } = useAction();
  const [openedAt] = useState(() => Date.now());
  const closed = task.status !== 'published' || (task.dueAt !== null && Date.parse(task.dueAt) < openedAt);

  if (task.type === 'notice') {
    if (task.acknowledgedAt) return <Notice tone="success" title="確認済みです">{dt(task.acknowledgedAt)}</Notice>;
    return (
      <>
        <ErrorNotice error={error} />
        <p className={ui.help}>内容を読んだら、下のボタンを押してください。開いただけでは確認済みになりません。</p>
        <Button
          busy={busy}
          onClick={async () => {
            const r = await run(() => api(`/tasks/${task.id}/acknowledge`, { body: { shopId } }));
            if (r) router.refresh();
          }}
        >
          確認しました
        </Button>
      </>
    );
  }

  const set = (id: string, v: unknown) => setValues((p) => ({ ...p, [id]: v }));
  const qs = task.definition.questions;
  const payload = Object.fromEntries(Object.entries(values).filter(([k, v]) => qs.some((q) => q.id === k) && v !== '' && v !== undefined && !(Array.isArray(v) && v.length === 0)));
  const missing = qs.filter((q) => q.required && (payload[q.id] === undefined));

  async function submit() {
    const r = await run(() => api(`/tasks/${task.id}/responses`, { body: { shopId, expectedRevision: expected.current, payload }, idempotencyKey: key.current }));
    if (r) {
      key.current = newKey();
      router.push('/m/tasks');
      router.refresh();
    }
  }

  if (error?.details?.reason === 'REVISION_CONFLICT' && !conflict) {
    const cur = error.details.current as { revision: number; payload: Record<string, unknown> };
    setConflict(cur);
  }

  return (
    <div>
      {task.current && (
        <Notice tone={task.current.status === 'returned' ? 'error' : task.current.status === 'approved' ? 'success' : 'info'}
          title={task.current.status === 'returned' ? '事務局から差し戻されました' : task.current.status === 'approved' ? '回答済みです' : '事務局の確認待ちです'}>
          {task.current.reviewNote && <p>事務局より: {task.current.reviewNote}</p>}
          <p>最新の回答: {dt(task.current.submittedAt)}{task.current.proxy ? '（事務局が代理入力）' : ''}・改訂{task.current.revision}</p>
        </Notice>
      )}
      {closed && <Notice tone="warning" title="期限を過ぎているか、締め切られています">回答を変える場合は事務局に延長・再開を依頼してください。</Notice>}
      {conflict && (
        <Notice tone="warning" title="他の方が先に回答しました">
          <ul>
            {qs.map((q) => (
              <li key={q.id}>{q.label}: {display(q, conflict.payload[q.id])}</li>
            ))}
          </ul>
          <p>この内容を上書きする場合は、もう一度「{TASK_ACTION_LABEL[task.type]}」を押してください。</p>
          <Button variant="secondary" onClick={() => { expected.current = conflict.revision; key.current = newKey(); setConflict(null); setError(null); }}>
            最新の回答を確認したので上書きする
          </Button>
        </Notice>
      )}
      <ErrorNotice error={error?.details?.reason === 'REVISION_CONFLICT' ? null : error} />
      {!closed && step === 'edit' && (
        <form onSubmit={(e) => { e.preventDefault(); setStep('review'); }}>
          {qs.map((q) => (
            <QuestionField key={q.id} q={q} value={values[q.id]} onChange={(v) => set(q.id, v)} error={fieldError(q.id)} shopId={shopId} />
          ))}
          <Button type="submit" disabled={missing.length > 0}>内容を確認する</Button>
          {missing.length > 0 && <p className={ui.help}>必須: {missing.map((q) => q.label).join('、')}</p>}
        </form>
      )}
      {!closed && step === 'review' && (
        <div className={ui.stack}>
          <h2 className={ui.h2}>この内容で送ります</h2>
          <dl className={ui.dl}>
            {qs.map((q) => (
              <div key={q.id} style={{ display: 'contents' }}>
                <dt>{q.label}</dt>
                <dd>{display(q, payload[q.id])}</dd>
              </div>
            ))}
          </dl>
          <Button busy={busy} onClick={submit} disabled={!!conflict}>{TASK_ACTION_LABEL[task.type]}</Button>
          <Button variant="secondary" onClick={() => setStep('edit')}>直す</Button>
        </div>
      )}
      {task.history.length > 1 && (
        <details style={{ marginTop: 24 }}>
          <summary>改訂履歴（{task.history.length}件）</summary>
          <ul>
            {task.history.map((h) => (
              <li key={h.revision}>改訂{h.revision}・{dt(h.submittedAt)}{h.proxy ? '・代理入力' : ''}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function QuestionField({ q, value, onChange, error, shopId }: { q: Question; value: unknown; onChange: (v: unknown) => void; error?: string; shopId: string }) {
  const id = `q-${q.id}`;
  const req = q.required ? <span className={ui.required}>必須</span> : null;
  if (q.kind === 'choice') {
    return (
      <fieldset className={ui.field} style={{ border: 0, padding: 0 }}>
        <legend className={ui.label}>{q.label}{req}</legend>
        <div className={ui.choices} role="radiogroup">
          {(q.options ?? []).map((o) => (
            <button key={o} type="button" role="radio" aria-checked={value === o} className={ui.choice} onClick={() => onChange(o)}>
              {o}
            </button>
          ))}
        </div>
        {error && <p className={ui.fieldError}>{error}</p>}
      </fieldset>
    );
  }
  if (q.kind === 'photos') {
    return <PhotoPicker shopId={shopId} purpose="task_response" value={(value as string[]) ?? []} onChange={onChange} label={q.label} />;
  }
  if (q.kind === 'dates') {
    const list = (value as string[]) ?? [];
    return (
      <div className={ui.field}>
        <span className={ui.label}>{q.label}{req}</span>
        {list.map((v, i) => (
          <div key={i} className={ui.row}>
            <input className={ui.input} style={{ flex: 1 }} type="date" value={v} aria-label={`${q.label} ${i + 1}`} onChange={(e) => onChange(list.map((x, j) => (j === i ? e.target.value : x)))} />
            <button type="button" className={ui.linkBtn} onClick={() => onChange(list.filter((_, j) => j !== i))}>外す</button>
          </div>
        ))}
        <button type="button" className={ui.secondary} onClick={() => onChange([...list, ''])}>日付を追加する</button>
        {error && <p className={ui.fieldError}>{error}</p>}
      </div>
    );
  }
  return (
    <div className={ui.field}>
      <label className={ui.label} htmlFor={id}>{q.label}{req}</label>
      {q.kind === 'number' ? (
        <input id={id} className={ui.input} inputMode="numeric" value={value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value.replace(/\D/g, '')))} />
      ) : (
        <textarea id={id} className={ui.textarea} value={(value as string) ?? ''} maxLength={1000} onChange={(e) => onChange(e.target.value)} />
      )}
      {error && <p className={ui.fieldError}>{error}</p>}
    </div>
  );
}
