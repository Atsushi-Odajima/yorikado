# Yorikado — 商店街の窓口

商店街の店舗と事務局をつなぎ、地域券の受付・精算、回覧・依頼・相談を管理するWebアプリです。

> **実装ブランチ：`claude/yorikado-v1`**。この既定ブランチのREADMEは製品の案内です。以下のソース・資料リンクと起動手順は、実装ブランチを参照します。

## できること

- QR券・紙券・外部実績CSVの受付と確認、取消承認
- 券の二段階発行、精算案・承認・支払作業票・銀行結果の照合
- 店舗への依頼・回答・相談、招待制認証、MFA、監査ログ

## 現在の範囲・制限

- 初期データは架空券のDEMOです。実在の券発行者・銀行・外部券サービスには接続していません。
- 支払作業票CSVは銀行へ直接取り込む振込ファイルではありません。実機・LIVE運用の確認は引継ぎ資料を参照してください。

## 実装の見どころ

**構成：** Next.js / React / TypeScript、Supabase（PostgreSQL / Auth / Storage）、RLS、ジョブワーカー。

- [src/server/api](https://github.com/Atsushi-Odajima/yorikado/tree/claude%2Fyorikado-v1/src/server/api)
- [supabase/migrations](https://github.com/Atsushi-Odajima/yorikado/tree/claude%2Fyorikado-v1/supabase/migrations)
- [scripts](https://github.com/Atsushi-Odajima/yorikado/tree/claude%2Fyorikado-v1/scripts)
- [tests](https://github.com/Atsushi-Odajima/yorikado/tree/claude%2Fyorikado-v1/tests)

## ローカルで試す

Node.js 22.12以上・23未満、DockerとSupabase CLI。専用のローカルDEMO環境を用意します。

実装ブランチを取得し、次のディレクトリで作業します。

```sh
git clone --branch claude/yorikado-v1 https://github.com/Atsushi-Odajima/yorikado.git
cd yorikado
npm ci
```

環境変数・鍵の設定後、開発手順の順序で npm run db:start → npm run db:reset:demo → npm run dev を実行します。通知ジョブは別ターミナルで npm run jobs:dev。db:reset:demo はローカルDBを初期化するため、既存データのあるDBには向けないでください。

環境設定・初期化の詳細：[セットアップ手順](https://github.com/Atsushi-Odajima/yorikado/blob/claude%2Fyorikado-v1/docs/SETUP_WINDOWS.txt)。

## 検証方法

`リポジトリ直下` の `package.json` に定義された主な確認コマンドです。DB・ブラウザ・外部ツールを要するものは、開発手順の事前設定が必要です。

```sh
npm run typecheck
npm run lint
npm run test
npm run test:e2e
npm run build
```

試験の実施環境・結果・未実施項目は、下記の記録を参照してください。画面エミュレーションと実機確認、モックと外部サービスでの確認を区別しています。

## 資料

- [docs/SETUP_WINDOWS.txt](https://github.com/Atsushi-Odajima/yorikado/blob/claude%2Fyorikado-v1/docs/SETUP_WINDOWS.txt)
- [docs/HANDOFF.txt](https://github.com/Atsushi-Odajima/yorikado/blob/claude%2Fyorikado-v1/docs/HANDOFF.txt)
- [README.md](https://github.com/Atsushi-Odajima/yorikado/blob/claude%2Fyorikado-v1/README.md)
- [docs/TEST_REPORT.txt](https://github.com/Atsushi-Odajima/yorikado/blob/claude%2Fyorikado-v1/docs/TEST_REPORT.txt)

## 制作・利用条件

制作・管理：**Atsushi Odajima**。実装・資料作成にはAI支援を利用しています。
ソース・同梱ライブラリ・フォント・モデル等の利用条件は、各ライセンスと第三者表記を参照してください。リポジトリの閲覧可能性と、再配布・商用利用の許諾は別です。
