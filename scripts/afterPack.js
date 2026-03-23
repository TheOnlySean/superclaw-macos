/**
 * electron-builder afterPack：在打包好的 .app 内对 openclaw 再打一次 CSP 补丁，确保安装后 Dashboard 不被 CSP 拦截。
 * 並用 ditto --norsrc 複製一份以去除 resource fork，方便後續 Developer ID 簽名。
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { patchControlUiCsp } = require('./patch-control-ui-csp');
const { patchOpenclawMjs } = require('./patch-openclaw-bootstrap');

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const productFilename = context.packager.appInfo.productFilename; // SuperClaw
  const appPath = path.join(appOutDir, `${productFilename}.app`);
  const openclawDir = path.join(appPath, 'Contents', 'Resources', 'openclaw');
  const entryJs = path.join(openclawDir, 'dist', 'entry.js');
  const entryMjs = path.join(openclawDir, 'dist', 'entry.mjs');
  if (!fs.existsSync(entryJs) && !fs.existsSync(entryMjs)) {
    throw new Error(
      `[afterPack] openclaw 缺少 dist/entry.js：請在 japanclaw-setup 目錄執行 npm run prepare-openclaw（勿在無 dist 的殘缺 openclaw 上跳過打包）。`,
    );
  }
  const openclawMjs = path.join(openclawDir, 'openclaw.mjs');
  patchOpenclawMjs(openclawMjs);
  console.log('[afterPack] Patching Control UI CSP in:', openclawDir);
  patchControlUiCsp(openclawDir);
  const appClean = path.join(appOutDir, `${productFilename}-clean.app`);
  if (fs.existsSync(appPath)) {
    try {
      execSync(`ditto --norsrc "${appPath}" "${appClean}"`, { stdio: 'pipe' });
      execSync(`rm -rf "${appPath}"`, { stdio: 'pipe' });
      execSync(`mv "${appClean}" "${appPath}"`, { stdio: 'pipe' });
      console.log('[afterPack] 已用 ditto --norsrc 去除 resource fork，便於簽名。');
    } catch (e) {
      console.warn('[afterPack] ditto 清理跳過:', (e && e.message) || e);
    }
  }
};
