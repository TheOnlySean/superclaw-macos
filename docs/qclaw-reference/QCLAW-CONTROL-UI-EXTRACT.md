# QClaw Control UI 提取说明

## 来源

从已挂载的 QClaw DMG 中提取的 **网关 Control UI**（即点「打开控制台」后浏览器里看到的那套界面）：

```
/Volumes/QClaw 0.1.4-arm64/QClaw.app/Contents/Resources/openclaw/node_modules/openclaw/dist/control-ui
```

已完整复制到本目录下的 **`qclaw-control-ui-extract/`**。

## 目录结构（与官方 OpenClaw 一致）

- `index.html` — 入口，标题为 "OpenClaw Control"
- `assets/index-wxM3V0HM.js` — 主逻辑（约 658KB）
- `assets/index-E0j6Tkrc.css` — 主样式（约 94KB）
- `assets/zh-CN-*.js`、`assets/de-*.js` 等 — 多语言 chunk
- favicon、apple-touch-icon 等静态资源

## 与当前 control-ui-ja 的关系

- **排版与组件**：QClaw 这份与 OpenClaw 官方/我们 .openclaw-ja-build 打出来的 Control UI 是**同一套设计系统**（shell、topbar、nav、content、chat 等），CSS 变量与布局一致。
- **差异**：主要是构建产物 hash 不同（文件名不同）、以及 index.html 里标题为 "OpenClaw Control"。若要用「QClaw 这份」作为我们 Dashboard 的界面，只需：
  1. 用 `qclaw-control-ui-extract/` 的**全部内容**覆盖 `control-ui-ja/`（或作为打包时的 control-ui 来源）；
  2. 把 `index.html` 的 `<title>` 改为 "SuperClaw"（或 "SuperClaw（日本語）"）；
  3. 保留我们现有的日文注入（或后续在源码里加 ja locale）。

## 如何用提取版替换我们的 Dashboard UI

**方式 A：直接覆盖 control-ui-ja（打包用这份）**

```bash
# 在 japanclaw-setup 根目录
rm -rf control-ui-ja/*
cp -R docs/qclaw-reference/qclaw-control-ui-extract/* control-ui-ja/
# 改标题
sed -i '' 's/<title>OpenClaw Control<\/title>/<title>SuperClaw<\/title>/' control-ui-ja/index.html
# 然后照常 npm run dist:mac:arm64
```

**方式 B：写进脚本**

可增加 `scripts/use-qclaw-control-ui.js`，执行：拷贝 `qclaw-control-ui-extract` → `control-ui-ja`、替换 title，再执行打包。这样每次打包前跑一次即可用 QClaw 的这份 UI。

## 注意

- 提取版依赖 **QClaw DMG 已挂载** 且路径为上述 `.../openclaw/node_modules/openclaw/dist/control-ui`。若 DMG 未挂载，需先挂载再执行提取或使用已复制好的 `qclaw-control-ui-extract/`。
- 若希望长期与 QClaw 新版本同步，可在每次拿到新 QClaw DMG 后重新执行一次提取并覆盖 `qclaw-control-ui-extract/`，再按上面步骤覆盖 control-ui-ja 并打包。
