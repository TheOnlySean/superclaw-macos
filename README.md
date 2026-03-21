# JapanClaw セットアップ（Electron アプリ）

OpenClaw をターミナルなしでインストール・設定するデスクトップアプリです。

## アイコンについて

**自分のアイコンを使う場合**：次のファイルを `build/icons/` に置いてください。

- **icon-512.png** — 512×512 ピクセルの PNG（必須）
- （任意）**icon.icns** — macOS 用
- （任意）**icon.ico** — Windows 用

詳細は [build/icons/README.md](build/icons/README.md) を参照。

## リポジトリ（GitHub）

ソース：<https://github.com/TheOnlySean/superclaw-macos>

`openclaw/` と `node-runtime/` は容量のため **Git に含めていません**。クローン後は次を実行してからビルドしてください。

```bash
npm install
npm run prepare-openclaw
npm run prepare-node-runtime:arm64   # Apple Silicon
# Intel の場合: npm run prepare-node-runtime:x64
```

## 開発

```bash
npm install
npm run prepare-openclaw
npm run prepare-node-runtime:arm64   # 未配置だと同梱 Node が無くパッケージに含まれません
npm start
```

## ビルド

```bash
npm run dist       # 全プラットフォーム
npm run dist:mac   # macOS (.dmg)
npm run dist:win   # Windows (.exe)
```

出力は `dist/` に生成されます。

## 「アプリは破損しています」と出る場合（未署名配布時）

DMG からインストールしたアプリを開くと、macOS が「破損しているためゴミ箱に移動する必要があります」と表示することがあります。**アプリは破損していません。** 未署名のため、ダウンロード・転送されたファイルに付く「隔離」属性でブロックされています。

**対処（テスト機で 1 回だけ実行）：**

1. **ターミナル**を開く（Spotlight で「ターミナル」と入力）。
2. 次のコマンドを実行（アプリを「アプリケーション」に入れた場合）：
   ```bash
   xattr -cr /Applications/JapanClaw.app
   ```
   DMG 内のアプリをそのまま開いている場合は、ドラッグ先のパスに合わせて `JapanClaw.app` のパスを書き換えてください。
3. 再度 JapanClaw を起動する。まだ「開発元を確認できません」と出たら、**右クリック → 開く** で起動し、ダイアログで「開く」を選ぶ。

## 日本語 Control UI（方針 B）

**利用者向け**：インストール完了後、**「今すぐ使い始める」を押すだけ**で日本語のダッシュボードが開きます。追加操作は不要です。

**リリース担当者向け**：配布用インストーラに日本語 UI を含めるには、事前に OpenClaw の Control UI を日本語 locale 付きでビルドし、成果物を **`control-ui-ja/`** にコピーしてから `npm run dist` してください。手順は [control-ui-ja/README.md](control-ui-ja/README.md)。`control-ui-ja/index.html` が無い場合は、公式のゲートウェイ URL にフォールバックします（利用者には何も通知されません）。

## フロー

1. ようこそ → システムチェック
2. チェック合格 → インストール開始（ログ表示）→ **次へ（AIモデル設定）**
3. AIモデル選択（Codex / Qwen ログイン、またはあとで設定）
4. **完了へ** を押すと **初期設定**（`openclaw onboard --auth-choice skip`）を実行し、ゲートウェイ・daemon のみ設定（モデル認証はそのまま）
5. 完了 → ダッシュボードを開く
