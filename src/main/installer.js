const { spawn, execSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { app, shell } = require('electron');

/** 调试用：同时发往 7242 并写入本机文件，便于在测试机上复现后带回日志。 */
function debugLog(location, message, data, hypothesisId) {
  const payload = { location, message, data: data || {}, hypothesisId, timestamp: Date.now() };
  try { fetch('http://127.0.0.1:7242/ingest/bb10cbe1-eb61-49ac-a7a6-a688bfda1c50', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => {}); } catch (_) {}
  try {
    const logPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.superclaw-setup-debug.log');
    fs.appendFileSync(logPath, JSON.stringify(payload) + '\n');
  } catch (_) {}
}

/** アプリに同梱した OpenClaw のルート（openclaw.mjs と node_modules があるディレクトリ）。Qclaw と同様に Electron を Node として使う。 */
function getBundledOpenclawRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'openclaw');
  }
  return path.join(app.getAppPath(), 'openclaw');
}

/** 主进程写入的 config 路径，gateway 子进程需与此一致才能读到 controlUi.root。 */
function getOpenClawConfigPathForGateway() {
  return process.env.OPENCLAW_CONFIG_PATH ||
    path.join(process.env.HOME || process.env.USERPROFILE || '', '.openclaw', 'openclaw.json');
}

function getBundledOpenclawMjs() {
  return path.join(getBundledOpenclawRoot(), 'openclaw.mjs');
}

/** 同梱 OpenClaw が使えるか（openclaw.mjs が存在するか）。 */
function hasBundledOpenclaw() {
  try {
    return fs.existsSync(getBundledOpenclawMjs());
  } catch {
    return false;
  }
}

/** 同梱 Node 22 のパス（OpenClaw は Node 22.12+ 必須。Electron は Node 18 のため、同梱 Node で実行する）。 */
function getBundledNodePath() {
  if (process.platform !== 'darwin') return null;
  const archDir = process.arch === 'arm64' ? 'darwin-arm64' : process.arch === 'x64' ? 'darwin-x64' : null;
  if (!archDir) return null;
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
  const nodePath = path.join(base, 'node-runtime', archDir, 'node');
  try {
    return fs.existsSync(nodePath) ? nodePath : null;
  } catch {
    return null;
  }
}

/** OpenClaw 公式: models auth login は interactive TTY 必須。非 TTY だと即 throw し、ブラウザも開かない。 */
function isAuthLoginArgs(args) {
  return args[0] === 'models' && args[1] === 'auth' && args[2] === 'login';
}

/** 同梱 OpenClaw を同梱 Node 22 で実行（Node 22.16+ 必須）。Terminal / Homebrew / npm 不要。 */
function runOpenclawBundled(mainWindow, args, options = {}) {
  const send = (event, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(event, data);
  };
  const cliPath = getBundledOpenclawMjs();
  const cwd = getBundledOpenclawRoot();
  const env = { ...process.env, OPENCLAW_EMBEDDED_IN: 'SuperClaw', ...(options.env || {}) };
  const nodeBin = getBundledNodePath();
  const exec = nodeBin || process.execPath;
  const execEnv = nodeBin ? env : { ...env, ELECTRON_RUN_AS_NODE: '1' };
  const useTty = process.platform === 'darwin' && isAuthLoginArgs(args);
  const spawnArgs = nodeBin ? [cliPath, ...args] : [cliPath, ...args];
  const spawnOpts = {
    env: execEnv,
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  };
  const child = useTty
    ? spawn('script', ['-q', '/dev/null', exec, ...spawnArgs], spawnOpts)
    : spawn(exec, spawnArgs, spawnOpts);
  const stderrChunks = options.collectStderr ? [] : null;
  return new Promise((resolve, reject) => {
    if (options.channel) {
      child.stdout.on('data', (chunk) => send(options.channel, { type: 'stdout', text: chunk.toString() }));
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        if (stderrChunks) stderrChunks.push(text);
        send(options.channel, { type: 'stderr', text });
      });
    }
    child.on('error', (err) => reject(err));
    child.on('close', (code, signal) => {
      if (code === 0) resolve({ code: 0 });
      else {
        const raw = stderrChunks && stderrChunks.length ? stderrChunks.join('').trim() : '';
        const lines = raw ? raw.split('\n').filter(Boolean) : [];
        const detail = lines.length ? (lines.length <= 3 ? lines.join(' ') : lines.slice(0, 3).join(' ')) : '';
        reject(new Error(detail || `Exit ${code} ${signal || ''}`));
      }
    });
  });
}

/** 「インストール」＝同梱 OpenClaw の準備確認。実際の npm インストールは行わない。 */
function runBundledInstallVerify(mainWindow) {
  const send = (event, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(event, data);
  };
  const lines = [
    'OpenClaw の環境を確認しています…\n',
    '必要なファイルを読み込んでいます…\n',
  ];
  lines.forEach((text) => send('install-log', { type: 'stdout', text }));

  return runOpenclawBundled(mainWindow, ['--version'], { channel: 'install-log' })
    .then(() => {
      [
        'バージョンの検証が完了しました。\n',
        'SuperClaw の準備が整いました。\n',
      ].forEach((text) => send('install-log', { type: 'stdout', text }));
      return { code: 0 };
    })
    .catch((e) => {
      send('install-log', { type: 'stderr', text: e.message });
      throw e;
    });
}

function runOpenclaw(mainWindow, args, options = {}) {
  if (hasBundledOpenclaw()) {
    return runOpenclawBundled(mainWindow, args, options);
  }
  const send = (event, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(event, data);
  };
  function getEnvWithPath() {
    const env = { ...process.env };
    try {
      const prefix = execSync('npm config get prefix', { encoding: 'utf8', timeout: 3000 }).trim();
      const binPath = path.join(prefix, process.platform === 'win32' ? '' : 'bin');
      const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
      const existing = env.PATH || env.Path || env[pathKey] || '';
      env.PATH = binPath + path.delimiter + existing;
      if (process.platform === 'win32') env.Path = env.PATH;
    } catch (_) {}
    return env;
  }
  const openclawCmd = (a) => 'openclaw ' + a.map((x) => (x.includes(' ') ? `"${x.replace(/"/g, '\\"')}"` : x)).join(' ');
  if (process.platform === 'darwin') {
    return new Promise((resolve, reject) => {
      const shell = process.env.SHELL || '/bin/zsh';
      const cmd = openclawCmd(args);
      const useTty = isAuthLoginArgs(args);
      const child = useTty
        ? spawn('script', ['-q', '/dev/null', shell, '-l', '-c', cmd], {
            env: { ...process.env },
            stdio: ['ignore', 'pipe', 'pipe'],
            ...options,
          })
        : spawn(shell, ['-l', '-c', cmd], {
            env: { ...process.env },
            stdio: ['ignore', 'pipe', 'pipe'],
            ...options,
          });
      const stderrChunks = options.collectStderr ? [] : null;
      if (options.channel) {
        child.stdout.on('data', (chunk) => send(options.channel, { type: 'stdout', text: chunk.toString() }));
        child.stderr.on('data', (chunk) => {
          const text = chunk.toString();
          if (stderrChunks) stderrChunks.push(text);
          send(options.channel, { type: 'stderr', text });
        });
      }
      child.on('error', reject);
      child.on('close', (code, signal) => {
        if (code === 0) resolve({ code: 0 });
        else {
          const raw = stderrChunks && stderrChunks.length ? stderrChunks.join('').trim() : '';
          const lines = raw ? raw.split('\n').filter(Boolean) : [];
          const detail = lines.length ? (lines.length <= 3 ? lines.join(' ') : lines.slice(-3).join(' ')) : '';
          reject(new Error(detail || `Exit ${code} ${signal || ''}`));
        }
      });
    });
  }
  const stderrChunks = options.collectStderr ? [] : null;
  return new Promise((resolve, reject) => {
    const env = getEnvWithPath();
    const cmd = process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw';
    const child = spawn(cmd, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      ...options,
    });
    if (options.channel) {
      child.stdout.on('data', (chunk) => send(options.channel, { type: 'stdout', text: chunk.toString() }));
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        if (stderrChunks) stderrChunks.push(text);
        send(options.channel, { type: 'stderr', text });
      });
    }
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolve({ code: 0 });
      else {
        const raw = stderrChunks && stderrChunks.length ? stderrChunks.join('').trim() : '';
        const lines = raw ? raw.split('\n').filter(Boolean) : [];
        const detail = lines.length ? (lines.length <= 3 ? lines.join(' ') : lines.slice(0, 3).join(' ')) : '';
        reject(new Error(detail || `Exit ${code} ${signal || ''}`));
      }
    });
  });
}

/**
 * 初期設定：認証はスキップし、ゲートウェイ・daemon・workspace のみ設定する。
 * ユーザーは先にモデル（Codex / Qwen）でログイン済みの想定。
 * 公式: --auth-choice skip + --gateway-token でトークンを平文で保存（daemon がそのまま読める）。
 */
async function runOnboardSkipAuth(mainWindow) {
  // #region agent log
  debugLog('installer.js:runOnboardSkipAuth', 'onboard start', {}, 'H-D');
  // #endregion
  const token = crypto.randomBytes(24).toString('hex');
  const args = [
    'onboard',
    '--non-interactive',
    '--mode', 'local',
    '--auth-choice', 'skip',
    '--gateway-auth', 'token',
    '--gateway-token', token,
    '--install-daemon',
    '--skip-skills',
    '--gateway-port', '18789',
    '--gateway-bind', 'loopback',
    '--accept-risk',
  ];
  return runOpenclaw(mainWindow, args, {
    channel: 'onboard-log',
    collectStderr: true,
  }).catch((e) => {
    // #region agent log
    debugLog('installer.js:runOnboardSkipAuth', 'onboard failed', { message: e.message }, 'H-D');
    // #endregion
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('onboard-log', { type: 'stderr', text: e.message });
    }
    throw e;
  });
}

/** 同梱 OpenClaw 時は standalone スクリプトで Codex OAuth を実行（ブラウザを open で開く）。CLI の TTY 不要。 */
async function loginCodex(mainWindow) {
  // #region agent log
  // #endregion
  const send = (event, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(event, data);
  };
  if (hasBundledOpenclaw()) {
    const openclawRoot = getBundledOpenclawRoot();
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const agentDir = path.join(home, '.openclaw', 'agents', 'main', 'agent');
    const appPath = app.getAppPath();
    const scriptPath = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', 'codex-oauth-standalone.js')
      : path.join(appPath, 'scripts', 'codex-oauth-standalone.js');
    const scriptExists = fs.existsSync(scriptPath);
    // #region agent log
    debugLog('installer.js:loginCodex', 'Codex branch', { hasBundled: true, scriptPath, scriptExists, isPackaged: app.isPackaged }, 'H-C');
    // #endregion
    if (!scriptExists) {
      return runOpenclaw(mainWindow, ['models', 'auth', 'login', '--provider', 'openai-codex'], { channel: 'model-auth-log' });
    }
    const nodeBin = getBundledNodePath();
    const exec = nodeBin || process.execPath;
    const env = { ...process.env, OPENCLAW_ROOT: openclawRoot, OPENCLAW_AGENT_DIR: agentDir, SUPERCLAW_OPEN_AUTH_VIA_STDOUT: '1' };
    const execEnv = nodeBin ? env : { ...env, ELECTRON_RUN_AS_NODE: '1' };
    const stderrChunks = [];
    return new Promise((resolve, reject) => {
      const child = spawn(exec, [scriptPath], {
        env: execEnv,
        cwd: openclawRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('OPEN_AUTH_URL:')) {
            const url = line.slice('OPEN_AUTH_URL:'.length).trim();
            if (url.startsWith('http')) shell.openExternal(url).catch(() => {});
            break;
          }
        }
        send('model-auth-log', { type: 'stdout', text });
      });
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderrChunks.push(text);
        send('model-auth-log', { type: 'stderr', text });
      });
      child.on('error', reject);
      child.on('close', (code, signal) => {
        const stderrText = stderrChunks.join('').trim();
        if (code !== 0) {
          debugLog('installer.js:loginCodex', 'Codex script exit', { code, signal, stderr: stderrText }, 'H-B');
          const detail = stderrText || `Exit ${code} ${signal || ''}`;
          reject(new Error(detail));
        } else {
          resolve({ code: 0 });
        }
      });
    });
  }
  return runOpenclaw(mainWindow, ['models', 'auth', 'login', '--provider', 'openai-codex'], { channel: 'model-auth-log' });
}

/** 同梱 OpenClaw 時は standalone スクリプトで Qwen device code OAuth を実行。CLI の TTY 不要。 */
async function loginQwen(mainWindow) {
  // #region agent log
  // #endregion
  const send = (event, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(event, data);
  };
  if (hasBundledOpenclaw()) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const agentDir = path.join(home, '.openclaw', 'agents', 'main', 'agent');
    const appPath = app.getAppPath();
    const scriptPath = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', 'qwen-oauth-standalone.js')
      : path.join(appPath, 'scripts', 'qwen-oauth-standalone.js');
    if (fs.existsSync(scriptPath)) {
      const nodeBin = getBundledNodePath();
      const exec = nodeBin || process.execPath;
      const env = { ...process.env, OPENCLAW_AGENT_DIR: agentDir };
      const execEnv = nodeBin ? env : { ...env, ELECTRON_RUN_AS_NODE: '1' };
      try {
        await new Promise((resolve, reject) => {
          const child = spawn(exec, [scriptPath], {
            env: execEnv,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          child.stdout.on('data', (chunk) => send('model-auth-log', { type: 'stdout', text: chunk.toString() }));
          child.stderr.on('data', (chunk) => send('model-auth-log', { type: 'stderr', text: chunk.toString() }));
          child.on('error', reject);
          child.on('close', (code, signal) => {
            if (code === 0) resolve();
            else reject(new Error(`Exit ${code} ${signal || ''}`));
          });
        });
      } catch (e) {
        debugLog('installer.js:loginQwen', 'Qwen step failed', { step: 'script', message: e.message }, 'H-B');
        throw e;
      }
      debugLog('installer.js:loginQwen', 'Qwen step ok', { step: 'script' }, 'H-B');
      const qwenOpts = {
        channel: 'model-auth-log',
        collectStderr: true,
        env: { OPENCLAW_AGENT_DIR: agentDir },
      };
      try {
        await runOpenclaw(mainWindow, ['plugins', 'enable', 'qwen-portal-auth'], qwenOpts);
      } catch (e) {
        debugLog('installer.js:loginQwen', 'Qwen step failed', { step: 'plugins_enable', message: e.message }, 'H-B');
        throw e;
      }
      debugLog('installer.js:loginQwen', 'Qwen step ok', { step: 'plugins_enable' }, 'H-B');
      try {
        await runOpenclaw(mainWindow, ['models', 'set', 'qwen-portal/coder-model'], qwenOpts);
      } catch (e) {
        debugLog('installer.js:loginQwen', 'Qwen step failed', { step: 'models_set', message: e.message }, 'H-B');
        throw e;
      }
      debugLog('installer.js:loginQwen', 'Qwen step ok', { step: 'models_set' }, 'H-B');
      return;
    }
  }
  const logOpts = { channel: 'model-auth-log', collectStderr: true };
  await runOpenclaw(mainWindow, ['plugins', 'enable', 'qwen-portal-auth'], logOpts).catch((e) => {
    throw new Error(e.message || 'Qwen プラグインの有効化に失敗しました');
  });
  return runOpenclaw(mainWindow, ['models', 'auth', 'login', '--provider', 'qwen-portal', '--set-default'], logOpts);
}

function setDefaultModel(providerModel) {
  return runOpenclaw(null, ['models', 'set', providerModel]);
}

function openDashboard() {
  const { shell } = require('electron');
  shell.openExternal('http://127.0.0.1:18789/');
}

/** 同梱 OpenClaw の gateway をバックグラウンドで起動（detached）。Dashboard を開くが gateway が未起動のときに呼ぶ。 */
function startBundledGateway() {
  if (!hasBundledOpenclaw()) return;
  const cliPath = getBundledOpenclawMjs();
  const cwd = getBundledOpenclawRoot();
  const configPath = getOpenClawConfigPathForGateway();
  const env = {
    ...process.env,
    OPENCLAW_EMBEDDED_IN: 'SuperClaw',
    OPENCLAW_CONFIG_PATH: configPath,
  };
  const nodeBin = getBundledNodePath();
  const exec = nodeBin || process.execPath;
  const execEnv = nodeBin ? env : { ...env, ELECTRON_RUN_AS_NODE: '1' };
  const spawnArgs = nodeBin ? [cliPath, 'gateway', '--port', '18789'] : [cliPath, 'gateway', '--port', '18789'];
  try {
    const child = spawn(exec, spawnArgs, {
      env: execEnv,
      cwd,
      stdio: 'ignore',
      detached: true,
    });
    child.unref();
  } catch (_) {}
}

const GATEWAY_PORT = 18789;

/** 指定ポートで listen しているプロセスを終了する。gateway に controlUi.root を反映させるために再起動するときに使う。 */
function stopProcessOnPort(port) {
  try {
    if (process.platform === 'darwin' || process.platform === 'linux') {
      const pid = execSync(`lsof -ti:${port}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (pid) {
        process.kill(parseInt(pid, 10), 'SIGTERM');
        return true;
      }
    }
  } catch (_) {}
  return false;
}

/** gateway を再起動し、設定（controlUi.root 等）を再読み込みさせる。旧プロセス終了を待ってから起動。 */
function restartBundledGateway() {
  if (!hasBundledOpenclaw()) return;
  stopProcessOnPort(GATEWAY_PORT);
  const start = () => {
    try {
      const pid = execSync(`lsof -ti:${GATEWAY_PORT}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (pid) execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
    } catch (_) {}
    startBundledGateway();
  };
  setTimeout(start, 1000);
}

module.exports = {
  hasBundledOpenclaw,
  runBundledInstallVerify,
  runOpenclaw,
  runOnboardSkipAuth,
  loginCodex,
  loginQwen,
  setDefaultModel,
  openDashboard,
  startBundledGateway,
  stopProcessOnPort,
  restartBundledGateway,
};
