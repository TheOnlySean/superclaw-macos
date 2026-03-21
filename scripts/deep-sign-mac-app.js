#!/usr/bin/env node
/**
 * 對 .app 內所有可執行檔與動態庫做「由內而外」深度簽名，滿足 Apple 公證要求：
 * - 每個二進位需有 Developer ID 簽名、secure timestamp、hardened runtime。
 * 使用方式：DEEP_SIGN_APP_PATH=/path/to/App.app node scripts/deep-sign-mac-app.js
 * 或由 sign-mac-app.js 在簽主 app 前呼叫。
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const APP_PATH = process.env.DEEP_SIGN_APP_PATH
  ? path.resolve(process.env.DEEP_SIGN_APP_PATH)
  : null;
const IDENTITY = process.env.CSC_NAME || 'Developer ID Application: SEAN XIAO (G7VUNQ8M6B)';
const ROOT = path.resolve(__dirname, '..');
const ENTITLEMENTS = path.join(ROOT, 'build', 'entitlements.mac.plist');

if (!APP_PATH || !fs.existsSync(APP_PATH)) {
  console.error('請設定 DEEP_SIGN_APP_PATH 指向 .app 目錄');
  process.exit(1);
}

const contentsPath = path.join(APP_PATH, 'Contents');
if (!fs.existsSync(contentsPath)) {
  console.error('無 Contents 目錄，非有效 .app:', APP_PATH);
  process.exit(1);
}

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: opts.silent ? 'pipe' : 'inherit', ...opts });
}

// 收集要簽名的項目：由深到淺排序（先簽內層）
const toSign = [];

// 1) 所有 .framework（整個 bundle）
try {
  const out = execSync(
    `find "${contentsPath}" -type d -name "*.framework" 2>/dev/null`,
    { encoding: 'utf8' }
  );
  out.trim().split('\n').filter(Boolean).forEach((p) => toSign.push({ path: p, depth: p.split('/').length }));
} catch (_) {}

// 2) 所有巢狀 .app（Helper 等），排除最外層
const mainAppName = path.basename(APP_PATH);
try {
  const out = execSync(
    `find "${contentsPath}" -type d -name "*.app" 2>/dev/null`,
    { encoding: 'utf8' }
  );
  out.trim().split('\n').filter(Boolean).forEach((p) => {
    if (path.basename(p) !== mainAppName) toSign.push({ path: p, depth: p.split('/').length });
  });
} catch (_) {}

// 3) 所有可能是 Mach-O 的檔案：.dylib, .node, 以及可執行檔（用 file 判斷）
function addMachOFiles(dir) {
  if (!fs.existsSync(dir)) return;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        // 進入 .framework 以簽署內部的 Libraries/*.dylib、Helpers/* 等（.app 內主程式由簽整個 .app 時處理）
        if (e.name.endsWith('.app')) continue;
        addMachOFiles(full);
        continue;
      }
      if (e.name.startsWith('.')) continue;
      const ext = path.extname(e.name);
      if (ext === '.dylib' || ext === '.node') {
        toSign.push({ path: full, depth: full.split(path.sep).length });
        continue;
      }
      if (ext !== '' && !['esbuild', 'ShipIt', 'chrome_crashpad_handler', 'spawn-helper', 'Electron Framework', 'ReactiveObjC', 'Squirrel', 'Mantle'].includes(e.name)) continue;
      try {
        const fileOut = execSync(`file -b "${full}"`, { encoding: 'utf8' });
        if (/Mach-O|executable|dynamically linked/.test(fileOut)) {
          toSign.push({ path: full, depth: full.split(path.sep).length });
        }
      } catch (_) {}
    }
  } catch (_) {}
}
addMachOFiles(contentsPath);

// 依深度由大至小排序，同深度時路徑長的先（更內層）
toSign.sort((a, b) => {
  if (b.depth !== a.depth) return b.depth - a.depth;
  return b.path.length - a.path.length;
});

// 去重（同一路徑只簽一次）
const seen = new Set();
const unique = toSign.filter((x) => {
  if (seen.has(x.path)) return false;
  seen.add(x.path);
  return true;
});

const codesignBase = `codesign --force --sign "${IDENTITY}" --options runtime --timestamp`;
/** Electron 的 Contents/Frameworks/*.app（Renderer/GPU Helper 等）必須帶與主程式相同的 entitlements（含 allow-jit）。 */
const frameworksDir = path.join(contentsPath, 'Frameworks');
function needsHardenedRuntimeEntitlements(p) {
  if (!p.endsWith('.app')) return false;
  const norm = path.normalize(p);
  return norm.startsWith(frameworksDir + path.sep);
}

console.log('深度簽名：共', unique.length, '個項目（.framework / .app / .dylib / .node / 可執行檔）');
let done = 0;
for (const { path: p } of unique) {
  done++;
  if (done % 20 === 0) console.log('  ', done, '/', unique.length);
  try {
    const ent = needsHardenedRuntimeEntitlements(p) && fs.existsSync(ENTITLEMENTS)
      ? ` --entitlements "${ENTITLEMENTS}"`
      : '';
    run(`${codesignBase}${ent} "${p}"`, { silent: true });
  } catch (e) {
    console.warn('簽名跳過或失敗:', p, (e && e.message) || e);
  }
}
console.log('深度簽名完成。');
// 主 app 由呼叫方用 entitlements 簽名
module.exports = { APP_PATH, IDENTITY, ENTITLEMENTS };
