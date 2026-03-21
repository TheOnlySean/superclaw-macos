# ダッシュボード UI（control-ui-ja）について

## 当前方案：仅使用官方 OpenClaw UI 日语版（control-ui-ja）

为避免白屏/黑屏问题，**已不再使用 dashboard-renderer（双端口）**，改为仅使用 **control-ui-ja**（官方 Control UI + 日语构建）：

- **control-ui-ja**：由 `scripts/prepare-control-ui-ja.js` 从 OpenClaw 官方 UI 构建，加入日文 locale（`ja.ts`），输出到 `control-ui-ja/`。应用内通过 **file://.../control-ui-ja/index.html?gatewayUrl=ws://127.0.0.1:18789&locale=ja** 加载，界面为日文。
- **打开逻辑**：`createDashboardWindow()` 只走 control-ui-ja（存在则 file:// + locale=ja），不存在则直连 http://127.0.0.1:18789。不再启动本机 HTTP 服务、不加载 dashboard-renderer。
- **浏览器 18789**：始终为官方默认 UI，不受影响。
- **打包**：`extraResources` 包含 `control-ui-ja`。构建 control-ui-ja 请运行 `npm run prepare-control-ui-ja`（可选 `SUPERCLAW_SIMPLE_NAV=1` 简化菜单）。详见 `docs/DASHBOARD-OFFICIAL-UI-JA.md`。

---

## 安装完成 → 打开 Dashboard 的流程（参考 QClaw 后的加强）

- 完成页唯一主操作：「あなたの SuperClaw を使い始める」→ IPC `open-dashboard`。
- 主进程：先**短暂等待网关就绪**（最多约 5 秒、每 0.5 秒探测一次），再 `createDashboardWindow()`，减少一打开就报连接错误的情况。
- 渲染进程：点击后按钮显示「開いています…」+ spinner，直到窗口打开后再恢复文案。
- 详见 `docs/qclaw-reference/QCLAW-FINDINGS.md`：QClaw 用浏览器打开网关；我们保持内嵌窗口 + 本地 control-ui-ja，仅借鉴「单点出口、流程顺」的体验。

## 不影响用户：SuperClaw 内是我们的 UI，浏览器 18789 仍是官方 UI（双端口方案）

**原则**：不修改用户本机的 OpenClaw 配置（`~/.openclaw/openclaw.json`），用户在自己浏览器里打开 `http://127.0.0.1:18789` 时看到的**始终是 OpenClaw 官方默认 UI**，不会因安装 SuperClaw 而改变。

- **双端口**：18789 由 OpenClaw 网关占用，提供官方 Control UI；SuperClaw 在打开 Dashboard 时在本机**另起一个随机端口**（仅 127.0.0.1），用 `dashboard-server.js` 提供我们的 **dashboard-renderer** 静态文件，并将 API/WebSocket 请求代理到 18789。两者互不干扰。
- **SuperClaw 内打开 Dashboard**：加载 `http://127.0.0.1:新端口/`，为标准 HTTP，无白屏问题；关窗时主进程关闭该 HTTP 服务并释放端口。
- **用户浏览器打开 18789**：应用**不再写入** `gateway.controlUi.root`，18789 始终为官方 Control UI。若配置曾被旧版本改过，打开 Dashboard 时会自动清除并重启网关，恢复 18789 为官方 UI。

---

## ローカル UI に含まれる変更（すべて control-ui-ja に反映済み）

以下の変更は **prepare-control-ui-ja** でビルドし、**control-ui-ja** にコピーした成果物に含まれています。アプリが**ローカルの control-ui-ja（file://）** を開いているときにだけ表示されます。

1. **ブランド**  
   - タイトル・ヘッダー：**SuperClaw** / ゲートウェイ ダッシュボード

2. **メニュー順（よく使う項目を前に）**  
   - コントロール：**チャンネル → 概要 → セッション → インスタンス → 利用状況 → Cron**  
   - 設定ページ内：**エージェント → チャンネル → ゲートウェイ → スキル → 認証 → …**

3. **設定ページの「通俗説明」**  
   - 各ブロック（環境変数・エージェント・チャンネルなど）の下に、一般ユーザー向けの短い説明文を日本語で表示（例：「Telegram・Discord・Slack など、メッセージアプリとの連携を設定します。」）。

4. **スキル説明の日本語化**  
   - スキル一覧・エージェントのスキルで、各スキルの説明を日本語で表示（files / web / browser など、対応分）。

5. **Gateway URL 確認ダイアログ**  
   - 文言を日本語にし、赤い「エラー」風ではなく中性のデザインに変更。

6. **サイドバーの軽いスタイル**  
   - ナビの余白・角丸・hover を調整（日本アプリの事例を参考にしたシンプルな見やすさ）。

7. **チャット欄の日本語表示（アプリ側で注入）**  
   - メッセージ入力欄のラベル「Message」→「メッセージ」、プレースホルダーを「メッセージを入力… (Enter で送信)」に。  
   - ボタン「Send」→「送信」、「New session」→「新規セッション」、「Queue」→「キュー」、「Stop」→「停止」。  
   - ローカル UI を開いたときにメインプロセスからスクリプトで差し替えています。

---

## ローカル vs リモートの見分け方

- **ウィンドウのタイトル**  
  - **「SuperClaw（日本語）」** → ローカルの control-ui-ja を読み込んでいます。上記の変更がすべて効いています。  
  - **「SuperClaw」**（日本語なし）→ 接続先のゲートウェイ（http://127.0.0.1:18789/）の画面を表示しています。公式の OpenClaw UI のため、上記の変更は反映されません。

- **画面上のブランド**  
  - 左上が **SuperClaw** かつ副題が **ゲートウェイ ダッシュボード** → ローカル UI。  
  - **OpenClaw** のまま → リモートのゲートウェイの画面。

ローカルが読まれていない場合は、アプリの「設定を更新しました」ダイアログの案内に従うか、一度アプリを再起動してから「あなたの SuperClaw を使い始める」を押し直してください。
