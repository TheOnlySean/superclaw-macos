# Dashboard メニュー順序と Skill Market のカスタム化

## 1. サイドバーメニューの順序（Chat → Skill → Agent → Cron → Channel）

### 現在の挙動

- **SUPERCLAW_NAV_SKILL_ONLY=1** でビルドした場合：サイドバーは「チャット」と「スキル」のみ。
- **SUPERCLAW_NAV_ORDER=1** でビルドした場合：メニュー順が次のように変わります。
  - **Chat** → **Skill** → **Agent**（スキル・エージェント・ノード）→ **Cron** → **Channel**（クロン・チャンネルのあと、概要・セッション・インスタンス・利用状況）→ **Settings**

### 使い方

control-ui-ja をビルドするときに、希望するメニューに合わせて環境変数を指定します。

```bash
# 順序を変えたフルメニュー（Chat・Skill・Agent・Cron・Channel を前に）
SUPERCLAW_NAV_ORDER=1 node scripts/prepare-control-ui-ja.js

# 従来どおりチャットとスキルのみ
SUPERCLAW_NAV_SKILL_ONLY=1 node scripts/prepare-control-ui-ja.js
```

ビルド後、`control-ui-ja` をアプリに同梱してから `npm run dist:mac:arm64` でパッケージします。  
既に control-ui-ja が別リポジトリや別ビルドで用意されている場合は、そのビルド時に上記のいずれかを指定してください。

---

## 2. Skill を自前の Skill Market に差し替える（可行性）

### 現状

- Dashboard の「スキル」タブは、OpenClaw 標準のスキル一覧・詳細 UI（control-ui 内のルート／コンポーネント）を表示しています。
- クリックで開いているのは **アプリ内の同一オリジン** の `/skills` などのルートです。

### 自前 Skill Market に切り替える場合の選択肢

| 方式 | 内容 | 難易度・注意点 |
|------|------|----------------|
| **A. スキルタブで iframe** | 「スキル」タブの内容を、自前 Skill Market の URL を表示する iframe に差し替える。 | 中。control-ui のソースを patch して、スキル用ルートで iframe を表示するコンポーネントに差し替え。CSP や cookie の扱いに注意。 |
| **B. スキルタブで外部リンク** | 「スキル」をクリックしたときに、自前 Market の URL を **システムブラウザ** で開く。 | 低。ナビのクリックハンドラを差し替え（patch または注入スクリプト）して、`window.open` や Electron の `shell.openExternal` で開く。 |
| **C. 別ウィンドウで開く** | スキルを押すと、Electron の別窓で自前 Market（WebView または BrowserView）を表示。 | 中。アプリ側で「スキル」クリックを検知し、別ウィンドウを開く処理を追加する必要がある。 |
| **D. control-ui のビルドでルート差し替え** | OpenClaw の UI を fork し、`/skills` 相当のルートを自前の React/Vue ページ（自前 Market の埋め込みやリダイレクト）に差し替えてビルド。 | 高。UI のビルド・保守を自前で行う必要がある。 |

### 推奨（段階的に進める場合）

1. **短期**：現状のまま OpenClaw 標準のスキル UI を使用する（現状どおり）。
2. **中期**：**B** を採用し、「スキル」クリックで自前 Skill Market の URL をブラウザで開く。実装が軽く、確実に自前 Market に誘導できる。
3. **長期**：アプリ内で完結させたい場合は **A** または **C** を検討。その際は CSP・認証・リンクの開き方の設計が必要。

### 技術的なポイント

- **A（iframe）**：control-ui-ja のビルド元（.openclaw-ja-build 等）で、`/skills` を担当するコンポーネントを「自前 URL を表示する iframe」に差し替える patch を用意する。`frame-src` などの CSP を緩める必要がある場合がある。
- **B（外部ブラウザ）**：メインウィンドウのナビを描画しているのは control-ui のため、**注入スクリプト**（`injectDashboardJapaneseStrings` と同様の仕組み）で、スキル用のナビ項目のクリックを捕捉し、`openExternal(skillMarketUrl)` を呼ぶ方法が現実的。または control-ui のナビコンポーネントを patch して、スキルだけリンク先を外部 URL にし、クリックで `target="_blank"` + アプリ側で openExternal に転送する方法もある。
- **C（別ウィンドウ）**：IPC で「スキルがクリックされた」ことを検知する必要がある。control-ui がそのイベントを送るように patch するか、注入スクリプトでクリックを検知して IPC 送信する形になる。

まとめると、**「スキルを自前 Market にしたい」は、外部ブラウザで開く（B）なら比較的すぐ実現可能。アプリ内で iframe や別窓で表示する（A/C）も、patch と CSP・ウィンドウ設計で実現可能です。**
