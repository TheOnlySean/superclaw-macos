#!/usr/bin/env node
/**
 * 將已簽名 .app 打包成 zip 供分發（不需 hdiutil，避開 Operation not permitted）。
 * 使用方式：SUPERCLAW_APP_PATH=/tmp/SuperClaw-sign-xxx.app node scripts/create-zip.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let pkgVersion = '1.0.0';
try {
  pkgVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || pkgVersion;
} catch (_) {}
const isX64 = process.env.MAC_ARCH === 'x64';
const defaultApp = isX64 ? path.join(root, 'dist', 'mac', 'SuperClaw.app') : path.join(root, 'dist', 'mac-arm64', 'SuperClaw.app');
const appPath = process.env.SUPERCLAW_APP_PATH ? path.resolve(process.env.SUPERCLAW_APP_PATH) : defaultApp;
const defaultZip = isX64 ? path.join(root, 'dist', `SuperClaw-${pkgVersion}-x64.zip`) : path.join(root, 'dist', `SuperClaw-${pkgVersion}-arm64.zip`);
const outZip = process.env.CREATED_ZIP_PATH ? path.resolve(process.env.CREATED_ZIP_PATH) : defaultZip;

if (!fs.existsSync(appPath)) {
  console.error('找不到 .app:', appPath);
  process.exit(1);
}

// 確保 dist 存在
const distDir = path.dirname(outZip);
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

if (fs.existsSync(outZip)) fs.unlinkSync(outZip);

console.log('打包 zip:', appPath, '->', outZip);
// ditto -c -k --keepParent 可保留 .app 結構，產出標準 zip
execSync(`ditto -c -k --keepParent "${appPath}" "${outZip}"`, { stdio: 'inherit' });
console.log('完成:', outZip);
