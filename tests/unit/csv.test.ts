import { describe, expect, it } from 'vitest';
import { buildWorklistCsv, jstMonthBounds, parseBankResultsCsv, safeCell, toCsv } from '@/domain/settlements/csv';
import { CsvFileError, parseExternalCsv } from '@/domain/vouchers/externalCsv';

const H = 'provider,provider_transaction_id,shop_external_code,amount_jpy,occurred_at,status,original_transaction_id\n';
const enc = (s: string) => new TextEncoder().encode(s);

describe('external CSV', () => {
  it('parses the sample format with BOM', () => {
    const rows = parseExternalCsv(enc('﻿' + H + 'P,TX-1,SHOP-DEMO-01,500,2026-10-09T10:00:00+09:00,confirmed,\n'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'P', amount_jpy: 500, occurred_at: '2026-10-09T01:00:00.000Z' });
    expect(rows[0]!.error).toBeUndefined();
  });

  it('handles quotes and embedded newlines', () => {
    const rows = parseExternalCsv(enc(H + '"P","TX-""2""","SHOP-1","1000","2026-10-09T10:00:00Z","confirmed",""\n'));
    expect(rows[0]!.provider_transaction_id).toBe('TX-"2"');
    const r2 = parseExternalCsv(enc(H + 'P,"TX\n3",SHOP-1,1000,2026-10-09T10:00:00Z,confirmed,\n'));
    expect(r2[0]!.provider_transaction_id).toBe('TX\n3');
  });

  it('flags formula injection, Excel damage, bad dates and amounts per row', () => {
    const rows = parseExternalCsv(
      enc(
        H +
          'P,=HYPERLINK("x"),SHOP-1,500,2026-10-09T10:00:00Z,confirmed,\n' +
          'P,1.23E+11,SHOP-1,500,2026-10-09T10:00:00Z,confirmed,\n' +
          'P,TX-3,SHOP-1,5E+2,2026-10-09T10:00:00Z,confirmed,\n' +
          'P,TX-4,SHOP-1,500,2026/10/9 10:00,confirmed,\n' +
          'P,TX-5,SHOP-1,500,2026-10-09T10:00:00,confirmed,\n' +
          'P,TX-6,SHOP-1,500,2026-02-30T10:00:00Z,confirmed,\n' +
          'P,TX-7,SHOP-1,-500,2026-10-09T10:00:00Z,confirmed,\n' +
          'P,TX-8,SHOP-1,0,2026-10-09T10:00:00Z,confirmed,\n' +
          'P,TX-9,SHOP-1,500,2026-10-09T10:00:00Z,reversed,\n' +
          'P,TX-10,SHOP-1,500,2026-10-09T10:00:00Z,pending,\n' +
          '@SUM(1),TX-11,SHOP-1,500,2026-10-09T10:00:00Z,confirmed,\n',
      ),
    );
    expect(rows.map((r) => r.error)).toEqual([
      'FORMULA_OR_CONTROL_CHAR',
      'EXCEL_SCIENTIFIC_NOTATION',
      'EXCEL_SCIENTIFIC_NOTATION',
      'INVALID_DATETIME_TZ_REQUIRED',
      'INVALID_DATETIME_TZ_REQUIRED',
      'INVALID_DATETIME_TZ_REQUIRED',
      'INVALID_AMOUNT', // -500 (leading minus is also never a valid amount)
      'INVALID_AMOUNT',
      'ORIGINAL_REQUIRED',
      'INVALID_STATUS',
      'FORMULA_OR_CONTROL_CHAR',
    ]);
  });

  it('rejects invalid UTF-8, missing columns, empty and oversized files', () => {
    const bad = new Uint8Array([...enc(H), 0x50, 0xff, 0xfe, 0x0a]);
    expect(() => parseExternalCsv(bad)).toThrow(CsvFileError);
    expect(() => parseExternalCsv(enc('a,b\n1,2\n'))).toThrow(/列/);
    expect(() => parseExternalCsv(enc(H))).toThrow(/行がありません/);
    expect(() => parseExternalCsv(new Uint8Array(10 * 1024 * 1024 + 1))).toThrow(/10MB/);
    const many = H + 'P,TX,SHOP-1,1,2026-10-09T10:00:00Z,confirmed,\n'.repeat(10_001);
    expect(() => parseExternalCsv(enc(many))).toThrow(/10,000/);
  });

  it('supports column mapping', () => {
    const rows = parseExternalCsv(enc('prov,id,shop,amt,at,st,orig\nP,1,S1,100,2026-10-09T10:00:00Z,confirmed,\n'), {
      provider: 'prov', provider_transaction_id: 'id', shop_external_code: 'shop', amount_jpy: 'amt', occurred_at: 'at', status: 'st', original_transaction_id: 'orig',
    });
    expect(rows[0]!.error).toBeUndefined();
  });
});

describe('spreadsheet output', () => {
  it('neutralises formula cells', () => {
    expect(safeCell('=1+1')).toBe("'=1+1");
    expect(safeCell('+81')).toBe("'+81");
    expect(safeCell('-5')).toBe("'-5");
    expect(safeCell('@x')).toBe("'@x");
    expect(safeCell('普通')).toBe('普通');
    expect(toCsv([['=cmd'], ['ok']])).toContain(`"'=cmd"`);
  });

  it('worklist says it is not a bank file and marks re-exports', () => {
    const csv = buildWorklistCsv({ batchNumber: 3, hash: 'h', reexport: true, exportCount: 2 }, [
      { lineId: 'l1', shopName: '=evil', netAmount: 1500, expectedDate: '2026-10-30', bank: { bankName: 'B', branchName: 'C', accountType: 'ordinary', accountNumber: '1234567', holderName: 'ヤマダ' } },
    ]);
    expect(csv).toContain('銀行へそのまま取り込むファイルではありません');
    expect(csv).toContain('再出力');
    expect(csv).toContain(`"'=evil"`);
  });
});

describe('bank results CSV', () => {
  it('validates rows', () => {
    const rows = parseBankResultsCsv(
      enc(
        'line_id,bank_reference,amount_jpy,result,executed_date\n' +
          '00000000-0000-4000-8000-000000000101,DEMO-BANK-0001,1500,success,2026-10-30\n' +
          'bad,REF,1,success,2026-10-30\n' +
          '00000000-0000-4000-8000-000000000101,REF2,1,maybe,2026-10-30\n' +
          '00000000-0000-4000-8000-000000000101,REF3,1,failed,2026-13-40\n',
      ),
    );
    expect(rows.map((r) => r.error)).toEqual([undefined, 'INVALID_LINE_ID', 'INVALID_RESULT', 'INVALID_DATE']);
  });
});

describe('JST month bounds', () => {
  it('uses JST midnight boundaries, end exclusive', () => {
    expect(jstMonthBounds('2026-10')).toEqual({ start: '2026-09-30T15:00:00.000Z', end: '2026-10-31T15:00:00.000Z' });
    expect(jstMonthBounds('2026-12').end).toBe('2026-12-31T15:00:00.000Z');
  });
});
