#!/usr/bin/env node
/**
 * Create DMG from dist/mac-arm64/SuperClaw.app (fallback when electron-builder DMG step fails).
 * Usage: node scripts/create-dmg.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkgVersion = (() => {
  try {
    return require(path.join(root, 'package.json')).version || '1.0.0';
  } catch {
    return '1.0.0';
  }
})();
const appDir = path.join(root, 'dist', 'mac-arm64');
const appPath = process.env.SUPERCLAW_APP_PATH
  ? path.resolve(process.env.SUPERCLAW_APP_PATH)
  : path.join(appDir, 'SuperClaw.app');
const outDmg = path.join(root, 'dist', `SuperClaw-${pkgVersion}-arm64.dmg`);
const volName = 'SuperClaw Setup';
// 暫存 DMG 放在使用者主目錄，避免 Desktop/dist 的寫入或 TCC 限制導致 hdiutil 失敗
const tmpDmg = path.join(require('os').homedir(), `superclaw-tmp-${Date.now()}.dmg`);

if (!fs.existsSync(appPath)) {
  console.error('Not found:', appPath);
  process.exit(1);
}

function run(cmd, opts = {}) {
  console.log('>', cmd);
  return execSync(cmd, { encoding: 'utf8', ...opts });
}

function detach(nameOrDev) {
  for (let i = 0; i < 3; i++) {
    try {
      run(`hdiutil detach "${nameOrDev}" -force 2>/dev/null || true`, { stdio: 'inherit' });
      run('sleep 2');
      return;
    } catch (e) {
      if (i === 2) throw e;
      run('sleep 3');
    }
  }
}

// Ensure no leftover mount
try {
  detach('/Volumes/' + volName);
} catch (_) {}
try {
  run('hdiutil info | grep "SuperClaw" | head -1', { stdio: 'pipe' });
} catch (_) {}

// Size: app is ~800MB+, use 1.5g
const size = '1500m';
console.log('Creating temporary DMG at', tmpDmg, '...');
try {
  run(`hdiutil create -volname "${volName}" -size ${size} -fs HFS+ -fsargs "-c c=0,a=0,j=0" -noscrub "${tmpDmg}"`);
} catch (e) {
  console.error('hdiutil create 失敗。請嘗試：');
  console.error('  1) 完全關閉「終端機」後重新開啟，再執行一次');
  console.error('  2) 系統設定 > 隱私權與安全性 > 完整磁碟取用：確認已勾選「終端機」');
  console.error('  3) 或改用 sudo 執行：sudo node scripts/create-dmg.js（會詢問本機密碼）');
  throw e;
}
run('sleep 1');

console.log('Attaching...');
run(`hdiutil attach "${tmpDmg}" -readwrite -noverify -noautoopen`);
run('sleep 2');
const volPath = `/Volumes/${volName.replace(/ /g, ' ')}`;
console.log('Copying app to volume...');
run(`cp -R "${appPath}" "${volPath}/"`);
run('sleep 1');

console.log('Detaching...');
detach(volPath);
run('sleep 2');

console.log('Converting to UDZO...');
if (fs.existsSync(outDmg)) fs.unlinkSync(outDmg);
run(`hdiutil convert "${tmpDmg}" -ov -format UDZO -o "${outDmg}"`);
try { fs.unlinkSync(tmpDmg); } catch (_) {}
console.log('Done:', outDmg);
