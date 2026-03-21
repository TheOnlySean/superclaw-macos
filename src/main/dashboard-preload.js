/**
 * Preload for dashboard window (QClaw-style renderer).
 * Exposes electronAPI compatible with QClaw renderer; SuperClaw implements only token/gateway/openControlUI.
 */
const { contextBridge, ipcRenderer } = require('electron');

const noop = () => {};
const reject = (msg) => () => Promise.reject(new Error(msg || 'Not available in SuperClaw'));

const electronAPI = {
  window: {
    minimize: () => ipcRenderer.invoke('dashboard:window:minimize'),
    maximize: () => ipcRenderer.invoke('dashboard:window:maximize'),
    close: () => ipcRenderer.invoke('dashboard:window:close'),
    isMaximized: () => ipcRenderer.invoke('dashboard:window:isMaximized').catch(() => false),
    onMaximizeChange: (cb) => {
      const handler = (_, isMaximized) => cb(isMaximized);
      ipcRenderer.on('dashboard:window:maximizeChange', handler);
      return () => ipcRenderer.removeListener('dashboard:window:maximizeChange', handler);
    },
  },
  process: {
    start: reject('process:start'),
    stop: reject('process:stop'),
    restart: reject('process:restart'),
    getStatus: () => ipcRenderer.invoke('dashboard:process:getStatus'),
    getLogs: () => Promise.resolve([]),
    openControlUI: () => ipcRenderer.invoke('dashboard:process:openControlUI'),
    onLog: (cb) => {
      const handler = (_, log) => cb(log);
      ipcRenderer.on('process:log', handler);
      return () => ipcRenderer.removeListener('process:log', handler);
    },
    onStatusChange: (cb) => {
      const handler = (_, status) => cb(status);
      ipcRenderer.on('process:status', handler);
      return () => ipcRenderer.removeListener('process:status', handler);
    },
  },
  config: {
    getField: (keyPath) => ipcRenderer.invoke('dashboard:config:getField', keyPath),
    updateField: (partialConfig) => ipcRenderer.invoke('dashboard:config:updateField', partialConfig),
  },
  app: {
    getMachineId: () => ipcRenderer.invoke('dashboard:app:getMachineId').catch(() => ''),
    getVersion: () => ipcRenderer.invoke('dashboard:app:getVersion').catch(() => '1.0.0'),
    getChannel: () => Promise.resolve(''),
    openPath: reject('app:openPath'),
    downloadFile: reject('app:downloadFile'),
    downloadSkill: reject('app:downloadSkill'),
    onDownloadProgress: () => noop,
    quitApp: () => ipcRenderer.invoke('app:quit'),
  },
  logger: {
    info: noop,
    warn: noop,
    error: noop,
  },
  reporter: { report: noop },
  instance: {
    // Dashboard InitLoading 期望对象 { mode?, needsUserChoice?, externalInstance? }。返回 { mode: 'isolated' } 会进入 initializing 分支并轮询 getStatus()；getStatus 返回 running 后跳转 /chat。
    getBootState: () => ipcRenderer.invoke('dashboard:instance:getBootState').catch(() => ({ mode: 'isolated' })),
    setMode: () => Promise.resolve(),
    getMode: () => Promise.resolve('isolated'),
    retryBoot: () => ipcRenderer.invoke('dashboard:instance:retryBoot').catch(() => ({ mode: 'isolated' })),
    onBootState: () => noop,
    onModeChange: () => noop,
  },
  session: {
    trimLastExchange: (sessionKey) => ipcRenderer.invoke('dashboard:session:trimLastExchange', sessionKey),
    search: (keyword, limit) => ipcRenderer.invoke('dashboard:session:search', keyword, limit),
  },
  openclaw: {
    getModels: () => ipcRenderer.invoke('dashboard:openclaw:getModels'),
    setDefaultModel: (modelId) => ipcRenderer.invoke('dashboard:openclaw:setDefaultModel', modelId),
    getShellState: () => ipcRenderer.invoke('dashboard:shell:getState'),
  },
  debug: {
    onTogglePanel: () => noop,
    openLogFolder: reject('debug:openLogFolder'),
    packQclaw: reject('debug:packQclaw'),
  },
  security: {
    verifyInviteCode: () => Promise.resolve(true),
    isInviteVerified: () => Promise.resolve(true),
    clearInviteStatus: () => Promise.resolve(),
  },
  safeStorage: {
    encrypt: () => Promise.reject(new Error('safeStorage not available')),
    decrypt: () => Promise.reject(new Error('safeStorage not available')),
    isAvailable: () => Promise.resolve(false),
  },
  platform: process.platform,
  arch: process.arch,
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
