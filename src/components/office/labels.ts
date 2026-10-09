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

/** Audit action labels for office staff (codes stay in the data/export). */
export const AUDIT_ACTION: Record<string, string> = {
  'bank.change_request': '口座変更の申請', 'bank.change_approve': '口座変更の承認', 'bank.change_reject': '口座変更の不承認',
  'bank_results.stage': '銀行結果の取込', 'bank_results.confirm': '銀行結果の確定',
  'campaign.create': '事業の作成', 'campaign.submit': '事業の公開申請', 'campaign.approve': '事業の承認', 'campaign.approve_live': 'LIVE審査の承認',
  'campaign.live_readiness': 'LIVE開始条件の更新', 'campaign.suspend': '受付停止', 'campaign.resume': '受付再開', 'campaign.close': '事業終了',
  'export.request': 'データ出力の作成', 'export.download': 'データ出力の取得', 'export.cli': 'データ出力（運用CLI）',
  'external_import.stage': '外部実績の取込', 'external_import.map_shop': '店舗コードの対応付け', 'external_import.commit': '外部実績の確定', 'external_import.reject': '外部実績の取消',
  'invitation.create': '招待', 'invitation.accept': '招待の受諾', 'invitation.revoke': '招待の取消',
  'issuance.create': '券の発行', 'issuance.generated': '印刷データ作成', 'issuance.download': '印刷データの取得', 'issuance.receipt_confirmed': '印刷枚数の確認',
  'issuance.activate': '券の有効化', 'issuance.void': '券の破棄・失効',
  'membership.set': '事務局の権限変更', 'shop_membership.revoke': '店舗担当者の無効化',
  'paper.create': '紙券の申告作成', 'paper.update': '紙券の申告修正', 'paper.submit': '紙券の申告', 'paper.verify': '紙券の原本確認', 'paper.return': '紙券の差戻し', 'paper.reject': '紙券の不受理',
  'redemption.confirm': '地域券の受付', 'reversal.request': '取消の申請', 'reversal.approve': '取消の承認', 'reversal.reject': '取消の不承認',
  'request.create': '相談の作成', 'request.message': '相談への返信', 'request.internal_memo': '内部メモ', 'request.update': '相談の状態変更',
  'security.rate_limited': '失敗の多発を検知', 'session.revoke_all': '全端末ログアウト',
  'settlement.generate': '精算案の作成', 'settlement.recalculate': '精算の再計算', 'settlement.discard': '精算案の破棄', 'settlement.submit_review': '精算の承認依頼',
  'settlement.approve': '精算の承認', 'settlement.return': '精算の差戻し', 'settlement.export': '支払作業票の出力', 'settlement.reexport': '支払作業票の再出力',
  'settlement.line_resolve': '要確認行の判断', 'settlement.shop_declared': '店舗の入金申告',
  'shop.create': '店舗の登録', 'shop.update': '店舗情報の変更', 'tenant.settings': '組織設定の変更',
  'task.save_draft': '依頼の下書き保存', 'task.publish': '依頼の公開', 'task.close': '依頼の締切', 'task.extend': '期限の延長', 'task.remind': '催促',
  'task.respond': '回答', 'task.proxy_respond': '代理入力', 'task.acknowledge': '回覧の確認', 'task.proxy_acknowledge': '回覧の代理確認',
  'task.approve': '回答の確認', 'task.return': '回答の差戻し',
};
