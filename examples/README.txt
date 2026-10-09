Yorikado サンプルCSV（すべて架空・DEMO専用）/ UTF-8 (BOM付き)

外部券の実績CSV（標準列: provider, provider_transaction_id, shop_external_code, amount_jpy, occurred_at, status, original_transaction_id）
  external_normal.csv            正常な2行（DEMO店舗コード SHOP-DEMO-01）
  external_duplicate.csv         同一キー・同一内容の重複（2行目はファイル内重複として停止。既存取込済みなら skip）
  external_conflict.csv          既存と同じ取引IDで金額が違う（差分として停止）
  external_unknown_shop.csv      不明な店舗コード／別組織の店舗コード（手動対応付けが必要・別組織へは割当不可）
  external_formula_injection.csv 式注入・Excel桁落ち・タイムゾーンなし日時（行エラーとして隔離）
  external_partial_reversal.csv  部分取消（v1は全額取消のみ・unsupported）

銀行の振込結果（line_id, bank_reference, amount_jpy, result, executed_date）
  bank_results_sample.csv        形式見本。line_id は実際の精算明細ID（事務局の精算詳細画面に表示）へ置き換えてください。

注意: これらは実在の銀行・券提供元のファイル形式への適合を示すものではありません。
