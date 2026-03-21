#!/usr/bin/env node
/**
 * 公證通過後：解壓 zip → 對內部的 .app 執行 stapler staple → 重新壓縮。
 * 這樣使用者在別台 Mac 解壓後雙擊 .app 才不會再出現「會損害您的 Mac」。
 *
 * 用法：node scripts/staple-and-rezip.js [zip路徑]
 * 若不傳參數，會處理 dist/SuperClaw-1.0.0-arm64.zip 與 dist/SuperClaw-1.0.0-x64.zip。
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_ZIPS = [
  path.join(ROOT, 'dist', 'SuperClaw-1.0.0-arm64.zip'),
  path.join(ROOT, 'dist', 'SuperClaw-1.0.0-x64.zip'),
];

function stapleAndRezip(zipPath) {
  zipPath = path.resolve(zipPath);
  if (!fs.existsSync(zipPath)) {
    console.warn('跳過（不存在）:', zipPath);
    return;
  }
  const zipName = path.basename(zipPath);
  const workDir = path.join(os.tmpdir(), `staple-rezip-${Date.now()}`);
  fs.mkdirSync(workDir, { recursive: true });
  try {
    console.log('處理:', zipName);
    execSync(`unzip -q -o "${zipPath}" -d "${workDir}"`, { stdio: 'pipe' });
    const topLevel = fs.readdirSync(workDir);
    const appDir = topLevel.find((n) => n.endsWith('.app') && fs.statSync(path.join(workDir, n)).isDirectory());
    if (!appDir) {
      console.error('zip 內找不到 .app，跳過:', zipPath);
      return;
    }
    const appPath = path.join(workDir, appDir);
    console.log('  staple 到:', appDir);
    execSync(`xcrun stapler staple "${appPath}"`, { stdio: 'inherit' });
    // 統一命名為 SuperClaw.app，避免出現 SuperClaw-sign-xxxxx.app
    const finalAppName = 'SuperClaw.app';
    const finalAppPath = path.join(workDir, finalAppName);
    if (appDir !== finalAppName) {
      if (fs.existsSync(finalAppPath)) fs.rmSync(finalAppPath, { recursive: true });
      fs.renameSync(appPath, finalAppPath);
    }
    // 在 zip 內加入簡短說明（若使用者仍遇到安全提示可依說明操作）
    const readmePath = path.join(workDir, '首次打開說明.txt');
    fs.writeFileSync(
      readmePath,
      '若首次雙擊出現「無法打開」或安全提示，請在 SuperClaw 上按右鍵 → 選擇「打開」→ 再點「打開」即可。之後即可正常雙擊使用。\n',
      'utf8'
    );
    const outZip = zipPath;
    if (fs.existsSync(outZip)) fs.unlinkSync(outZip);
    console.log('  重新壓縮（內容為', finalAppName, ' + 說明）->', outZip);
    execSync(`cd "${workDir}" && zip -r -y "${outZip}" "${finalAppName}" "首次打開說明.txt"`, { stdio: 'pipe' });
    console.log('  完成:', zipName);
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {}
  }
}

const zips = process.argv[2] ? [path.resolve(process.argv[2])] : DEFAULT_ZIPS;
zips.forEach(stapleAndRezip);
