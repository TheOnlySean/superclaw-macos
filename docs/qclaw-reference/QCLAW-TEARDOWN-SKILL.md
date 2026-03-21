# QClaw DMG 拆解步骤（Skill / 任务清单）

按顺序执行以下步骤，可完整拆解 QClaw 的 DMG，并重点分析「安装界面 → 打开 Dashboard」流程与 Dashboard 相关 UI。

---

## 1. 挂载 DMG（只读）

```bash
hdiutil attach /path/to/QClaw-0.1.4-arm64.dmg -readonly -nobrowse
```

- 挂载点一般为 `/Volumes/QClaw 0.1.4-arm64/`。
- 内有 `QClaw.app`。

---

## 2. 列出 App 包结构

```bash
ls -la "/Volumes/QClaw 0.1.4-arm64/QClaw.app/Contents/"
ls -la "/Volumes/QClaw 0.1.4-arm64/QClaw.app/Contents/Resources/"
ls -la "/Volumes/QClaw 0.1.4-arm64/QClaw.app/Contents/MacOS/"
```

- **Resources**：`app.asar`、`openclaw/`、`scripts/` 等。
- **MacOS**：可执行文件 `QClaw`（主进程入口）。

---

## 3. 解包 app.asar

```bash
mkdir -p /path/to/qclaw-reference/app
npx asar extract "/Volumes/QClaw 0.1.4-arm64/QClaw.app/Contents/Resources/app.asar" /path/to/qclaw-reference/app
```

- 解压后得到：`package.json`、`out/main/index.js`、`out/preload/index.mjs`、`out/renderer/index.html`、`out/renderer/assets/*`、以及大量 `node_modules/`。

---

## 4. 定位主进程与入口

- 查看 `app/package.json` 的 `"main": "./out/main/index.js"`。
- 主逻辑在 `out/main/index.js`（单文件、已打包，体积较大）。
- 关键词搜索（在 main 里）：
  - `dashboard` / `openControlUI` / `gateway` / `18789` / `BrowserWindow` / `createWindow` / `runBootSequence`。

---

## 5. 定位「打开 Dashboard」逻辑

- **IPC**：主进程注册 `ipcMain.handle("process:openControlUI", ...)`。
- **实现**：读取配置中的 `gateway.port` 与 `gateway.auth.token`，调用  
  `shell.openExternal("http://127.0.0.1:${port}#token=${token}")`。  
  即：**用系统默认浏览器打开网关页**，而不是在 Electron 内再开一个窗口。
- **渲染端**：在 `out/renderer/assets/*.js` 中搜索 `openControlUI` 或「打开控制台」等文案，可找到触发该 IPC 的按钮（QClaw 里对应「打开控制台」类按钮，class 含 `action-btn-control-ui`）。

---

## 6. 安装完成后的整体流程

- **主窗口**：仅一个 `createWindow()`，加载 `out/renderer/index.html`（Vue 等打包后的 SPA）。
- **启动顺序**：`ready-to-show` 时执行 `runBootSequence(mainWindow)`：
  - 检测是否已有外部 OpenClaw 实例（`detectExternalInstance`）；
  - 计算 `computeBootState`（isolated / shared / needsUserChoice）；
  - 通过 `mainWindow.webContents.send("instance:bootState", currentBootState)` 把状态发给渲染进程；
  - 若无需用户选择，则 `initializeWithMode`（启动进程等）。
- 用户在主窗口完成安装/配置后，点击「打开控制台」→ 调用 `process:openControlUI` → 浏览器打开 `http://127.0.0.1:18789#token=xxx`。  
  **结论**：QClaw 的「Dashboard」= 浏览器里的网关页，不是 Electron 内嵌的 control-ui。

---

## 7. 提取并分析 Dashboard 相关 UI（主窗口面板）

- QClaw 的「主窗口」不是 Gateway 的 control-ui，而是一个**控制面板**（状态、端口、运行时间、启动/停止/重启、**打开控制台**、日志）。
- 样式在 `out/renderer/assets/a-DwpcwrzL.css`（以及 a-CG9QQGJt.css 等）。
- 关键 class（便于对照我们自己的安装器 UI）：
  - **整体**：`dashboard-overlay`、`dashboard-panel`（深色 `#1a1a22`，圆角 16px）。
  - **头部**：`panel-header`、`panel-header-left`、`panel-title`、`mode-badge`、`panel-header-right`、`panel-close-btn`、`status-badge`。
  - **信息区**：`panel-info-grid`（网格）、`info-card`、`info-label`、`info-value`、`info-value-port`、`info-value-uptime`。
  - **操作区**：`panel-actions`、`action-btn`、`action-btn-start`、`action-btn-stop`、`action-btn-restart`、**`action-btn-control-ui`**（打开控制台）。
  - **日志区**：`panel-logs-section`、`panel-logs-header`、`logs-title`、`logs-autoscroll`、`panel-logs`、`log-entry`、`log-time`、`log-level`、`log-message`。
  - **状态指示**：左下角 `dashboard-indicator`（dot），红/黄/绿/橙；`dashboard-indicator-ping` 动画。

---

## 8. 可选：对比我们项目

- **我们**：安装完成后点击「あなたの SuperClaw を使い始める」→ IPC `open-dashboard` → `createDashboardWindow()`，在 **Electron 内** 打开一个窗口，加载 `file://` 本地 `control-ui-ja` 或 `http://127.0.0.1:18789`，并注入日文等。
- **QClaw**：安装/配置完成后点击「打开控制台」→ IPC `process:openControlUI` → **外部浏览器**打开 `http://127.0.0.1:18789#token=xxx`。
- 若我们要「从安装界面直接进入 Dashboard」且保持**内嵌窗口**，只需保证：  
  - 安装完成步（done）突出「打开 Dashboard」按钮；  
  - `open-dashboard` → `createDashboardWindow` 前可短暂等待网关就绪；  
  - 本地 `control-ui-ja` 路径在打包后可靠解析。

---

## 9. 卸载 DMG

```bash
hdiutil detach "/Volumes/QClaw 0.1.4-arm64"
```

---

以上步骤可作为「QClaw 拆解」的固定 skill list，按需复现或更新版本路径即可。
