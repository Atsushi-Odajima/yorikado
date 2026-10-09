import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionButton } from '@/components/office/Actions';
import { MapShop } from '@/components/office/MapShop';
import { IMPORT_STATUS } from '@/components/office/labels';
import { OfficeShell } from '@/components/office/Shell';
import o from '@/components/office/office.module.css';
import { dt, Notice, StateBadge, ui, yen } from '@/components/ui';
import { load, requireOffice } from '@/server/auth/page';

export const metadata: Metadata = { title: '外部実績の取込' };

interface Imp {
  id: string;
  campaignId: string;
  sourceName: string;
  fileName: string;
  status: string;
  summary: Record<string, number>;
  rows: { row: number; provider: string; providerTransactionId: string; shopExternalCode: string; shopName: string | null; amount: number | null; occurredAt: string | null; status: string; originalTransactionId: string; rowStatus: string; errorCode: string | null }[];
}

const ROW: Record<string, string> = { ok: '取込可', duplicate: '取込済み（同一・スキップ）', conflict: '差分あり（停止）', error: 'エラー', unknown_shop: '店舗不明', unsupported: '未対応（部分取消）' };
const ERR: Record<string, string> = {
  FORMULA_OR_CONTROL_CHAR: '式・制御文字の疑い（隔離）', INVALID_AMOUNT: '金額が不正', INVALID_DATETIME_TZ_REQUIRED: '日時が不正（タイムゾーン必須）', EXCEL_SCIENTIFIC_NOTATION: 'Excelの桁落ちの疑い',
  INVALID_STATUS: '状態が不正', ORIGINAL_REQUIRED: '取消の元取引IDが必要', ORIGINAL_NOT_ALLOWED: '確定行に元取引IDは不要', INVALID_SHOP_CODE: '店舗コードが不正', INVALID_PROVIDER: '提供元が不正',
  INVALID_TRANSACTION_ID: '取引IDが不正', UNKNOWN_SHOP: '店舗コードが見つかりません', CONFLICT_EXISTING: '同じIDで内容が違う既存取引', DUPLICATE_IN_FILE: 'ファイル内で重複',
  ORIGINAL_NOT_FOUND: '元取引が見つかりません', PARTIAL_REVERSAL_UNSUPPORTED: '部分取消は未対応', ALREADY_REVERSED: '既に取消済み', SHOP_NOT_ELIGIBLE: '対象外の店舗', OUT_OF_PERIOD: '事業期間外', COLUMN_COUNT_MISMATCH: '列数が合いません',
};

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, me, office, can } = await requireOffice();
  const imp = await load<Imp>(db, 'api_external_import_get', { p_import: id });
  const { data: shops } = await db.from('shops').select('id, display_name').eq('tenant_id', office.tenantId).order('display_name');
  const s = imp.summary;
  const blocking = (s.conflict ?? 0) + (s.error ?? 0) + (s.unknownShop ?? 0) + (s.unsupported ?? 0);
  const unknownCodes = [...new Set(imp.rows.filter((r) => r.rowStatus === 'unknown_shop').map((r) => r.shopExternalCode))];
  const open = imp.status === 'staged' || imp.status === 'validated';
  return (
    <OfficeShell me={me} office={office} tab="vouchers">
      <Link href={`/o/campaigns/${imp.campaignId}`}>← 事業へ</Link>
      <h1 className={o.h1} style={{ marginTop: 8 }}>外部実績の取込：{imp.fileName}</h1>
      <p className={ui.lead}>提供元: {imp.sourceName}・状態: {IMPORT_STATUS[imp.status]}</p>
      <section className={o.section}>
        <dl className={ui.dl}>
          <dt>行数</dt><dd>{s.rows}</dd>
          <dt>取込可</dt><dd>{s.ok}行（確定 {yen(s.confirmedAmount)} / 取消 {yen(s.reversedAmount)}）</dd>
          <dt>スキップ</dt><dd>{s.duplicate}行（同じ内容が取込済み）</dd>
          <dt>止める必要あり</dt><dd>差分 {s.conflict}・エラー {s.error}・店舗不明 {s.unknownShop}・未対応 {s.unsupported}</dd>
        </dl>
        {open && blocking > 0 && <Notice tone="warning" title="このままでは確定できません">エラー行があるときは全体が未確定のままです。提供元に正しいファイルを依頼するか、店舗コードを対応付けてください。</Notice>}
        {open && can(['office_operator']) && (
          <div className={ui.row} style={{ marginTop: 12 }}>
            {blocking === 0 && <ActionButton path={`/imports/${id}/commit`} label={`${s.ok}行を確定する`} />}
            <ActionButton path={`/imports/${id}/reject`} label="この取込を取り消す" variant="secondary" />
          </div>
        )}
      </section>
      {open && unknownCodes.length > 0 && can(['office_operator']) && (
        <section className={o.section}>
          <h2 className={ui.h2}>不明な店舗コードの対応付け</h2>
          {unknownCodes.map((code) => <MapShop key={code} importId={id} code={code} shops={(shops ?? []).map((x) => ({ id: x.id, name: x.display_name }))} />)}
        </section>
      )}
      <div className={ui.tableWrap}>
        <table className={ui.table}>
          <thead><tr><th>行</th><th>取引ID</th><th>店舗</th><th className={ui.num}>金額</th><th>日時</th><th>種別</th><th>判定</th></tr></thead>
          <tbody>
            {imp.rows.map((r) => (
              <tr key={r.row}>
                <td className={ui.num}>{r.row}</td>
                <td>{r.provider}<br />{r.providerTransactionId}{r.originalTransactionId && <span className={ui.meta}><br />元: {r.originalTransactionId}</span>}</td>
                <td>{r.shopName ?? r.shopExternalCode}</td>
                <td className={ui.num}>{r.amount === null ? '—' : yen(r.amount)}</td>
                <td>{dt(r.occurredAt)}</td>
                <td>{r.status === 'reversed' ? '取消' : r.status === 'confirmed' ? '確定' : r.status}</td>
                <td>
                  <StateBadge tone={r.rowStatus === 'ok' ? 'done' : r.rowStatus === 'duplicate' ? 'muted' : 'error'}>{ROW[r.rowStatus]}</StateBadge>
                  {r.errorCode && <span className={ui.meta}><br />{ERR[r.errorCode] ?? r.errorCode}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </OfficeShell>
  );
}
