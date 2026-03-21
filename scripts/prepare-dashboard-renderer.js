#!/usr/bin/env node
/**
 * 打包前准备 dashboard-renderer：
 * 1) 移除所有腾讯/QQ/微信相关请求与上报（见 strip-tencent-from-dashboard.js）
 * 2) 将应用图标复制到 assets
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'build', 'icons', 'icon-512.png');
const dest = path.join(root, 'dashboard-renderer', 'assets', 'superclaw-icon.png');

if (!fs.existsSync(path.join(root, 'dashboard-renderer', 'assets'))) {
  console.log('prepare-dashboard-renderer: no dashboard-renderer/assets, skip');
  process.exit(0);
}

require('./strip-tencent-from-dashboard.js');

if (!fs.existsSync(src)) {
  console.log('prepare-dashboard-renderer: no build/icons/icon-512.png, skip');
  process.exit(0);
}
fs.copyFileSync(src, dest);
console.log('prepare-dashboard-renderer: copied icon to dashboard-renderer/assets/superclaw-icon.png');
