const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const systemCheck = require('./systemCheck');

// Electron 主进程 API。开发时 npm 包会覆盖内置，导致 app 为 undefined；打包后应用内无 node_modules/electron，会使用内置 API。
const electron = require('electron');
const app = electron && electron.app;
const BrowserWindow = electron && electron.BrowserWindow;
const ipcMain = electron && electron.ipcMain;
const shell = electron && electron.shell;
const dialog = electron && electron.dialog;
const protocol = electron && electron.protocol;
const net = electron && electron.net;
if (!app) {
  console.error('SuperClaw: Electron API 不可用。请用打包后的应用测试：npm run dist:mac:arm64');
  process.exit(1);
}
// Intel 版從未預設關 GPU；先前為 arm64 預設 disableHardwareAcceleration + disable-gpu 開關，
// 在部分 Apple Silicon + Electron 上會讓 WebContents 沒有有效繪製路徑 → 整窗全白（與「Intel 正常、M 芯片白屏」現象一致）。
// 現在與 Intel 對齊：預設不關 GPU。僅在明確需要時關閉：
//   SUPERCLAW_DISABLE_GPU=1（任意平台）或 SUPERCLAW_SILICON_DISABLE_HW_ACCEL=1（僅 darwin-arm64）
const isMacArm64 = process.platform === 'darwin' && process.arch === 'arm64';
const ARM64_BUILD_TAG = 'arm64-build-23';
/** 內嵌 Control UI 本機靜態服務優先埠；須在 gateway.controlUi.allowedOrigins 中有對應 http://127.0.0.1:該埠 */
const SUPERCLAW_EMBEDDED_CONTROL_UI_PORT = 27489;
// 穩定模式改為「明確開啟」：預設與 Intel 一致不關 GPU。先前預設開 stable 並 disableHardwareAcceleration，
// 在多台 Apple Silicon 上會出現「DOM/日誌正常但整窗全白」；若仍遇 renderer crash 可設 SUPERCLAW_ARM64_STABLE_MODE=1。
const arm64StableMode = isMacArm64 && process.env.SUPERCLAW_ARM64_STABLE_MODE === '1';
if (process.env.SUPERCLAW_DISABLE_GPU === '1' ||
    (isMacArm64 && process.env.SUPERCLAW_SILICON_DISABLE_HW_ACCEL === '1')) {
  app.disableHardwareAcceleration();
}
if (arm64StableMode) {
  // 穩定模式預設不再關 GPU（易白屏）；若仍遇 crash 可另設 SUPERCLAW_ARM64_STABLE_DISABLE_GPU=1
  if (process.env.SUPERCLAW_ARM64_STABLE_DISABLE_GPU === '1') {
    app.disableHardwareAcceleration();
  }
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
}
function withBuildTag(title) {
  return (app.isPackaged && isMacArm64) ? `${title} [${ARM64_BUILD_TAG}]` : title;
}

const debugLogPath = () => path.join(process.env.HOME || process.env.USERPROFILE || '', '.superclaw-setup-debug.log');
process.on('uncaughtException', (err) => {
  try { fs.appendFileSync(debugLogPath(), JSON.stringify({ event: 'uncaughtException', message: String(err && err.message), stack: err && err.stack, timestamp: Date.now() }) + '\n'); } catch (_) {}
});
process.on('unhandledRejection', (reason, promise) => {
  try { fs.appendFileSync(debugLogPath(), JSON.stringify({ event: 'unhandledRejection', reason: String(reason), timestamp: Date.now() }) + '\n'); } catch (_) {}
});

/** 自定义协议 app: 用于加载 dashboard-renderer，避免 file:// 下 ES modules 白屏。必须在 app.ready 前注册。 */
if (protocol && typeof protocol.registerSchemesAsPrivileged === 'function') {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true } },
  ]);
}
const { initAutoUpdater } = require('./autoUpdater');
const installer = require('./installer');
const nodeInstaller = require('./nodeInstaller');
const license = require('./license');
const { startDashboardServer } = require('./dashboard-server');
let mainWindow = null;
let dashboardWindow = null;
/** 仅当使用 dashboard-renderer 时：本机新端口 HTTP 服务，关窗时关闭。不修改 18789，浏览器打开 18789 仍为官方 UI。 */
let dashboardServerRef = null;

/** app:// プロトコルで返すレスポンスに付与する CSP（白屏・インラインスクリプトブロックを防ぐ）。 */
const APP_PROTOCOL_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: https: http:",
  "connect-src 'self' ws: wss: http: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "frame-src 'self'",
].join('; ');

/** 调试用：同时发往 7242 并写入本机文件，便于在测试机上复现后带回日志。 */
function debugLog(location, message, data, hypothesisId) {
  const payload = { location, message, data: data || {}, hypothesisId, timestamp: Date.now() };
  try { fetch('http://127.0.0.1:7242/ingest/bb10cbe1-eb61-49ac-a7a6-a688bfda1c50', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => {}); } catch (_) {}
  try { const logPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.superclaw-setup-debug.log'); fs.appendFileSync(logPath, JSON.stringify(payload) + '\n'); } catch (_) {}
}

function getOpenClawConfigPath() {
  return process.env.OPENCLAW_CONFIG_PATH ||
    path.join(process.env.HOME || process.env.USERPROFILE || '', '.openclaw', 'openclaw.json');
}

/** OpenClaw 状態ディレクトリ（~/.openclaw）。会话・モデル一覧の読み取りに使用。 */
function getOpenClawStateDir() {
  return path.dirname(getOpenClawConfigPath());
}

function getGatewayToken() {
  try {
    const raw = fs.readFileSync(getOpenClawConfigPath(), 'utf8');
    const config = JSON.parse(raw);
    return config.gateway?.auth?.token || null;
  } catch {
    return null;
  }
}

/** 配置里是否已有可用的 Gateway 鉴权（不仅限于 token 字符串）。 */
function secretConfiguredInConfig(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'object' && value.$env != null && String(value.$env).trim() !== '') return true;
  return false;
}

function readOpenClawConfigSafe() {
  try {
    const p = getOpenClawConfigPath();
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 是否已有 OpenClaw 网关侧配置（与「仅装了 CLI、尚未 onboard」区分）。 */
function hasGatewayAuthInOpenClawConfig(config) {
  if (!config || typeof config !== 'object' || !config.gateway) return false;
  const g = config.gateway;
  const auth = g.auth;
  if (auth && typeof auth === 'object') {
    if (secretConfiguredInConfig(auth.token)) return true;
    if (secretConfiguredInConfig(auth.password)) return true;
  }
  // 旧版 / 误写在 gateway.token（OpenClaw 会提示迁移到 gateway.auth.token）
  if (secretConfiguredInConfig(g.token)) return true;
  const remote = g.remote;
  if (remote && typeof remote === 'object') {
    if (secretConfiguredInConfig(remote.token)) return true;
    if (secretConfiguredInConfig(remote.password)) return true;
  }
  return false;
}

function hasExistingOpenClawSetupSync() {
  if (getGatewayToken() != null) return true;
  if (hasGatewayAuthInOpenClawConfig(readOpenClawConfigSafe())) return true;
  const gt = process.env.OPENCLAW_GATEWAY_TOKEN;
  const gp = process.env.OPENCLAW_GATEWAY_PASSWORD;
  if (gt != null && String(gt).trim() !== '') return true;
  if (gp != null && String(gp).trim() !== '') return true;
  return false;
}

/** Control UI が Gateway に接続できるよう allowedOrigins に null / file:// / 127.0.0.1 を足す。書き込んだら true。 */
function ensureControlUiAllowedOriginsForFile() {
  const configPath = getOpenClawConfigPath();
  const needed = [
    'null',
    'file://',
    'http://127.0.0.1',
    'http://127.0.0.1:18789',
    `http://127.0.0.1:${SUPERCLAW_EMBEDDED_CONTROL_UI_PORT}`,
  ];
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    const controlUi = config.gateway?.controlUi ?? {};
    const existing = Array.isArray(controlUi.allowedOrigins) ? controlUi.allowedOrigins : [];
    const added = needed.filter((o) => !existing.includes(o));
    if (added.length === 0) return false;
    config.gateway = config.gateway ?? {};
    config.gateway.controlUi = { ...controlUi, allowedOrigins: [...existing, ...added] };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

/** 隨機埠靜態服務時，把精確 Origin 寫入 allowedOrigins（OpenClaw 為全字串匹配，不含埠的 http://127.0.0.1 不夠）。 */
function ensureControlUiAllowedOriginForLocalhostPort(port) {
  if (port == null || typeof port !== 'number' || port <= 0) return false;
  const origin = `http://127.0.0.1:${port}`;
  const configPath = getOpenClawConfigPath();
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    const controlUi = config.gateway?.controlUi ?? {};
    const existing = Array.isArray(controlUi.allowedOrigins) ? controlUi.allowedOrigins : [];
    if (existing.includes(origin)) return false;
    config.gateway = config.gateway ?? {};
    config.gateway.controlUi = { ...controlUi, allowedOrigins: [...existing, origin] };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

/** 不再写入：保证 18789 始终为 OpenClaw 官方 UI，不改为我们的 control-ui-ja。保留函数仅作兼容。 */
function ensureControlUiRootInConfig() {
  return false;
}

/** 若 gateway.controlUi.root 指向我们的 dashboard-renderer 或 control-ui-ja，则清除并重启网关，使 18789 恢复为官方 UI。返回是否做过清除。 */
function ensure18789UsesOfficialControlUi() {
  const configPath = getOpenClawConfigPath();
  try {
    if (!fs.existsSync(configPath)) return false;
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    const root = config.gateway?.controlUi?.root;
    if (!root || typeof root !== 'string') return false;
    const ourDirs = [];
    try {
      const drDir = getDashboardRendererDirForGateway();
      if (drDir && fs.existsSync(drDir)) ourDirs.push(path.resolve(drDir));
    } catch (_) {}
    try {
      const localPath = getLocalControlUiPath();
      if (localPath && fs.existsSync(localPath)) ourDirs.push(path.resolve(path.dirname(localPath)));
    } catch (_) {}
    const resolvedRoot = path.resolve(root);
    const isOurs = ourDirs.some((d) => resolvedRoot === d || resolvedRoot.startsWith(d + path.sep));
    if (!isOurs) return false;
    delete config.gateway.controlUi.root;
    if (Object.keys(config.gateway.controlUi || {}).length === 0) config.gateway.controlUi = undefined;
    if (config.gateway && Object.keys(config.gateway).length === 0) config.gateway = undefined;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
    if (installer.restartBundledGateway) {
      installer.restartBundledGateway();
    }
    return true;
  } catch (_) {
    return false;
  }
}

/** 已废弃：不再把 18789 改为我们的 UI，保证浏览器打开 18789 始终为官方 UI。 */
function ensureDashboardRendererAsControlUiRoot() {
  const dir = getDashboardRendererDirForGateway();
  if (!dir) return false;
  const configPath = getOpenClawConfigPath();
  try {
    if (!fs.existsSync(configPath)) return false;
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    const controlUi = config.gateway?.controlUi ?? {};
    const resolvedDir = path.resolve(dir);
    if (controlUi.root === resolvedDir) return resolvedDir;
    config.gateway = config.gateway ?? {};
    config.gateway.controlUi = { ...controlUi, root: resolvedDir };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
    try {
      const logPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.superclaw-setup-debug.log');
      fs.appendFileSync(logPath, JSON.stringify({ event: 'dashboard-controlUi-root-written', path: resolvedDir, configPath, timestamp: Date.now() }) + '\n');
    } catch (_) {}
    return resolvedDir;
  } catch (_) {
    return false;
  }
}

/** 网关就绪前短暂等待，避免打开 Dashboard 时立刻显示连接错误。探针用 /healthz，最多等 maxWaitMs，每 intervalMs 试一次。 */
function waitForGateway(maxWaitMs = 5000, intervalMs = 500) {
  const start = Date.now();
  const timeoutMs = 2000;
  function tryOnce() {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    return fetch('http://127.0.0.1:18789/healthz', { signal: controller.signal })
      .then((r) => { clearTimeout(id); return r.ok; })
      .catch(() => {
        clearTimeout(id);
        if (Date.now() - start >= maxWaitMs) return false;
        return new Promise((r) => setTimeout(r, intervalMs)).then(tryOnce);
      });
  }
  return tryOnce();
}

/** 应用启动时若已有 OpenClaw 配置则自动启动 gateway，保证点击「打开 Dashboard」时 18789 已在监听。不修改用户 config，避免影响用户在浏览器打开 18789 时看到的官方 UI。 */
function ensureGatewayStartedAtLaunch() {
  if (!installer.hasBundledOpenclaw()) return;
  const configPath = getOpenClawConfigPath();
  if (!configPath || !fs.existsSync(configPath)) return;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 1500);
  fetch('http://127.0.0.1:18789/', { signal: controller.signal })
    .then(() => { clearTimeout(id); })
    .catch(() => {
      clearTimeout(id);
      installer.startBundledGateway();
    });
}

/** 日本語 Control UI（方案 B）の index.html パス。存在すればこちらを優先して開く。打包后多路径回退，避免已有 OpenClaw 用户误用官方 dashboard。 */
function getLocalControlUiPath() {
  if (app.isPackaged) {
    const resourcesPath = process.resourcesPath;
    const execDir = path.dirname(process.execPath);
    const appPathDir = path.dirname(app.getAppPath());
    // 打包后 extraResources 的 control-ui-ja 在 Contents/Resources/control-ui-ja；多种路径确保从 DMG 或 /Applications 运行都能找到
    const candidates = [
      path.resolve(resourcesPath, 'control-ui-ja', 'index.html'),
      path.join(resourcesPath, 'control-ui-ja', 'index.html'),
      path.join(execDir, '..', 'Resources', 'control-ui-ja', 'index.html'),
      path.join(appPathDir, 'control-ui-ja', 'index.html'),
      path.join(path.dirname(execDir), 'Resources', 'control-ui-ja', 'index.html'),
      // app.asar.unpacked/src/main から Resources へは 3 段上
      path.join(__dirname, '..', '..', '..', 'control-ui-ja', 'index.html'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return candidates[0];
  }
  return path.join(__dirname, '../../control-ui-ja', 'index.html');
}

/** Dashboard（renderer）路径。打包后在 extraResources 的 Resources/dashboard-renderer（不在 asar 内），开发时用本地目录。 */
function getDashboardRendererPath() {
  if (app.isPackaged) {
    const resourcesRoot = process.resourcesPath;
    const candidates = [
      path.join(resourcesRoot, 'dashboard-renderer', 'index.html'),
      path.join(path.dirname(process.execPath), '..', 'Resources', 'dashboard-renderer', 'index.html'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p) && !p.includes('app.asar')) return p;
    }
    return candidates[0];
  }
  return path.join(__dirname, '../../dashboard-renderer', 'index.html');
}

/** 网关可读的 dashboard-renderer 目录（用于 gateway.controlUi.root，必须为磁盘路径）。 */
function getDashboardRendererDirForGateway() {
  const indexPath = getDashboardRendererPath();
  const dir = path.dirname(indexPath);
  return fs.existsSync(path.join(dir, 'index.html')) ? dir : null;
}

/** Dashboard-renderer 所在目录，供 app: 协议解析路径用。 */
function getDashboardRendererBasePath() {
  const indexPath = getDashboardRendererPath();
  return path.dirname(indexPath);
}

/** 使用 app: 协议加载 Dashboard 的 URL。必须带 host（如 dashboard）才能让 standard scheme 正确解析相对路径 ./assets/xxx → app://dashboard/assets/xxx。 */
const APP_PROTOCOL_HOST = 'dashboard';
function getDashboardAppURL() {
  return `app://${APP_PROTOCOL_HOST}/index.html`;
}

function resolveDashboardPreloadPath() {
  let preloadPath = path.join(__dirname, 'dashboard-preload.js');
  if (app.isPackaged && preloadPath.includes('app.asar') && !preloadPath.includes('app.asar.unpacked')) {
    preloadPath = preloadPath.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
  }
  if (app.isPackaged) {
    const candidates = [
      path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'main', 'dashboard-preload.js'),
      path.join(path.dirname(process.execPath), '..', 'Resources', 'app.asar.unpacked', 'src', 'main', 'dashboard-preload.js'),
      preloadPath,
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
  }
  return fs.existsSync(preloadPath) ? preloadPath : undefined;
}

/**
 * 本機 HTTP 靜態服務載入 Dashboard（dashboard-renderer 或 control-ui-ja）。
 * ARM64 一律掛 preload + sandbox:false（先前關 preload 反易與前端初始化衝突）。
 */
async function openDashboardOverLocalHttp({
  baseDir,
  buildUrlWithPort,
  log,
  logPathForUser,
  localPath,
  serverLabel,
  startServerOpts,
  /** 載入 control-ui-ja 時套用與 file:// 相同的日文／SuperClaw 樣式注入（本機 HTTP 預設也要） */
  enhanceControlUiJa = false,
}) {
  const GATEWAY_PORT = 18789;
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    if (dashboardServerRef && typeof dashboardServerRef.port === 'number') {
      dashboardWindow.setTitle('SuperClaw');
      dashboardWindow.focus();
      return;
    }
    dashboardWindow.close();
    dashboardWindow = null;
  }
  let configTouched = ensureControlUiAllowedOriginsForFile();
  const { server, port, close } = await startDashboardServer(baseDir, GATEWAY_PORT, startServerOpts || {});
  dashboardServerRef = { server, port, close };
  if (ensureControlUiAllowedOriginForLocalhostPort(port)) configTouched = true;
  if (configTouched && installer.restartBundledGateway) {
    log({ event: 'dashboard-gateway-restart-for-allowed-origins', port, timestamp: Date.now() });
    installer.restartBundledGateway();
    await new Promise((r) => setTimeout(r, 2500));
  }
  const dashboardUrl = buildUrlWithPort(port);
  log({
    event: serverLabel || 'dashboard-server-started',
    port,
    baseDir,
    url: dashboardUrl,
    buildTag: ARM64_BUILD_TAG,
    timestamp: Date.now(),
  });

  const preloadPath = resolveDashboardPreloadPath();
  if (!preloadPath) {
    log({ event: 'dashboard-preload-missing', buildTag: ARM64_BUILD_TAG, timestamp: Date.now() });
  }
  const iconPath = path.join(__dirname, '../../build/icons/icon-512.png');
  const opts = {
    width: 1000,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    title: 'SuperClaw',
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
      preload: preloadPath || undefined,
      sandbox: isMacArm64 ? false : undefined,
    },
  };
  if (fs.existsSync(iconPath)) opts.icon = iconPath;
  dashboardWindow = new BrowserWindow(opts);
  dashboardWindow.loadURL(dashboardUrl);
  const showTimer = setTimeout(() => {
    if (dashboardWindow && !dashboardWindow.isDestroyed() && !dashboardWindow.isVisible()) {
      try { dashboardWindow.show(); } catch (_) {}
    }
  }, 2500);
  dashboardWindow.once('ready-to-show', () => {
    clearTimeout(showTimer);
    if (dashboardWindow && !dashboardWindow.isDestroyed() && !dashboardWindow.isVisible()) {
      try { dashboardWindow.show(); } catch (_) {}
    }
  });
  dashboardWindow.on('closed', () => {
    if (dashboardServerRef && typeof dashboardServerRef.close === 'function') dashboardServerRef.close();
    dashboardServerRef = null;
    dashboardWindow = null;
  });
  dashboardWindow.once('did-finish-load', () => {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.setTitle(withBuildTag(enhanceControlUiJa ? 'SuperClaw（日本語）' : 'SuperClaw'));
    }
  });
  const dwc = dashboardWindow.webContents;
  if (enhanceControlUiJa) {
    dwc.on('dom-ready', () => {
      if (!dashboardWindow || dashboardWindow.isDestroyed() || dwc.isDestroyed()) return;
      attachControlUiJapaneseEnhancements(dwc);
    });
  }
  dwc.on('render-process-gone', (_e, details) => {
    log({ event: 'dashboard-render-process-gone', details, url: dashboardUrl, serverLabel, buildTag: ARM64_BUILD_TAG, timestamp: Date.now() });
  });
  dwc.on('console-message', (_e, level, message, line, sourceId) => {
    log({ event: 'dashboard-console', level, message, line, sourceId, timestamp: Date.now() });
  });
  dwc.on('did-finish-load', () => {
    if (!dashboardWindow || dashboardWindow.isDestroyed()) return;
    const u = dwc.isDestroyed() ? '' : dwc.getURL();
    log({ event: 'dashboard-did-finish-load', url: u, serverLabel, timestamp: Date.now() });
    dwc.executeJavaScript(`
      try {
        document.documentElement.style.background = '#ffffff';
        document.body && (document.body.style.background = '#ffffff');
        document.body && (document.body.style.color = '#111111');
        void(document.body && document.body.offsetHeight);
        requestAnimationFrame(function(){});
      } catch (e) {}
    `).catch(() => {});
    hideDashboardUpdateBanner(dwc);
    const win = dashboardWindow;
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      const b = win.getBounds();
      win.setBounds({ ...b, height: b.height + 1 });
      win.setBounds(b);
    }, 50);
    if (process.env.SUPERCLAW_FORCE_PAINT_DEVTOOLS === '1') {
      setTimeout(() => {
        if (!dashboardWindow || dashboardWindow.isDestroyed() || dwc.isDestroyed()) return;
        dwc.openDevTools({ mode: 'detach' });
        setTimeout(() => {
          if (!dwc.isDestroyed()) dwc.closeDevTools();
        }, 80);
      }, 150);
    }
    if (enhanceControlUiJa && !dwc.isDestroyed()) {
      attachControlUiJapaneseEnhancements(dwc);
      setTimeout(() => {
        if (!dashboardWindow || dashboardWindow.isDestroyed() || dwc.isDestroyed()) return;
        injectDashboardIntoShadowRoot(dwc);
      }, 1500);
      setTimeout(() => {
        if (!dashboardWindow || dashboardWindow.isDestroyed() || dwc.isDestroyed()) return;
        injectDashboardIntoShadowRoot(dwc);
      }, 4000);
    }
  });
  dwc.on('did-fail-load', (_, errorCode, errorDescription, validatedURL) => {
    if (!dashboardWindow || dashboardWindow.isDestroyed()) return;
    log({ event: 'dashboard-did-fail-load', errorCode, errorDescription, validatedURL, timestamp: Date.now() });
    if (localPath && fs.existsSync(localPath)) {
      const fallbackUrl = pathToFileURL(localPath).href + '?gatewayUrl=' + encodeURIComponent('ws://127.0.0.1:18789') + '&locale=ja&theme=light';
      dashboardWindow.loadURL(fallbackUrl).catch(() => {});
    } else {
      dialog.showMessageBox(dashboardWindow, {
        type: 'error',
        title: 'SuperClaw',
        message: 'Dashboard 加载失败',
        detail: `错误: ${errorDescription}\n代码: ${errorCode}\n请将日志发给我们: ${logPathForUser}`,
      }).catch(() => {});
    }
  });
  dwc.on('before-input-event', (_, input) => {
    if (!dashboardWindow || dashboardWindow.isDestroyed()) return;
    if (input.key === 'F12' || (input.control && input.alt && input.key.toLowerCase() === 'i') || (input.meta && input.alt && input.key.toLowerCase() === 'i')) {
      if (!dwc.isDestroyed()) dwc.toggleDevTools();
    }
  });
  if (!app.isPackaged) {
    dashboardWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

async function createDashboardWindow() {
  const logPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.superclaw-setup-debug.log');
  const log = (obj) => { try { fs.appendFileSync(logPath, JSON.stringify(obj) + '\n'); } catch (_) {} };
  const token = getGatewayToken();
  // 彻底改用官方 Dashboard UI（control-ui-ja）：file:// + locale=ja，应用内日文、浏览器 18789 不变。不再使用 dashboard-renderer，避免白/黑屏。
  const localPath = getLocalControlUiPath();
  const useLocalUi = fs.existsSync(localPath);
  const useArm64HttpDashboard =
    app.isPackaged && isMacArm64 && process.env.SUPERCLAW_ARM64_DASHBOARD_HTTP === '1';
  const useArm64ControlUiHttp =
    app.isPackaged && isMacArm64 && useLocalUi && process.env.SUPERCLAW_ARM64_CONTROL_UI_FILE !== '1';
  log({
    event: 'dashboard-open',
    useControlUiJa: useLocalUi,
    controlUiPath: localPath,
    useArm64HttpDashboard,
    useArm64ControlUiHttp,
    buildTag: ARM64_BUILD_TAG,
    timestamp: Date.now(),
  });

  // ARM64 打包：預設本機 HTTP + 固定優先埠載入 control-ui-ja（正確 Origin 供 Gateway allowlist；避免 file:// 下模組與白屏）
  if (useArm64ControlUiHttp) {
    const uiRoot = path.dirname(localPath);
    if (fs.existsSync(path.join(uiRoot, 'index.html'))) {
      try {
        log({ event: 'dashboard-controlui-http-branch', uiRoot, preferredPort: SUPERCLAW_EMBEDDED_CONTROL_UI_PORT, timestamp: Date.now() });
        const ps = new URLSearchParams({
          gatewayUrl: 'ws://127.0.0.1:18789',
          locale: 'ja',
          theme: 'light',
        });
        const h = token ? '#token=' + encodeURIComponent(token) : '';
        await openDashboardOverLocalHttp({
          baseDir: uiRoot,
          buildUrlWithPort: (port) => `http://127.0.0.1:${port}/?${ps.toString()}${h}`,
          log,
          logPathForUser: logPath,
          localPath,
          serverLabel: 'dashboard-controlui-http-started',
          startServerOpts: { preferredPort: SUPERCLAW_EMBEDDED_CONTROL_UI_PORT },
          enhanceControlUiJa: true,
        });
        return;
      } catch (err) {
        log({ event: 'dashboard-controlui-http-error', err: String(err && err.message), timestamp: Date.now() });
      }
    }
  }

  // 可選：dashboard-renderer 本機 HTTP（SUPERCLAW_ARM64_DASHBOARD_HTTP=1）
  if (useArm64HttpDashboard) {
    let baseDir = getDashboardRendererBasePath();
    if (app.isPackaged && baseDir && baseDir.includes('app.asar')) {
      baseDir = path.join(process.resourcesPath, 'dashboard-renderer');
      log({ event: 'dashboard-fix-asar-path', baseDir, timestamp: Date.now() });
    }
    if (!baseDir || !fs.existsSync(path.join(baseDir, 'index.html'))) {
      log({ event: 'dashboard-open-no-base', baseDir, fallback: 'control-ui-ja', timestamp: Date.now() });
    } else {
      try {
        log({ event: 'dashboard-renderer-http-starting', baseDir, timestamp: Date.now() });
        const hash = token ? '#token=' + encodeURIComponent(token) : '';
        await openDashboardOverLocalHttp({
          baseDir,
          buildUrlWithPort: (port) => `http://127.0.0.1:${port}/` + (hash || ''),
          log,
          logPathForUser: logPath,
          localPath,
          serverLabel: 'dashboard-renderer-http-started',
          startServerOpts: {},
        });
        return;
      } catch (err) {
        log({ event: 'dashboard-server-error', err: String(err && err.message), baseDir, timestamp: Date.now() });
        const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
        dialog.showMessageBox(parent, {
          type: 'error',
          title: 'SuperClaw',
          message: 'Dashboard 服务启动失败',
          detail: String(err && err.message) + '\n请将日志发给我们: ' + logPath,
        }).catch(() => {});
      }
    }
  }

  // 使用 control-ui-ja（官方 UI 日语版）或直连 18789；不修改 18789，浏览器打开 18789 仍为官方 UI
  if (app.isPackaged && !useLocalUi) {
    const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    dialog.showMessageBox(parent, {
      type: 'error',
      title: 'SuperClaw',
      message: 'ダッシュボード用のファイルが見つかりません',
      detail: 'アプリを再インストールするか、インストーラーを再度実行してください。',
    }).catch(() => {});
    return;
  }
  let url;
  let configUpdated = false;
  if (useLocalUi) {
    configUpdated = ensureControlUiAllowedOriginsForFile();
    const gatewayUrl = 'ws://127.0.0.1:18789';
    const params = new URLSearchParams({ gatewayUrl, locale: 'ja', theme: 'light' });
    const fileUrl = pathToFileURL(localPath);
    url = fileUrl.href + (params.toString() ? '?' + params.toString() : '');
    if (token) url += '#token=' + encodeURIComponent(token);
  } else {
    url = 'http://127.0.0.1:18789/' + (token ? '#token=' + encodeURIComponent(token) : '');
  }
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    if (useLocalUi) ensureControlUiAllowedOriginsForFile();
    log({ event: 'dashboard-reuse-window-loadurl', url, buildTag: ARM64_BUILD_TAG, timestamp: Date.now() });
    dashboardWindow.loadURL(url);
    dashboardWindow.setTitle(withBuildTag(useLocalUi ? 'SuperClaw（日本語）' : 'SuperClaw'));
    dashboardWindow.focus();
    return;
  }
  const dashPreloadFile = resolveDashboardPreloadPath();
  log({
    event: 'dashboard-file-window',
    hasPreload: Boolean(dashPreloadFile),
    url,
    arm64SandboxOff: Boolean(app.isPackaged && isMacArm64),
    buildTag: ARM64_BUILD_TAG,
    timestamp: Date.now(),
  });
  dashboardWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 640,
    minHeight: 480,
    title: withBuildTag(useLocalUi ? 'SuperClaw（日本語）' : 'SuperClaw'),
    icon: path.join(__dirname, '../../build/icons/icon-512.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      preload: dashPreloadFile || undefined,
      sandbox: app.isPackaged && isMacArm64 ? false : undefined,
    },
  });
  dashboardWindow.loadURL(url);
  dashboardWindow.webContents.on('render-process-gone', (_e, details) => {
    log({ event: 'dashboard-render-process-gone', details, mode: 'file-window', buildTag: ARM64_BUILD_TAG, timestamp: Date.now() });
  });
  dashboardWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    log({ event: 'dashboard-console', level, message, line, sourceId, mode: 'file-window', timestamp: Date.now() });
  });
  dashboardWindow.on('closed', () => { dashboardWindow = null; });
  dashboardWindow.once('did-finish-load', () => {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.setTitle(withBuildTag(useLocalUi ? 'SuperClaw（日本語）' : 'SuperClaw'));
    }
    log({ event: 'dashboard-did-finish-load', mode: 'file-window', buildTag: ARM64_BUILD_TAG, timestamp: Date.now() });
  });
  if (configUpdated) {
    dashboardWindow.once('ready-to-show', () => {
      const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
      dialog.showMessageBox(parent, {
        type: 'info',
        title: 'SuperClaw',
        message: '設定を更新しました。',
        detail: '接続できない場合は「あなたの SuperClaw を使い始める」をもう一度押してください。',
      }).catch(() => {});
    });
  }
  function runDashboardInjections() {
    if (!dashboardWindow || dashboardWindow.isDestroyed()) return;
    if (useLocalUi) attachControlUiJapaneseEnhancements(dashboardWindow.webContents);
  }
  dashboardWindow.webContents.on('dom-ready', runDashboardInjections);
  dashboardWindow.webContents.on('did-finish-load', () => {
    runDashboardInjections();
    if (useLocalUi && dashboardWindow && !dashboardWindow.isDestroyed()) {
      setTimeout(() => injectDashboardIntoShadowRoot(dashboardWindow.webContents), 1500);
      setTimeout(() => injectDashboardIntoShadowRoot(dashboardWindow.webContents), 4000);
    }
  });
}

function hideDashboardUpdateBanner(webContents) {
  if (webContents && !webContents.isDestroyed()) {
    webContents.insertCSS('.update-banner { display: none !important; }').catch(() => {});
  }
}

/** ダッシュボードをデフォルトでライトテーマで表示する（URL の theme=light に加え、localStorage / data-theme を設定）。 */
function injectDashboardLightTheme(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  webContents.executeJavaScript(`
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('theme', 'light');
      document.documentElement.setAttribute('data-theme', 'light');
      document.documentElement.classList.add('light');
    } catch (e) {}
  `).catch(() => {});
}

/** Gateway URL 確認ダイアログを「エラー」っぽく見えない中性スタイルにする */
function injectGatewayModalStyles(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  const css = [
    '.exec-approval-card .callout.danger, .exec-approval-card .callout.exec-approval-note {',
    '  background: #f0f4f8 !important; color: #334155 !important; border-color: #cbd5e1 !important;',
    '}',
    '.exec-approval-card .btn.primary.exec-approval-btn-confirm {',
    '  background: #475569 !important; border-color: #475569 !important;',
    '}',
  ].join(' ');
  webContents.insertCSS(css).catch(() => {});
}

/** ダッシュボードのナビを少し見やすく（余白・階層をはっきり） */
function injectDashboardLayoutStyles(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  const css = [
    '.nav-group__items .nav-item { padding: 0.5rem 0.75rem !important; border-radius: 6px !important; }',
    '.nav-group__items .nav-item:hover { background: rgba(255,255,255,0.06) !important; }',
    '.nav-group__items .nav-item.active { background: rgba(255,255,255,0.1) !important; }',
    '.nav-label { padding: 0.4rem 0.75rem !important; border-radius: 6px !important; }',
    '.nav-group + .nav-group { margin-top: 0.5rem !important; }',
  ].join(' ');
  webContents.insertCSS(css).catch(() => {});
}

/** ダッシュボード UI：入力框常時可見邊框 + 毛玻璃風（白底主題下）。document に insert するが、control-ui は Shadow DOM のためメインは injectDashboardIntoShadowRoot で注入。 */
function injectDashboardGlassStyles(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  const css = [
    '/* 輸入框：未聚焦時也有清晰邊框 */',
    'input[type="text"], input[type="search"], input:not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea, .dashboard-app input, .dashboard-app textarea, .chat-compose__field textarea, .chat-compose__field input, [class*="compose"] textarea, [class*="compose"] input {',
    '  border: 1px solid rgba(0,0,0,0.12) !important; border-radius: 8px !important;',
    '  background: rgba(255,255,255,0.9) !important;',
    '  box-shadow: 0 1px 0 rgba(255,255,255,0.8) inset !important;',
    '}',
    'input:focus, textarea:focus, .chat-compose__field textarea:focus, .chat-compose__field input:focus, [class*="compose"] textarea:focus, [class*="compose"] input:focus {',
    '  border-color: rgba(229,77,77,0.5) !important; box-shadow: 0 0 0 2px rgba(229,77,77,0.15) !important; outline: none !important;',
    '}',
    '/* 毛玻璃：側欄、卡片、聊天輸入區 */',
    '[class*="sidebar"], [class*="nav-bar"], aside[class*="nav"], .nav-root, [data-testid*="sidebar"] {',
    '  background: rgba(255,255,255,0.75) !important; backdrop-filter: blur(12px) !important; -webkit-backdrop-filter: blur(12px) !important;',
    '  border-right: 1px solid rgba(0,0,0,0.06) !important;',
    '}',
    '.chat-compose, [class*="chat-compose"], [class*="compose"] {',
    '  background: rgba(255,255,255,0.7) !important; backdrop-filter: blur(10px) !important; -webkit-backdrop-filter: blur(10px) !important;',
    '  border-top: 1px solid rgba(0,0,0,0.06) !important;',
    '  box-shadow: 0 -1px 0 rgba(255,255,255,0.5) inset !important;',
    '}',
    '[class*="card"]:not(.exec-approval-card), [class*="panel"] {',
    '  background: rgba(255,255,255,0.8) !important; backdrop-filter: blur(8px) !important; -webkit-backdrop-filter: blur(8px) !important;',
    '  border: 1px solid rgba(0,0,0,0.06) !important; border-radius: 10px !important;',
    '  box-shadow: 0 1px 0 rgba(255,255,255,0.9) inset, 0 2px 12px rgba(0,0,0,0.04) !important;',
    '}',
    '/* 根容器白底時的主內容區 */',
    '[data-theme="light"] .main, [data-theme="light"] [class*="main"], .light .main, .light [class*="content"] {',
    '  background: rgba(248,249,252,0.6) !important; backdrop-filter: blur(6px) !important; -webkit-backdrop-filter: blur(6px) !important;',
    '}',
  ].join(' ');
  webContents.insertCSS(css).catch(() => {});
}

/** control-ui は openclaw-app の Shadow DOM 内で描画されるため、ここで Shadow Root にスタイルとスキルマーケットボタンを注入する */
function injectDashboardIntoShadowRoot(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  const fullCss = [
    '.nav-group__items .nav-item { padding: 0.5rem 0.75rem !important; border-radius: 6px !important; }',
    '.nav-group__items .nav-item:hover { background: rgba(255,255,255,0.06) !important; }',
    '.nav-group__items .nav-item.active { background: rgba(255,255,255,0.1) !important; }',
    '.nav-label { padding: 0.4rem 0.75rem !important; border-radius: 6px !important; }',
    '.nav-group + .nav-group { margin-top: 0.5rem !important; }',
    'input[type="text"], input[type="search"], input:not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea { border: 1px solid rgba(0,0,0,0.12) !important; border-radius: 8px !important; background: rgba(255,255,255,0.9) !important; box-shadow: 0 1px 0 rgba(255,255,255,0.8) inset !important; }',
    'input:focus, textarea:focus { border-color: rgba(229,77,77,0.5) !important; box-shadow: 0 0 0 2px rgba(229,77,77,0.15) !important; outline: none !important; }',
    '[class*="sidebar"], [class*="nav-bar"], aside[class*="nav"], .nav-root { background: rgba(255,255,255,0.75) !important; backdrop-filter: blur(12px) !important; -webkit-backdrop-filter: blur(12px) !important; border-right: 1px solid rgba(0,0,0,0.06) !important; }',
    '.chat-compose, [class*="chat-compose"] { background: rgba(255,255,255,0.7) !important; backdrop-filter: blur(10px) !important; -webkit-backdrop-filter: blur(10px) !important; border-top: 1px solid rgba(0,0,0,0.06) !important; }',
    '.card:not(.exec-approval-card), [class*="panel"] { background: rgba(255,255,255,0.8) !important; backdrop-filter: blur(8px) !important; -webkit-backdrop-filter: blur(8px) !important; border: 1px solid rgba(0,0,0,0.06) !important; border-radius: 10px !important; box-shadow: 0 1px 0 rgba(255,255,255,0.9) inset, 0 2px 12px rgba(0,0,0,0.04) !important; }',
    '[data-theme="light"] .main, .light .main { background: rgba(248,249,252,0.6) !important; backdrop-filter: blur(6px) !important; -webkit-backdrop-filter: blur(6px) !important; }',
    '.superclaw-skill-market-btn { display: inline-flex !important; align-items: center !important; gap: 8px !important; padding: 10px 20px !important; margin-bottom: 16px !important; background: linear-gradient(135deg, #e54d4d 0%, #c73e3e 100%) !important; color: #fff !important; border: none !important; border-radius: 10px !important; font-weight: 600 !important; font-size: 15px !important; cursor: pointer !important; box-shadow: 0 2px 8px rgba(229,77,77,0.35) !important; transition: transform 0.15s ease, box-shadow 0.15s ease !important; }',
    '.superclaw-skill-market-btn:hover { transform: translateY(-1px) !important; box-shadow: 0 4px 12px rgba(229,77,77,0.4) !important; }',
    '#superclaw-skill-market-modal { position: fixed !important; inset: 0 !important; z-index: 99999 !important; display: flex !important; align-items: center !important; justify-content: center !important; background: rgba(0,0,0,0.4) !important; backdrop-filter: blur(4px) !important; }',
    '#superclaw-skill-market-modal .modal-inner { background: #fff !important; border-radius: 14px !important; padding: 28px 32px !important; max-width: 380px !important; box-shadow: 0 12px 40px rgba(0,0,0,0.15) !important; text-align: center !important; }',
    '#superclaw-skill-market-modal .modal-title { font-size: 18px !important; font-weight: 700 !important; margin-bottom: 12px !important; color: #1e293b !important; }',
    '#superclaw-skill-market-modal .modal-body { font-size: 15px !important; line-height: 1.5 !important; color: #475569 !important; margin-bottom: 24px !important; }',
    '#superclaw-skill-market-modal .modal-close { padding: 10px 24px !important; background: #e54d4d !important; color: #fff !important; border: none !important; border-radius: 8px !important; font-weight: 600 !important; cursor: pointer !important; }',
  ].join(' ');

  const script = `
(function() {
  var styleId = 'superclaw-dashboard-styles';
  var modalId = 'superclaw-skill-market-modal';
  var btnClass = 'superclaw-skill-market-btn';
  var markerAttr = 'data-superclaw-skill-market-btn';
  var titleTexts = ['Skills', 'スキル', '技能', 'Fähigkeiten', 'Habilidades'];
  var fullCss = ${JSON.stringify(fullCss)};

  function getRoot() {
    var app = document.querySelector('openclaw-app') || document.body.firstElementChild;
    if (!app) return null;
    if (app.shadowRoot) return app.shadowRoot;
    if (app.tagName && app.tagName.toLowerCase() === 'openclaw-app') return null;
    return null;
  }
  function isSkillsCardTitle(el) {
    if (!el || !el.classList || !el.classList.contains('card-title')) return false;
    var t = (el.textContent || '').trim();
    return titleTexts.some(function(s) { return t === s; });
  }
  function ensureModal(root) {
    if (!root) return null;
    var m = root.getElementById ? root.getElementById(modalId) : root.querySelector('#' + modalId);
    if (m) return m;
    m = document.createElement('div');
    m.id = modalId;
    m.style.display = 'none';
    m.innerHTML = '<div class="modal-inner"><div class="modal-title">Coming soon</div><div class="modal-body">スキルマーケットを準備中です。まもなくお届けします。</div><button class="modal-close">OK</button></div>';
    m.addEventListener('click', function(e) {
      if (e.target === m || e.target.classList.contains('modal-close')) m.style.display = 'none';
    });
    root.appendChild(m);
    return m;
  }
  function tryInject(root) {
    if (!root) return;
    root.querySelectorAll('.card').forEach(function(card) {
      if (card.getAttribute(markerAttr)) return;
      var title = card.querySelector('.card-title');
      if (!title || !isSkillsCardTitle(title)) return;
      if (card.closest('.card') && card.closest('.card') !== card) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = btnClass;
      btn.setAttribute(markerAttr, '1');
      btn.textContent = 'スキルマーケット';
      btn.addEventListener('click', function() {
        var m = ensureModal(root);
        if (m) m.style.display = 'flex';
      });
      var sub = card.querySelector('.card-sub');
      if (sub && sub.nextSibling) card.insertBefore(btn, sub.nextSibling);
      else if (sub) sub.parentNode.insertBefore(btn, sub.nextSibling);
      else card.insertBefore(btn, card.firstChild);
    });
  }
  function run(root) {
    if (!root) return;
    if (!root.querySelector('#' + styleId)) {
      var style = document.createElement('style');
      style.id = styleId;
      style.textContent = fullCss;
      root.appendChild(style);
    }
    tryInject(root);
  }
  function attach() {
    var root = getRoot();
    if (root) {
      run(root);
      var obs = new MutationObserver(function() { tryInject(root); });
      obs.observe(root, { childList: true, subtree: true });
      return true;
    }
    return false;
  }
  function scheduleAttach() {
    setTimeout(attach, 0);
    setTimeout(attach, 100);
    setTimeout(attach, 400);
  }
  if (typeof customElements !== 'undefined' && customElements.whenDefined) {
    customElements.whenDefined('openclaw-app').then(scheduleAttach).catch(function() { scheduleAttach(); });
  } else {
    scheduleAttach();
  }
  var tries = 0;
  var t = setInterval(function() {
    if (attach() || ++tries > 100) clearInterval(t);
  }, 200);
  setTimeout(attach, 500);
  setTimeout(attach, 1500);
  setTimeout(attach, 3500);
})();
`;
  webContents.executeJavaScript(script).catch(() => {});
}

/** チャット欄・品牌・プレースホルダーを日本語／SuperClaw に差し替え（ローカル UI 用）。MutationObserver のみで DOM 変更に反応し、定時ポーリングは使わない（メモリ・負荷・不安定さを避ける）。 */
function injectDashboardJapaneseStrings(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  const script = `
(function() {
  var btnMap = { 'Send': '送信', 'New session': '新規セッション', 'Queue': 'キュー', 'Stop': '停止', 'Message': 'メッセージ' };
  var placeholderJa = 'メッセージを入力… (Enter で送信、Shift+Enter で改行、画像は貼り付け可)';
  var placeholderDisconnected = 'チャットを開始するにはゲートウェイに接続してください。';
  var placeholderWithImages = 'メッセージを追加、または画像を貼り付け…';
  function setPlaceholder(el, val) {
    if (!el) return;
    el.placeholder = val;
  }
  function replaceText(el, from, to) {
    if (!el || !el.textContent || el.textContent.indexOf(from) === -1) return;
    el.textContent = el.textContent.replace(from, to);
  }
  function walk(root) {
    if (!root) return;
    try {
      root.querySelectorAll('.brand-title').forEach(function(el) { replaceText(el, 'OPENCLAW', 'SuperClaw'); });
      root.querySelectorAll('.brand-sub').forEach(function(el) { replaceText(el, 'Gateway Dashboard', 'ゲートウェイ ダッシュボード'); });
      root.querySelectorAll('.brand-logo img').forEach(function(img) {
        try {
          var base = img.baseURI ? img.baseURI.replace(/[^/]+$/, '') : '';
          if (base) img.src = base + 'assets/superclaw-icon.png';
        } catch (e) {}
      });
      root.querySelectorAll('button').forEach(function(btn) {
        var raw = btn.textContent || '';
        for (var k in btnMap) {
          if (raw.indexOf(k) !== -1) { btn.textContent = raw.replace(k, btnMap[k]); break; }
        }
      });
      root.querySelectorAll('.chat-compose__field label span').forEach(function(span) {
        if (span.textContent && span.textContent.trim() === 'Message') span.textContent = 'メッセージ';
      });
      root.querySelectorAll('.chat-compose__field textarea').forEach(function(ta) {
        var ph = (ta.placeholder || '');
        if (/Connect to the gateway/i.test(ph)) setPlaceholder(ta, placeholderDisconnected);
        else if (/Add a message or paste/i.test(ph)) setPlaceholder(ta, placeholderWithImages);
        else if (/Message|メッセージ|send|line break|paste image|↩/i.test(ph)) setPlaceholder(ta, placeholderJa);
      });
      root.querySelectorAll('input[placeholder], textarea[placeholder]').forEach(function(el) {
        var ph = (el.placeholder || '');
        if (/heartbeat/i.test(ph)) setPlaceholder(el, 'ハートビート');
        if (/Type a command/i.test(ph)) setPlaceholder(el, 'コマンドを入力…');
      });
      root.querySelectorAll('*').forEach(function(el) {
        var t = (el.textContent || '').trim();
        if (t === '拖拽至此上传') el.textContent = 'ここにドラッグしてアップロード';
        if (t === 'New messages') el.textContent = '新しいメッセージ';
        if (t === 'Loading chat…') el.textContent = 'チャットを読み込み中…';
        if (t === 'Type a command…') el.textContent = 'コマンドを入力…';
      });
      root.querySelectorAll('.chat-queue__title').forEach(function(el) {
        if (el.textContent && el.textContent.startsWith('Queued')) el.textContent = el.textContent.replace('Queued', 'キュー');
      });
      root.querySelectorAll('*').forEach(function(el) {
        if (el.shadowRoot) walk(el.shadowRoot);
      });
    } catch (e) {}
  }
  function run() { walk(document.body); }
  run();
  setTimeout(run, 500);
  setTimeout(run, 1500);
  var debounceTimer = null;
  var pending = false;
  function scheduleRun() {
    if (pending) return;
    pending = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function() {
      debounceTimer = null;
      pending = false;
      run();
    }, 80);
  }
  var obs = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      if (mutations[i].addedNodes.length) { scheduleRun(); break; }
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
  setTimeout(run, 4000);
  setTimeout(run, 8000);
})();
`;
  webContents.executeJavaScript(script).catch(() => {});
}

/** control-ui-ja（file:// 或本機 HTTP）共通：SuperClaw 日文優化・毛玻璃等（與 createDashboardWindow 內 file 分支一致）。 */
function attachControlUiJapaneseEnhancements(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  hideDashboardUpdateBanner(webContents);
  injectGatewayModalStyles(webContents);
  injectDashboardLayoutStyles(webContents);
  injectDashboardLightTheme(webContents);
  injectDashboardGlassStyles(webContents);
  injectDashboardJapaneseStrings(webContents);
  injectDashboardIntoShadowRoot(webContents);
}

/** 主界面 index.html：打包后仅 src/main 在 unpacked 时，../renderer 可能不存在，需多路径回退。 */
function getMainRendererHtmlPath() {
  const rel = path.join(__dirname, '..', 'renderer', 'index.html');
  const safeRel = path.join(__dirname, '..', 'renderer-safe', 'index.html');
  if (!app.isPackaged) return rel;
  // 必須先嘗試 app.asar.unpacked：若先用 __dirname 相對路徑，在 App Translocation / 部分環境下會誤判為
  // .../app.asar/src/renderer（實際檔案在 unpacked），導致本機 HTTP 讀錯目錄 → loadURL ERR_FAILED (-2)。
  // 優先完整安裝精靈 renderer；僅在缺檔或 SUPERCLAW_USE_RENDERER_SAFE=1 時回退 renderer-safe。
  const safeCandidates =
    process.env.SUPERCLAW_USE_RENDERER_SAFE === '1'
      ? [
          path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'renderer-safe', 'index.html'),
          safeRel,
        ]
      : [];
  const candidates = [
    path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'renderer', 'index.html'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'renderer', 'index.html'),
    rel,
    ...safeCandidates,
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

/** 打包後 preload 必須優先 app.asar.unpacked；僅依 __dirname 在 Translocation 下可能指到 app.asar 虛路徑 → 預載入失敗或 renderer 異常。 */
function getMainPreloadPath() {
  const rel = path.join(__dirname, 'preload.js');
  if (!app.isPackaged) return rel;
  const candidates = [
    path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'main', 'preload.js'),
    rel,
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

/** 視窗圖示：build 多在 app.asar 內，unpacked 的 __dirname 相對路徑常找不到。 */
function getMainWindowIconPath() {
  const rel = path.join(__dirname, '../../build/icons/icon-512.png');
  if (!app.isPackaged) return rel;
  const candidates = [
    path.join(process.resourcesPath, 'app.asar', 'build', 'icons', 'icon-512.png'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'build', 'icons', 'icon-512.png'),
    rel,
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return rel;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 640,
    minWidth: 560,
    minHeight: 520,
    title: 'SuperClaw セットアップ',
    backgroundColor: '#f8f9fc',
    icon: getMainWindowIconPath(),
    webPreferences: {
      preload: getMainPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      // arm64 穩定性模式：關閉 sandbox / webgl，降低渲染進程崩潰概率。
      backgroundThrottling: false,
      sandbox: !arm64StableMode ? undefined : false,
      webgl: !arm64StableMode ? undefined : false,
      spellcheck: false,
    },
    show: false,
  });

  const tryShowMainWindow = () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      try { mainWindow.show(); } catch (_) {}
    }
  };

  const showFallbackTimer = setTimeout(() => {
    tryShowMainWindow();
  }, 3500);
  mainWindow.once('ready-to-show', () => {
    clearTimeout(showFallbackTimer);
    tryShowMainWindow();
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    clearTimeout(showFallbackTimer);
    tryShowMainWindow();
    try {
      fs.appendFileSync(
        debugLogPath(),
        JSON.stringify({ event: 'main-did-fail-load', code, desc, url, rendererPath: getMainRendererHtmlPath(), timestamp: Date.now() }) + '\n'
      );
    } catch (_) {}
    dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'SuperClaw',
      message: 'メイン画面の読み込みに失敗しました',
      detail: `${desc || code}\n${url || ''}\n\nログ: ~/.superclaw-setup-debug.log`,
    }).catch(() => {});
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    try {
      fs.appendFileSync(
        debugLogPath(),
        JSON.stringify({
          event: 'main-render-process-gone',
          reason: details && details.reason,
          exitCode: details && details.exitCode,
          details,
          rendererHtml: getMainRendererHtmlPath(),
          preload: getMainPreloadPath(),
          timestamp: Date.now(),
        }) + '\n'
      );
    } catch (_) {}
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  const rendererHtml = getMainRendererHtmlPath();
  if (!fs.existsSync(rendererHtml)) {
    clearTimeout(showFallbackTimer);
    tryShowMainWindow();
    dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'SuperClaw',
      message: 'インストールが不完全です',
      detail: `見つかりません: ${rendererHtml}\nアプリを再ダウンロードしてください。`,
    }).catch(() => {});
    return;
  }
  // 11.log：路徑已正確（app.asar.unpacked）時，主視窗 loadURL(http://127.0.0.1:…) 仍 ERR_FAILED(-2)（App Translocation 等環境下常見）。
  // Dashboard 用本機 HTTP 可行，但主視窗改回 loadFile；getMainRendererHtmlPath / preload 已固定優先 unpacked。
  try {
    fs.appendFileSync(
      debugLogPath(),
      JSON.stringify({
        event: 'main-load-loadfile',
        rendererHtml,
        preload: getMainPreloadPath(),
        isPackaged: app.isPackaged,
        arch: process.arch,
        timestamp: Date.now(),
      }) + '\n'
    );
  } catch (_) {}
  mainWindow.loadFile(rendererHtml);
  if (!app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (e, input) => {
      if ((input.meta || input.control) && input.shift && input.key === 'D') {
        e.preventDefault();
        waitForGateway().then(() => void createDashboardWindow());
      }
    });
  }
}

/** 注册 app: 协议，从 dashboard-renderer 目录提供文件；/api は 18789 にプロキシ。 */
function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    let pathname;
    try {
      const u = new URL(request.url);
      const pathPart = (u.pathname || '').replace(/^\/+/, '');
      // app://dashboard/index.html → pathname=dashboard/index.html；app://dashboard/assets/xxx → dashboard/assets/xxx。ルート host の場合は host を外して base からの相対パスにする。
      const rawPath = (u.host ? u.host + (pathPart ? '/' + pathPart : '') : pathPart) || 'index.html';
      pathname = (rawPath.startsWith(APP_PROTOCOL_HOST + '/') || rawPath === APP_PROTOCOL_HOST)
        ? (rawPath === APP_PROTOCOL_HOST ? 'index.html' : rawPath.slice(APP_PROTOCOL_HOST.length + 1))
        : rawPath;
    } catch (_) {
      return new Response('', { status: 400 });
    }
    if (pathname.includes('..')) return new Response('', { status: 403 });
    // /api 系はゲートウェイへプロキシ（Vue が app:// 同一オリジンで fetch するため）
    if (pathname.startsWith('api/') || pathname === 'api') {
      try {
        const u = new URL(request.url);
        const gatewayUrl = 'http://127.0.0.1:18789/' + pathname + (u.search || '');
        const opts = { method: request.method, headers: {} };
        request.headers.forEach((v, k) => { opts.headers[k] = v; });
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          try { opts.body = await request.arrayBuffer(); } catch (_) {}
        }
        const res = await fetch(gatewayUrl, opts);
        const body = await res.arrayBuffer();
        const headers = {};
        res.headers.forEach((v, k) => { headers[k] = v; });
        return new Response(body, { status: res.status, headers });
      } catch (_) {
        return new Response('', { status: 502 });
      }
    }
    const base = getDashboardRendererBasePath();
    const indexPath = path.join(base, 'index.html');
    if (!base || !fs.existsSync(indexPath)) {
      try {
        const logPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.superclaw-setup-debug.log');
        fs.appendFileSync(logPath, JSON.stringify({ event: 'app-protocol-404', base, pathname, existsIndex: fs.existsSync(indexPath), timestamp: Date.now() }) + '\n');
      } catch (_) {}
      return new Response('', { status: 404 });
    }
    const filePath = path.join(base, pathname);
    try {
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        try {
          const logPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.superclaw-setup-debug.log');
          fs.appendFileSync(logPath, JSON.stringify({ event: 'app-protocol-404-file', pathname, filePath, timestamp: Date.now() }) + '\n');
        } catch (_) {}
        return new Response('', { status: 404 });
      }
      const resolved = path.resolve(filePath);
      const baseResolved = path.resolve(base);
      if (resolved !== baseResolved && !resolved.startsWith(baseResolved + path.sep)) return new Response('', { status: 403 });
      const ext = path.extname(pathname).toLowerCase();
      const mime = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff' }[ext] || null;
      const body = fs.readFileSync(resolved);
      const headers = { 'Content-Type': mime || 'application/octet-stream', 'Content-Security-Policy': APP_PROTOCOL_CSP };
      return new Response(body, { status: 200, headers });
    } catch (_) {
      return new Response('', { status: 500 });
    }
  });
}

app.whenReady().then(() => {
  if (protocol && typeof protocol.handle === 'function') registerAppProtocol();
  if (process.env.TEST_DASHBOARD_CSP) {
    createDashboardWindow();
    return;
  }
  // 僅除錯：設 SUPERCLAW_ARM64_DIRECT_DASHBOARD=1 時跳過主安裝精靈直開 Dashboard。預設與 Intel 一致先走安裝流程（Helper entitlements 修復後主視窗應可正常）。
  if (app.isPackaged && isMacArm64 && process.env.SUPERCLAW_ARM64_DIRECT_DASHBOARD === '1') {
    try {
      fs.appendFileSync(
        debugLogPath(),
        JSON.stringify({ event: 'arm64-direct-dashboard', reason: 'env-SUPERCLAW_ARM64_DIRECT_DASHBOARD=1', buildTag: ARM64_BUILD_TAG, timestamp: Date.now() }) + '\n'
      );
    } catch (_) {}
    ensureGatewayStartedAtLaunch();
    createDashboardWindow();
    initAutoUpdater({ getMainWindow: () => dashboardWindow || mainWindow });
    return;
  }
  createWindow();
  ensureGatewayStartedAtLaunch();
  initAutoUpdater({ getMainWindow: () => mainWindow });
});
app.on('window-all-closed', () => {
  setImmediate(() => app.quit());
});

ipcMain.handle('system-check', () => systemCheck.run());

ipcMain.handle('install-node', () => nodeInstaller.run(mainWindow));

/**
 * Terminal でスクリプトを実行する。Terminal から xcode-select --install を叩くとシステムのインストールウィンドウが確実に表示される。
 * スクリプトは「インストール完了後に Enter を押して閉じる」まで待つので、「プロセスが完了しました」で誤解しない。
 */
function openXcodeCltInstall() {
  const scriptPath = path.join(os.tmpdir(), 'install-xcode-command-line-tools.command');
  const script = `#!/bin/sh
echo ""
echo "=========================================="
echo "コマンドラインツールのインストール"
echo "=========================================="
echo ""
xcode-select --install
echo ""
echo "※ 別のウィンドウ（「コマンドラインツールをインストール」）が表示されます。"
echo "  そのウィンドウで「インストール」を押し、完了するまで待ってください。"
echo ""
printf "完了したら Enter を押してこのウィンドウを閉じてください... "
read dummy
echo ""
echo "閉じます。"
`;
  fs.writeFileSync(scriptPath, script, { mode: 0o755 });
  shell.openPath(scriptPath).then((err) => {
    if (err) {
      require('child_process').spawn('open', ['-a', 'Terminal', scriptPath], { stdio: 'ignore' });
    }
  }).catch(() => {
    require('child_process').spawn('open', ['-a', 'Terminal', scriptPath], { stdio: 'ignore' });
  });
}

ipcMain.handle('install-xcode-clt', async () => {
  if (process.platform !== 'darwin') return { ok: false, error: 'macOS のみ' };
  await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'コマンドラインツールのインストール',
    message: 'これから Terminal とシステムのウィンドウが開きます',
    detail:
      '1. Terminal が開いたら、そのままにしてください。\n' +
      '2. 別のウィンドウ（「コマンドラインツールをインストール」）が表示されます。そのウィンドウで「インストール」を押し、完了するまで待ってください。\n' +
      '3. インストールが終わったら、Terminal に戻り「Enter」キーを押して閉じてください。\n\n' +
      'その後、このアプリに戻り「インストールする」をもう一度押してください。',
    buttons: ['OK'],
  });
  openXcodeCltInstall();
  return { ok: true };
});

function hasXcodeCltOrGit() {
  if (process.platform !== 'darwin') return true;
  try {
    require('child_process').execSync('/usr/bin/xcode-select -p', { encoding: 'utf8', timeout: 3000 });
    return true;
  } catch (_) {}
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    require('child_process').execSync(`${shell} -l -c 'git --version'`, { encoding: 'utf8', timeout: 5000 });
    return true;
  } catch (_) {}
  return false;
}

// 同梱 OpenClaw がある場合はクライアント内で完結（Qclaw 方式）。Terminal / Homebrew / npm 不要。
ipcMain.handle('start-install', async () => {
  if (installer.hasBundledOpenclaw()) {
    try {
      await installer.runBundledInstallVerify(mainWindow);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message || 'Install failed' };
    }
  }
  return { ok: false, error: 'Bundled OpenClaw not found. Rebuild the app with npm run prepare-openclaw.' };
});

ipcMain.handle('run-onboard', async () => {
  try {
    await installer.runOnboardSkipAuth(mainWindow);
    ensureControlUiAllowedOriginsForFile();
    if (installer.hasBundledOpenclaw()) installer.startBundledGateway();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('login-codex', async () => {
  try {
    await installer.loginCodex(mainWindow);
    await installer.setDefaultModel('openai-codex/gpt-5.4');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('login-qwen', async () => {
  // #region agent log
  // #endregion
  try {
    await installer.loginQwen(mainWindow);
    debugLog('index.js:login-qwen', 'loginQwen returned, calling setDefaultModel', {}, 'H-A');
    await installer.setDefaultModel('qwen-portal/coder-model');
    debugLog('index.js:login-qwen', 'setDefaultModel done', { ok: true }, 'H-A');
    return { ok: true };
  } catch (e) {
    debugLog('index.js:login-qwen', 'login-qwen catch', { ok: false, error: e.message }, 'H-A');
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('set-default-model', (_, model) => installer.setDefaultModel(model));
ipcMain.handle('has-valid-license', () => license.hasValidLicense(app));
ipcMain.handle('verify-license', (_, key) => license.verifyLicenseKey(app, key));
ipcMain.handle('open-external', (_, url) => {
  if (url && typeof url === 'string') shell.openExternal(url);
});
ipcMain.handle('open-dashboard', async () => {
  try {
    // 保证 18789 始终为官方 UI：若曾被改为我们的 UI 则清除并重启网关
    const restored = ensure18789UsesOfficialControlUi();
    if (restored) {
      await new Promise((r) => setTimeout(r, 2000));
    }
    let ready = await waitForGateway(8000, 400);
    if (!ready && installer.hasBundledOpenclaw()) {
      installer.startBundledGateway();
      ready = await waitForGateway(8000, 400);
    }
    if (ready) {
      await new Promise((r) => setTimeout(r, 1500));
    }
    await createDashboardWindow();
  } catch (e) {
    try {
      fs.appendFileSync(path.join(process.env.HOME || process.env.USERPROFILE || '', '.superclaw-setup-debug.log'), JSON.stringify({ event: 'open-dashboard-error', error: String(e && e.message), stack: e && e.stack, timestamp: Date.now() }) + '\n');
    } catch (_) {}
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    dialog.showMessageBox(win, { type: 'error', title: 'SuperClaw', message: 'ダッシュボードを開けませんでした', detail: String(e && e.message) }).catch(() => {});
    throw e;
  }
});

// Dashboard window (QClaw-style renderer) IPC：窗口控制、网关 token/URL、打开控制台
function getDashboardWin(event) {
  return BrowserWindow.fromWebContents(event.sender);
}
ipcMain.handle('dashboard:window:minimize', (event) => { getDashboardWin(event)?.minimize(); });
ipcMain.handle('dashboard:window:maximize', (event) => { getDashboardWin(event)?.maximize(); });
ipcMain.handle('dashboard:window:close', (event) => { getDashboardWin(event)?.close(); });
ipcMain.handle('dashboard:window:isMaximized', (event) => getDashboardWin(event)?.isMaximized() ?? false);
let lastGetStatusLog = 0;
const GET_STATUS_LOG_INTERVAL_MS = 10000;
ipcMain.handle('dashboard:process:getStatus', async () => {
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 3000);
    await fetch('http://127.0.0.1:18789/', { signal: controller.signal });
    const now = Date.now();
    if (now - lastGetStatusLog >= GET_STATUS_LOG_INTERVAL_MS) {
      lastGetStatusLog = now;
      debugLog('index.js:dashboard:process:getStatus', 'gateway ok', { status: 'running', port: 18789 }, 'H-D');
    }
    return { status: 'running', port: 18789 };
  } catch (e) {
    const now = Date.now();
    if (now - lastGetStatusLog >= GET_STATUS_LOG_INTERVAL_MS) {
      lastGetStatusLog = now;
      debugLog('index.js:dashboard:process:getStatus', 'gateway not ready', { status: 'stopped', error: e?.message || String(e) }, 'H-D');
    }
    return { status: 'stopped', port: null };
  }
});
ipcMain.handle('dashboard:process:openControlUI', async () => {
  const token = getGatewayToken();
  const url = 'http://127.0.0.1:18789/' + (token ? '#token=' + encodeURIComponent(token) : '');
  await shell.openExternal(url);
});
/** 允许 Dashboard 写入的 OpenClaw 配置 key（白名单）。仅限与「外壳」相关的非敏感项。 */
const DASHBOARD_CONFIG_UPDATE_ALLOWED = new Set([
  'agents.defaults.model.primary',
]);

function setByPath(obj, keyPath, value) {
  const keys = keyPath.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    const next = cur[k];
    if (next != null && typeof next === 'object' && !Array.isArray(next)) {
      cur = next;
    } else {
      cur[k] = {};
      cur = cur[k];
    }
  }
  cur[keys[keys.length - 1]] = value;
}

ipcMain.handle('dashboard:config:getField', async (_, keyPath) => {
  if (keyPath === 'gateway.auth.token' || keyPath === 'gateway.auth') {
    const token = getGatewayToken();
    return token ? { token } : null;
  }
  if (keyPath === 'gateway.port') return 18789;
  if (keyPath === 'agents.defaults.model.primary' || keyPath === 'models.default') {
    try {
      const raw = fs.readFileSync(getOpenClawConfigPath(), 'utf8');
      const config = JSON.parse(raw);
      const primary = config?.agents?.defaults?.model?.primary;
      return primary != null ? primary : null;
    } catch {
      return null;
    }
  }
  return null;
});

/** Dashboard 作为外壳：将 UI 的配置变更写回 OpenClaw。仅接受白名单内的 key。 */
ipcMain.handle('dashboard:config:updateField', async (_, partialConfig) => {
  if (!partialConfig || typeof partialConfig !== 'object') {
    return { success: false, error: 'Invalid partialConfig' };
  }
  const configPath = getOpenClawConfigPath();
  if (!fs.existsSync(configPath)) {
    return { success: false, error: 'OpenClaw config file not found' };
  }
  const allowed = {};
  for (const keyPath of Object.keys(partialConfig)) {
    if (!DASHBOARD_CONFIG_UPDATE_ALLOWED.has(keyPath)) continue;
    const v = partialConfig[keyPath];
    if (v !== undefined) allowed[keyPath] = v;
  }
  if (Object.keys(allowed).length === 0) {
    return { success: true };
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    for (const [keyPath, value] of Object.entries(allowed)) {
      setByPath(config, keyPath, value);
    }
    const dir = path.dirname(configPath);
    const tmpPath = path.join(dir, `.openclaw.json.${Date.now()}.tmp`);
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
    fs.renameSync(tmpPath, configPath);
    return { success: true };
  } catch (e) {
    debugLog('index.js:dashboard:config:updateField', 'error', { message: e?.message }, 'H-D');
    return { success: false, error: e?.message || 'Write failed' };
  }
});
ipcMain.handle('dashboard:app:getMachineId', async () => require('os').hostname());
ipcMain.handle('dashboard:app:getVersion', async () => app.getVersion());

/** Dashboard 初期化画面用。getBootState が object { mode } を返すと InitLoading が initializing に入り、getStatus をポーリングして gateway が running になったら /chat へ遷移する。 */
ipcMain.handle('dashboard:instance:getBootState', async () => {
  const result = { mode: 'isolated' };
  debugLog('index.js:dashboard:instance:getBootState', 'called', result, 'H-D');
  return result;
});
ipcMain.handle('dashboard:instance:retryBoot', async () => {
  const result = { mode: 'isolated' };
  debugLog('index.js:dashboard:instance:retryBoot', 'called', result, 'H-D');
  return result;
});

/** 既に OpenClaw / Gateway が使える状態か。token だけでなく password 認証・環境変数・本機 18789 応答も含む。 */
ipcMain.handle('has-existing-openclaw-config', async () => {
  let hasExistingConfig = hasExistingOpenClawSetupSync();
  if (!hasExistingConfig) {
    try {
      const cfg = readOpenClawConfigSafe();
      const p = cfg?.gateway?.port;
      const port = typeof p === 'number' && p > 0 && p < 65536 ? p : 18789;
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 1500);
      await fetch(`http://127.0.0.1:${port}/`, { signal: controller.signal });
      clearTimeout(t);
      hasExistingConfig = true;
    } catch (_) {
      /* 未起動或端口非本机 */
    }
  }
  // #region agent log
  debugLog('index.js:has-existing-openclaw-config', 'result', { hasExistingConfig }, 'H-E');
  // #endregion
  return { hasExistingConfig };
});

/** OpenClaw 与 gateway 一致：sessionKey 仅允许安全字符，用于 transcript 路径。 */
const SAFE_SESSION_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
function getSessionTranscriptPath(sessionKey) {
  const trimmed = (sessionKey == null ? '' : String(sessionKey)).trim();
  if (!SAFE_SESSION_ID_RE.test(trimmed)) return null;
  return path.join(getOpenClawStateDir(), 'agents', 'main', 'sessions', `${trimmed}.jsonl`);
}

/** Dashboard 作为外壳：撤销当前会话最后一条对话（删除 transcript 最后一条 user+assistant）。 */
ipcMain.handle('dashboard:session:trimLastExchange', async (_, sessionKey) => {
  const transcriptPath = getSessionTranscriptPath(sessionKey);
  if (!transcriptPath) return { success: false, error: 'Invalid sessionKey' };
  if (!fs.existsSync(transcriptPath)) return { success: false, error: 'Transcript not found' };
  try {
    const raw = fs.readFileSync(transcriptPath, 'utf8');
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const indices = []; // { index, role } for message lines only
    for (let i = 0; i < lines.length; i++) {
      try {
        const obj = JSON.parse(lines[i]);
        if (obj && obj.type === 'session') continue; // header
        const role = obj?.message?.role || obj?.role;
        if (role === 'user' || role === 'assistant') indices.push({ index: i, role });
      } catch (_) { /* skip malformed line */ }
    }
    if (indices.length < 2) return { success: true, trimmed: false };
    const last = indices[indices.length - 1];
    const prev = indices[indices.length - 2];
    const removeIdx = new Set([last.index].concat(last.role === 'assistant' && prev.role === 'user' ? [prev.index] : []));
    const newLines = lines.filter((_, i) => !removeIdx.has(i));
    const tmpPath = transcriptPath + `.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, newLines.join('\n') + (newLines.length ? '\n' : ''), 'utf8');
    fs.renameSync(tmpPath, transcriptPath);
    return { success: true, trimmed: true };
  } catch (e) {
    debugLog('index.js:dashboard:session:trimLastExchange', 'error', { message: e?.message }, 'H-D');
    return { success: false, error: e?.message || 'Trim failed' };
  }
});

/** Dashboard: OpenClaw の sessions.json を読み、会话一覧を返す。keyword が空なら全件、指定時はタイトル検索。 */
ipcMain.handle('dashboard:session:search', async (_, keyword, limit) => {
  try {
    const stateDir = getOpenClawStateDir();
    const sessionsJsonPath = path.join(stateDir, 'agents', 'main', 'sessions', 'sessions.json');
    if (!fs.existsSync(sessionsJsonPath)) return [];
    const raw = fs.readFileSync(sessionsJsonPath, 'utf8');
    const sessionsData = JSON.parse(raw);
    const trimmedKeyword = (keyword == null ? '' : String(keyword)).trim();
    const lowerKeyword = trimmedKeyword.toLowerCase();
    const maxResults = typeof limit === 'number' && limit > 0 ? limit : 200;
    const results = [];
    for (const [sessionKey, sessionInfo] of Object.entries(sessionsData)) {
      const label = (sessionInfo?.label || '').trim();
      const displayName = (sessionInfo?.displayName || '').trim();
      const title = label || displayName || sessionKey;
      if (trimmedKeyword && !title.toLowerCase().includes(lowerKeyword)) continue;
      results.push({
        sessionKey,
        title,
        matchType: trimmedKeyword ? 'title' : 'list',
        updatedAt: sessionInfo?.updatedAt,
      });
    }
    results.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return results.slice(0, maxResults);
  } catch (e) {
    debugLog('index.js:dashboard:session:search', 'error', { message: e?.message }, 'H-D');
    return [];
  }
});

/** Dashboard 作为外壳：设置 OpenClaw 默认模型（调用 openclaw models set）。 */
ipcMain.handle('dashboard:openclaw:setDefaultModel', async (_, modelId) => {
  if (!modelId || typeof modelId !== 'string') {
    return { success: false, error: 'Invalid modelId' };
  }
  try {
    await installer.setDefaultModel(modelId);
    return { success: true };
  } catch (e) {
    debugLog('index.js:dashboard:openclaw:setDefaultModel', 'error', { message: e?.message }, 'H-D');
    return { success: false, error: e?.message || 'Set default model failed' };
  }
});

/** Dashboard 作为外壳：一次获取默认模型 + 会话列表，供 UI 初始化用。 */
ipcMain.handle('dashboard:shell:getState', async () => {
  try {
    let defaultModel = null;
    try {
      const raw = fs.readFileSync(getOpenClawConfigPath(), 'utf8');
      const config = JSON.parse(raw);
      defaultModel = config?.agents?.defaults?.model?.primary ?? null;
    } catch (_) {}
    let sessions = [];
    try {
      const stateDir = getOpenClawStateDir();
      const sessionsJsonPath = path.join(stateDir, 'agents', 'main', 'sessions', 'sessions.json');
      if (fs.existsSync(sessionsJsonPath)) {
        const raw = fs.readFileSync(sessionsJsonPath, 'utf8');
        const data = JSON.parse(raw);
        sessions = Object.entries(data).map(([sessionKey, sessionInfo]) => ({
          sessionKey,
          title: (sessionInfo?.label || sessionInfo?.displayName || sessionKey).trim() || sessionKey,
          updatedAt: sessionInfo?.updatedAt,
        }));
        sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        sessions = sessions.slice(0, 100);
      }
    } catch (_) {}
    return { defaultModel, sessions };
  } catch (e) {
    debugLog('index.js:dashboard:shell:getState', 'error', { message: e?.message }, 'H-D');
    return { defaultModel: null, sessions: [] };
  }
});

/** Dashboard: OpenClaw に設定されているモデル一覧を返す（config から取得、未設定時は空配列）。 */
ipcMain.handle('dashboard:openclaw:getModels', async () => {
  try {
    const configPath = getOpenClawConfigPath();
    if (!fs.existsSync(configPath)) return [];
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    const models = new Set();
    const primary = config?.agents?.defaults?.model?.primary;
    if (primary && typeof primary === 'string') models.add(primary);
    const providers = config?.models?.providers;
    if (providers && typeof providers === 'object') {
      for (const [providerId, providerConfig] of Object.entries(providers)) {
        if (providerConfig?.models && Array.isArray(providerConfig.models)) {
          providerConfig.models.forEach((m) => {
            if (typeof m === 'string') models.add(m);
            if (m?.id) models.add(m.id);
          });
        }
        if (providerId && typeof providerId === 'string') models.add(providerId);
      }
    }
    return Array.from(models).filter(Boolean);
  } catch (e) {
    debugLog('index.js:dashboard:openclaw:getModels', 'error', { message: e?.message }, 'H-D');
    return [];
  }
});
