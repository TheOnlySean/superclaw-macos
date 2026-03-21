#!/usr/bin/env node
/**
 * 從已 staple 的 zip 取出 SuperClaw.app，用 productbuild 打成 .pkg 安裝包。
 * 使用者下載 .pkg 後雙擊安裝，會裝到 /Applications，首次打開 app 時較不易被 Gatekeeper 擋。
 *
 * 需先執行過 node scripts/staple-and-rezip.js 產出含 SuperClaw.app 的 zip。
 *
 * 用法：
 *   node scripts/create-pkg-from-stapled-zip.js [arm64|x64]
 * 若不傳參數則處理 arm64。會產出 dist/SuperClaw-1.0.0-arm64.pkg 或 dist/SuperClaw-1.0.0-x64.pkg。
 *
 * 產出 .pkg 後需簽名（Developer ID Installer 憑證）、送公證、再 staple 到 .pkg，才能分發。
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const arch = process.argv[2] === 'x64' ? 'x64' : 'arm64';
const zipPath = path.join(ROOT, 'dist', `SuperClaw-1.0.0-${arch}.zip`);
const pkgPath = path.join(ROOT, 'dist', `SuperClaw-1.0.0-${arch}.pkg`);
const INSTALLER_ID = process.env.INSTALLER_ID || 'Developer ID Installer: SEAN XIAO (G7VUNQ8M6B)';

if (!fs.existsSync(zipPath)) {
  console.error('找不到 zip:', zipPath);
  console.error('請先執行: node scripts/staple-and-rezip.js');
  process.exit(1);
}

const workDir = path.join(os.tmpdir(), `pkg-from-zip-${Date.now()}`);
fs.mkdirSync(workDir, { recursive: true });
try {
  console.log('解壓 zip…');
  execSync(`unzip -q -o "${zipPath}" -d "${workDir}"`, { stdio: 'pipe' });
  const appName = 'SuperClaw.app';
  const appPath = path.join(workDir, appName);
  if (!fs.existsSync(appPath)) {
    const found = fs.readdirSync(workDir).find((n) => n.endsWith('.app'));
    if (found) {
      const oldPath = path.join(workDir, found);
      fs.renameSync(oldPath, appPath);
    } else {
      console.error('zip 內找不到 .app');
      process.exit(1);
    }
  }
  if (fs.existsSync(pkgPath)) fs.unlinkSync(pkgPath);
  console.log('建立 .pkg（安裝到 /Applications）…');
  execSync(
    `productbuild --component "${appPath}" /Applications "${pkgPath}"`,
    { stdio: 'inherit', cwd: ROOT }
  );
  console.log('已產出:', pkgPath);
  if (process.env.SIGN_PKG === '1') {
    console.log('簽名 .pkg（Developer ID Installer）…');
    const signedPath = pkgPath.replace('.pkg', '-signed.pkg');
    execSync(`productbuild --component "${appPath}" /Applications --sign "${INSTALLER_ID}" "${signedPath}"`, {
      stdio: 'inherit',
      cwd: ROOT,
    });
    fs.renameSync(signedPath, pkgPath);
    console.log('已簽名。接下來請送公證並 staple:');
    console.log('  xcrun notarytool submit "' + pkgPath + '" --apple-id "..." --password "..." --team-id G7VUNQ8M6B --wait');
    console.log('  xcrun stapler staple "' + pkgPath + '"');
  } else {
    console.log('未簽名。若要簽名並公證 .pkg，請設定 SIGN_PKG=1 並確保已安裝 Developer ID Installer 憑證。');
  }
} finally {
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {}
}
