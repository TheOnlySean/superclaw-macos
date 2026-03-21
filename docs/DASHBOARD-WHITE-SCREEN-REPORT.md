# Electron Dashboard 白屏排查报告

## 当前方案（双端口 HTTP + 先显示再加载，根除绘制白屏）

1. **双端口 HTTP**：打开 Dashboard 时在本机新端口启动 `dashboard-server.js`，窗口加载 `http://127.0.0.1:新端口/`。18789 不改动，浏览器仍为官方 UI。详见 `DASHBOARD-UI.md`。

2. **根除「DOM 存在但窗口白/黑屏」**（Electron 绘制/合成 bug）：
   - **原因**：Electron/Chromium 在「窗口先 `show: false`，等 ready-to-show 再 show()」时，部分环境下**不触发首帧绘制**（compositor 未 schedule paint），导致 DevTools 里能看到 DOM 但窗口显示白屏或黑屏。见 [electron#32001](https://github.com/electron/electron/issues/32001)、[electron#37201](https://github.com/electron/electron/issues/37201)；macOS 上在 [electron#46615](https://github.com/electron/electron/pull/46615)（Electron 35/36）已修，我们当前为 Electron 28，故在应用侧规避。
   - **做法**：
     - Dashboard 窗口 **`show: true`** + **`backgroundColor: '#0f0f1a'`**，**先显示窗口再 `loadURL`**。
     - **立即 loadURL**：用 `setImmediate` 替代原 150ms 延迟，减少空窗导致 compositor 不绘制的概率。
     - **did-finish-load 后强制重绘**：约 50ms 后对窗口 `setBounds(height+1)` 再 `setBounds(原值)` 触发 resize/合成；约 100ms 后在渲染进程执行一次 reflow（`document.body.offsetHeight` + `requestAnimationFrame`），促使 compositor 更新。
   - **备选**：若某台机器仍白/黑屏，可尝试：(1) 禁用硬件加速：`SUPERCLAW_DISABLE_GPU=1 open -a SuperClaw`；(2) 用 DevTools 触发绘制：`SUPERCLAW_FORCE_PAINT_DEVTOOLS=1 open -a SuperClaw`（会短暂打开再关闭 DevTools）。
   - 已移除不可靠的 workaround（ready-to-show 里 show、resize 触发重绘等），仅保留上述策略与必要日志。

---

## 一、网上调研结论（英文关键词）

### 1. 自定义协议要支持「相对路径解析」和「与窗口同一 session」

- **standard: true**  
  [Electron protocol 文档](https://www.electronjs.org/docs/latest/api/protocol) 明确：  
  - 必须用 `protocol.registerSchemesAsPrivileged()` 将 scheme 注册为 **standard**，相对/绝对资源才能按 RFC 3986 正确解析。  
  - 未注册为 standard 时，行为类似 `file://`，**无法解析相对 URL**（例如 `<img src='test.png'>`、`<script src="./assets/xxx.js">` 会失败）。

- **URL 格式**  
  - Standard scheme 需符合「generic URI」：应有 **host** 成分。  
  - 推荐使用 `scheme://host/path`（如 `app://localhost/index.html` 或 `app://dashboard/index.html`），否则相对路径可能被解析成「path 拼接」而非「基于目录」的解析，导致请求到错误 URL（如 [electron/electron#49073](https://github.com/electron/electron/issues/49073) 中 `custom://contents/index.html/assets/sample.mp4` 一类问题）。

- **Session 一致**  
  - 文档 "Using protocol with a custom partition or session"：  
    - 自定义协议是注册到**某个 session** 上的。  
    - 若 `BrowserWindow` 的 `webPreferences.partition` / `session` 使用非默认 session，则必须用 **该 session** 的 `ses.protocol.handle()` 注册协议，用全局 `protocol.handle()` 时该窗口访问不到自定义协议。

### 2. registerSchemesAsPrivileged 时机

- 必须在 **`app` 的 `ready` 事件之前** 调用，且 **只能调用一次**。  
- `protocol.handle()` 应在 **`app.whenReady()` 之后** 调用。

### 3. Vue SPA 生产包白屏常见原因

- **Vue Router 模式**：在 Electron 内常用 **hash 模式**（`createWebHashHistory()`），history 模式在 file/app 协议下易出问题。  
- **base / base href**：Vite 需配置 `base: './'`，HTML 中 `<base href="./">` 要与实际载入 URL 的「目录」一致，否则相对路径会错。  
- **CSP**：若 `script-src` 不含 `'unsafe-eval'`，而打包产物中有 `eval`/`new Function()`（如 Vue 运行时编译、部分依赖），会白屏并报 CSP 错误。  
- **载入方式**：用 `app://` 且正确设置 standard + 正确 URL 格式，比 `file://` 更利于 ES modules 和相对路径；若用 `file://`，需注意 ES modules 限制，不少项目改用本地 HTTP 或 app 协议。

---

## 二、代码内确认结果

### 1. registerSchemesAsPrivileged（japanclaw-setup）

- **文件**：`japanclaw-setup/src/main/index.js`  
- **行号**：约 29–33（在 `app.whenReady()` 之前、顶层执行）。

**结论**：  
- 已在 **app.ready 之前** 调用。  
- 已包含 **standard: true**，以及 **secure: true, supportFetchAPI: true, bypassCSP: true**。

```29:33:japanclaw-setup/src/main/index.js
/** 自定义协议 app: 用于加载 dashboard-renderer，避免 file:// 下 ES modules 白屏。必须在 app.ready 前注册。 */
if (protocol && typeof protocol.registerSchemesAsPrivileged === 'function') {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true } },
  ]);
}
```

### 2. Dashboard 的 BrowserWindow 与 partition/session

- **文件**：`japanclaw-setup/src/main/index.js`  
- **创建位置**：  
  - 使用 dashboard-renderer + 本地 HTTP 时：约 295–310（opts），310 行 `new BrowserWindow(opts)`。  
  - 回退到 control-ui-ja / 网关 URL 时：约 391–402。

**结论**：  
- 两处 **均未** 设置 `webPreferences.partition` 或 `session`，即使用 **默认 session**。  
- `registerAppProtocol()` 使用全局 `protocol.handle('app', ...)`，注册在默认 session 上，与上述窗口 **一致**，无 session 不一致问题。

### 3. app:// 协议：Content-Type、CSP 与 type="module" / 相对路径

- **文件**：`japanclaw-setup/src/main/index.js`  
  - CSP：约 44–53（`APP_PROTOCOL_CSP`），585 行在 Response 中设置。  
  - Content-Type：约 583–585（按扩展名设 `.js` → `application/javascript` 等）。  
- **Handler 逻辑**：约 533–541，根据 `request.url` 解析出 `pathname`。

**结论**：  
- **Content-Type**：`.js`/`.mjs` 已设为 `application/javascript`，对 `type="module"` 正确。  
- **CSP**：已包含 `script-src 'self' 'unsafe-inline' 'unsafe-eval'`，不会因 eval 导致白屏。  
- **潜在问题**：当前 **入口 URL 为 `app://index.html`**（见 `getDashboardAppURL()` 约 234–236）。  
  - 在 standard scheme 下，部分环境会把「当前文档」视为 `app://index.html`，相对路径 `./assets/e-xxx.js` 可能被解析为 **`app://index.html/assets/e-xxx.js`**（path 被拼接），而不是 `app://assets/e-xxx.js`。  
  - Handler 对 `app://index.html/assets/xxx` 会得到 pathname = `index.html/assets/xxx`，再 `path.join(base, pathname)` 会变成 `base/index.html/assets/xxx`，**与实际文件路径 `base/assets/xxx` 不符**，导致 404、白屏。  
  - 因此：若将来改用 app:// 载入（或某路径仍用 app://），**必须使用带 host 的 URL**（如 `app://dashboard/index.html`），并在 handler 中把「host 对应根目录」映射到 `base`，其余 path 按相对路径解析。

**补充**：当前打包后实际走的是 **本地 HTTP 服务**（`startDashboardServer`，随机端口），不是 app://；若白屏出现在 HTTP 方式下，则更可能来自：端口冲突、服务器未就绪、或 Vue Router/base 与 `http://127.0.0.1:port/` 不匹配。

---

## 三、可实施的修改建议（按优先级）

### P0：若使用 app:// 载入（或切回 app:// 时）——**已实现**

1. **改用带 host 的入口 URL**  
   - `getDashboardAppURL()` 已改为返回 `app://dashboard/index.html`（常量 `APP_PROTOCOL_HOST = 'dashboard'`）。  
   - 相对路径 `./assets/e-xxx.js` 会解析为 `app://dashboard/assets/e-xxx.js`，与「以目录为根」的语义一致。

2. **在 protocol handler 中按 host 映射根目录**  
   - 已在 `registerAppProtocol()` 中：当 path 以 `dashboard/` 或 host 为 `dashboard` 时，去掉该前缀再与 `getDashboardRendererBasePath()` 拼接。  
   - 例如：`app://dashboard/index.html` → pathname 视为 `index.html`；`app://dashboard/assets/e-xxx.js` → pathname 视为 `assets/e-xxx.js`。  
   - 对 `api/` 的代理逻辑不变。

**启用 app:// 载入**：当前打包后默认使用「本地 HTTP + 随机端口」。若需改为用 app:// 载入以验证白屏是否与协议相关，可在 `createDashboardWindow()` 的 `useRendererDashboard` 分支内，将 `dashboardUrl` 改为 `getDashboardAppURL() + (hash ? hash : '')`（并注释或移除对 `startDashboardServer` 的依赖），即可用 app:// 加载同一份 dashboard-renderer。

### P1：无论 app:// 还是 HTTP，都建议

3. **保证 CSP 一致**  
   - 已允许 `unsafe-eval`，若仍白屏且控制台有 CSP 报错，检查是否有其他 meta/header 覆盖，或是否需对 `worker-src`/`script-src` 再放宽（仅限本地）。

4. **Vue Router**  
   - 确认 dashboard-renderer 使用 **hash 模式**（或与 Electron 载入方式匹配的 base），避免 history 模式在 app:// 或 file:// 下导致空白或 404。

5. **base href**  
   - 保持 `<base href="./">`；若入口改为 `app://dashboard/index.html`，相对路径仍以「当前目录」为基准，无需改 HTML。

### P2：可选

6. **stream: true**  
   - 若后续有视频/音频等流式资源通过 app 协议加载，可在 `registerSchemesAsPrivileged` 的 privileges 中加 `stream: true`（按 [electron/electron#49073](https://github.com/electron/electron/issues/49073) 讨论）。

7. **日志与调试**  
   - 在 handler 中对 404 已写 `.superclaw-setup-debug.log`；可对「首次加载 URL」和「关键资源请求 URL」打点，便于确认相对路径是否解析为预期 URL。

---

## 四、若仍白屏可尝试的替代方案

1. **继续使用当前「本地 HTTP + 随机端口」**  
   - 已能避免 file:// 的 ES module 限制，且相对路径语义清晰。  
   - 若白屏仅出现在 app:// 而 HTTP 正常，可暂时只使用 HTTP 路径，并排查端口占用、启动顺序、网关 18789 代理是否影响首屏。

2. **file:// + 非 module 打包**  
   - 若必须用 file://：  
     - 将 Vue 构建为 **非 ES module**（如 IIFE/UMD），在 index.html 用普通 `<script src="...">` 加载。  
     - 或使用 `script type="module"` 但保证 base 与 file 路径一致，且不依赖需要特殊 MIME/CORS 的 module 行为。  
   - 注意：file:// 下部分 API 和 CORS 有限制，通常不如 app:// 或 HTTP 省心。

3. **严格 CSP 且无 eval**  
   - 若需去掉 `unsafe-eval`：需从源码构建 dashboard-renderer，确保打包产物无 eval/new Function（参见 `DASHBOARD-CSP-TEST-AND-OPTIONS.md`）。

---

## 五、涉及文件与行号速查

| 内容 | 文件 | 行号 |
|------|------|------|
| registerSchemesAsPrivileged | `japanclaw-setup/src/main/index.js` | 29–33 |
| APP_PROTOCOL_CSP | 同上 | 44–53 |
| getDashboardAppURL | 同上 | 234–236 |
| registerAppProtocol (pathname 解析) | 同上 | 531–591 |
| app.whenReady + registerAppProtocol | 同上 | 594–596 |
| Dashboard BrowserWindow (HTTP 路径) | 同上 | 295–320 |
| Dashboard BrowserWindow (回退路径) | 同上 | 391–402 |
| index.html base + script type=module | `japanclaw-setup/dashboard-renderer/index.html` | 7, 10 |
| 本地 HTTP 服务 + CSP | `japanclaw-setup/src/main/dashboard-server.js` | 46–71 |

以上为本次排查的汇总与建议；优先实施 P0 中的 app:// URL 与 handler 映射，再视现象补充 P1/P2 与替代方案。
