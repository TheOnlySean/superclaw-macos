# ARM64 白屏／崩潰 深度調研（與「認證」時間線對照）

## 2026-03 根因更新（測試機實測）

在 **macOS 26.2 (Tahoe) + Apple M4** 上，`SuperClaw Helper (Renderer)` 崩潰報告顯示：

- **Exception**: `EXC_BREAKPOINT (SIGTRAP)`，**Code 5**
- **堆疊**: `pthread_jit_write_protect_np` → `v8::internal::ThreadIsolation::Initialize` → `v8::V8::Initialize`
- **含義**: Renderer 進程在 **V8 初始化**階段即崩潰，與「頁面是否為官方 Control UI」無直接關係。

**簽名層根因**：`scripts/deep-sign-mac-app.js` 對 `Contents/Frameworks/` 下巢狀 **`SuperClaw Helper (Renderer).app`** 等使用 `codesign` 時 **未附加 `--entitlements`**，僅主 `.app` 外殼帶了 `com.apple.security.cs.allow-jit`。在 **Hardened Runtime** 下，Helper 可執行檔若缺 **JIT / 可執行記憶體** 相關權限，會與 V8 Thread Isolation 衝突；**macOS 26** 上更嚴格，表現為立即 SIGTRAP（與 [electron#49522](https://github.com/electron/electron/issues/49522) 一類報告一致）。

**修復**：深度簽名時對 `Contents/Frameworks/*.app` 一律加上與主程式相同的 `build/entitlements.mac.plist`（**arm64-build-21** 起）。

---

## 結論摘要

| 說法 | 判斷 |
|------|------|
| OpenClaw 官方 Control UI「不能打包進 App」 | **不成立**。目前為 `extraResources` 靜態資源 + 連本機 Gateway，與瀏覽器開 18789 同類。 |
| 「因為不是我們寫的，所以不能在 App 裡認證」 | **需拆層**：OAuth／授權多在 **主進程 / installer / 子程序**；Control UI 是 **Gateway 的客戶端**。問題多在 **嵌入方式與環境**，而非「官方禁止嵌入」。 |
| 「做了認證之後 ARM64 才壞」 | **時間上可能重疊，但程式上「授權模組」幾乎不是白屏根因**（見下節）。更可能是 **同一時期加入了**：內嵌 Gateway、Dashboard、control-ui、preload、arm64 捷徑等，**多變因疊加**。 |

## 1. 授權（license）實際在何時執行？

來源：`src/main/license.js`

- `hasValidLicense()`：只讀 **本地** `userData/license.json`，**無網路**、**無阻塞主進程**。
- `verifyLicenseKey()`：僅在用戶 **點擊「認証してダッシュボードを開く」** 時 `fetch` 遠端 API，**不在 App 啟動時自動執行**。

來源：`src/renderer/renderer.js`

- 「SuperClaw を使い始める」→ `hasValidLicense()` → 無則進入 **license 步驟**；有則 `openDashboard()`。
- 因此：**白屏／renderer crash 若發生在「尚未點開 Dashboard」**，與 **線上 license API** 無直接因果。

## 2. 為何「感覺上」跟認證同時出問題？

合理解釋包括：

1. **同一迭代合併了多項改動**（授權 UI + 內嵌 Gateway + control-ui-ja + Dashboard 視窗 + arm64 直開 Dashboard 等），問題被歸因到「認證」。
2. **預設改為 `arm64-direct-dashboard`** 時，主安裝精靈被繞過，**體感流程變成「一開就進 Dashboard」**，而 Dashboard／Control UI 路徑在 ARM64 上較不穩，與 license 步驟是否顯示無必然關係。
3. **Intel 與 ARM64 共用同一套前端資源**，差異在 **Electron/Chromium arm64 二進位、GPU 合成、沙箱、路徑（含 App Translocation）**，不是「同一 HTML 在 Intel 能跑、ARM 不能」的單一原因。

## 3. 技術上較可能的根因（按優先級）

1. **Electron Renderer 在 darwin-arm64 上的穩定性**（日誌曾出現 `render-process-gone` / exitCode 5）：與 **GPU／合成／沙箱** 相關，非 license。
2. **Gateway `allowedOrigins` 與頁面 Origin**：需 **完整匹配**（含埠）。`file://` 或 `http://127.0.0.1:隨機埠` 與僅配置 `http://127.0.0.1` 不一致時，WebSocket 失敗 → 長時間空白或看似白屏。
3. **App Translocation / 資源路徑**：從下載目錄直接執行時路徑在臨時掛載下，**資源找不到或載入錯誤**。
4. **內嵌 HTTP 靜態服務 + 重啟 Gateway**：配置寫入後若未正確重啟，短暫連線失敗。

## 4. 建議驗證步驟（縮小範圍）

在 ARM64 測試機上：

```bash
# 對照：是否「主視窗」本身就不穩
SUPERCLAW_ARM64_DIRECT_DASHBOARD=0 /path/to/SuperClaw.app/Contents/MacOS/SuperClaw
```

- 若 **僅主視窗**也崩／白屏 → 偏向 **Electron/精靈 renderer** 與環境。
- 若 **僅 Dashboard** 壞 → 偏向 **Control UI + Gateway + Origin + 本機 HTTP**。

日誌：`~/.superclaw-setup-debug.log`，搜尋 `main-render-process-gone`、`dashboard-render-process-gone`、`dashboard-did-fail-load`、`dashboard-controlui-http-started`。

## 5. 遠端 SSH 說明

自動化環境若未掛載你的 SSH 私鑰，無法直接連測試機。若需代跑指令，請在本機終端執行並貼輸出，或提供 **只讀** 的跳板與金鑰路徑約定。

---

*文檔隨排查更新。*
