#!/usr/bin/env node
/**
 * Download Node.js v22 LTS for darwin-arm64 and place bin/node in node-runtime/darwin-arm64/
 * OpenClaw / Qwen 等需要 Node 22.16+；Electron 内嵌 Node 18，故同梱 Node 22 以运行 openclaw。
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const NODE_VERSION = 'v22.16.0';
const SUPPORTED = ['darwin-arm64', 'darwin-x64'];
const forcePlatform = process.argv[2];
const PLATFORM = SUPPORTED.includes(forcePlatform) ? forcePlatform : 'darwin-arm64';
const TARBALL = `node-${NODE_VERSION}-${PLATFORM}.tar.gz`;
const URL = `https://nodejs.org/dist/${NODE_VERSION}/${TARBALL}`;
const rootDir = path.join(__dirname, '..');
const outDir = path.join(rootDir, 'node-runtime', PLATFORM);
const workDir = path.join(os.tmpdir(), `node-runtime-${Date.now()}`);

const needRun = forcePlatform ? SUPPORTED.includes(forcePlatform) : (process.platform === 'darwin' && process.arch === 'arm64');
if (!needRun) {
  if (!forcePlatform) console.log('Skipping Node runtime. Use: node prepare-node-runtime.js darwin-arm64|darwin-x64 to force.');
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });
if (fs.existsSync(path.join(outDir, 'node'))) {
  console.log('Node runtime already at', outDir);
  process.exit(0);
}

console.log('Downloading', URL, '...');
fs.mkdirSync(workDir, { recursive: true });
try {
  execSync(`curl -fsSL -o "${path.join(workDir, TARBALL)}" "${URL}"`, {
    stdio: 'inherit',
    timeout: 120000,
  });
  execSync(`tar -xzf "${path.join(workDir, TARBALL)}" -C "${workDir}"`, { stdio: 'inherit' });
  const extracted = fs.readdirSync(workDir).find((n) => n.startsWith('node-'));
  const nodeBin = path.join(workDir, extracted, 'bin', 'node');
  if (!fs.existsSync(nodeBin)) throw new Error('node binary not found');
  fs.copyFileSync(nodeBin, path.join(outDir, 'node'));
  fs.chmodSync(path.join(outDir, 'node'), 0o755);
  console.log('Done. Node at', path.join(outDir, 'node'));
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}
