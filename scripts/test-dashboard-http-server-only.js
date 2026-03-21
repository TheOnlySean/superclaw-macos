/**
 * 仅验证 dashboard-server 能否启动并返回我们的 index.html（不依赖 Electron 窗口）。
 * 运行：cd japanclaw-setup && node scripts/test-dashboard-http-server-only.js
 */
const path = require('path');
const fs = require('fs');
const { startDashboardServer } = require('../src/main/dashboard-server');

const GATEWAY_PORT = 18789;
const BASE = path.resolve(__dirname, '..', 'dashboard-renderer');

async function main() {
  if (!fs.existsSync(path.join(BASE, 'index.html'))) {
    console.error('FAIL: dashboard-renderer not found at', BASE);
    process.exit(1);
  }
  let serverRef;
  try {
    const { port, close } = await startDashboardServer(BASE, GATEWAY_PORT);
    serverRef = { close };
    const url = `http://127.0.0.1:${port}/`;
    const res = await fetch(url);
    const text = await res.text();
    const ok = res.ok && (text.includes('SuperClaw') || text.includes('index.html') || text.includes('<!'));
    if (serverRef.close) serverRef.close();
    if (ok) {
      console.log('OK: Dashboard HTTP server serves our UI at', url);
      process.exit(0);
    } else {
      console.error('FAIL: Response not our UI. status=', res.status, 'body length=', text.length);
      process.exit(1);
    }
  } catch (err) {
    if (serverRef && serverRef.close) serverRef.close();
    console.error('FAIL:', err.message);
    process.exit(1);
  }
}

main();
