# Dashboard：网页 vs 原生 — 思路与可选方案

## 1. QClaw 实际在做什么（拆包结论）

根据对 QClaw 的拆包与文档：

- **你看到的「丝滑」主界面**（技能广场、会话列表、微信远程、用户系统配置等）来自 **Electron 主窗口**，不是「在 app 里打开浏览器再打开一个网页」。
- 主窗口加载的是：**`out/renderer/index.html`**（Vue 单页应用），通过 **`loadFile(getUIPath())`** 从 **app.asar 里的本地文件** 加载，即 **file:// 的本地打包前端**。
- 也就是说：**QClaw 的 Dashboard 也是「网页」**（HTML + JS + Vue），只是：
  - **不是**从网关 18789 或任何远程 URL 加载的；
  - **是**和安装器一样，作为 **app 自带的静态资源**，用 **loadFile** 从包里读出来在同一个（或另一个）BrowserWindow 里渲染。

所以：**QClaw 并没有在 app 里再做一套「真正原生」的 UI（例如纯 Swift/原生控件），而是用「打包在 app 里的本地网页」做 Dashboard，只是这份网页不依赖任何在线地址或网关的 HTML，所以体验上像「app 自己的界面」。

---

## 2. 和我们的差异（为何我们容易不丝滑）

- 我们一度用 **http://127.0.0.1:18789** 或 **app://** 来加载 Dashboard：
  - 用 18789：网关会注入 CSP、可能有加载顺序/白屏问题；
  - 用 app://：协议、Content-Type、CSP、失败回退等都要自己兜住，容易踩坑。
- 目标应该是：**和 QClaw 对齐** — Dashboard 的 **UI 只来自 app 自带的静态资源**（不依赖网关提供页面），**所有内容数据** 再和本地 OpenClaw（18789）联动。

---

## 3. 调整思路：两种「原生」理解

### 方案 A：App 自带前端 + OpenClaw 只提供数据（推荐，和 QClaw 一致）

- **不做**：在 app 里「打开一个网页」去展示 Dashboard（不依赖 18789 或任何 URL 提供 HTML）。
- **做**：
  - Dashboard 的 **整份 UI**（HTML/JS/CSS）都 **打包在 app 里**，和 QClaw 一样；
  - 用 **loadFile** 或 **app://** 从 app 包内加载这份 UI（只负责「界面」）；
  - 所有 **数据**（会话、模型、技能、状态等）**只和本地 OpenClaw 联动**：通过  
    - 主进程/Preload 的 IPC，或  
    - 渲染进程里直接请求 **http://127.0.0.1:18789** 的 API / WebSocket，  
    不依赖「从 18789 加载整页」。
- 技术形态上仍是「网页」（HTML+JS），但 **归属上是「app 自带的界面」**，和「在 app 里打开一个网页」有本质区别。  
  这样就能在思路和架构上对齐 QClaw，同时避免网关 CSP、白屏等问题。

### 方案 B：真正原生 UI（非 Web）

- 用 **完全非 Web** 的 UI 做 Dashboard（例如原生控件、或 React Native / Tauri 等非「BrowserWindow 里跑网页」的方案）。
- 数据仍只和本地 OpenClaw 联动（API/WebSocket 不变）。
- 代价：需要 **新栈或重写** 当前基于 Vue/HTML 的 Dashboard，工作量和维护成本都大；Electron 本身没有「原生控件」做复杂列表/聊天等，通常要换技术栈或混合架构。

---

## 4. 建议的落地顺序

1. **先落实方案 A**  
   - 把 Dashboard 明确为「**app 自带的本地前端**」：  
     - 只从 app 包内加载（loadFile 或稳定可用的 app://）；  
     - 绝不从 18789 加载「整页」；  
     - 所有内容数据通过 18789 的 API/WebSocket + 主进程/Preload 获取。  
   - 这样在「不用一个网页去做 Dashboard，而是 app 里自己的界面」这一点上，已经和 QClaw 一致；只是实现上仍是 Web 技术，便于复用现有 Vue 和 OpenClaw 对接。

2. **若仍追求「完全原生」**  
   - 再在方案 A 稳定后，评估方案 B：新开一个真正原生的 Dashboard 模块，只把「和 OpenClaw 联动」的逻辑保留/迁移过去。

---

## 5. 小结

- **QClaw 并没有在 app 里用浏览器打开一个网页来做 Dashboard**，而是用 **app 自带的本地前端**（file:// 的 Vue 页）做 UI，数据再和网关/后端联动。
- 你要的「不用网页、在 app 里做原生 Dashboard」在**架构上**可以理解为：**Dashboard 是 app 的一部分（自带 UI），数据与 OpenClaw 联动**。  
  推荐先按 **方案 A** 做到：UI 只来自 app 包、数据只来自 OpenClaw，这样就已经是「app 里的 Dashboard」而不是「在 app 里打开的网页」；若之后仍要完全原生 UI，再考虑方案 B。
