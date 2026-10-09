import Papa from 'papaparse';
import { CsvFileError, decodeUtf8Strict, isFormulaLike, MAX_CSV_BYTES } from '@/domain/vouchers/externalCsv';

/** Neutralise spreadsheet formula injection: prefix risky cells with an apostrophe. */
export function safeCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  const cleaned = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  return isFormulaLike(cleaned) ? `'${cleaned}` : cleaned;
}

export function toCsv(rows: unknown[][]): string {
  // BOM so Excel opens UTF-8 correctly; every cell neutralised.
  return '﻿' + Papa.unparse(rows.map((r) => r.map(safeCell)), { quotes: true, newline: '\r\n' });
}

export interface BankPayload {
  bankName: string;
  branchName: string;
  accountType: 'ordinary' | 'current';
  accountNumber: string;
  holderName: string;
}

export interface WorklistLine {
  lineId: string;
  shopName: string;
  netAmount: number;
  expectedDate: string | null;
  bank: BankPayload | null;
}

export const WORKLIST_NOTICE = '支払作業票（銀行へそのまま取り込むファイルではありません。銀行の画面で振込を行い、結果を所定の形式で取り込んでください）';

export function buildWorklistCsv(meta: { batchNumber: number; hash: string; reexport: boolean; exportCount: number }, lines: WorklistLine[]): string {
  const header = ['精算番号', '出力区分', '内容hash', 'line_id', '店舗', '金融機関', '支店', '種別', '口座番号', '口座名義', '金額(円)', '振込予定日'];
  const rows: unknown[][] = [
    [WORKLIST_NOTICE],
    meta.reexport ? [`再出力（${meta.exportCount}回目）: 同じ内容です。銀行で重ねて振込を実行しないでください`] : ['初回出力'],
    header,
    ...lines.map((l) => [
      meta.batchNumber,
      meta.reexport ? '再出力' : '初回',
      meta.hash,
      l.lineId,
      l.shopName,
      l.bank?.bankName ?? '',
      l.bank?.branchName ?? '',
      l.bank ? (l.bank.accountType === 'ordinary' ? '普通' : '当座') : '',
      l.bank?.accountNumber ?? '',
      l.bank?.holderName ?? '',
      l.netAmount,
      l.expectedDate ?? '',
    ]),
  ];
  return toCsv(rows);
}

export const BANK_RESULT_COLUMNS = ['line_id', 'bank_reference', 'amount_jpy', 'result', 'executed_date'] as const;

export interface BankResultRow {
  row: number;
  line_id: string;
  bank_reference: string;
  amount_jpy: number | null;
  result: string;
  executed_date: string | null;
  error?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseBankResultsCsv(bytes: Uint8Array): BankResultRow[] {
  if (bytes.byteLength > MAX_CSV_BYTES) throw new CsvFileError('TOO_LARGE', 'ファイルは10MBまでです');
  const text = decodeUtf8Strict(bytes);
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.replace(/^﻿/, '').trim() });
  if (parsed.errors.some((e) => e.type === 'Quotes' || e.type === 'Delimiter')) throw new CsvFileError('MALFORMED', 'CSVの形式が壊れています');
  for (const c of BANK_RESULT_COLUMNS) if (!(parsed.meta.fields ?? []).includes(c)) throw new CsvFileError('MISSING_COLUMN', `列「${c}」がありません`);
  if (parsed.data.length === 0) throw new CsvFileError('EMPTY', '行がありません');
  if (parsed.data.length > 10_000) throw new CsvFileError('TOO_MANY_ROWS', '10,000行までです');
  return parsed.data.map((r, i) => {
    const row: BankResultRow = {
      row: i + 1,
      line_id: (r.line_id ?? '').trim(),
      bank_reference: (r.bank_reference ?? '').trim(),
      amount_jpy: null,
      result: (r.result ?? '').trim(),
      executed_date: null,
    };
    if (Object.values(r).some((v) => isFormulaLike(v ?? ''))) return { ...row, error: 'FORMULA_OR_CONTROL_CHAR' };
    if (!UUID_RE.test(row.line_id)) return { ...row, error: 'INVALID_LINE_ID' };
    if (!/^[A-Za-z0-9_-]{1,60}$/.test(row.bank_reference)) return { ...row, error: 'INVALID_BANK_REFERENCE' };
    const a = (r.amount_jpy ?? '').trim();
    if (!/^\d{1,10}$/.test(a)) return { ...row, error: 'INVALID_AMOUNT' };
    row.amount_jpy = Number(a);
    if (row.result !== 'success' && row.result !== 'failed') return { ...row, error: 'INVALID_RESULT' };
    const d = (r.executed_date ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d + 'T00:00:00Z')) || new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) !== d) {
      return { ...row, error: 'INVALID_DATE' };
    }
    row.executed_date = d;
    return row;
  });
}

/** JST month bounds [start, end) as ISO strings (for display/tests; the DB is authoritative). */
export function jstMonthBounds(month: string): { start: string; end: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error('invalid month');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const start = new Date(Date.UTC(y, mo - 1, 1) - 9 * 3600_000);
  const end = new Date(Date.UTC(y, mo, 1) - 9 * 3600_000);
  return { start: start.toISOString(), end: end.toISOString() };
}
