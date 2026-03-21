# GitHub Releases 与 SuperClaw 更新

当前环境**没有**可用的 GitHub MCP；请在本机终端完成仓库创建与推送。应用内更新使用 **electron-updater**，发布端使用 **GitHub Releases**。

## 1. 替换占位仓库地址

在 `package.json` 里把 `repository.url` 中的：

- `YOUR_GITHUB_ORG` → 你的 GitHub 用户名或组织名  
- `superclaw-macos` → 你想要的仓库名（可改）

示例：

```json
"repository": {
  "type": "git",
  "url": "https://github.com/acme-corp/superclaw-macos.git"
}
```

`build.publish.provider` 已设为 `github`，electron-builder 会从上述 `repository` 解析 `owner/repo`。

重新**打包**一次后，`SuperClaw.app` 内会带有 `app-update.yml`，electron-updater 会向该仓库的 Releases 查询更新。

## 2. 新建仓库并上传代码（首次）

在 GitHub 网页新建空仓库（不要勾选自动添加 README，避免推送冲突），或使用 GitHub CLI：

```bash
cd /path/to/japanclaw-setup
git init
git add .
git commit -m "chore: initial SuperClaw setup"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_ORG/superclaw-macos.git
git push -u origin main
```

**注意**：`openclaw/`、`node-runtime/`、`dist/`、`.env` 已在 `.gitignore` 中（`node-runtime` 内 `node` 单文件超过 GitHub 100MB 限制）。克隆或 CI 发版前请执行：

`npm run prepare-openclaw` 与 `npm run prepare-node-runtime:arm64`（或 `x64`）。

## 3. 发布新版本到 GitHub Releases

### 3.1 版本号

只改根目录 `package.json` 的 `version`（如 `1.0.0` → `1.0.1`），与 Git tag 一致，例如 `v1.0.1`。

### 3.2 用 electron-builder 自动上传（推荐，含 `latest-mac-*.yml`）

1. 在 GitHub 创建 **Personal Access Token（classic）**，勾选 `repo`（私有库需要；公开库至少能上传 Release 资源）。
2. 发版机器上设置环境变量：

```bash
export GH_TOKEN=你的_token
```

3. 在**已签名、与发布流程一致**的构建产物上执行发布（示例，按你实际脚本调整）：

```bash
# 示例：打完 arm64 目录并签名后，由 electron-builder 负责 publish（需与本仓库 electron-builder 配置一致）
npx electron-builder --mac --arm64 --publish always
```

若你当前流程是「builder --dir → 自研 sign → make-clean-zip」，则 **zip 内容与哈希** 可能与 builder 直接产出的 zip 不一致；此时 app 内 auto-update 所依赖的 `latest-mac-arm64.yml` 必须对应**实际上传的那一个 zip**。短期可任选其一：

- **对齐**：发版用 electron-builder 生成的 **zip**（并完成公证/notarize）上传；或  
- **后续**：写脚本对 `make-clean-zip` 的最终 zip 计算 sha512 并生成/覆盖 `latest-mac-arm64.yml`（再上传）。

### 3.3 纯手动在网页建 Release

1. GitHub → Releases → Draft a new release。  
2. Tag 填 `v1.0.1`，上传 zip、dmg 等附件。  
3. **electron-updater** 仍需要在同一次 Release 里附带由 electron-builder 生成的 **`latest-mac-arm64.yml`**（及 x64 对应文件，若分架构发布），否则客户端无法正确拉更新。手动发版时最容易漏掉这一步，故优先用 `electron-builder --publish always`。

## 4. 官网下载按钮能否直链 GitHub？

**可以。** 每个附件都有固定下载地址：

```text
https://github.com/OWNER/REPO/releases/download/v1.0.1/文件名.zip
```

若希望**官网永远指向「最新版」**而不用每次改版本号，有两种常见做法：

### 做法 A：固定附件名（推荐）

每个 Release 都上传**相同文件名**，例如：

- `SuperClaw-mac-arm64.zip`  
- `SuperClaw-mac-x64.zip`  

则官网可写死：

```text
https://github.com/OWNER/REPO/releases/latest/download/SuperClaw-mac-arm64.zip
https://github.com/OWNER/REPO/releases/latest/download/SuperClaw-mac-x64.zip
```

`releases/latest/download/` 会解析到**最新一次 Release** 里同名文件。

### 做法 B：带版本号的文件名

官网每次发版后改链接，或让官网小脚本请求 GitHub API 取 `latest` 的 `browser_download_url`（需处理 API 限流）。

---

这样**安装包不必再上传到 Vercel**；Vercel 只托管静态站，下载走 GitHub CDN 即可。

## 5. 应用内行为说明

- 仅 **打包后**（`app.isPackaged`）会检查更新；开发 `npm start` 不会弹更新。  
- 环境变量 **`SUPERCLAW_DISABLE_AUTO_UPDATE=1`** 可关闭检查。  
- 启动约 **8 秒**后首次检查，之后每 **24 小时**一次。  
- macOS 上部分环境要求应用安装在 **`/Applications`** 下替换更新才稳定，若安装失败可看 `~/.superclaw-setup-debug.log` 中的 `autoUpdater-*` 记录。

## 6. 私有仓库

公开仓库无需额外配置。私有仓库时 electron-updater 需带 token 的 feed，配置较麻烦；**建议更新检查用公开仓库**（可单独建 `superclaw-releases` 只放安装包与 yml，源码仍私有）。
