/**
 * SuperClaw ライセンス認証 API
 * POST /api/verify-license
 * Body: { "licenseKey": "xxx" }
 * Response: { "valid": true } or { "valid": false, "message": "..." }
 *
 * Neon プロジェクト: https://console.neon.tech/app/projects/cool-credit-10550379
 * 環境変数: DATABASE_URL（Neon の接続文字列）
 *
 * licenses テーブル想定: id, key (ライセンスキー), revoked (boolean, 任意)
 * カラム名が license_key の場合は sql.unsafe で変更してください。
 */

import { neon } from '@neondatabase/serverless';

export const config = {
  runtime: 'nodejs',
  maxDuration: 10,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ valid: false, message: 'Method Not Allowed' });
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    return res.status(500).json({ valid: false, message: 'サーバー設定エラーです。' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  } catch (_) {
    return res.status(400).json({ valid: false, message: 'リクエスト形式が不正です。' });
  }

  const licenseKey = typeof body.licenseKey === 'string' ? body.licenseKey.trim() : '';
  if (!licenseKey) {
    return res.status(400).json({ valid: false, message: 'ライセンスキーを入力してください。' });
  }

  try {
    const sql = neon(databaseUrl);
    // 既存 DB に合わせて環境変数で指定可能
    const tableName = process.env.LICENSE_TABLE_NAME || 'licenses';
    const keyColumn = process.env.LICENSE_KEY_COLUMN || 'key';
    const revokedColumn = process.env.LICENSE_REVOKED_COLUMN || 'revoked'; // 無い場合は '' にして下の条件をスキップ

    let rows;
    if (revokedColumn) {
      rows = await sql`
        SELECT 1 AS ok FROM ${sql.unsafe(tableName)}
        WHERE ${sql.unsafe(keyColumn)} = ${licenseKey}
          AND (${sql.unsafe(revokedColumn)} IS NULL OR ${sql.unsafe(revokedColumn)} = false)
        LIMIT 1
      `;
    } else {
      rows = await sql`
        SELECT 1 AS ok FROM ${sql.unsafe(tableName)}
        WHERE ${sql.unsafe(keyColumn)} = ${licenseKey}
        LIMIT 1
      `;
    }
    if (Array.isArray(rows) && rows.length > 0) {
      return res.status(200).json({ valid: true });
    }
    return res.status(200).json({ valid: false, message: 'ライセンスキーが無効です。' });
  } catch (e) {
    console.error('License verify error:', e.message);
    return res.status(500).json({
      valid: false,
      message: '認証処理中にエラーが発生しました。しばらくしてからお試しください。',
    });
  }
}
