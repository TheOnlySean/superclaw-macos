#!/bin/bash
# 在終端機用 sudo 製作 DMG（解決 hdiutil Operation not permitted）
# 使用方式：在「終端機」執行：cd japanclaw-setup && bash scripts/make-dmg-terminal.sh

set -e
cd "$(dirname "$0")/.."

# 找最新的已簽名 .app（在 /tmp）
APP=$(ls -td /tmp/SuperClaw-sign-*.app 2>/dev/null | head -1)
if [ -z "$APP" ]; then
  echo "找不到 /tmp 內的已簽名 .app。請先執行："
  echo "  node scripts/sign-mac-app.js"
  exit 1
fi

echo "使用已簽名 .app: $APP"
echo "即將用 sudo 執行 create-dmg（會詢問本機登入密碼）…"
sudo env SUPERCLAW_APP_PATH="$APP" node scripts/create-dmg.js
echo "完成。DMG 位於: dist/SuperClaw-1.0.0-arm64.dmg"
