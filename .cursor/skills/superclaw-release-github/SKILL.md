---
name: superclaw-release-github
description: Bumps SuperClaw (japanclaw-setup) version, builds signed macOS arm64/x64 zips, uploads stable-named assets to GitHub Releases for TheOnlySean/superclaw-macos. Use when the user asks to 更新版本、发版、上传 GitHub Release、release、publish、或同步官网下载包。
---

# SuperClaw：新版本打包并上传 GitHub Releases

## 前提

- 仓库根目录：`japanclaw-setup/`（本 skill 所在项目的根）。
- GitHub：`TheOnlySean/superclaw-macos`；官网直链依赖 **固定附件名**（见下）。
- 本机：`gh` 已登录；Apple 签名/公证环境已配置（与现有脚本一致）。
- `openclaw/`、`node-runtime/` 不在 Git 中；发版前需 `prepare-openclaw` 与 `prepare-node-runtime`。

## 流程（按顺序执行）

### 1. 改版本号

编辑根目录 `package.json` 的 `"version"`（semver，如 `1.0.1`）。  
`scripts/make-clean-zip.sh`、`scripts/create-dmg.js` 会读取该字段。

### 2. 打双架构包并签名/公证（与团队现有脚本一致）

典型顺序（细节以 `AGENTS.md` / 历史命令为准）：

- **arm64**：`prepare-openclaw` → `prepare-node-runtime:arm64` → `electron-builder --mac --arm64 --dir` → `node scripts/sign-mac-app.js` → 公证 zip（若有）→ `xcrun stapler staple dist/mac-arm64/SuperClaw.app` →  
  `bash scripts/make-clean-zip.sh arm64`
- **x64**：同理，`MAC_ARCH=x64` 等按现有 `sign-mac-app` 用法 →  
  `bash scripts/make-clean-zip.sh x64`

得到：

- `dist/SuperClaw-<version>-arm64.zip`
- `dist/SuperClaw-<version>-x64.zip`

**干净 zip 仅含 `SuperClaw.app`**（不含「首次打開說明」等 txt）。

### 3. 固定文件名（官网 `latest/download` 不变）

```bash
cd dist
cp -f "SuperClaw-<version>-arm64.zip" SuperClaw-mac-arm64.zip
cp -f "SuperClaw-<version>-x64.zip"   SuperClaw-mac-x64.zip
```

将 `<version>` 换为 `package.json` 中的实际版本。

### 4. 提交代码并推送（若尚未提交）

```bash
git add package.json package-lock.json  # 如有
git commit -m "release: <version>"
git push
```

### 5. 创建 GitHub Release 并上传附件

Tag 与版本对齐：`v` + `package.json` 的 version。

```bash
gh release create "v<version>" \
  dist/SuperClaw-mac-arm64.zip \
  dist/SuperClaw-mac-x64.zip \
  --repo TheOnlySean/superclaw-macos \
  --title "SuperClaw <version>" \
  --notes "<给用户看的更新说明>"
```

上传完成后，**Release 列表**：`https://github.com/TheOnlySean/superclaw-macos/releases`  
**本条 tag**：`https://github.com/TheOnlySean/superclaw-macos/releases/tag/v<version>`

### 6. 官网两个下载按钮（勿改 URL，除非换仓库）

- Apple Silicon：`https://github.com/TheOnlySean/superclaw-macos/releases/latest/download/SuperClaw-mac-arm64.zip`
- Intel：`https://github.com/TheOnlySean/superclaw-macos/releases/latest/download/SuperClaw-mac-x64.zip`

每次新 Release **必须**仍附带上述**同名**两个 zip，`latest` 才会指向新包。

## electron-updater（应用内更新）

- 主进程已接 `electron-updater`；**完整自动更新**通常还需 Release 中带 `latest-mac-arm64.yml`（等），一般由 `electron-builder --publish` 生成。仅上传两个 zip 时：**官网下载正常**；应用内自动更新可能不完整，需后续把 yml 纳入发布流程。
- 关闭检查：`SUPERCLAW_DISABLE_AUTO_UPDATE=1`。

## 常见故障

- **GitHub 拒收单文件 >100MB**：勿把 `node-runtime/` 提交进 Git（已在 `.gitignore`）。
- **推送 Release 失败**：检查 `gh auth status` 与网络。
