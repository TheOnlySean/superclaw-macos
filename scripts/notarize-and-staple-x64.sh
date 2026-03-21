#!/bin/bash
# x64 公證 + staple 一鍵腳本（需先設定環境變數）
# 用法：APPLE_ID="your@email.com" NOTARY_PASSWORD="xxx" TEAM_ID="G7VUNQ8M6B" bash scripts/notarize-and-staple-x64.sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ZIP="$ROOT/dist/SuperClaw-1.0.0-x64.zip"
[ -f "$ZIP" ] || { echo "Missing $ZIP"; exit 1; }
[ -n "$APPLE_ID" ] && [ -n "$NOTARY_PASSWORD" ] || { echo "Set APPLE_ID, NOTARY_PASSWORD, TEAM_ID"; exit 1; }
echo "送交 x64 公證…"
xcrun notarytool submit "$ZIP" --apple-id "$APPLE_ID" --team-id "${TEAM_ID:-G7VUNQ8M6B}" --password "$NOTARY_PASSWORD" --wait
echo "公證通過。執行 staple…"
WRK=$(mktemp -d)
trap "rm -rf '$WRK'" EXIT
unzip -q -o "$ZIP" -d "$WRK"
APP=$(find "$WRK" -maxdepth 1 -type d -name "*.app" | head -1)
xcrun stapler staple "$APP"
rm -f "$ZIP"
cd "$WRK"
zip -r -X -y "$ZIP" SuperClaw.app 首次打開說明.txt 2>/dev/null || zip -r -X -y "$ZIP" *.app *.txt 2>/dev/null
echo "完成: $ZIP"
