#!/bin/bash
# 純 bash 製作 DMG，由「終端機」執行時 hdiutil 可繼承完整磁碟取用權限。
# 使用：在終端機執行
#   cd japanclaw-setup && bash scripts/create-dmg.sh
#  或指定 .app 路徑：
#   bash scripts/create-dmg.sh /tmp/SuperClaw-sign-xxxxx.app

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

APP_PATH="${1:-}"
if [ -z "$APP_PATH" ]; then
  # 優先使用 /tmp 內最新的已簽名 .app，否則用 dist 內的
  TMP_APP=$(ls -td /tmp/SuperClaw-sign-*.app 2>/dev/null | head -1)
  if [ -n "$TMP_APP" ] && [ -d "$TMP_APP" ]; then
    APP_PATH="$TMP_APP"
    echo "使用 /tmp 內已簽名 .app"
  else
    APP_PATH="$ROOT/dist/mac-arm64/SuperClaw.app"
  fi
fi
if [ ! -d "$APP_PATH" ]; then
  echo "找不到 .app: $APP_PATH"
  echo "請先執行: node scripts/sign-mac-app.js"
  echo "或指定路徑: bash scripts/create-dmg.sh /path/to/SuperClaw.app"
  exit 1
fi

OUT_DMG="$ROOT/dist/SuperClaw-1.0.0-arm64.dmg"
VOL_NAME="SuperClaw Setup"
# 暫存 DMG 放 /tmp，避免 Desktop 等路徑的 TCC 限制
TMP_DMG="/tmp/superclaw-build-$$.dmg"

echo "使用 .app: $APP_PATH"
echo "建立暫存 DMG: $TMP_DMG"

# 先卸載可能殘留的卷
hdiutil detach "/Volumes/$VOL_NAME" -force 2>/dev/null || true
sleep 2

echo "> hdiutil create ..."
hdiutil create -volname "$VOL_NAME" -size 1500m -fs HFS+ -fsargs "-c c=0,a=0,j=0" -noscrub "$TMP_DMG"
sleep 1

echo "> hdiutil attach ..."
hdiutil attach "$TMP_DMG" -readwrite -noverify -noautoopen
sleep 2

echo "> 複製 .app 到卷..."
cp -R "$APP_PATH" "/Volumes/$VOL_NAME/"
sleep 1

echo "> hdiutil detach ..."
hdiutil detach "/Volumes/$VOL_NAME" -force
sleep 2

echo "> hdiutil convert ..."
[ -f "$OUT_DMG" ] && rm -f "$OUT_DMG"
hdiutil convert "$TMP_DMG" -ov -format UDZO -o "$OUT_DMG"
rm -f "$TMP_DMG"

echo "完成: $OUT_DMG"
