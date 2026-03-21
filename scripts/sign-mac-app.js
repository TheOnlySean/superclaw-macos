#!/usr/bin/env node
/**
 * 使用系統 codesign 對已打包的 SuperClaw.app 簽名（繞過 electron-builder 內建簽名的 isbinaryfile bug）。
 * 需已安裝 Developer ID Application 憑證。
 * 使用方式：先 npm run dist:mac:arm64:dir 產出 .app，再 node scripts/sign-mac-app.js
 * 或直接 npm run dist:mac:arm64:signed
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let PKG_VERSION = '1.0.0';
try {
  PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || PKG_VERSION;
} catch (_) {}
const MAC_ARCH = process.env.MAC_ARCH === 'x64' ? 'x64' : 'arm64';
const APP_PATH = MAC_ARCH === 'x64'
  ? path.join(ROOT, 'dist', 'mac', 'SuperClaw.app')
  : path.join(ROOT, 'dist', 'mac-arm64', 'SuperClaw.app');
const ZIP_NAME = MAC_ARCH === 'x64' ? `SuperClaw-${PKG_VERSION}-x64.zip` : `SuperClaw-${PKG_VERSION}-arm64.zip`;
const IDENTITY = 'Developer ID Application: SEAN XIAO (G7VUNQ8M6B)';
const ENTITLEMENTS = path.join(ROOT, 'build', 'entitlements.mac.plist');

if (!fs.existsSync(APP_PATH)) {
  console.error('找不到 SuperClaw.app，請先執行:', MAC_ARCH === 'x64' ? 'npm run dist:mac:x64:dir' : 'npm run dist:mac:arm64:dir');
  process.exit(1);
}
if (!fs.existsSync(ENTITLEMENTS)) {
  console.error('找不到 build/entitlements.mac.plist');
  process.exit(1);
}

// 若設 SIGN_IN_PLACE=1：直接在 dist 內清除 xattr 並簽名（需在「終端機」執行且授予完整磁碟取用，簽名後不會被系統再加 provenance）。
// 否則：複製到 /tmp 簽名再移回；移回後系統可能重新加上 com.apple.provenance 導致簽名無效，僅供測試。
const SIGN_IN_PLACE = process.env.SIGN_IN_PLACE === '1' || process.env.SIGN_IN_PLACE === 'true';

if (SIGN_IN_PLACE) {
  console.log('就地簽名模式（SIGN_IN_PLACE=1）：請由「終端機」執行，並在 系統設定 > 隱私權與安全性 > 完整磁碟取用 加入「終端機」。\n');
  const appDir = path.dirname(APP_PATH);
  const inPlaceClean = path.join(appDir, 'SuperClaw-clean.app');
  console.log('步驟 1/4：ditto --norsrc 複製一份以去除 resource fork…');
  try {
    execSync(`ditto --norsrc "${APP_PATH}" "${inPlaceClean}"`, { stdio: 'inherit', cwd: ROOT });
    execSync(`rm -rf "${APP_PATH}"`, { stdio: 'inherit', cwd: ROOT });
    execSync(`mv "${inPlaceClean}" "${APP_PATH}"`, { stdio: 'inherit', cwd: ROOT });
  } catch (e) {
    console.error('ditto 失敗:', (e && e.message) || e);
    if (fs.existsSync(inPlaceClean)) try { execSync(`rm -rf "${inPlaceClean}"`, { stdio: 'pipe' }); } catch (_) {}
    process.exit(1);
  }
  console.log('步驟 2/4：清除擴展屬性 (xattr -cr)…');
  try {
    execSync(`/usr/bin/xattr -cr "${APP_PATH}"`, { stdio: 'inherit', cwd: ROOT });
  } catch (e) {
    console.error('xattr -cr 失敗（請用「終端機」執行並授予完整磁碟取用）:', (e && e.message) || e);
    process.exit(1);
  }
  console.log('步驟 3/4：dot_clean 並移除 ._* …');
  try { execSync(`dot_clean -m "${APP_PATH}"`, { stdio: 'pipe' }); } catch (_) {}
  try { execSync(`find "${APP_PATH}" -type f -name '._*' -delete`, { stdio: 'pipe' }); } catch (_) {}
  console.log('步驟 4/4：codesign 簽名…');
  try {
    execSync(
      `codesign --force --sign "${IDENTITY}" --options runtime --entitlements "${ENTITLEMENTS}" "${APP_PATH}"`,
      { stdio: 'inherit', cwd: ROOT }
    );
    console.log('簽名完成。');
  } catch (e) {
    console.error('簽名失敗:', e.message || e);
    process.exit(1);
  }
  try {
    execSync(`codesign -v --deep --strict "${APP_PATH}"`, { stdio: 'pipe' });
    console.log('驗證通過：codesign -v --deep --strict 成功。');
  } catch (_) {
    console.warn('\n驗證未通過（簽名後可能被系統重新加上擴展屬性）。請改在「終端機」執行本指令，並在 系統設定 > 隱私權與安全性 > 完整磁碟取用 中加入「終端機」後再執行一次。');
  }
  process.exit(0);
}

// 預設：在 /tmp 簽名再移回（移回後可能被加 provenance 導致驗證失敗，見上方說明）
const tmpApp = path.join('/tmp', `SuperClaw-sign-${process.pid}.app`);

function rmTmp() {
  try {
    if (fs.existsSync(tmpApp)) execSync(`rm -rf "${tmpApp}"`, { stdio: 'pipe' });
  } catch (_) {}
}

console.log('步驟 1/5：以 rsync 複製到 /tmp（不帶 xattr、保留符號連結）…');
try {
  rmTmp();
  execSync(`mkdir -p "${tmpApp}"`, { stdio: 'pipe' });
  execSync(`rsync -rlptgoD "${APP_PATH}/" "${tmpApp}/"`, { stdio: 'inherit', cwd: ROOT });
} catch (e) {
  console.error('rsync 失敗:', e.message || e);
  rmTmp();
  process.exit(1);
}

console.log('步驟 2/5：dot_clean 並移除 ._* …');
try {
  execSync(`dot_clean -m "${tmpApp}"`, { stdio: 'pipe' });
} catch (_) {}
try {
  execSync(`find "${tmpApp}" -type f -name '._*' -delete`, { stdio: 'pipe' });
} catch (_) {}

console.log('步驟 3/5：清除殘留擴展屬性（若有）…');
try {
  execSync(`/usr/bin/xattr -cr "${tmpApp}"`, { stdio: 'pipe' });
} catch (_) {}

console.log('步驟 4/5：深度簽名（.framework / Helper .app / .dylib / .node，供公證）…');
try {
  execSync(`DEEP_SIGN_APP_PATH="${tmpApp}" CSC_NAME="${IDENTITY}" node "${path.join(ROOT, 'scripts', 'deep-sign-mac-app.js')}"`, { stdio: 'inherit', cwd: ROOT });
} catch (e) {
  console.warn('深度簽名有項目失敗（繼續簽主 app）:', (e && e.message) || e);
}
console.log('步驟 5/5：簽名主 .app…');
const appDir = path.dirname(APP_PATH);
const signedPlaceholder = path.join(appDir, 'SuperClaw-signed.app');
try {
  execSync(
    `codesign --force --sign "${IDENTITY}" --options runtime --timestamp --entitlements "${ENTITLEMENTS}" "${tmpApp}"`,
    { stdio: 'inherit', cwd: ROOT }
  );
  console.log('簽名完成。');
  try {
    execSync(`codesign -v --deep --strict "${tmpApp}"`, { stdio: 'pipe' });
    console.log('驗證通過（/tmp 內簽名有效）。');
  } catch (_) {}
  console.log('從 /tmp 已簽名 .app 製作 DMG…');
  let dmgOk = false;
  try {
    execSync(`SUPERCLAW_APP_PATH="${tmpApp}" node "${path.join(ROOT, 'scripts', 'create-dmg.js')}"`, { stdio: 'inherit', cwd: ROOT });
    dmgOk = true;
  } catch (e) {
    console.warn('DMG 製作失敗（本機 hdiutil 受限制）。改產 ZIP 分發檔（不需 hdiutil）…');
    try {
      execSync(`MAC_ARCH="${MAC_ARCH}" SUPERCLAW_APP_PATH="${tmpApp}" node "${path.join(ROOT, 'scripts', 'create-zip.js')}"`, { stdio: 'inherit', cwd: ROOT });
      console.log('已產出 dist/' + ZIP_NAME + '（內為已簽名 .app，可直接分發）。');
    } catch (zipErr) {
      console.warn('ZIP 產出失敗:', (zipErr && zipErr.message) || zipErr);
      console.warn('已簽名 .app 仍在:', tmpApp);
    }
  }
  if (dmgOk) {
    console.log('替換 dist 內 .app…');
    execSync(`mv "${tmpApp}" "${signedPlaceholder}"`, { stdio: 'inherit', cwd: ROOT });
    execSync(`rm -rf "${APP_PATH}"`, { stdio: 'inherit', cwd: ROOT });
    execSync(`mv "${signedPlaceholder}" "${APP_PATH}"`, { stdio: 'inherit', cwd: ROOT });
    console.log('全部完成。DMG 內的 .app 為有效簽名。');
  } else {
    console.log('替換 dist 內 .app…');
    execSync(`mv "${tmpApp}" "${signedPlaceholder}"`, { stdio: 'inherit', cwd: ROOT });
    execSync(`rm -rf "${APP_PATH}"`, { stdio: 'inherit', cwd: ROOT });
    execSync(`mv "${signedPlaceholder}" "${APP_PATH}"`, { stdio: 'inherit', cwd: ROOT });
    console.log('簽名完成。分發檔請使用 dist/' + ZIP_NAME + '。');
  }
} catch (e) {
  rmTmp();
  if (fs.existsSync(signedPlaceholder)) try { execSync(`rm -rf "${signedPlaceholder}"`, { stdio: 'pipe' }); } catch (_) {}
  console.error('簽名失敗:', e.message || e);
  process.exit(1);
}
