import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionButton, NoteAction } from '@/components/office/Actions';
import { OfficeShell } from '@/components/office/Shell';
import o from '@/components/office/office.module.css';
import { dt, Notice, ui, yen } from '@/components/ui';
import { load, requireOffice } from '@/server/auth/page';

export const metadata: Metadata = { title: '取消申請' };

export default async function ReversalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, me, office, can } = await requireOffice();
  const { data: v } = await db.from('reversals').select('*').eq('id', id).eq('tenant_id', office.tenantId).maybeSingle();
  if (!v) notFound();
  const op = await load<{ receipt: { receiptNumber: string; amount: number; occurredAt: string; shopName: string; campaignName: string; items: { displayNumber: string; faceValue: number }[] } }>(db, 'api_redemption_get', { p_redemption: v.redemption_id });
  const r = op.receipt;
  return (
    <OfficeShell me={me} office={office} tab="queue">
      <Link href="/o">← 対応待ち</Link>
      <h1 className={o.h1} style={{ marginTop: 8 }}>取消申請（全額）</h1>
      <section className={o.section}>
        <dl className={ui.dl}>
          <dt>受付番号</dt><dd>{r.receiptNumber}</dd>
          <dt>店舗</dt><dd>{r.shopName}</dd>
          <dt>事業</dt><dd>{r.campaignName}</dd>
          <dt>金額</dt><dd className="tabular">{yen(r.amount)}</dd>
          <dt>受付日時</dt><dd>{dt(r.occurredAt)}</dd>
          <dt>券</dt><dd>{r.items.map((i) => `${i.displayNumber}(${yen(i.faceValue)})`).join('、')}</dd>
          <dt>理由</dt><dd>{v.reason}</dd>
          <dt>申請</dt><dd>{dt(v.created_at)}</dd>
        </dl>
      </section>
      <Notice tone="info">承認すると券は「使用不可（retired）」のまま再利用できず、元の受付記録は残ります。精算の承認後・出力後の取消は、次の精算で要確認の調整として扱い、自動で口座から引き落としません。</Notice>
      {v.status === 'requested' && can(['office_approver']) && v.requested_by !== me.userId ? (
        <div className={ui.row}>
          <ActionButton path={`/reversals/${id}/approve`} body={{ approve: true, note: '' }} label="取消を承認する" variant="danger" then="/o" />
          <NoteAction path={`/reversals/${id}/approve`} field="note" extra={{ approve: false }} label="承認しない" noteLabel="理由" />
        </div>
      ) : (
        <p>{v.status === 'requested' ? (v.requested_by === me.userId ? '申請者本人は承認できません。別の承認者が判断します。' : '承認者の権限が必要です。') : `判断済み: ${v.status === 'approved' ? '承認' : '不承認'}（${dt(v.decided_at)}）`}</p>
      )}
    </OfficeShell>
  );
}
