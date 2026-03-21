#!/bin/bash
# 從已公證且已 staple 的 zip 產出「乾淨」分發用 zip：
# - 解壓後刪除所有 ._* / .__*（這些會破壞 code signature 密封，導致雙擊無法打開）
# - 用 zip -r -X 重壓（不寫入擴展屬性，避免解壓時再出現 ._*）
# 用法：./scripts/make-clean-zip.sh [arm64|x64|both]
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VER="$(node -p "require('./package.json').version" 2>/dev/null || echo "1.0.0")"
arch="${1:-both}"
if [ "$arch" = "both" ]; then
  for a in arm64 x64; do bash "$0" "$a"; done
  exit 0
fi
ZIP="$ROOT/dist/SuperClaw-$VER-$arch.zip"
[ -f "$ZIP" ] || { echo "Missing: $ZIP"; exit 1; }
WRK=$(mktemp -d)
trap "rm -rf '$WRK'" EXIT
unzip -q -o "$ZIP" -d "$WRK"
APP=$(find "$WRK" -maxdepth 1 -type d -name "*.app" | head -1)
[ -n "$APP" ] || { echo "No .app in zip"; exit 1; }
[ "$(basename "$APP")" = "SuperClaw.app" ] || mv "$APP" "$WRK/SuperClaw.app"
APP="$WRK/SuperClaw.app"
find "$APP" -name "._*" -delete
find "$APP" -name ".__*" -delete
dot_clean -m "$APP" 2>/dev/null || true
codesign -vvv --deep --strict "$APP" >/dev/null 2>&1 || { echo "Signature invalid after clean"; exit 1; }
printf '%s\n' '請依您的 Mac 選擇對應版本：' "・Apple Silicon (M1/M2/M3)：請用 SuperClaw-$VER-arm64.zip" "・Intel Mac：請用 SuperClaw-$VER-x64.zip" '用錯版本會雙擊沒反應（無錯誤視窗）。' '' '若首次雙擊出現安全提示，請右鍵 SuperClaw → 打開 → 點「打開」。' > "$WRK/首次打開說明.txt"
rm -f "$ZIP"
cd "$WRK"
zip -r -X -y "$ZIP" SuperClaw.app "首次打開說明.txt"
echo "OK: $ZIP (no ._* files, signature valid)"
