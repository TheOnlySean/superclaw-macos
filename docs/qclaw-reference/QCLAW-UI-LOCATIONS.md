# QClaw 界面位置确认（基于 QClaw-latest-arm64.dmg / 0.1.4-arm64）

已用你提供的 **QClaw-latest-arm64.dmg** 挂载后整包搜索，结论如下。

---

## 1. 拆的就是这个 DMG

- 挂载后卷名为 **QClaw 0.1.4-arm64**，与「latest」一致，版本为 0.1.4。
- 下面所有路径都来自这次挂载后的 `QClaw.app`。

---

## 2. 包里和「控制台 / 操作界面」有关的唯一位置

在整包内搜了：

- 所有 **index.html**
- 所有名字带 control / dashboard / ui / qclaw 的目录  
- 主进程里 **openExternal**、**controlUi**、**gateway** 的用法

结果只有这一处是「点『打开控制台』后浏览器会打开的页面」对应的资源：

| 用途 | 路径 |
|------|------|
| **网关 Control UI**（浏览器里看到的 18789 页面） | `QClaw.app/Contents/Resources/openclaw/node_modules/openclaw/dist/control-ui/` |

- 主进程里「打开控制台」只调用了：  
  `shell.openExternal("http://${localhost}:${port}#token=${token}")`  
  即 **只打开本机 18789**，没有看到打开其它 URL（例如 aizone / 远程页）的代码。
- 自带配置 `openclaw/config/openclaw.json` 里 **没有** 设置 `gateway.controlUi.root`，因此网关会用 OpenClaw 的默认逻辑，从上面的 **dist/control-ui** 提供页面。
- 也就是说：**没有找错位置**，浏览器里那套「最后操作界面」在包内只对应 **dist/control-ui** 这一处。

其它找到的 html（pino、playwright、a2ui、chrome-extension、export-html 等）都不是「主控制台 / 主操作界面」。

---

## 3. 「和官方完全不一样」的两种可能

### 可能 1：你说的「最后操作界面」是 **QClaw 主窗口**（带「打开控制台」按钮的那一块）

- 那是 **Electron 主窗口** 的界面，不是浏览器里的 18789。
- 它在 **app.asar** 里：`out/renderer/`（Vue 应用，深色面板、状态、端口、启动/停止、「打开控制台」、日志等）。
- 我们之前已经解包并参考的是这一块（见 QCLAW-FINDINGS 里 panel-header、action-btn-control-ui 等）。
- 若你指的是「**主窗口这一块**和官方不一样」——官方本来就没有这个 Electron 壳，所以不一样是正常的；我们没找错，这块就在 app.asar 的 renderer 里。

### 可能 2：你说的「最后操作界面」是 **浏览器里 18789 打开后的那一页**

- 包内对应资源**只有** `dist/control-ui`，没有第二个「控制台 UI」目录。
- 若实际跑起来看到的和官方 **完全** 不一样，有可能是：
  - **运行时** 打开 18789 后，页面里又 **跳转到远程**（例如 aizone / 其它域名），真正界面是远程站点的；或
  - 你本机跑的是 **别的版本/渠道** 的 QClaw（例如已自动更新到更新版），而我们现在拆的是这份 0.1.4 的 DMG。

---

## 4. 建议你这边确认的两件事

1. **点「打开控制台」后，浏览器地址栏里最终是哪个 URL？**  
   - 若一直是 `http://127.0.0.1:18789/...`，那界面对应的就是包里的 **dist/control-ui**，我们位置没找错。  
   - 若会变成别的域名（例如 `*.qq.com`、`*aizone*` 等），那「最后操作界面」就可能是远程页面，不在本 DMG 里。

2. **你说的「最后操作界面」是指哪一块？**  
   - **A**：QClaw 那个带「打开控制台」按钮、有状态/日志的主窗口；  
   - **B**：点完「打开控制台」后，**浏览器**里打开的那一页。  

若是 A，我们已经从 app.asar 里拆的就是这块；若是 B，包内对应资源只有 **dist/control-ui**，没有其它位置。

---

## 5. 截图界面已定位（2026-03-13 补充）

根据你提供的「最终 dashboard」截图中的文案在包内全文搜索：

- **「技能广场」「微信远程」「用户系统配置」「可以描述任务或提问任何问题」「检测更新」** 等均出现在  
  **`app/out/renderer/assets/c-8aHI0XC0.js`**（Vite 打包后的 chunk）。
- 入口：`out/renderer/index.html` → 主 bundle **`e-BOOjGo6C.js`** → 会加载 `c-8aHI0XC0.js` 等 chunk。

**结论：你看到的「和官方 OpenClaw dashboard 完全不同的」那一套 UI，是 QClaw 的 Electron 主窗口（渲染进程）里的页面，不是浏览器里 18789 的 control-ui。**

| 界面 | 来源 | 包内路径 |
|------|------|----------|
| 官方风 control-ui（18789 网页） | 网关 dist/control-ui | `openclaw/node_modules/openclaw/dist/control-ui/` |
| **截图中的 UI**（技能广场、会话列表、微信远程、用户系统配置等） | **Electron 主窗口** | **`app.asar` → `out/renderer/`**（主 chunk：`e-BOOjGo6C.js`，含文案的 chunk：`c-8aHI0XC0.js`） |

若要在我们 SuperClaw 里复刻或复用这套「主窗口内 dashboard」UI，需要从 `docs/qclaw-reference/app/out/renderer/` 提取并接入我们的 Electron 渲染进程（或把该窗口改为加载这份前端）；与「网关 control-ui 替换」是两条线。

---

## 6. 当前我们已提取的内容

- **网关 Control UI**：已从该 DMG 的 `dist/control-ui` 完整复制到  
  `docs/qclaw-reference/qclaw-control-ui-extract/`。  
- **Electron 主窗口（面板 + 截图中的 dashboard 内容）**：在解包的 `docs/qclaw-reference/app/out/renderer/`（含 `index.html`、`e-BOOjGo6C.js`、`c-8aHI0XC0.js` 及各类 `a-*.css` 等）。

若你确认「最后操作界面」实际是远程页面或来自其它安装包，我们可以再按新线索（例如最终 URL、或新 DMG）继续找。
