#!/usr/bin/env node
/**
 * 讀取公證相關終端輸出，彙總 arm64 / x64 公證狀態。
 * 用法：node scripts/check-notarize-status.js
 * 可搭配每 5 分鐘輪詢：while true; do node scripts/check-notarize-status.js; sleep 300; done
 */
const fs = require('fs');
const path = require('path');

const TERMINALS_DIR = process.env.NOTARIZE_TERMINALS_DIR ||
  path.join(process.env.HOME || '', '.cursor', 'projects', 'Users-x-sean-Desktop-JapanClaw', 'terminals');
const ARM64_FILE = path.join(TERMINALS_DIR, '752932.txt');
const X64_FILE = path.join(TERMINALS_DIR, '555863.txt');

function readTerminal(name, filePath) {
  const out = { name, running: false, seconds: null, exitCode: null, accepted: false, invalid: false, error: null, raw: '' };
  if (!fs.existsSync(filePath)) {
    out.error = '終端檔案不存在';
    return out;
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  out.raw = raw;
  const runMatch = raw.match(/running_for_seconds:\s*(\d+)/);
  if (runMatch) out.seconds = parseInt(runMatch[1], 10);
  const exitMatch = raw.match(/exit_code:\s*(\d+)/);
  if (exitMatch) {
    out.exitCode = parseInt(exitMatch[1], 10);
    out.running = false;
  } else if (runMatch) {
    out.running = true;
  }
  if (/status:\s*Accepted/i.test(raw)) out.accepted = true;
  if (/status:\s*Invalid/i.test(raw)) out.invalid = true;
  if (/Error:|錯誤|失敗|無法判斷/.test(raw) && !out.accepted) out.error = raw.match(/Error:[^\n]+|錯誤[^\n]+|失敗[^\n]+|無法判斷[^\n]+/)?.[0] || '有錯誤輸出';
  return out;
}

const now = new Date().toISOString();
console.log('--- 公證狀態', now, '---\n');

const arm = readTerminal('arm64', ARM64_FILE);
const x64 = readTerminal('x64', X64_FILE);

function report(label, t) {
  if (t.error && !t.running) {
    console.log(label + ': 異常/已結束');
    if (t.exitCode !== null) console.log('  exit_code:', t.exitCode);
    if (t.error) console.log('  ', t.error);
    if (t.invalid) console.log('  公證結果: Invalid');
    if (t.accepted) console.log('  公證結果: Accepted');
  } else if (t.running) {
    console.log(label + ': 進行中 (已運行 ' + (t.seconds != null ? Math.floor(t.seconds / 60) + ' 分鐘' : '?') + ')');
  } else {
    console.log(label + ': 已結束');
    if (t.exitCode !== null) console.log('  exit_code:', t.exitCode);
    if (t.accepted) console.log('  公證結果: Accepted ✓');
    if (t.invalid) console.log('  公證結果: Invalid');
  }
  console.log('');
}

report('arm64 (752932)', arm);
report('x64 (555863)', x64);

if (arm.accepted && x64.accepted) {
  console.log('兩邊公證均已通過。');
  process.exit(0);
}
if (arm.invalid || x64.invalid || (arm.exitCode === 1) || (x64.exitCode === 1)) {
  process.exit(1);
}
