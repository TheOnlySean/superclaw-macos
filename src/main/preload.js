const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('superclaw', {
  systemCheck: () => ipcRenderer.invoke('system-check'),
  startInstall: () => ipcRenderer.invoke('start-install'),
  onInstallLog: (cb) => {
    const fn = (_, data) => cb(data);
    ipcRenderer.on('install-log', fn);
    return () => ipcRenderer.removeListener('install-log', fn);
  },
  runOnboard: () => ipcRenderer.invoke('run-onboard'),
  onOnboardLog: (cb) => {
    const fn = (_, data) => cb(data);
    ipcRenderer.on('onboard-log', fn);
    return () => ipcRenderer.removeListener('onboard-log', fn);
  },
  loginCodex: () => ipcRenderer.invoke('login-codex'),
  loginQwen: () => ipcRenderer.invoke('login-qwen'),
  onModelAuthLog: (cb) => {
    const fn = (_, data) => cb(data);
    ipcRenderer.on('model-auth-log', fn);
    return () => ipcRenderer.removeListener('model-auth-log', fn);
  },
  setDefaultModel: (model) => ipcRenderer.invoke('set-default-model', model),
  openDashboard: () => ipcRenderer.invoke('open-dashboard'),
  hasValidLicense: () => ipcRenderer.invoke('has-valid-license'),
  verifyLicense: (key) => ipcRenderer.invoke('verify-license', key),
  hasExistingOpenClawConfig: () => ipcRenderer.invoke('has-existing-openclaw-config'),
  installNode: () => ipcRenderer.invoke('install-node'),
  onNodeInstallLog: (cb) => {
    const fn = (_, data) => cb(data);
    ipcRenderer.on('node-install-log', fn);
    return () => ipcRenderer.removeListener('node-install-log', fn);
  },
  installXcodeClt: () => ipcRenderer.invoke('install-xcode-clt'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
