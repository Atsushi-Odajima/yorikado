R10_Yorikado / 2026-10-09 / v1.0

これは何か
商店の「地域券の受付・報告と返事・事務局への相談」を簡単にするWebアプリの企画・設計・ブランド素材です。
アプリ本体・公開サイト・実在する券の接続ではありません。

Claude Codeへの渡し方
1．このZIPを展開し、R10_Yorikadoフォルダを開発リポジトリのdesign-kit/として置きます。
2．01_claude_code_prompt.txtをClaude Codeへ渡します。UI・データの全文もこのTXT内に収録済みです。
3．最初は架空券のDEMOを実装します。Windowsでの開発と、HTTPSのDEMOをiPhoneで触る手順をプロンプトに含めています。
4．実装したアプリのコード・テスト・未完了事項を確認します。ブランド画像だけでは実取引の安全性は確認できません。

収録ファイル
00_product_summary.txt：商品、対象、事業性、料金仮説、範囲。
01_claude_code_prompt.txt：そのまま渡す開発指示。UIとデータ仕様を全文収録。
02_market_and_name_research.txt：競合4件、名称調査、事実と仮説、参考URL。
03_brand_and_ui_spec.txt：色・書体・寸法・状態・店舗10画面群と事務局6画面群。
04_design_direction_report.txt：3方向の比較、採用と却下、過去作との差。
05_data_and_settlement_rules.txt：スキーマ、権限、券の受付・取消・紙券・CSV・精算。
06_asset_notes_and_review.txt：素材の状態、生成指示、確認内容と限界。
assets/brand_board.png：ブランドボード。
assets/logo_horizontal.png、logo_mark.png：透過PNG。
assets/pwa_icon_192.png、pwa_icon_512.png、apple_touch_icon_180.png、favicon_32.png：アプリ用。
assets/fonts/、licenses/：フォントとOFL。
examples/：tokens、manifest例、操作アイコン、架空のCSV、検証記録。

仕様の読み合わせ
元の再設計方針：商店の入口は3つ。券の受付実績は報告へ再利用。
ブランドボードは演出資料で、UIの正本は03、金額処理の正本は05です。
写真の紙券登録は消化の確定ではなく、外部サービスのCSVは決済APIではありません。
支払作業票CSVはそのまま銀行へ取り込める保証のない資料です。銀行固有接続・外部券APIは範囲外。

確認できていないこと
Astra_master_prompt_v4.txtは原文を参照できず。チャットの共通基準を適用。
商標未確認、ドメイン未取得。名称調査は一般検索に載る範囲で、完全な権利調査ではありません。
価格・工数・導入効果は検証前の仮説。顧客インタビュー、実券運用審査、アプリの実機テストは未実施。
今回の納品でアプリや外部への送金・投稿・連絡・公開は行っていません。

ライセンス
フォントの条件はlicenses/の原文を維持してください。ロゴとブランドボードは生成AIによる新規制作物です。商標や排他的権利の成立を保証するものではありません。
PNGの単体マークと横組みは同一の方向を参照して生成しており、輪郭が画素単位で完全一致するベクターマスターではありません。ロゴのSVGマスターはこのパッケージに含めていません。
ui-icons.svgはこの商品向けの自作操作図形。製品実装で利用・改変できます。参考サイトの画像は同梱していません。
