import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionButton, NoteAction } from '@/components/office/Actions';
import { BankResultsImport, ExportWorklist } from '@/components/office/SettlementTools';
import { EXCEPTION_REASON, LINE_STATUS, SETTLEMENT_STATUS } from '@/components/office/labels';
import { OfficeShell } from '@/components/office/Shell';
import o from '@/components/office/office.module.css';
import { d, dt, Notice, StateBadge, ui, yen } from '@/components/ui';
import { bankTransferAdapter } from '@/server/adapters';
import { load, requireOffice } from '@/server/auth/page';

export const metadata: Metadata = { title: '精算の詳細' };

const BLOCKER: Record<string, string> = {
  PENDING_REVERSAL: '未処理の取消申請', RECALC_REQUIRED: '承認済み取消の未反映（再計算）', UNVERIFIED_PAPER: '原本未確認の紙券', UNCOMMITTED_IMPORT: '未確定の外部実績取込',
  BANK_CHANGE_PENDING: '承認待ちの口座変更', NO_BANK_ACCOUNT: '承認済み口座なし', BANK_CHANGED_AFTER_APPROVAL: '承認後の口座変更', TOTAL_MISMATCH: '合計不一致',
};

interface Batch {
  id: string;
  batchNumber: number;
  campaignName: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  totalAmount: number;
  preparedBy: string;
  preparedName: string | null;
  approvedName: string | null;
  approvedAt: string | null;
  hash: string | null;
  scheduledPaymentDate: string | null;
  exportCount: number;
  lastExportedAt: string | null;
  version: number;
  blockers: { code: string; shop: string }[];
  lines: { id: string; shopName: string; grossAmount: number; reversalAmount: number; netAmount: number; status: string; exceptionReason: string | null; bankLabel: string | null; bankAccountVersion: number | null; sourceCount: number; sourceSum: number; shopDeclaredAt: string | null; sources: { type: string; amount: number; occurredAt: string }[] }[];
  bankImports: { id: string; fileName: string; status: string; summary: Record<string, number>; uploadedBy: string; createdAt: string }[];
}

export default async function SettlementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, me, office, can } = await requireOffice();
  const b = await load<Batch>(db, 'api_settlement_get', { p_batch: id });
  const isOp = can(['office_operator']);
  const isApprover = can(['office_approver']);
  const lineSum = b.lines.filter((l) => l.netAmount > 0).reduce((s, l) => s + l.netAmount, 0);
  const sourcesMatch = b.lines.every((l) => l.sourceSum === l.netAmount);
  const exportable = ['approved', 'exported', 'partially_confirmed', 'exception'].includes(b.status);
  return (
    <OfficeShell me={me} office={office} tab="vouchers">
      <Link href="/o/settlements">← 精算の一覧</Link>
      <h1 className={o.h1} style={{ marginTop: 8 }}>精算 #{b.batchNumber}・{b.campaignName}</h1>
      <div className={o.split}>
        <div>
          <section className={o.section}>
            <dl className={ui.dl}>
              <dt>対象期間</dt><dd>{dt(b.periodStart)}〜{dt(b.periodEnd)}（終了は含まない・JST）</dd>
              <dt>振込予定日</dt><dd>{b.scheduledPaymentDate ? d(b.scheduledPaymentDate) : '未設定'}</dd>
              <dt>精算合計</dt><dd className="tabular">{yen(b.totalAmount)}（明細合計 {yen(lineSum)}・{sourcesMatch && lineSum === b.totalAmount ? '一致' : '不一致'}）</dd>
              <dt>内容hash</dt><dd style={{ fontWeight: 400, fontSize: 14, wordBreak: 'break-all' }}>{b.hash ?? '承認時に固定'}</dd>
            </dl>
          </section>
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead><tr><th>店舗</th><th className={ui.num}>額面合計</th><th className={ui.num}>取消</th><th className={ui.num}>精算額</th><th>口座</th><th>状態</th></tr></thead>
              <tbody>
                {b.lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.shopName}
                      <details>
                        <summary className={ui.meta}>内訳 {l.sourceCount}件（{yen(l.sourceSum)}）</summary>
                        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 14 }}>
                          {l.sources.map((s, i) => <li key={i}>{{ redemption: 'QR受付', redemption_reversal: '取消', paper: '紙券', external: '外部' }[s.type] ?? s.type} {yen(s.amount)}・{dt(s.occurredAt)}</li>)}
                        </ul>
                      </details>
                      <span className={ui.meta} style={{ fontSize: 12 }}>line_id: {l.id}</span>
                    </td>
                    <td className={ui.num}>{yen(l.grossAmount)}</td>
                    <td className={ui.num}>{l.reversalAmount ? `−${yen(l.reversalAmount)}` : '—'}</td>
                    <td className={ui.num}><strong>{yen(l.netAmount)}</strong></td>
                    <td>{l.bankLabel ?? '承認時に固定'}{l.bankAccountVersion ? <span className={ui.meta}> 版{l.bankAccountVersion}</span> : null}</td>
                    <td>
                      <StateBadge tone={l.status === 'confirmed' ? 'done' : ['exception', 'failed', 'held'].includes(l.status) ? 'error' : 'muted'}>{LINE_STATUS[l.status]}</StateBadge>
                      {l.exceptionReason && <span className={ui.meta}><br />{EXCEPTION_REASON[l.exceptionReason] ?? l.exceptionReason}</span>}
                      {l.shopDeclaredAt && <span className={ui.meta}><br />店舗から入金の申告あり</span>}
                      {['exception', 'failed', 'held'].includes(l.status) && isApprover && b.preparedBy !== me.userId && (
                        <div style={{ marginTop: 8 }}><NoteAction path={`/settlement-lines/${l.id}/resolve`} field="note" label="判断を記録して解消" noteLabel="運営判断（回収・相殺・再振込など）と証跡" /></div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {b.bankImports.length > 0 && (
            <section className={o.section} style={{ marginTop: 24 }}>
              <h2 className={ui.h2} style={{ marginTop: 0 }}>銀行結果の取込</h2>
              <ul>
                {b.bankImports.map((i) => (
                  <li key={i.id}>
                    {i.fileName}・{dt(i.createdAt)}・{i.status === 'staged' ? '未確定' : i.status === 'confirmed' ? '確定' : '取消'}・
                    成功 {i.summary.success ?? 0}・失敗 {i.summary.failed ?? 0}・金額不一致 {i.summary.amountMismatch ?? 0}・エラー {i.summary.error ?? 0}・未着 {i.summary.missingLines ?? 0}
                    {i.status === 'staged' && i.uploadedBy !== me.userId && (isOp || isApprover) && (
                      <div style={{ marginTop: 8 }}><ActionButton path={`/settlements/${id}/confirm-bank-results`} body={{ importId: i.id }} label="照合結果を確定する" /></div>
                    )}
                    {i.status === 'staged' && i.uploadedBy === me.userId && <span className={ui.meta}>（取り込んだ担当者とは別の担当者が確定します）</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <aside className={o.panel} aria-label="確認欄">
          <p><StateBadge tone={b.status === 'confirmed' ? 'done' : b.status === 'exception' ? 'error' : 'todo'}>{SETTLEMENT_STATUS[b.status]}</StateBadge></p>
          <dl className={ui.dl} style={{ margin: '12px 0' }}>
            <dt>作成</dt><dd>{b.preparedName ?? '—'}</dd>
            <dt>承認</dt><dd>{b.approvedName ? `${b.approvedName}（${dt(b.approvedAt)}）` : '未承認'}</dd>
            <dt>出力</dt><dd>{b.exportCount ? `${b.exportCount}回（最終 ${dt(b.lastExportedAt)}）` : 'なし'}</dd>
          </dl>
          {b.blockers.length > 0 && ['draft', 'review'].includes(b.status) && (
            <Notice tone="warning" title="承認・出力できない例外">
              <ul>{b.blockers.map((x, i) => <li key={i}>{BLOCKER[x.code] ?? x.code}{x.shop ? `（${x.shop}）` : ''}</li>)}</ul>
            </Notice>
          )}
          <div className={ui.stack8}>
            {b.status === 'draft' && isOp && (
              <>
                <ActionButton path={`/settlements/${id}/submit-review`} body={{ expectedVersion: b.version }} label="承認を依頼する" inline={false} />
                <ActionButton path={`/settlements/${id}/recalculate`} body={{ expectedVersion: b.version }} label="再計算する" variant="secondary" inline={false} />
                <ActionButton path={`/settlements/${id}/discard`} body={{ expectedVersion: b.version }} label="この精算案を破棄する" variant="danger" inline={false} then="/o/settlements" confirmText="精算案を破棄します（承認前なので金額の記録には影響しません）。よろしいですか？" />
              </>
            )}
            {b.status === 'review' && isApprover && b.preparedBy !== me.userId && (
              <>
                <ActionButton path={`/settlements/${id}/approve`} body={{ expectedVersion: b.version, approve: true }} label={`${yen(b.totalAmount)}を承認する`} inline={false} />
                <NoteAction path={`/settlements/${id}/approve`} field="note" extra={{ expectedVersion: b.version, approve: false }} label="差し戻す" noteLabel="差戻しの理由" />
              </>
            )}
            {b.status === 'review' && b.preparedBy === me.userId && <p className={ui.help}>作成者とは別の承認者が承認します。</p>}
            {b.status === 'review' && isOp && <ActionButton path={`/settlements/${id}/recalculate`} body={{ expectedVersion: b.version }} label="再計算する（下書きに戻る）" variant="secondary" inline={false} />}
            {exportable && (isOp || isApprover) && <ExportWorklist batchId={id} batchNumber={b.batchNumber} exportCount={b.exportCount} />}
            {['exported', 'partially_confirmed', 'exception'].includes(b.status) && (isOp || isApprover) && <BankResultsImport batchId={id} />}
          </div>
          <p className={ui.help} style={{ marginTop: 16 }}>支払作業票は銀行へそのまま取り込めるファイルではありません。出力しただけでは振込済みになりません。{bankTransferAdapter.note}。</p>
        </aside>
      </div>
    </OfficeShell>
  );
}
