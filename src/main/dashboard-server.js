/**
 * Dashboard 用のローカル静的サーバー + ゲートウェイ (18789) へのプロキシ。
 * 自前で UI を配信し、API/WebSocket は 18789 に転送するため、ゲートウェイの CSP の影響を受けない。
 */
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

/** 静的ファイルとして扱うパス（先頭一致）。それ以外はゲートウェイへプロキシ。 */
const STATIC_PREFIXES = ['/assets/', '/index.html', '/'];

function findStaticPath(rootDir, urlPath) {
  const decoded = decodeURIComponent(urlPath).replace(/^\//, '').replace(/\.\./g, '');
  if (!decoded) return path.join(rootDir, 'index.html');
  const full = path.join(rootDir, decoded);
  try {
    const stat = fs.statSync(full);
    if (stat.isFile()) return full;
    if (stat.isDirectory()) return path.join(full, 'index.html');
  } catch (_) {}
  return null;
}

/**
 * @param {string} dashboardDir - dashboard-renderer / control-ui-ja のルート
 * @param {number} gatewayPort - 転送先ポート (18789)
 * @param {{ preferredPort?: number }} [opts] - preferredPort を指定するとまずそのポートで listen（衝突時は OS に任せる）
 * @returns {{ server: import('http').Server, port: number, close: () => void }}
 */
function startDashboardServer(dashboardDir, gatewayPort = 18789, opts = {}) {
  if (!dashboardDir || !fs.existsSync(path.join(dashboardDir, 'index.html'))) {
    throw new Error('dashboard-renderer directory not found or missing index.html');
  }
  const server = http.createServer((req, res) => {
    const urlPath = (req.url && new URL(req.url, 'http://127.0.0.1').pathname) || '/';
    const isStatic =
      urlPath.startsWith('/assets/') ||
      urlPath === '/' ||
      urlPath === '/index.html' ||
      (urlPath.length > 1 && !urlPath.startsWith('/api') && !urlPath.startsWith('/socket'));
    const filePath = findStaticPath(dashboardDir, urlPath === '/' ? '' : urlPath);
    if (isStatic && filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME[ext] || 'application/octet-stream';
      const headers = { 'Content-Type': contentType };
      if (ext === '.html') {
        headers['Cache-Control'] = 'no-store, no-cache';
        // unsafe-eval: 打包后的 Vue/Zod 等依赖会使用 new Function()，仅本地 127.0.0.1 使用，风险可控
        headers['Content-Security-Policy'] = [
          "default-src 'self'",
          "base-uri 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:*",
          "img-src 'self' data:",
          "font-src 'self' https://fonts.gstatic.com",
        ].join('; ');
      }
      res.writeHead(200, headers);
      const rs = fs.createReadStream(filePath);
      rs.on('error', () => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
      rs.pipe(res);
      return;
    }
    // プロキシ to gateway
    const opts = {
      hostname: '127.0.0.1',
      port: gatewayPort,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${gatewayPort}` },
    };
    const proxy = http.request(opts, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxy.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Bad Gateway');
    });
    req.pipe(proxy);
  });

  server.on('upgrade', (req, socket, head) => {
    const target = net.connect(gatewayPort, '127.0.0.1', () => {
      const headers = { ...req.headers, host: `127.0.0.1:${gatewayPort}` };
      const headerStr = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n');
      socket.write(`GET ${req.url} HTTP/1.1\r\n${headerStr}\r\n\r\n`);
      socket.write(head);
      target.pipe(socket);
      socket.pipe(target);
    });
    target.on('error', () => {
      socket.destroy();
    });
  });

  const preferredPort = typeof opts.preferredPort === 'number' ? opts.preferredPort : 0;
  return new Promise((resolve, reject) => {
    const finish = () => {
      server.removeAllListeners('error');
      const port = server.address().port;
      resolve({
        server,
        port,
        close: () => {
          server.close();
        },
      });
    };
    const tryListen = (p) => {
      server.removeAllListeners('error');
      server.once('error', (err) => {
        if (p && (err.code === 'EADDRINUSE' || err.code === 'EACCES')) {
          tryListen(0);
        } else {
          reject(err);
        }
      });
      server.listen(p, '127.0.0.1', finish);
    };
    tryListen(preferredPort || 0);
  });
}

module.exports = { startDashboardServer };
