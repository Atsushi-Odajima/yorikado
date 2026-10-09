import Papa from 'papaparse';

/**
 * External voucher records CSV (provider exports). This is NOT a payment API:
 * rows are records supplied by the provider and validated before staging.
 */
export const EXTERNAL_COLUMNS = [
  'provider',
  'provider_transaction_id',
  'shop_external_code',
  'amount_jpy',
  'occurred_at',
  'status',
  'original_transaction_id',
] as const;
export type ExternalColumn = (typeof EXTERNAL_COLUMNS)[number];

export const MAX_CSV_BYTES = 10 * 1024 * 1024;
export const MAX_CSV_ROWS = 10_000;

export interface ParsedRow {
  row: number; // 1-based data row number (header excluded)
  provider: string;
  provider_transaction_id: string;
  shop_external_code: string;
  amount_jpy: number | null;
  occurred_at: string | null;
  status: string;
  original_transaction_id: string;
  error?: string;
}

export class CsvFileError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Strict UTF-8 decode (BOM allowed). Invalid byte sequences reject the file. */
export function decodeUtf8Strict(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new CsvFileError('INVALID_UTF8', 'UTF-8以外の文字コードか、壊れた文字が含まれています。UTF-8で保存し直してください');
  }
  return text;
}

const FORMULA = /^[=+\-@\t\r]/;
const SCIENTIFIC = /^-?\d+(\.\d+)?[eE][+-]?\d+$/;
// ISO 8601 with mandatory timezone (Z or ±hh:mm)
const ISO_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

export function isFormulaLike(v: string): boolean {
  return FORMULA.test(v);
}

function validateRow(raw: Record<string, string>, rowNo: number): ParsedRow {
  const g = (k: ExternalColumn) => (raw[k] ?? '').trim();
  const out: ParsedRow = {
    row: rowNo,
    provider: g('provider'),
    provider_transaction_id: g('provider_transaction_id'),
    shop_external_code: g('shop_external_code'),
    amount_jpy: null,
    occurred_at: null,
    status: g('status'),
    original_transaction_id: g('original_transaction_id'),
  };
  const textFields: ExternalColumn[] = ['provider', 'provider_transaction_id', 'shop_external_code', 'status', 'original_transaction_id'];
  for (const k of textFields) {
    const v = raw[k] ?? '';
    if (isFormulaLike(v) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) return { ...out, error: 'FORMULA_OR_CONTROL_CHAR' };
  }
  if (!out.provider || out.provider.length > 60) return { ...out, error: 'INVALID_PROVIDER' };
  if (!out.provider_transaction_id || out.provider_transaction_id.length > 100) return { ...out, error: 'INVALID_TRANSACTION_ID' };
  if (SCIENTIFIC.test(out.provider_transaction_id) || SCIENTIFIC.test(out.original_transaction_id)) return { ...out, error: 'EXCEL_SCIENTIFIC_NOTATION' };
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(out.shop_external_code)) return { ...out, error: 'INVALID_SHOP_CODE' };
  const amountRaw = g('amount_jpy');
  if (SCIENTIFIC.test(amountRaw)) return { ...out, error: 'EXCEL_SCIENTIFIC_NOTATION' };
  if (!/^\d{1,7}$/.test(amountRaw)) return { ...out, error: 'INVALID_AMOUNT' };
  const amount = Number(amountRaw);
  if (amount < 1 || amount > 1_000_000) return { ...out, error: 'INVALID_AMOUNT' };
  out.amount_jpy = amount;
  const at = g('occurred_at');
  if (!ISO_TZ.test(at) || Number.isNaN(Date.parse(at))) return { ...out, error: 'INVALID_DATETIME_TZ_REQUIRED' };
  const d = new Date(at);
  // reject impossible calendar dates that Date normalises (e.g. 2026-02-30)
  const datePart = at.slice(0, 10);
  const [y, m, day] = datePart.split('-').map(Number) as [number, number, number];
  if (m < 1 || m > 12 || day < 1 || day > new Date(Date.UTC(y, m, 0)).getUTCDate()) return { ...out, error: 'INVALID_DATETIME_TZ_REQUIRED' };
  out.occurred_at = d.toISOString();
  if (out.status !== 'confirmed' && out.status !== 'reversed') return { ...out, error: 'INVALID_STATUS' };
  if (out.status === 'reversed' && !out.original_transaction_id) return { ...out, error: 'ORIGINAL_REQUIRED' };
  if (out.status === 'confirmed' && out.original_transaction_id) return { ...out, error: 'ORIGINAL_NOT_ALLOWED' };
  return out;
}

/**
 * Parse an external CSV. `mapping` maps standard column -> file header name
 * (defaults to identical names). Throws CsvFileError for file-level problems;
 * row-level problems are returned per row in `error`.
 */
export function parseExternalCsv(bytes: Uint8Array, mapping: Partial<Record<ExternalColumn, string>> = {}): ParsedRow[] {
  if (bytes.byteLength > MAX_CSV_BYTES) throw new CsvFileError('TOO_LARGE', 'ファイルは10MBまでです');
  const text = decodeUtf8Strict(bytes);
  const result = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.replace(/^﻿/, '').trim() });
  if (result.errors.some((e) => e.type === 'Quotes' || e.type === 'Delimiter')) {
    throw new CsvFileError('MALFORMED', 'CSVの形式が壊れています（引用符・区切り）');
  }
  const headers = result.meta.fields ?? [];
  const resolved = {} as Record<ExternalColumn, string>;
  for (const col of EXTERNAL_COLUMNS) {
    const h = mapping[col] ?? col;
    if (!headers.includes(h)) throw new CsvFileError('MISSING_COLUMN', `列「${h}」がありません`);
    resolved[col] = h;
  }
  if (result.data.length === 0) throw new CsvFileError('EMPTY', '行がありません');
  if (result.data.length > MAX_CSV_ROWS) throw new CsvFileError('TOO_MANY_ROWS', '1ファイル10,000行までです');
  const fieldErrorRows = new Set(result.errors.filter((e) => e.type === 'FieldMismatch').map((e) => e.row));
  return result.data.map((r, i) => {
    const raw: Record<string, string> = {};
    for (const col of EXTERNAL_COLUMNS) raw[col] = r[resolved[col]] ?? '';
    const parsed = validateRow(raw, i + 1);
    if (fieldErrorRows.has(i) && !parsed.error) parsed.error = 'COLUMN_COUNT_MISMATCH';
    return parsed;
  });
}
