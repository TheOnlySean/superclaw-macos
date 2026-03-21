# Agent / 發佈備忘（SuperClaw / japanclaw-setup）

## ARM64 環境變數（除錯／回退）

- **`SUPERCLAW_ARM64_STABLE_MODE=1`**：開啟「穩定模式」（背景視窗相關 Chromium 開關）；**預設不關 GPU**（避免白屏）。若仍 crash 可再加 `SUPERCLAW_ARM64_STABLE_DISABLE_GPU=1`。
- **`SUPERCLAW_ARM64_CONTROL_UI_FILE=1`**：強制以 `file://` 開 `control-ui-ja`（略過本機 HTTP）。預設（ARM64 打包）改為 **本機 HTTP + 固定優先埠 `27489`**，並在 `allowedOrigins` 寫入 `http://127.0.0.1:27489`（OpenClaw 為**全字串匹配**，僅 `http://127.0.0.1` 不含埠時 WebSocket 會被拒）。
- **`SUPERCLAW_ARM64_DASHBOARD_HTTP=1`**：改走本機 HTTP + `dashboard-renderer`（舊行為；與上者不同）。
- **`SUPERCLAW_ARM64_DIRECT_DASHBOARD=1`**：除錯用，啟動時跳過主安裝精靈、直開 Dashboard。**預設關閉**（與 Intel 一致先走安裝流程）。
- **`SUPERCLAW_USE_RENDERER_SAFE=1`**：主視窗改優先 `renderer-safe`（極端環境除錯）；預設用完整 `renderer` 安裝精靈。
- **`SUPERCLAW_BUNDLED_NODE_NO_JITLESS=1`**：同梱 Node 起 OpenClaw 時**不要**加 `--jitless`（預設會加，避免低內存機 V8 `CodeRange` OOM；若需對照除錯可關閉）。

## macOS arm64 修 bug 後的流程

若已修改主進程 / 打包相關程式碼且目標是修正 **Apple Silicon（arm64）** 行為，**應直接在本機跑完整流水線**，無需再向使用者確認「要不要打包」：

```bash
cd japanclaw-setup
rm -rf dist/mac-arm64
TARGET_ARCH=arm64 npm run prepare-openclaw && npm run prepare-node-runtime:arm64 && CSC_IDENTITY_AUTO_DISCOVERY=false ./node_modules/.bin/electron-builder --mac --arm64 --dir
node scripts/sign-mac-app.js
bash scripts/make-clean-zip.sh arm64
VER="$(node -p "require('./package.json').version")"
set -a && . ./.env && set +a && NOTARIZE_ZIP_PATH="$PWD/dist/SuperClaw-$VER-arm64.zip" node scripts/notarize-mac.js
xcrun stapler staple "$PWD/dist/mac-arm64/SuperClaw.app"
mkdir -p dist/release-for-upload && cp -f "dist/SuperClaw-$VER-arm64.zip" dist/release-for-upload/
```

（`.env` 需含 `APPLE_ID` / `NOTARY_PASSWORD` / `TEAM_ID`；勿提交 Git。）

## 路徑類 bug 檢查清單（打包後）

- **優先** `process.resourcesPath` + `app.asar.unpacked/...`，不要只信 `path.join(__dirname, ...)`（App Translocation 下 `__dirname` 可能落在 `app.asar` 虛路徑）。
- **主視窗**：`index.html` / `preload.js` 必須指向 **unpacked** 下的 `src/renderer`、`src/main`；主視窗用 **`loadFile`**（勿對主視窗用 `127.0.0.1` HTTP，Translocation 下易 `ERR_FAILED -2`）。
- **OAuth 腳本**：`app.asar.unpacked/scripts/*.js` 用 `path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', ...)`。

## 產物

- 分發：`dist/SuperClaw-<package.json version>-arm64.zip`
- 已簽名 app：`dist/mac-arm64/SuperClaw.app`
