# Dashboard 自建前端 + QClaw 式打开 — 分步计划

## 背景与目标

- **问题**：由网关 (18789) 提供 dashboard-renderer 时，网关注入的 CSP 导致载入页卡死；Electron 侧覆盖 CSP 又引发白屏，稳定性差。
- **目标**：仿照 QClaw「自有 UI + 可控打开方式」，**由我们自建/自控前端**，用 **本地静态服务 + 反向代理** 打开 Dashboard，不依赖网关提供 HTML，从而彻底避开网关 CSP，提升稳定性。

## QClaw 方式简述

- QClaw：点「打开控制台」→ `shell.openExternal("http://127.0.0.1:18789#token=...")`，用**系统浏览器**打开。页面内容由网关从 `gateway.controlUi.root` 提供（QClaw 在包里放的是自家构建的 UI）。
- 我们采用的「QClaw 式」：**不**用浏览器，用 **Electron 内嵌窗口**；但 **不**从 18789 加载 HTML，而是：
  1. **我们**起一个本地 HTTP 服务（例如 127.0.0.1:随机端口），只负责提供 **dashboard-renderer 的静态文件**（index.html、assets/*），**不设置 CSP**。
  2. 该服务把 **API / WebSocket** 请求**反向代理**到 18789。
  3. 窗口加载我们自己的 URL（例如 `http://127.0.0.1:18790/#token=...`），这样 HTML/JS 来自我们的服务，CSP 可控；与网关的通信通过代理透明转发。

## QClaw との違い（深掘り）

- **QClaw**：主窗口は `mainWindow.loadFile(getUIPath())` で **file://** の `out/renderer/index.html` を読み、`session.webRequest.onHeadersReceived` で **file:// / localhost** 向けに緩い CSP を注入。ただし **file:// は Chromium の制約で onHeadersReceived が発火しない**ため、本番では別要因で動いている可能性あり。
- **当方**：**app://** プロトコルで dashboard-renderer を配信。プロトコルハンドラ内でレスポンスに **Content-Security-Policy** を付与するため、CSP を確実に制御可能。あわせて **/api は 18789 にプロキシ**し、Vue の API が app:// 同一オリジンで動くようにした。WebSocket は app:// ではプロキシ不可のため、Vue が同一オリジン WS を使う場合は要対応（注入やローカルサーバー再検討）。

## 已实现（本次）

| 步骤 | 内容 | 状态 |
|------|------|------|
| 1 | 回退 Electron `webRequest` CSP 覆盖（18789），避免白屏 | ✅ 已回退 |
| 2 | Dashboard を **app://** で読み込み。`registerAppProtocol` でレスポンスに **CSP 付与** | ✅ 已实现 |
| 3 | app:// の **/api を 18789 にプロキシ**（protocol.handle 内で fetch 転送） | ✅ 已实现 |
| 4 | ローカル静的サーバー（dashboard-server.js）は白屏対策のため未使用；必要なら WebSocket プロキシ用に再検討可 | 保留 |

## 后续可拆分的子任务（可交给 SubAgent）

| 任务 | 说明 | 产出 |
|------|------|------|
| **A. 验证与兜底** | 在真机/打包环境下验证：首次打开、二次打开、关闭再开；若本地服务启动失败则回退到加载 18789 | 测试结论 + 必要时兜底逻辑 |
| **B. 前端网关 URL 可配置** | 当前 Vue chunk 可能用 `location.origin` 连 WebSocket；若代理后仍连不上，需在 HTML 或 preload 注入 `window.__GATEWAY_WS__ = 'ws://127.0.0.1:18789'` 等，并确认 chunk 内是否有可读的全局/环境变量 | 文档或小改 index.html/preload |
| **C. 从源码构建 Dashboard 前端** | 若有 QClaw/OpenClaw 的 control-ui 或主窗口前端源码，用 Vite/Webpack 构建一版「可配置 gateway base URL」的 dashboard，替代当前解包 chunk，便于长期维护与日文化 | 独立前端工程 + 构建脚本 + 与 dashboard-renderer 的对接方式 |
| **D. 文档与发布说明** | 在 DASHBOARD-UI.md 中说明「自前サーバー + プロキシ」方式、与 QClaw 的对比、升级 OpenClaw 时注意事项 | 文档更新 |

## 关键文件

- 主进程入口：`src/main/index.js`（`createDashboardWindow`、`open-dashboard`）
- 本地服务与代理：`src/main/dashboard-server.js`
- 静态资源：`dashboard-renderer/`（index.html、assets/*）
- 打包：`extraResources` 含 `dashboard-renderer`，无需改 `controlUi.root` 也可用自前サーバー方式

## 注意事项

- 本地服务监听 `127.0.0.1` 随机端口，仅本机访问。
- 窗口关闭时关闭服务，下次打开再起新端口，避免端口长期占用。
- 若 `startDashboardServer` 抛错（例如目录不存在），会回退到直接加载 `http://127.0.0.1:18789/`，保证兼容。
