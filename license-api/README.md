# SuperClaw ライセンス認証 API

Neon DB の `licenses` テーブルでライセンスキーを検証するサーバーレス API です。  
[Neon コンソール](https://console.neon.tech/app/projects/cool-credit-10550379) のプロジェクトに接続します。

**既存の Neon Database と連携する手順は [NEON-联动说明.md](./NEON-联动说明.md) にまとめています（中文）。**

## デプロイ（Vercel の場合）

1. この `license-api` フォルダを Vercel にデプロイする（またはリポジトリのルートに `api/` を置いている場合はそのリポジトリをデプロイ）。
2. 環境変数に **DATABASE_URL** を設定（Neon の接続文字列。[Neon Console](https://console.neon.tech/app/projects/cool-credit-10550379) の「Connect」から取得）。
3. 既存のテーブル名・カラム名が異なる場合は、任意で以下を設定：
   - **LICENSE_TABLE_NAME**（例: `licenses`）
   - **LICENSE_KEY_COLUMN**（例: `key` または `license_key`）
   - **LICENSE_REVOKED_COLUMN**（無効フラグのカラム名。無い場合は空文字）
4. デプロイ後の URL を控える（例: `https://your-app.vercel.app`）。

## アプリ側の設定

Electron アプリ（SuperClaw セットアップ）で、起動前に環境変数 **SUPERCLAW_LICENSE_API_URL** に上記 API のベース URL を設定してください。

- 例（開発時）: `SUPERCLAW_LICENSE_API_URL=https://your-app.vercel.app npm start`
- 本番: アプリの起動スクリプトや plist で同様に設定するか、ビルド時に埋め込む。

アプリは `POST {SUPERCLAW_LICENSE_API_URL}/api/verify-license` に  
`{ "licenseKey": "ユーザーが入力したキー" }` を送信し、  
`{ "valid": true }` または `{ "valid": false, "message": "..." }` を受け取ります。

## Neon の licenses テーブル

次のようなテーブルを想定しています（Neon SQL Editor で作成してください）。

```sql
CREATE TABLE IF NOT EXISTS licenses (
  id         SERIAL PRIMARY KEY,
  key        TEXT NOT NULL UNIQUE,
  revoked    BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- カラム名が license_key の場合は、api/verify-license.js 内の key を license_key に書き換えてください。
```

購入完了時に Stripe 等の Webhook や管理画面から、`licenses` にレコードを挿入し、ユーザーにメールでキーを送付します。

## ローカル動作確認

```bash
cd license-api
npm install @neondatabase/serverless
# .env に DATABASE_URL を設定
npx vercel dev
# または Node で簡易サーバーを立てて api/verify-license.js を require してテスト
```
