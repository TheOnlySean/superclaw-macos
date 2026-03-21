/**
 * Node.js をユーザー環境にインストールする。
 * - macOS: まず Homebrew があれば brew install node、なければ公式 LTS .pkg をダウンロードして開く。
 * - Windows: winget install OpenJS.NodeJS.LTS（または公式 .msi をダウンロードして実行）。
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const NODE_DIST_INDEX = 'https://nodejs.org/dist/index.json';
const NODE_DIST_BASE = 'https://nodejs.org/dist';

function send(mainWindow, event, data) {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents) return;
  try {
    mainWindow.webContents.send(event, data);
  } catch (_) {}
}

/** index.json から最新 LTS の version 文字列（例: v22.22.1）を取得 */
function fetchLatestLtsVersion() {
  return new Promise((resolve, reject) => {
    https.get(NODE_DIST_INDEX, { timeout: 15000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const list = JSON.parse(body);
          const lts = list.find((e) => e.lts);
          if (!lts || !lts.version) {
            reject(new Error('No LTS version found'));
            return;
          }
          resolve(lts.version);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

/** 指定 URL を destPath にダウンロード。進捗を onProgress(percent) で通知 */
function downloadFile(url, destPath, mainWindow, channel = 'node-install-log') {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, { timeout: 60000 }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        const loc = res.headers.location;
        file.close();
        fs.unlinkSync(destPath);
        return downloadFile(loc, destPath, mainWindow, channel).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const total = parseInt(res.headers['content-length'], 10) || 0;
      let done = 0;
      res.on('data', (chunk) => {
        done += chunk.length;
        if (total > 0) {
          const pct = Math.min(100, Math.round((done / total) * 100));
          send(mainWindow, channel, { type: 'progress', percent: pct, text: `ダウンロード中 ${pct}%` });
        }
      });
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        send(mainWindow, channel, { type: 'stdout', text: 'ダウンロード完了。インストーラを開いています…' });
        resolve();
      });
    }).on('error', (err) => {
      file.close();
      try { fs.unlinkSync(destPath); } catch (_) {}
      reject(err);
    });
  });
}

/** macOS: Homebrew で node をインストール */
function installNodeViaBrew(mainWindow, channel) {
  return new Promise((resolve, reject) => {
    const shell = process.env.SHELL || '/bin/zsh';
    const child = spawn(shell, ['-l', '-c', 'brew install node'], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const sendLog = (type, text) => send(mainWindow, channel, { type, text });
    child.stdout.on('data', (c) => sendLog('stdout', c.toString()));
    child.stderr.on('data', (c) => sendLog('stderr', c.toString()));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Exit ${code} ${signal || ''}`));
    });
  });
}

/** macOS: 公式 .pkg をダウンロードして開く（ユーザーがインストーラで完了する） */
async function installNodeViaPkg(mainWindow, channel) {
  const version = await fetchLatestLtsVersion();
  const pkgName = `node-${version}.pkg`;
  const url = `${NODE_DIST_BASE}/${version}/${pkgName}`;
  const destPath = path.join(os.tmpdir(), pkgName);
  send(mainWindow, channel, { type: 'stdout', text: `Node.js ${version} を取得しています…` });
  await downloadFile(url, destPath, mainWindow, channel);
  return new Promise((resolve, reject) => {
    const child = spawn('open', [destPath], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        send(mainWindow, channel, { type: 'stdout', text: 'インストーラを開きました。画面の案内に従ってインストールを完了してください。' });
        resolve();
      } else reject(new Error(`open exited ${code}`));
    });
  });
}

/** Windows: winget で Node LTS をインストール */
function installNodeViaWinget(mainWindow, channel) {
  return new Promise((resolve, reject) => {
    const child = spawn('winget', [
      'install', 'OpenJS.NodeJS.LTS',
      '--accept-package-agreements',
      '--accept-source-agreements',
      '--silent',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });
    const sendLog = (type, text) => send(mainWindow, channel, { type, text });
    child.stdout.on('data', (c) => sendLog('stdout', c.toString()));
    child.stderr.on('data', (c) => sendLog('stderr', c.toString()));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Exit ${code} ${signal || ''}`));
    });
  });
}

/** Windows: 公式 .msi をダウンロードして実行 */
async function installNodeViaMsi(mainWindow, channel) {
  const version = await fetchLatestLtsVersion();
  const msiName = `node-${version}-x64.msi`;
  const url = `${NODE_DIST_BASE}/${version}/${msiName}`;
  const destPath = path.join(os.tmpdir(), msiName);
  send(mainWindow, channel, { type: 'stdout', text: `Node.js ${version} を取得しています…` });
  await downloadFile(url, destPath, mainWindow, channel);
  return new Promise((resolve, reject) => {
    const child = spawn('msiexec', ['/i', destPath, '/passive'], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`msiexec exited ${code}`));
    });
  });
}

/**
 * Node をインストールする。mainWindow に node-install-log で進捗を送る。
 * @returns {{ ok: boolean, error?: string }}
 */
async function run(mainWindow) {
  const channel = 'node-install-log';
  try {
    if (process.platform === 'darwin') {
      try {
        const { execSync } = require('child_process');
        execSync('brew --version', { encoding: 'utf8', timeout: 3000 });
        send(mainWindow, channel, { type: 'stdout', text: 'Homebrew で Node をインストールしています…' });
        await installNodeViaBrew(mainWindow, channel);
      } catch (_) {
        send(mainWindow, channel, { type: 'stdout', text: 'Homebrew がないため、公式インストーラをダウンロードします。' });
        await installNodeViaPkg(mainWindow, channel);
      }
    } else if (process.platform === 'win32') {
      try {
        const { execSync } = require('child_process');
        execSync('winget --version', { encoding: 'utf8', timeout: 3000 });
        send(mainWindow, channel, { type: 'stdout', text: 'winget で Node LTS をインストールしています…' });
        await installNodeViaWinget(mainWindow, channel);
      } catch (_) {
        send(mainWindow, channel, { type: 'stdout', text: 'winget がないため、公式インストーラをダウンロードします。' });
        await installNodeViaMsi(mainWindow, channel);
      }
    } else {
      return { ok: false, error: 'この OS ではアプリ内インストールに対応していません。' };
    }
    return { ok: true };
  } catch (e) {
    send(mainWindow, channel, { type: 'stderr', text: e.message || String(e) });
    return { ok: false, error: e.message || String(e) };
  }
}

module.exports = { run };
