#!/usr/bin/env node
/**
 * 用已提取的 QClaw Control UI 覆盖 control-ui-ja，仅改标题为 SuperClaw。
 * 使用方式：node scripts/use-qclaw-control-ui.js
 * 前提：docs/qclaw-reference/qclaw-control-ui-extract/ 已存在（从 QClaw DMG 提取）。
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const extractDir = path.join(root, 'docs', 'qclaw-reference', 'qclaw-control-ui-extract');
const targetDir = path.join(root, 'control-ui-ja');

if (!fs.existsSync(extractDir)) {
  console.error('未找到 QClaw 提取目录:', extractDir);
  console.error('请先挂载 QClaw DMG 并执行提取（见 docs/qclaw-reference/QCLAW-CONTROL-UI-EXTRACT.md）。');
  process.exit(1);
}

if (!fs.existsSync(path.join(extractDir, 'index.html'))) {
  console.error('提取目录中缺少 index.html');
  process.exit(1);
}

// 清空并创建 control-ui-ja
if (fs.existsSync(targetDir)) {
  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(targetDir, e.name);
    if (e.isDirectory()) fs.rmSync(p, { recursive: true });
    else fs.unlinkSync(p);
  }
} else {
  fs.mkdirSync(targetDir, { recursive: true });
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

for (const name of fs.readdirSync(extractDir)) {
  copyRecursive(path.join(extractDir, name), path.join(targetDir, name));
}

// 把 index.html 标题改为 SuperClaw
const indexPath = path.join(targetDir, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
html = html.replace(/<title>OpenClaw Control<\/title>/, '<title>SuperClaw</title>');
fs.writeFileSync(indexPath, html, 'utf8');

console.log('已用 QClaw 提取的 Control UI 覆盖 control-ui-ja，标题已改为 SuperClaw。');
console.log('可执行 npm run dist:mac:arm64 打包。');
