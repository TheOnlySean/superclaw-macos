# QClaw 解析结论与可借鉴点

本文档基于对 QClaw 0.1.4-arm64 DMG 的拆解（app.asar 解包 + main/renderer 分析），总结其「安装 → Dashboard」流程与 UI，供 SuperClaw/JapanClaw 参考。

---

## 零、为什么 QClaw 打开的是「网关地址」却看到定制 UI？

用户点「打开控制台」后，浏览器访问的确实是 **http://127.0.0.1:18789/**（网关地址），但页面上看到的是一套**优化过的、和官方不一样的 UI**。原因在于：

- OpenClaw 网关**从本地文件系统**提供 Control UI，而不是写死在代码里的固定页面。
- 配置项 **`gateway.controlUi.root`** 指定「Control UI 静态资源的文件系统根目录」，默认是 `dist/control-ui`（即官方构建的那套）。
- 网关进程在响应 `GET /` 等请求时，会去 **`controlUi.root` 指向的目录**里读 `index.html` 和静态资源并返回。谁控制这个目录里的文件，谁就控制了用户在浏览器里看到的界面。

因此：

- **QClaw** 在 App 里捆绑的是**自己的 OpenClaw 运行时**（如 `QClaw.app/Contents/Resources/openclaw/`）。  
  该运行时里的 **`dist/control-ui`（或通过配置写死的 controlUi.root）** 放的是 **QClaw 自己构建的定制前端**，不是官方仓库默认的 control-ui。  
  所以用户打开「官方路径」http://127.0.0.1:18789 时，**网关读的是 QClaw 自带的那套文件**，看到的自然就是 QClaw 优化过的 UI。

- **我们（SuperClaw）** 做法不同：我们用 **Electron 内嵌窗口** 加载**本地**的 `control-ui-ja`（file://），没有改网关的 `controlUi.root`；网关仍可能提供官方 UI，但我们优先用本地 file:// 展示日文版。

总结：**「打开的是官方路径」≠「看到的是官方 UI」。网关按 `gateway.controlUi.root` 从磁盘读文件并 serve，QClaw 在包里放的是自己的 build，所以浏览器里看到的是定制 UI。**

---

## 一、QClaw 的「Dashboard」是什么

- **不是** Electron 内嵌的第二个窗口。
- **是**：用户点击「打开控制台」后，主进程调用 `shell.openExternal("http://127.0.0.1:${port}#token=${token}")`，用**系统默认浏览器**打开网关页。
- 因此 QClaw 没有「内嵌 control-ui」的路径，也没有 file:// 本地 UI 的打包；Dashboard = 浏览器里的 OpenClaw Gateway 页面。**但该页面内容由网关进程从 `gateway.controlUi.root` 指向的目录提供，QClaw 在该目录放的是自家构建的 UI，故与官方不同。**

---

## 二、安装完成后如何「进入 Dashboard」

1. 主窗口唯一，即 `createWindow()` 加载的 `out/renderer/index.html`（安装/配置/面板 UI）。
2. 启动时执行 `runBootSequence(mainWindow)`：检测外部实例、计算 mode（isolated/shared）、发 `instance:bootState` 给渲染进程，必要时自动 `initializeWithMode`。
3. 渲染进程里有一个按钮（样式 class 含 `action-btn-control-ui`），点击后调用 IPC `process:openControlUI`。
4. 主进程 `ipcMain.handle("process:openControlUI", ...)` 读配置的 `gateway.port` 与 `gateway.auth.token`，然后 `shell.openExternal(...)`。
5. **结论**：从安装界面「进入 Dashboard」= 点击一个明确的「打开控制台」类按钮 → 浏览器打开带 token 的网关 URL。流程简单、无内嵌窗口逻辑。

---

## 三、主窗口 UI 结构（可借鉴的排版与设计）

- **整体**：深色面板 `#1a1a22`，圆角 16px，边框 `rgba(255,255,255,.08)`，阴影 `0 20px 60px #00000080`。面板宽度 60vw，min 560px，max 960px。
- **头部**：左右分栏（`panel-header-left` / `panel-header-right`），标题 + 模式 badge（shared/isolated 不同色）+ 状态 badge（红/黄/绿/橙）+ 关闭按钮。
- **信息区**：网格两列（`panel-info-grid`），卡片式 `info-card`，小号大写 label + 等宽数值（端口、运行时间等）。
- **操作区**：一排按钮（`panel-actions`）— 启动（绿）、停止（红）、重启（灰）、**打开控制台（蓝，`action-btn-control-ui`）**。按钮统一圆角 10px，disabled 时 opacity .5。
- **日志区**：占满剩余高度，标题行（日志数、自动滚动、清空），下方等宽字体、按时间/级别/消息分行；空状态有提示文案。
- **状态指示**：左下角小圆点（`dashboard-indicator`），红/黄/绿/橙 + 可选 ping 动画，hover 略放大。

可借鉴到我们安装器/完成页的：信息卡片网格、主操作按钮一组（含「打开 Dashboard」）、日志区域与空状态、小圆点状态指示。

---

## 四、与我们项目的差异与可采纳点

| 项目       | QClaw                         | 我们（SuperClaw）                          |
|------------|-------------------------------|--------------------------------------------|
| Dashboard 载体 | 系统浏览器                    | Electron 内嵌窗口（本地 control-ui-ja 或网关） |
| 打开方式   | `process:openControlUI` → openExternal | `open-dashboard` → createDashboardWindow |
| 优点       | 实现简单，无窗口/路径问题     | 体验统一、可注入日文、可控制标题与样式     |
| 可采纳     | 按钮文案与位置要明显          | 保持内嵌；加强「安装完成 → 点击 → 打开」的顺畅度 |

**建议我们保留内嵌 Dashboard**，但可做：

1. **安装完成步（done）**：唯一主操作 =「あなたの SuperClaw を使い始める」（或「ダッシュボードを開く」），样式突出（如主色、略大），与 QClaw 的「打开控制台」一样作为唯一出口。
2. **点击后**：若网关可能尚未就绪，可在 `createDashboardWindow` 前做短暂轮询（如 2–5 秒）等待 gateway 健康，再 loadURL，避免用户看到无法连接。
3. **UI 排版**：done 页可参考 QClaw 的 panel-actions：一个主按钮 + 次要说明，信息区简洁（如端口、状态一行即可）。
4. **不采纳**：不改为用浏览器打开 Dashboard（我们会继续用内嵌 + 本地 control-ui-ja）。

---

## 五、关键代码位置（QClaw 解包后）

- 主进程 IPC：`app/out/main/index.js` 约 9614–9625 行，`ipcMain.handle("process:openControlUI", ...)`。
- 主窗口创建与 runBootSequence：同文件约 10673–10756 行（`getUIPath`、`createWindow`、`runBootSequence`）。
- 启动与 mode 解析：约 8337–8446 行（`runBootSequence`、`initializeWithMode`、`computeBootState`、`resolveRuntimeConfig`）。
- 面板样式：`app/out/renderer/assets/a-DwpcwrzL.css`（dashboard-panel、panel-*、action-btn-control-ui 等）。

---

以上内容随 QClaw 版本更新可再解包对比；我们以「安装完成 → 一键打开内嵌 Dashboard」为主轴优化即可。
