# Yorikado（ヨリカド）— 商店街の窓口

商店街の加盟店と事務局のための Web アプリ（PWA）。地域券の受付、事務局への報告・返事、相談をスマホで行い、事務局は券の発行・精算・照合・依頼・相談対応を行います。

> **DEMO**: このリポジトリの初期データはすべて架空です（練習用・実際の券には使えません）。実在の発行者・銀行・外部券サービスとは接続していません。

## できること（v1）

| 区分 | 内容 |
|---|---|
| 店舗（スマホ） | 招待制ログイン、複数店舗の切替、ホーム3入口、QR券の読取（カメラ / 写真 / 番号入力、最大10枚）、受取確認→受付完了、結果不明時の照会、紙券の申告、依頼への回答・回覧の確認、相談（写真3枚）、入金予定・明細、履歴、口座変更申請（MFA） |
| 事務局（PC/スマホ） | 対応待ち、地域券事業（独自QR / 紙券 / 外部実績CSV）、二段階発行と印刷（A4・ブラウザ印刷）、紙券の原本確認、外部CSVの検査・プレビュー・確定、取消承認、精算（集計→承認→支払作業票→銀行結果の照合）、依頼配信・催促・代理入力、相談対応と内部メモ、店舗・招待・口座承認、権限、監査ログ、組織データ出力 |
| 基盤 | Supabase（PostgreSQL / Auth / private Storage）、全テーブル RLS、金銭と状態は SQL 関数で原子的に処理、TOTP MFA、DB共有のレート制限、outbox ジョブ、PWA（公開シェルのみキャッシュ） |

## すぐ動かす（Windows 11 は docs/SETUP_WINDOWS.txt）

```powershell
npm ci
Copy-Item .env.example .env.local   # 鍵と Supabase のキーを設定
npm run db:start                    # 表示された URL / キーを .env.local へ
npm run db:reset:demo               # ローカル DEMO データ（DEMO と入力して確認）
npm run dev                         # http://localhost:3000
npm run jobs:dev                    # 別ターミナル: 通知・招待メール・催促
```

DEMO ログイン（パスワード共通 `yorikado-demo-2026`）: `a.staff@example.com`（店員）、`a.owner@example.com`（店主）、`a.operator@example.com`（事務局担当）、`a.approver@example.com`（承認）、`a.admin@example.com`（管理者）。事務局の認証コードは DEMO 専用シークレット `YORIKADODEMOTOTPSECRETAA` を認証アプリに登録して表示します。

## 品質チェック

```powershell
npm run lint; npm run typecheck; npm run test; npm run test:integration; npm run test:e2e; npm run build
```

結果と未実施項目は [docs/TEST_REPORT.txt](docs/TEST_REPORT.txt)、引継ぎは [docs/HANDOFF.txt](docs/HANDOFF.txt)。

## ドキュメント

- [docs/SETUP_WINDOWS.txt](docs/SETUP_WINDOWS.txt) Windows 11 での起動 / Docker なしの手順
- [docs/DEPLOYMENT.txt](docs/DEPLOYMENT.txt) HTTPS の DEMO 公開（iPhone 確認）と LIVE 移行チェック
- [docs/DATA_MODEL.txt](docs/DATA_MODEL.txt) テーブル・状態・金額規則
- [docs/SECURITY.txt](docs/SECURITY.txt) 認証・RLS・鍵管理・残課題
- [docs/OPERATIONS.txt](docs/OPERATIONS.txt) 運用・障害対応・バックアップ
- [docs/openapi.yaml](docs/openapi.yaml) API 契約
- [docs/MANUAL_MERCHANT.txt](docs/MANUAL_MERCHANT.txt) / [docs/MANUAL_OFFICE.txt](docs/MANUAL_OFFICE.txt) 操作手順
- [docs/legal/](docs/legal/) 利用規約・プライバシー・役割分担の**原案**（法的完成品ではありません）
- [design-kit/](design-kit/) ブランド・UI・データ仕様（正本）と素材

## 重要な注意

- 支払作業票 CSV は**銀行へそのまま取り込めるファイルではありません**。振込は銀行の画面で行い、結果を所定の CSV で取り込んで照合します。
- 外部券（PayPay 等）の実績 CSV 取込は決済ではありません。外部サービスの非公開 API には接続しません。
- DEMO と LIVE は別の Supabase プロジェクト・Storage・シークレット・ドメインで運用します。LIVE 開始条件は docs/DEPLOYMENT.txt を参照。
