# Dashboard：官方 OpenClaw UI + 日语化（彻底方案）

## 思路

不再使用 dashboard-renderer（双端口 HTTP），改为**仅使用官方 OpenClaw Control UI 的日语构建版（control-ui-ja）**，在应用内通过 **file:// + `locale=ja`** 加载。这样：

- **应用内**：打开 Dashboard 时加载本地的 `control-ui-ja/index.html?gatewayUrl=ws://127.0.0.1:18789&locale=ja`，界面为日文。
- **浏览器**：用户打开 http://127.0.0.1:18789 时仍为官方默认 UI（中/英文），不受影响。
- **白/黑屏**：不再启动本地 HTTP 服务、不加载 Vue 打包的 dashboard-renderer，避免 Electron 白屏/黑屏问题。

## 实现方式（之前就做过、效果很好）

1. **prepare-control-ui-ja.js**  
   - 从 OpenClaw 官方仓库 clone 到 `.openclaw-ja-build`。  
   - 将 `docs/openclaw-pr-ja/locales/ja.ts` 拷入 UI 的 i18n，并在 registry 中注册 `ja`、在 en 里加「日本語」。  
   - 执行 `pnpm ui:build`，把 `dist/control-ui` 拷到 **control-ui-ja/**。  
   - 打包时 **extraResources** 包含 `control-ui-ja`，应用从 `file://.../control-ui-ja/index.html?…&locale=ja` 加载。

2. **应用内日文、浏览器不变**  
   - 应用内：`loadURL(fileUrl + '?gatewayUrl=ws://127.0.0.1:18789&locale=ja' + hash)`，官方 UI 会读 URL 的 `locale=ja` 并显示日文。  
   - 浏览器直接打开 18789：不传 `locale`，网关 serve 的是默认 control-ui，语言不变。

3. **主进程**  
   - `createDashboardWindow()` 已改为**不再使用 dashboard-renderer**（`if (useRendererDashboard)` 已废弃），只走 control-ui-ja（或没有时直连 18789）。

## 官方 UI 可改动范围

在**不 fork 整个 OpenClaw** 的前提下，我们能在 **prepare-control-ui-ja** 里做的修改包括：

| 项目 | 方式 | 说明 |
|------|------|------|
| **日语化** | 已做 | `ja.ts` 覆盖所有 i18n key（nav、tabs、chat.send、config 等），`locale=ja` 时全部日文。 |
| **侧栏菜单精简** | 已支持 | 环境变量 `SUPERCLAW_SIMPLE_NAV=1` 时，构建前 patch `navigation.ts` 的 `TAB_GROUPS`，只保留：チャット・概要・セッション・チャンネル・エージェント・スキル・設定（隐藏 instances/usage/cron/nodes/debug/logs）。 |
| **设定页区块顺序/名称** | 可做 | 在 `.openclaw-ja-build/ui` 里改 `config.ts` 的 SECTIONS 顺序、或 patch 构建前文件。 |
| **品牌（标题/logo）** | 已做 | prepare 后改 index.html 的 title 为 SuperClaw；复制 `build/icons/icon-512.png` 到 control-ui-ja/assets/superclaw-icon.png；主进程注入脚本将 .brand-title 改为 SuperClaw、.brand-sub 改为「ゲートウェイ ダッシュボード」、.brand-logo img 改为 assets/superclaw-icon.png。 |
| **未走 i18n 的英文** | 已做 | 主进程 `injectDashboardJapaneseStrings`：Send/New session/Queue/Stop/Message、输入框 placeholder（含 heartbeat）、「拖拽至此上传」→「ここにドラッグしてアップロード」、「New messages」「Loading chat…」「Type a command…」等を日本語に差し替え。 |

「Send」等按钮：官方 UI 已通过 i18n 的 `chat.send`、`chat.messageLabel` 等提供，`ja.ts` 中已译为「送信」「メッセージ」等，只要用 `locale=ja` 即生效。

## 简化菜单 / 工具栏（侧栏）能改到什么程度

**可以改。** 我们不改动 OpenClaw 业务逻辑，只在其 **构建前** 改 `navigation.ts` 里的 `TAB_GROUPS`，侧栏就只显示你指定的项。构建 control-ui-ja 时用环境变量即可。

### 只保留「チャット + スキル」

```bash
SUPERCLAW_NAV_SKILL_ONLY=1 node scripts/prepare-control-ui-ja.js
```

侧栏只显示：**チャット**、**スキル**（其他全部不显示）。

### 调整顺序：Chat → Skill → Agent → Cron → Channel（数据类往后）

```bash
SUPERCLAW_NAV_ORDER=1 node scripts/prepare-control-ui-ja.js
```

侧栏分组与顺序变为：**チャット** → **エージェント**（スキル・エージェント・ノード）→ **コントロール**（クロン・チャンネル・概要・セッション・インスタンス・利用状況）→ **設定**。用户最常接触的 Chat / Skill / Agent / Cron / Channel 在前，数据/运维类在后。

### 保留常用项（チャット・概要・セッション・エージェント・スキル・設定）

```bash
SUPERCLAW_SIMPLE_NAV=1 node scripts/prepare-control-ui-ja.js
```

侧栏保留：チャット / コントロール（概要・セッション・チャンネル）/ エージェント（エージェント・スキル）/ 設定。不显示：インスタンス、利用状況、Cron、ノード、デバッグ、ログ。

## 打包流程

1. 生成 control-ui-ja（必选）：  
   `node scripts/prepare-control-ui-ja.js`  
   如需简化菜单：  
   `SUPERCLAW_SIMPLE_NAV=1 node scripts/prepare-control-ui-ja.js`

2. 打包应用（无需再跑 prepare-dashboard-renderer）：  
   `npm run dist:mac:arm64`  
   extraResources 中仍可保留 `dashboard-renderer` 以作备份，但主流程已不再使用。

## 相关文件

| 文件 | 作用 |
|------|------|
| `src/main/index.js` | `createDashboardWindow()` 仅用 control-ui-ja（file:// + locale=ja）或 18789，不再启动 dashboard-server。 |
| `scripts/prepare-control-ui-ja.js` | 从官方 UI 构建日文版并支持 `SUPERCLAW_SIMPLE_NAV=1` 精简菜单。 |
| `docs/openclaw-pr-ja/locales/ja.ts` | 日文 i18n 源，需与官方 en/zh 的 key 对齐。 |
| `.openclaw-ja-build/ui/src/ui/navigation.ts` | 构建前被 patch（当 SUPERCLAW_SIMPLE_NAV=1 时）以简化 TAB_GROUPS。 |
