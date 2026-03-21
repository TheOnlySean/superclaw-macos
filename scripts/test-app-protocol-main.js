/**
 * 最小复现：仅注册 app:// 协议并打开 app://dashboard/index.html，
 * 用于在本地用 Terminal 跑 electron 验证是否白屏（不依赖完整 SuperClaw 主进程）。
 * 运行：cd japanclaw-setup && npx electron scripts/test-app-protocol-main.js
 */
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, protocol } = require('electron');

const APP_PROTOCOL_HOST = 'dashboard';
const BASE = path.join(__dirname, '..', 'dashboard-renderer');
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "connect-src 'self' ws: wss: http: https:",
  "img-src 'self' data: https: http:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "frame-src 'self'",
].join('; ');

if (protocol.registerSchemesAsPrivileged) {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true } },
  ]);
}

function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    let pathname;
    try {
      const u = new URL(request.url);
      const pathPart = (u.pathname || '').replace(/^\/+/, '');
      const rawPath = (u.host ? u.host + (pathPart ? '/' + pathPart : '') : pathPart) || 'index.html';
      pathname = (rawPath.startsWith(APP_PROTOCOL_HOST + '/') || rawPath === APP_PROTOCOL_HOST)
        ? (rawPath === APP_PROTOCOL_HOST ? 'index.html' : rawPath.slice(APP_PROTOCOL_HOST.length + 1))
        : rawPath;
    } catch (_) {
      return new Response('', { status: 400 });
    }
    if (pathname.includes('..')) return new Response('', { status: 403 });
    const filePath = path.join(BASE, pathname);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      console.error('[test-app-protocol] 404', pathname, filePath);
      return new Response('', { status: 404 });
    }
    const resolved = path.resolve(filePath);
    const baseResolved = path.resolve(BASE);
    if (resolved !== baseResolved && !resolved.startsWith(baseResolved + path.sep)) {
      return new Response('', { status: 403 });
    }
    const ext = path.extname(pathname).toLowerCase();
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff' }[ext] || null;
    const body = fs.readFileSync(resolved);
    const headers = { 'Content-Type': mime || 'application/octet-stream', 'Content-Security-Policy': CSP };
    return new Response(body, { status: 200, headers });
  });
}

app.whenReady().then(() => {
  registerAppProtocol();
  const w = new BrowserWindow({
    width: 1000,
    height: 720,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, webSecurity: true },
  });
  w.once('ready-to-show', () => w.show());
  w.loadURL(`app://${APP_PROTOCOL_HOST}/index.html`);
  w.webContents.on('did-fail-load', (_, code, desc, url) => {
    console.error('[test-app-protocol] did-fail-load', code, desc, url);
  });
  w.webContents.on('did-finish-load', () => {
    console.log('[test-app-protocol] did-finish-load', w.webContents.getURL());
    w.webContents.executeJavaScript('document.title').then((t) => console.log('[test-app-protocol] document.title', t)).catch((e) => console.error(e));
  });
  w.webContents.openDevTools({ mode: 'detach' });
});

app.on('window-all-closed', () => app.quit());
