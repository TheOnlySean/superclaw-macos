/**
 * GitHub Releases + electron-updater：打包后检查更新。
 * 开发模式（未打包）不检查。可设 SUPERCLAW_DISABLE_AUTO_UPDATE=1 关闭。
 */
'use strict';

const { app, dialog } = require('electron');

let started = false;

function formatReleaseNotes(info) {
  const n = info && info.releaseNotes;
  if (n == null) return '';
  if (Array.isArray(n)) {
    return n
      .map((item) => (typeof item === 'string' ? item : (item && (item.note || item.body)) || ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return String(n).trim();
}

function appendDebugLog(payload) {
  try {
    const path = require('path');
    const fs = require('fs');
    const logPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.superclaw-setup-debug.log');
    fs.appendFileSync(logPath, JSON.stringify({ ...payload, timestamp: Date.now() }) + '\n');
  } catch (_) {}
}

/**
 * @param {{ getMainWindow: () => import('electron').BrowserWindow | null }} opts
 */
function initAutoUpdater(opts) {
  if (started) return;
  started = true;

  if (!app.isPackaged) return;
  if (process.env.SUPERCLAW_DISABLE_AUTO_UPDATE === '1') return;
  if (process.platform !== 'darwin' && process.platform !== 'win32') return;

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    appendDebugLog({ event: 'autoUpdater-load-failed', message: String(e && e.message) });
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.allowPrerelease = false;

  const parentWindow = () => {
    const get = opts && opts.getMainWindow;
    if (typeof get !== 'function') return null;
    try {
      const w = get();
      return w && !w.isDestroyed() ? w : null;
    } catch (_) {
      return null;
    }
  };

  autoUpdater.on('error', (err) => {
    appendDebugLog({ event: 'autoUpdater-error', message: String(err && err.message), stack: err && err.stack });
  });

  autoUpdater.on('update-available', async (info) => {
    const ver = (info && info.version) || '';
    const detail = formatReleaseNotes(info).slice(0, 4000);
    const { response } = await dialog.showMessageBox(parentWindow() || undefined, {
      type: 'info',
      buttons: ['稍后再说', '下载更新'],
      defaultId: 1,
      cancelId: 0,
      title: 'SuperClaw 更新',
      message: `发现新版本 ${ver}，是否下载？`,
      detail: detail || undefined,
    });
    if (response === 1) {
      autoUpdater.downloadUpdate().catch((e) => {
        appendDebugLog({ event: 'autoUpdater-download-failed', message: String(e && e.message) });
      });
    }
  });

  autoUpdater.on('update-downloaded', async (info) => {
    const ver = (info && info.version) || '';
    const { response } = await dialog.showMessageBox(parentWindow() || undefined, {
      type: 'info',
      buttons: ['稍后重启', '立即重启并安装'],
      defaultId: 1,
      cancelId: 0,
      title: 'SuperClaw 更新',
      message: `版本 ${ver} 已下载完成，是否立即重启安装？`,
    });
    if (response === 1) {
      autoUpdater.quitAndInstall(false, true);
    }
  });

  const check = () => {
    autoUpdater.checkForUpdates().catch((e) => {
      appendDebugLog({ event: 'autoUpdater-check-failed', message: String(e && e.message) });
    });
  };

  // 避免拖慢冷启动：延迟首次检查
  setTimeout(check, 8000);
  setInterval(check, 24 * 60 * 60 * 1000);
}

module.exports = { initAutoUpdater };
