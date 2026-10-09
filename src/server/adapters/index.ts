import 'server-only';

/**
 * External connection adapters. v1 ships with NONE for every external party:
 * no official contract exists, so nothing is scraped, no personal logins are
 * used and no undocumented APIs are probed. The UI states "not connected".
 *
 * - External voucher services (PayPay, region PAY, chiica, ...): records are
 *   imported from the provider's official CSV only (src/domain/vouchers/externalCsv.ts).
 * - Banks: the payment worklist is NOT a bank file; results are imported from a
 *   normalised CSV (src/domain/settlements/csv.ts). Zengin/API transfer is out of scope.
 */
export type AdapterStatus = { name: 'NONE'; connected: false; note: string };

export const externalVoucherAdapter: AdapterStatus = {
  name: 'NONE',
  connected: false,
  note: '外部券サービスとは接続していません（実績CSVの取込のみ）',
};

export const bankTransferAdapter: AdapterStatus = {
  name: 'NONE',
  connected: false,
  note: '銀行とは接続していません（支払作業票の出力と振込結果CSVの取込のみ）',
};
