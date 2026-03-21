# 应用图标

请将**您自己的图标**放在本目录：

- **icon-512.png** — 512×512 像素 PNG（必需，用于 Linux 及 electron-builder 生成图标）
- **icon.icns** — macOS 应用图标（可选，有则用；无则 electron-builder 会从 PNG 尝试生成）
- **icon.ico** — Windows 应用图标（可选，有则用；无则从 PNG 尝试生成）

这样打包后的应用在桌面/Dock 会显示为 **JapanClaw** 和您的图标，而不是 Electron 默认图标。

生成 .icns（macOS）：可用 `iconutil` 或在线工具从 512×512 PNG 生成。  
生成 .ico（Windows）：可用在线工具从 PNG 生成多尺寸 .ico。
