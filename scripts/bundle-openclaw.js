#!/usr/bin/env node
/**
 * Bundle openclaw@latest into ./openclaw for embedding in the app (Qclaw-style).
 * Run before pack/dist. Output: openclaw/openclaw.mjs, openclaw/package.json, openclaw/node_modules, ...
 * When TARGET_ARCH=arm64 (e.g. from dist:mac:arm64), also installs darwin-arm64 native binding so Intel Macs can build DMGs that run on Apple Silicon.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const rootDir = path.join(__dirname, '..');
const outDir = path.join(rootDir, 'openclaw');
const packDir = path.join(os.tmpdir(), `openclaw-pack-${Date.now()}`);
const { patchControlUiCsp } = require('./patch-control-ui-csp');

// 已有 openclaw 且未强制重打时跳过，避免每次打包都重新 npm pack + npm install（耗时数分钟）
const forceBundle = process.env.FORCE_OPENCLAW_BUNDLE === '1' || process.env.FORCE_OPENCLAW_BUNDLE === 'true';
const hasExisting = fs.existsSync(outDir) &&
  fs.existsSync(path.join(outDir, 'package.json')) &&
  fs.existsSync(path.join(outDir, 'node_modules'));
if (hasExisting && !forceBundle) {
  console.log('openclaw already bundled at', outDir, '(skip). Set FORCE_OPENCLAW_BUNDLE=1 to re-bundle.');
  patchControlUiCsp(outDir);
  console.log('Done. OpenClaw at', outDir);
  process.exit(0);
}

console.log('Bundling openclaw@latest...');
fs.mkdirSync(packDir, { recursive: true });
process.chdir(packDir);

execSync('npm pack openclaw@latest', { stdio: 'inherit' });
const tgz = fs.readdirSync(packDir).find((f) => f.endsWith('.tgz'));
if (!tgz) throw new Error('npm pack did not produce a tgz');
execSync(`tar -xzf "${tgz}"`, { stdio: 'inherit' });
const pkgDir = fs.readdirSync(packDir).find((f) => f.startsWith('package'));
if (!pkgDir) throw new Error('No package dir in tarball');
const srcDir = path.join(packDir, pkgDir);

if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });
for (const name of fs.readdirSync(srcDir)) {
  const src = path.join(srcDir, name);
  const dest = path.join(outDir, name);
  fs.cpSync(src, dest, { recursive: true });
}
process.chdir(outDir);
// Remove lockfile so npm resolves optional deps for *this* platform (e.g. davey-darwin-arm64 on M1).
// Building for arm64 DMG must run on an arm64 Mac so optional native bindings match.
try { fs.unlinkSync(path.join(outDir, 'package-lock.json')); } catch (_) {}
console.log('Running npm install in bundle (optional deps for current arch)...');
execSync('npm install --omit=dev --include=optional', { stdio: 'inherit' });
// On Intel Mac building for arm64 DMG: add darwin-arm64 native binding so the bundle works on M-chip (npm only installed darwin-x64).
const targetArch = process.env.TARGET_ARCH || '';
if (process.platform === 'darwin' && targetArch === 'arm64') {
  const daveyPkg = path.join(outDir, 'node_modules', '@snazzah', 'davey', 'package.json');
  if (fs.existsSync(daveyPkg)) {
    const version = require(daveyPkg).optionalDependencies?.['@snazzah/davey-darwin-arm64'] || '0.1.10';
    console.log('Adding darwin-arm64 native binding for M-chip (version ' + version + ')...');
    execSync(`npm install @snazzah/davey-darwin-arm64@${version} --no-save --force`, { stdio: 'inherit', cwd: outDir });
  }
}
fs.rmSync(packDir, { recursive: true, force: true });

// Shrink bundle: remove docs, source maps, tests, lockfile from node_modules
console.log('Shrinking openclaw bundle...');
const nm = path.join(outDir, 'node_modules');
const toDelete = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (name === 'test' || name === 'tests' || name === 'docs' || name === '__tests__') {
        toDelete.push(full);
      } else {
        walk(full);
      }
    } else {
      if (name.endsWith('.md') || name.endsWith('.map') || name === 'LICENSE' || name === 'README' || name === 'CHANGELOG') {
        toDelete.push(full);
      }
    }
  }
}
walk(nm);
for (const f of toDelete) {
  try { fs.rmSync(f, { recursive: true, force: true }); } catch (_) {}
}
try { fs.unlinkSync(path.join(outDir, 'package-lock.json')); } catch (_) {}

// Patch: extend OpenAI Codex OAuth callback wait from 60s to 10min so slow logins still hit the local server
const codexOauth = path.join(outDir, 'node_modules', '@mariozechner', 'pi-ai', 'dist', 'utils', 'oauth', 'openai-codex.js');
if (fs.existsSync(codexOauth)) {
  let code = fs.readFileSync(codexOauth, 'utf8');
  code = code.replace(/for \(let i = 0; i < 600; i \+= 1\)/, 'for (let i = 0; i < 6000; i += 1)');
  fs.writeFileSync(codexOauth, code);
  console.log('Patched openai-codex.js: callback wait 60s -> 10min');
}

patchControlUiCsp(outDir);
console.log('Done. Bundled openclaw at', outDir);
