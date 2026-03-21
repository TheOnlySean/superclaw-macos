#!/bin/bash
# x64 公證 + staple 一鍵腳本（需先設定環境變數）
# 用法：APPLE_ID="your@email.com" NOTARY_PASSWORD="xxx" TEAM_ID="G7VUNQ8M6B" bash scripts/notarize-and-staple-x64.sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="$(node -p "require('$ROOT/package.json').version" 2>/dev/null || echo "1.0.0")"
ZIP="$ROOT/dist/SuperClaw-$VER-x64.zip"
[ -f "$ZIP" ] || { echo "Missing $ZIP"; exit 1; }
[ -n "$APPLE_ID" ] && [ -n "$NOTARY_PASSWORD" ] || { echo "Set APPLE_ID, NOTARY_PASSWORD, TEAM_ID"; exit 1; }
echo "送交 x64 公證…"
xcrun notarytool submit "$ZIP" --apple-id "$APPLE_ID" --team-id "${TEAM_ID:-G7VUNQ8M6B}" --password "$NOTARY_PASSWORD" --wait
echo "公證通過。執行 staple…"
WRK=$(mktemp -d)
trap "rm -rf '$WRK'" EXIT
unzip -q -o "$ZIP" -d "$WRK"
APP=$(find "$WRK" -maxdepth 1 -type d -name "*.app" | head -1)
[ -n "$APP" ] || { echo "No .app in zip"; exit 1; }
[ "$(basename "$APP")" = "SuperClaw.app" ] || mv "$APP" "$WRK/SuperClaw.app"
APP="$WRK/SuperClaw.app"
xcrun stapler staple "$APP"
rm -f "$ZIP"
cd "$WRK"
zip -r -X -y "$ZIP" SuperClaw.app
echo "完成: $ZIP"
