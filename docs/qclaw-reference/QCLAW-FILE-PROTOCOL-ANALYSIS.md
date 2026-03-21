# QClaw が file:// で Dashboard をスムーズに開ける理由（深掘り）

## 1. QClaw の実装

- **主窗口**：`createWindow()` 内で `mainWindow.loadFile(getUIPath())`。  
  `getUIPath()` は `join(__dirname, "../renderer/index.html")`（app.asar 内では `out/main/` 基準で `out/renderer/index.html`）。
- **CSP 注入**：`mainWindow.webContents.session.webRequest.onHeadersReceived` を登録し、  
  `url.startsWith("file://") || url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1")` のときだけ、  
  開発時は `script-src 'self' 'unsafe-inline' 'unsafe-eval'`、本番は `script-src 'self'` の CSP を付与している。
- **renderer/index.html**：  
  - `<script type="module" crossorigin src="./assets/e-BOOjGo6C.js"></script>` で ES module を読み込み。  
  - `<base href="./">` は**ない**（QClaw 側は相対パスのみ）。  
  - 外部スクリプトとして `https://res.wx.qq.com/.../wxLogin.js` を読み込み（CSP で許可）。

## 2. file:// で onHeadersReceived が発火するか

- Chromium の一般的な仕様では、**file:// は HTTP レスポンスを持たない**ため、`webRequest.onHeadersReceived` は**発火しない**とされる。
- 一方で、Electron では `loadFile` が内部で「ファイルを読んでレスポンス的に渡す」実装になっており、  
  バージョンや実装次第では、**file プロトコルでも onHeadersReceived が呼ばれている可能性**がある（要 Electron ソース確認）。
- QClaw が「file:// でスムーズ」な理由の候補：
  1. **Electron 側で file でも onHeadersReceived が呼ばれている**  
     → 登録した CSP がそのまま file レスポンスに付与され、同一オリジン・script が許可される。
  2. **本番 CSP が script-src 'self' のみ**  
     → つまり **eval を使わないビルド**になっている。  
     QClaw 本番用 Vue ビルドが runtime-only 等で `eval`/`new Function` を含まないため、`'unsafe-eval'` がなくても動く。
  3. **file:// ではデフォルトで厳格な CSP がかかっていない**  
     → 何も注入しなくても、相対パスの module がそのまま読み込まれている。

## 3. 当方（SuperClaw）との違い

- **当方の dashboard-renderer**：QClaw から解包した **同一の chunk**（e-BOOjGo6C.js 等）を使用。  
  この chunk 内に **eval / new Function** が含まれるため、CSP に **`'unsafe-eval'`** が無いと白屏＋Console に CSP エラーが出る（過去検証済み）。
- **file:// の制約**：  
  - 上記の通り、file:// では `onHeadersReceived` が発火しない可能性が高く、**CSP を注入できない**。  
  - そのため、**CSP を確実に制御するには「自前でレスポンスを返す」必要**があり、  
    - **app:// プロトコル**で HTML/JS を配信し、レスポンスヘッダに CSP（`unsafe-inline` / `unsafe-eval` 含む）と Content-Type を付与する方式を採用している。
- **app:// 過去の白屏対策（チェックリスト準拠）**  
  - **Content-Type**：HTML/JS/CSS に正しい MIME を付与（ES module が正しく解釈されるようにする）。  
  - **CSP**：`script-src` に `'unsafe-inline'` と **`'unsafe-eval'`** を含める。  
  - **失敗時フォールバック**：`did-fail-load` で app:// 失敗を検知したら、**1 回だけ** `loadFile(dashboardRendererPath)` で再試行。  
  - **preload**：複数パス候補で存在するものを使用。

## 4. 結論

- **QClaw が file:// でスムーズな理由**は、少なくとも次のいずれか（または組み合わせ）と考えられる：  
  - Electron の file 読み込み経路で onHeadersReceived が発火し、CSP が注入されている。  
  - 本番用ビルドが eval を使わず、`script-src 'self'` のみで足りている。  
  - file:// では元々厳格な CSP がかかっておらず、そのまま動いている。
- **当方は同一 chunk で eval 依存のため**、CSP を確実に緩和する必要があり、**app:// + レスポンスヘッダで CSP 付与**を採用。  
  さらに、過去の白屏対策に合わせて **Content-Type の明示**と **app:// 失敗時の loadFile 1 回フォールバック**を入れ、白屏・ロード失敗を防いでいる。
