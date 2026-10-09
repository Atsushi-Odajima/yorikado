'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { useAction } from '@/components/forms/useAction';
import { Button, Notice, ui } from '@/components/ui';
import { TASK_TYPE_LABEL, TEMPLATES, type Question, type TaskType } from '@/domain/tasks/templates';
import { api, newKey } from '@/lib/api-client';

export interface TaskDraft {
  id: string;
  version: number;
  type: TaskType;
  title: string;
  body: string;
  dueAt: string | null;
  definition: { questions: Question[] };
  targets: string[];
}

const toLocal = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 16) : '');

export function TaskEditor({ tenantId, shops, draft }: { tenantId: string; shops: { id: string; name: string }[]; draft?: TaskDraft }) {
  const router = useRouter();
  const [type, setType] = useState<TaskType>(draft?.type ?? 'event');
  const [title, setTitle] = useState(draft?.title ?? '');
  const [body, setBody] = useState(draft?.body ?? '');
  const [due, setDue] = useState(toLocal(draft?.dueAt ?? null));
  const [questions, setQuestions] = useState<Question[]>(draft?.definition.questions ?? TEMPLATES.event.questions);
  const [targets, setTargets] = useState<string[]>(draft?.targets ?? shops.map((s) => s.id));
  const [preview, setPreview] = useState(false);
  const key = useRef(newKey());
  const { busy, error, run } = useAction();

  const pickType = (t: TaskType) => {
    setType(t);
    setQuestions(TEMPLATES[t].questions.map((q) => ({ ...q })));
  };
  const setQ = (i: number, patch: Partial<Question>) => setQuestions(questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  async function save() {
    const r = await run(() =>
      api<{ id: string }>('/office/tasks', {
        body: {
          tenantId,
          id: draft?.id ?? null,
          type,
          title,
          body,
          definition: { questions: type === 'notice' ? [] : questions },
          dueAt: due ? new Date(`${due}:00+09:00`).toISOString() : null,
          shopIds: targets,
          expectedVersion: draft?.version ?? null,
        },
        idempotencyKey: draft ? undefined : key.current,
      }),
    );
    if (r) {
      router.push(`/o/tasks/${r.id}`);
      router.refresh();
    }
  }

  if (preview) {
    return (
      <div style={{ maxWidth: 720 }} className={ui.stack}>
        <Notice tone="info" title="店舗にはこのように表示されます">公開後は内容を直接変更できません（訂正は改版）。</Notice>
        <div className={ui.sheet}>
          <p className={ui.meta}>{TASK_TYPE_LABEL[type]}・期限 {due ? due.replace('T', ' ') : 'なし'}</p>
          <h2 className={ui.h1}>{title}</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{body}</p>
          <ol>{(type === 'notice' ? [] : questions).map((q) => <li key={q.id}>{q.label}{q.required ? '（必須）' : ''}{q.options ? `：${q.options.join(' / ')}` : ''}</li>)}</ol>
          {type === 'notice' && <p>［確認しました］ボタン</p>}
        </div>
        <p>対象: {shops.filter((s) => targets.includes(s.id)).map((s) => s.name).join('、')}（{targets.length}店）</p>
        <ErrorNotice error={error} />
        <div className={ui.row}>
          <Button inline busy={busy} onClick={save}>下書きを保存する</Button>
          <Button inline variant="secondary" onClick={() => setPreview(false)}>直す</Button>
        </div>
      </div>
    );
  }

  return (
    <form style={{ maxWidth: 720 }} onSubmit={(e) => { e.preventDefault(); setPreview(true); }}>
      <fieldset className={ui.field} style={{ border: 0, padding: 0 }}>
        <legend className={ui.label}>テンプレート</legend>
        <div className={ui.row}>
          {(Object.keys(TASK_TYPE_LABEL) as TaskType[]).map((t) => (
            <button key={t} type="button" className={ui.choice} aria-pressed={type === t} onClick={() => pickType(t)} disabled={!!draft}>
              {TASK_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </fieldset>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="title">件名</label>
        <input id="title" className={ui.input} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="body">本文</label>
        <textarea id="body" className={ui.textarea} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} />
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="due">期限（JST）</label>
        <input id="due" type="datetime-local" className={ui.input} value={due} onChange={(e) => setDue(e.target.value)} />
      </div>
      {type !== 'notice' && (
        <fieldset className={ui.field} style={{ border: 0, padding: 0 }}>
          <legend className={ui.label}>質問（最大5項目）</legend>
          {questions.map((q, i) => (
            <div key={i} className={ui.sheet} style={{ marginBottom: 8 }}>
              <div className={ui.row}>
                <label className="sr-only" htmlFor={`ql${i}`}>質問{i + 1}</label>
                <input id={`ql${i}`} className={ui.input} style={{ flex: 1 }} value={q.label} onChange={(e) => setQ(i, { label: e.target.value })} />
                <span className={ui.meta}>{{ choice: '選択', text: '文章', number: '数', dates: '日付', photos: '写真' }[q.kind]}</span>
                <label><input type="checkbox" checked={!!q.required} onChange={(e) => setQ(i, { required: e.target.checked })} /> 必須</label>
                <button type="button" className={ui.linkBtn} onClick={() => setQuestions(questions.filter((_, j) => j !== i))}>削除</button>
              </div>
              {q.kind === 'choice' && (
                <div style={{ marginTop: 8 }}>
                  <label className={ui.help} htmlFor={`qo${i}`}>選択肢（/区切り・2〜6個）</label>
                  <input id={`qo${i}`} className={ui.input} value={(q.options ?? []).join(' / ')} onChange={(e) => setQ(i, { options: e.target.value.split('/').map((x) => x.trim()).filter(Boolean) })} />
                </div>
              )}
            </div>
          ))}
          {questions.length < 5 && (
            <div className={ui.row}>
              {(['choice', 'text', 'number', 'dates', 'photos'] as const).map((k) => (
                <button key={k} type="button" className={`${ui.secondary} ${ui.inline}`} onClick={() => setQuestions([...questions, { id: `q${Date.now().toString(36)}`, label: '新しい質問', kind: k, ...(k === 'choice' ? { options: ['はい', 'いいえ'] } : {}) }])}>
                  ＋{{ choice: '選択', text: '文章', number: '数', dates: '日付', photos: '写真' }[k]}
                </button>
              ))}
            </div>
          )}
        </fieldset>
      )}
      <fieldset className={ui.field} style={{ border: 0, padding: 0 }}>
        <legend className={ui.label}>対象店舗（{targets.length}店）</legend>
        <div className={ui.row}>
          {shops.map((s) => (
            <label key={s.id} className={ui.choice} data-checked={targets.includes(s.id)}>
              <input type="checkbox" checked={targets.includes(s.id)} onChange={(e) => setTargets(e.target.checked ? [...targets, s.id] : targets.filter((x) => x !== s.id))} />
              {s.name}
            </label>
          ))}
        </div>
      </fieldset>
      <Button type="submit" disabled={!title.trim() || targets.length === 0 || (type !== 'notice' && questions.length === 0)}>
        店舗の表示を確認する
      </Button>
    </form>
  );
}
