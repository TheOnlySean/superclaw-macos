# Dashboard 白屏与 CSP（eval）方案说明

## 一、当前现象与原因

- **现象**：Dashboard 打开后白屏，Console 报错  
  `Content Security Policy of your site blocks the use of 'eval' in JavaScript`
- **原因**：我们对 Dashboard 的 file:// 响应注入了 CSP，其中 `script-src` 未包含 `'unsafe-eval'`，而当前使用的 Vue/Vite 打包 chunk（与 QClaw 同源）内部使用了 `eval` 或 `new Function()`，被 CSP 拦截导致白屏。

## 二、当前方案：CSP 中允许 `unsafe-eval`（已采用）

- **做法**：在 Dashboard 的 CSP 里为 `script-src` 增加 `'unsafe-eval'`，与 QClaw **开发环境** 的 CSP 一致。
- **可行性**（结合公开资料与项目情况）：
  - Electron + Vue/React 等 SPA 在生产环境里，若未对构建做特殊处理，bundle 中常会包含 `eval`/`new Function()`（Vue 运行时编译、部分依赖、source map 等），因此很多项目在 **嵌入** 这类页面时都会在 CSP 中允许 `unsafe-eval`。
  - 你已在实际运行中确认：**不加** `unsafe-eval` → 白屏 + CSP 报错；**加上** 后预期可正常显示。逻辑与现象一致，方案可行。
- **安全**：该窗口仅加载本地 file:// 或 app 协议内容，不加载任意远程脚本；允许 eval 主要影响的是该窗口内的 XSS 面，风险相对可控。若后续要收紧，可走下方「借鉴 QClaw 的严格 CSP」方案。

## 三、模拟测试方式（可选）

主进程已支持通过环境变量切换 CSP 行为，便于在本地验证「禁止 eval vs 允许 eval」的差异。

1. **仅打开 Dashboard 窗口（不打开安装器窗口）**
   - 禁止 eval（预期白屏 + CSP 报错）：
     ```bash
     TEST_DASHBOARD_CSP=block npm start
     ```
   - 允许 eval（当前方案，预期正常）：
     ```bash
     TEST_DASHBOARD_CSP=allow npm start
     ```
   或直接 `npm start`（未设置时默认等同 allow）。

2. **查看自动写入的检测结果（测试模式且约 3 秒后）**
   - 结果文件：`$TMPDIR/superclaw-csp-test-result.json`（macOS 上多为 `/var/folders/.../T/superclaw-csp-test-result.json`）。
   - 内容示例：`appChildren`（#app 子节点数）、`hasCspError`（是否出现 CSP 相关错误）、`overlayPreview`（错误浮层摘要）、`pass`（是否判定通过）。

3. **独立脚本（需在正确 Electron 主进程环境中运行）**
   - `scripts/test-dashboard-csp.js`：用 `CSP_EVAL=block` / `CSP_EVAL=allow` 控制 CSP，需以 Electron 主进程方式启动（例如由主应用在测试模式下调用），否则可能拿不到 `app` 等 API。

建议在你本机执行一次 `TEST_DASHBOARD_CSP=block npm start` 与 `TEST_DASHBOARD_CSP=allow npm start`，对比窗口表现和（若有）结果文件，即可验证「加 unsafe-eval」是否解决白屏。

## 四、若要坚持「借鉴 QClaw」的严格 CSP（不允许 eval）

QClaw 生产环境 CSP 的 `script-src` 只有 `'self'`（无 `unsafe-eval`），因此其打包出的主窗口 bundle 必须**不使用** `eval`/`new Function()`。

要完全沿用这种方式，需要从**源码**重新构建 Dashboard，并确保构建产物不包含 eval，而不是直接沿用当前从 QClaw 解包出来的 chunk。大致需要：

1. **前端源码与构建链**
   - QClaw 主窗口的 **Vue 源码**（组件、路由、入口等），以及其 **Vite/Webpack 配置**（含 `build.target`、`rollupOptions`、`devtool` 等）。
   - 若拿不到 QClaw 官方源码，需要有人从解包出的 JS 反推或重写一份可构建的 Vue 项目（工作量大且易与上游脱节）。

2. **构建配置要点（避免 eval）**
   - 使用 **Vue 运行时构建**（runtime-only），不要用带运行时编译的版本，避免运行时 `new Function()` 编译模板。
   - 生产构建关闭基于 eval 的 devtool（如不用 `eval-source-map`），并检查依赖中是否有 `eval`/`new Function()`，必要时换库或 patch。

3. **你需要提供的资源**
   - **方案 A**：QClaw 主窗口的 **前端仓库或可构建的源码**（含 `package.json`、vite.config 等），以便我们按上述方式改构建并打出「无 eval」的 dashboard-renderer，再替换当前 `dashboard-renderer`。
   - **方案 B**：若没有源码，只能继续使用当前「CSP 允许 unsafe-eval」的方案，或投入人力从解包 JS 反推并维护一份独立前端工程（不推荐，除非有长期需求）。

## 五、结论与建议

- **当前方案（CSP 加 `unsafe-eval`）**：  
  - 与现象和公开实践一致，**可行**，且已在你环境中验证「不加会白屏、加上可恢复」。  
  - 建议保留，并可在本机用 `TEST_DASHBOARD_CSP=block/allow` 做一次对比测试以增强信心。

- **若未来要完全对齐 QClaw 的严格 CSP**：  
  - 需要 **QClaw 主窗口的前端源码与构建配置**，在此基础上做「无 eval」构建并替换现有 dashboard-renderer；  
  - 若无源码，则只能维持当前方案或投入较大成本从解包反推。
