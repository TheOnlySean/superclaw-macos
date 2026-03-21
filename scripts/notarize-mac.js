#!/usr/bin/env node
/**
 * 將已簽名的 SuperClaw.app 壓縮送交 Apple 公證，並對 DMG 執行 stapler staple。
 * 需先完成簽名（npm run dist:mac:arm64:signed 或 node scripts/sign-mac-app.js + create-dmg.js）。
 *
 * 使用方式（請勿把密碼提交到 Git）：
 *   APPLE_ID="your@email.com" NOTARY_PASSWORD="xxxx-xxxx-xxxx-xxxx" TEAM_ID="G7VUNQ8M6B" node scripts/notarize-mac.js
 *
 * 或先 export 環境變數再執行 node scripts/notarize-mac.js
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let PKG_VERSION = '1.0.0';
try {
  PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || PKG_VERSION;
} catch (_) {}
const APP_PATH = path.join(ROOT, 'dist', 'mac-arm64', 'SuperClaw.app');
const ZIP_PATH = path.join(ROOT, 'dist', `SuperClaw-${PKG_VERSION}-arm64.zip`);
const DMG_PATH = path.join(ROOT, 'dist', `SuperClaw-${PKG_VERSION}-arm64.dmg`);

const APPLE_ID = process.env.APPLE_ID;
const NOTARY_PASSWORD = process.env.NOTARY_PASSWORD;
const TEAM_ID = process.env.TEAM_ID || 'G7VUNQ8M6B';

if (!APPLE_ID || !NOTARY_PASSWORD) {
  console.error('請設定環境變數：APPLE_ID 與 NOTARY_PASSWORD');
  console.error('例：APPLE_ID="your@email.com" NOTARY_PASSWORD="xxxx-xxxx-xxxx" TEAM_ID="G7VUNQ8M6B" node scripts/notarize-mac.js');
  process.exit(1);
}

let zipToSubmit = process.env.NOTARIZE_ZIP_PATH ? path.resolve(process.env.NOTARIZE_ZIP_PATH) : null;
if (!zipToSubmit && fs.existsSync(ZIP_PATH)) {
  zipToSubmit = ZIP_PATH;
}
if (!zipToSubmit && fs.existsSync(APP_PATH)) {
  zipToSubmit = path.join(ROOT, 'dist', 'SuperClaw-arm64-upload.zip');
  const distDir = path.dirname(zipToSubmit);
  if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
  console.log('壓縮 .app 為 zip…');
  try {
    execSync(`ditto -c -k --keepParent "${APP_PATH}" "${zipToSubmit}"`, { stdio: 'inherit', cwd: ROOT });
  } catch (e) {
    console.error('壓縮失敗:', e.message || e);
    process.exit(1);
  }
}
if (!zipToSubmit || !fs.existsSync(zipToSubmit)) {
  console.error(`找不到要公證的 zip。請先執行簽名流程產出 dist/SuperClaw-${PKG_VERSION}-arm64.zip：`);
  console.error('  node scripts/sign-mac-app.js');
  process.exit(1);
}
console.log('將送交公證的 zip:', zipToSubmit);

console.log('送交 Apple 公證…');
let submitOut;
try {
  submitOut = execSync(
    `xcrun notarytool submit "${zipToSubmit}" --apple-id "${APPLE_ID}" --team-id "${TEAM_ID}" --password "${NOTARY_PASSWORD}" --wait`,
    { encoding: 'utf8', cwd: ROOT }
  );
} catch (e) {
  submitOut = (e.stdout || '') + (e.stderr || '');
  if (!submitOut && e.message) submitOut = e.message;
}

const statusInvalid = /status:\s*Invalid/i.test(submitOut);
const submissionIdMatch = submitOut.match(/id:\s*([a-f0-9-]+)/i);

if (statusInvalid) {
  console.error('公證未通過（status: Invalid）。Apple 拒絕原因請見下方日誌。\n');
  if (submissionIdMatch) {
    const id = submissionIdMatch[1].trim();
    console.error('Submission ID:', id);
    try {
      const logOut = execSync(
        `xcrun notarytool log "${id}" --apple-id "${APPLE_ID}" --team-id "${TEAM_ID}" --password "${NOTARY_PASSWORD}"`,
        { encoding: 'utf8', cwd: ROOT }
      );
      console.error('--- Apple 公證日誌 ---');
      console.error(logOut);
      console.error('--- 請依日誌修正簽名或內容後重新打包並再送公證。---');
    } catch (logErr) {
      console.error('取得日誌失敗:', (logErr.stderr || logErr.stdout || logErr.message) || logErr);
      console.error('可手動執行：xcrun notarytool log', id, '--apple-id "..." --password "..." --team-id', TEAM_ID);
    }
  }
  process.exit(1);
}

if (!/status:\s*Accepted/i.test(submitOut)) {
  console.error('無法判斷公證結果，請檢查上方輸出。');
  process.exit(1);
}

console.log('公證通過。');
if (zipToSubmit === ZIP_PATH) {
  console.log('請直接分發此 zip，使用者解壓後即可正常開啟：', ZIP_PATH);
}
// 僅在我們有 DMG 且公證的是 DMG 時才 staple；公證 zip 時不對 DMG staple
if (fs.existsSync(DMG_PATH) && zipToSubmit === DMG_PATH) {
  console.log('將公證票釘到 DMG…');
  try {
    execSync(`xcrun stapler staple "${DMG_PATH}"`, { stdio: 'inherit', cwd: ROOT });
    console.log('可發佈 DMG:', DMG_PATH);
  } catch (e) {
    console.warn('stapler 失敗:', e.message || e);
  }
}
