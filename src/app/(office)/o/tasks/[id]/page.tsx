import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionButton, NoteAction } from '@/components/office/Actions';
import { ExtendDue, ProxyResponse } from '@/components/office/TaskTools';
import { TaskEditor } from '@/components/office/TaskEditor';
import { OfficeShell } from '@/components/office/Shell';
import o from '@/components/office/office.module.css';
import { dt, Notice, StateBadge, ui } from '@/components/ui';
import { TASK_STATE_LABEL, TASK_TYPE_LABEL, type Question, type TaskType } from '@/domain/tasks/templates';
import { load, requireOffice } from '@/server/auth/page';

export const metadata: Metadata = { title: '依頼の詳細' };

interface Detail {
  id: string;
  type: TaskType;
  title: string;
  body: string;
  status: string;
  dueAt: string | null;
  version: number;
  definition: { questions: Question[] };
  supersedesId: string | null;
  supersededBy: string | null;
  targets: string[];
  recipients: {
    shopId: string;
    shopName: string;
    state: string;
    lastRemindedAt: string | null;
    acknowledgedAt: string | null;
    revisions: number;
    current: null | { revision: number; payload: Record<string, unknown>; status: string; submittedAt: string; submittedBy: string | null; proxyReason: string | null; proxyChannel: string | null; reviewNote: string | null };
  }[];
}

function show(q: Question, v: unknown) {
  if (v === undefined || v === null || v === '') return '—';
  if (Array.isArray(v)) return q.kind === 'photos' ? v.map((id, i) => <a key={String(id)} href={`/api/v1/attachments/${id}/download`} target="_blank" rel="noreferrer">写真{i + 1} </a>) : v.join('、');
  return String(v);
}

export default async function OfficeTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, me, office, can } = await requireOffice();
  const t = await load<Detail>(db, 'api_task_office_get', { p_task: id });
  const isOp = can(['office_operator']);
  if (t.status === 'draft') {
    const { data: shops } = await db.from('shops').select('id, display_name').eq('tenant_id', office.tenantId).eq('status', 'active').order('display_name');
    return (
      <OfficeShell me={me} office={office} tab="tasks">
        <Link href="/o/tasks">← 依頼の一覧</Link>
        <div className={o.toolbar} style={{ marginTop: 8 }}>
          <h1 className={o.h1} style={{ margin: 0 }}>下書き：{t.title}</h1>
          {isOp && <ActionButton path={`/office/tasks/${id}/publish`} body={{ expectedVersion: t.version }} label={`${t.targets.length}店に公開する`} />}
        </div>
        {t.supersedesId && <Notice tone="info" title="改版の下書きです">公開すると前の版は「改版済み」になります。前の版への回答は残ります。</Notice>}
        {isOp && <TaskEditor tenantId={office.tenantId} shops={(shops ?? []).map((s) => ({ id: s.id, name: s.display_name }))} draft={{ id: t.id, version: t.version, type: t.type, title: t.title, body: t.body, dueAt: t.dueAt, definition: t.definition, targets: t.targets }} />}
      </OfficeShell>
    );
  }
  const unanswered = t.recipients.filter((r) => r.state === 'unanswered' || r.state === 'returned').length;
  return (
    <OfficeShell me={me} office={office} tab="tasks">
      <Link href="/o/tasks">← 依頼の一覧</Link>
      <div className={o.toolbar} style={{ marginTop: 8 }}>
        <h1 className={o.h1} style={{ margin: 0 }}>{t.title}</h1>
        <span className={ui.meta}>{TASK_TYPE_LABEL[t.type]}・{t.status === 'published' ? '公開中' : '締切'}・期限 {dt(t.dueAt)}{t.supersededBy && '・改版済み'}</span>
      </div>
      {t.supersededBy && <Notice tone="info">この依頼は改版されています。<Link href={`/o/tasks/${t.supersededBy}`}>新しい版を開く</Link></Notice>}
      {isOp && (
        <section className={o.section}>
          <div className={ui.row}>
            {t.status === 'published' && unanswered > 0 && <ActionButton path={`/office/tasks/${id}/remind`} label={`未回答の${unanswered}店に催促する`} variant="secondary" />}
            {t.status === 'published' && !t.supersededBy && <ActionButton path={`/office/tasks/${id}/revise`} label="訂正のため改版する" variant="secondary" idempotent thenIdPrefix="/o/tasks/" />}
            {t.status === 'published' && <ActionButton path={`/office/tasks/${id}/close`} label="締め切る" variant="secondary" confirmText="締め切ると店舗は回答できなくなります。よろしいですか？" />}
            <ExtendDue taskId={id} />
          </div>
          <p className={ui.help}>催促は回答済みの店には送られません。1店舗あたり1日1回まで、09:00〜18:00に届きます。</p>
        </section>
      )}
      <div className={ui.tableWrap}>
        <table className={ui.table}>
          <thead>
            <tr>
              <th>店舗</th>
              <th>状態</th>
              {t.definition.questions.map((q) => <th key={q.id}>{q.label}</th>)}
              <th>記録</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {t.recipients.map((r) => (
              <tr key={r.shopId}>
                <td>{r.shopName}</td>
                <td><StateBadge tone={r.state === 'done' ? 'done' : r.state === 'returned' ? 'error' : r.state === 'pending_review' ? 'todo' : 'muted'}>{TASK_STATE_LABEL[r.state]}</StateBadge></td>
                {t.definition.questions.map((q) => <td key={q.id}>{show(q, r.current?.payload[q.id])}</td>)}
                <td className={ui.meta}>
                  {r.acknowledgedAt && `確認 ${dt(r.acknowledgedAt)}`}
                  {r.current && `改訂${r.current.revision}・${dt(r.current.submittedAt)}・${r.current.submittedBy ?? ''}`}
                  {r.current?.proxyReason && <><br />代理入力（{{ phone: '電話', paper: '紙', in_person: '対面', other: 'その他' }[r.current.proxyChannel ?? 'other']}）: {r.current.proxyReason}</>}
                  {r.lastRemindedAt && <><br />催促 {dt(r.lastRemindedAt)}</>}
                </td>
                <td>
                  <div className={ui.stack8}>
                    {r.state === 'pending_review' && r.current && can(['office_operator', 'office_approver']) && (
                      <>
                        <ActionButton path={`/office/tasks/${id}/review`} body={{ shopId: r.shopId, revision: r.current.revision, approve: true }} label="確認済みにする" />
                        <NoteAction path={`/office/tasks/${id}/review`} field="note" extra={{ shopId: r.shopId, revision: r.current.revision, approve: false }} label="差し戻す" noteLabel="差戻しの理由（店舗に表示）" />
                      </>
                    )}
                    {isOp && t.status === 'published' && r.state !== 'done' && <ProxyResponse taskId={id} shopId={r.shopId} shopName={r.shopName} type={t.type} questions={t.definition.questions} expectedRevision={r.current?.revision ?? 0} />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </OfficeShell>
  );
}
