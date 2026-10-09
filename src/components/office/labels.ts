export const MODE_LABEL: Record<string, string> = { owned_qr: '独自QR額面券', paper_count: '紙券（枚数申告）', external_csv: '外部券（実績CSV）' };
export const CAMPAIGN_STATUS: Record<string, string> = { draft: '下書き', active: '受付中', suspended: '停止中', closed: '終了' };
export const BATCH_STATUS: Record<string, string> = { draft: '作成中', generated: '印刷データ作成済み（未有効）', activated: '有効化済み', void: '破棄' };
export const PAPER_STATUS: Record<string, string> = { draft: '下書き', submitted: '原本確認待ち', returned: '差戻し', verified: '原本確認済み', rejected: '不受理' };
export const IMPORT_STATUS: Record<string, string> = { staged: 'エラー・差分あり（未確定）', validated: '確認済み（未確定）', committed: '確定', rejected: '取消' };
export const SETTLEMENT_STATUS: Record<string, string> = {
  draft: '精算案（下書き）', review: '承認待ち', approved: '承認済み', exported: '支払作業票 出力済み', partially_confirmed: '一部 振込確認済み', confirmed: '振込結果 確認済み', exception: '要確認',
};
export const LINE_STATUS: Record<string, string> = {
  pending: '未承認', approved: '承認済み', exported: '振込手続き中', confirmed: '振込結果確認済み', failed: '振込失敗', exception: '要確認', held: '保留（取消あり）', resolved: '処理済み（判断記録）',
};
export const EXCEPTION_REASON: Record<string, string> = {
  NEGATIVE_ADJUSTMENT: '支払後の取消による負の調整', UNDERPAID: '銀行結果の金額が不足', OVERPAID: '銀行結果の金額が過大', BANK_FAILED: '振込失敗', REVERSAL_AFTER_APPROVAL: '承認後に取消あり',
};
