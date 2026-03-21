/**
 * SuperClaw ライセンス認証：API で検証し、成功時にローカルに保存する。
 * ライセンスキーは Neon DB の licenses テーブルで管理（検証はバックエンド API 経由）。
 */

const path = require('path');
const fs = require('fs');

const LICENSE_FILENAME = 'license.json';

function getLicenseFilePath(app) {
  if (!app || typeof app.getPath !== 'function') return null;
  return path.join(app.getPath('userData'), LICENSE_FILENAME);
}

/**
 * 保存済みライセンスを読み込む。存在し有効なら { key, verifiedAt } を返し、なければ null。
 */
function loadStoredLicense(app) {
  const filePath = getLicenseFilePath(app);
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data.key === 'string' && data.key.trim()) {
      return { key: data.key.trim(), verifiedAt: data.verifiedAt || 0 };
    }
  } catch (_) {}
  return null;
}

/**
 * ライセンスをローカルに保存する。
 */
function saveLicense(app, key) {
  const filePath = getLicenseFilePath(app);
  if (!filePath) return;
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({ key: key.trim(), verifiedAt: Date.now() }, null, 2),
      'utf8'
    );
  } catch (_) {}
}

/**
 * 有効な保存済みライセンスがあるかどうか。
 */
function hasValidLicense(app) {
  return loadStoredLicense(app) !== null;
}

/**
 * バックエンド API でライセンスキーを検証する。
 * 環境変数 SUPERCLAW_LICENSE_API_URL に API のベース URL を設定（例: https://api.superclaw.jp）。
 * API は POST /v1/verify-license で body: { licenseKey: string }、応答: { valid: true } または { valid: false, message?: string } を想定。
 * @returns {{ ok: boolean, error?: string }}
 */
async function verifyLicenseKey(app, key) {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (!trimmed) {
    return { ok: false, error: 'ライセンスキーを入力してください。' };
  }

  const baseUrl = process.env.SUPERCLAW_LICENSE_API_URL || 'https://www.superclaw.jp';

  const url = baseUrl.replace(/\/$/, '') + '/api/verify-license';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey: trimmed }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await res.json().catch(() => ({}));
    if (res.ok && data.valid === true) {
      saveLicense(app, trimmed);
      return { ok: true };
    }
    const message = data.message || data.error || (res.status === 401 ? 'ライセンスキーが無効です。' : '認証に失敗しました。');
    return { ok: false, error: message };
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') {
      return { ok: false, error: '接続がタイムアウトしました。しばらくしてからお試しください。' };
    }
    return { ok: false, error: e.message || 'ネットワークエラーが発生しました。' };
  }
}

module.exports = {
  getLicenseFilePath,
  loadStoredLicense,
  saveLicense,
  hasValidLicense,
  verifyLicenseKey,
};
