# Dashboard 白屏・日本語化・OpenClaw 接続 チェックリスト

## 1. 白屏対策（今回の修正）

- **app: プロトコルで Content-Type を付与**  
  JS/CSS/HTML 等を返す際に `application/javascript` / `text/css` / `text/html` を設定。  
  ES modules が正しく解釈されるようにした。
- **app: 失敗時は loadFile にフォールバック**  
  `did-fail-load` で `app://` の失敗を検知したら、同一ウィンドウで `loadFile(dashboardRendererPath)` を一度だけ再試行。  
  file:// でも webSecurity:false のため ES modules が動く可能性がある。
- **preload 複数パス**  
  打包後は `app.asar.unpacked/src/main/dashboard-preload.js` および  
  `Resources` / `execPath/../Resources` の両方の候補を試し、存在するパスを使用。
- **protocol 未定義ガード**  
  `protocol` が undefined の環境でもクラッシュしないよう `registerSchemesAsPrivileged` / `registerAppProtocol` を条件付きで実行。
- **エラー表示**  
  `#superclaw-error-overlay` に `onerror` / `unhandledrejection` / スクリプト load 失敗を表示。  
  まだ白屏の場合は **F12**（または Cmd+Option+I）で DevTools を開き、Console のエラー内容を確認すること。
- **ルート**  
  起動時は `redirect:"/chat"` で直接チャットへ。`/init-loading` / 微信ログインはスキップ。
- **Ws 重複**  
  SkillComingSoon は `WsSkill`、ルートは `component:WsSkill` で統一済み。

## 2. 日本語化・中文残存

- **index.html**  
  コメントは日本語（「エラー時は白画面に表示」「ブランド統一・WeChat非表示・OpenClaw 接続表示」）。  
  表示文言は「接続: ローカル OpenClaw」「セッション: N 件」「モデル: xxx」。
- **注入スクリプト**  
  「登录」は非表示判定用の文字列のためそのまま（UI には出さない）。  
  他にユーザー向け中文はなし。
- **バンドル**  
  Vue バンドル内のユーザー向け文言は「スキル広場」「リクエストに失敗しました」等の日本語。  
  （`docs/qclaw-reference` 内の別コピーに「请求失败」あり＝本番 dashboard-renderer には未使用）

## 3. OpenClaw 接続（現状）

| 項目 | バックエンド / Preload | Dashboard UI での利用 |
|------|------------------------|------------------------|
| **言語モデル（既定）** | `config.getField('agents.defaults.model.primary')` / `openclaw.getShellState().defaultModel` / `openclaw.getModels()` / `openclaw.setDefaultModel(id)` | Preload 経由で利用可能。左下に「モデル: xxx」を注入表示。モデル切替は UI が `setDefaultModel` を呼べば反映可能。 |
| **セッション一覧** | `session.search('')` / `getShellState().sessions` / `session.trimLastExchange(sessionKey)` | Preload 経由で利用可能。左下に「セッション: N 件」を注入表示。一覧・切替は Vue 側が `session.search` を呼んで描画すれば可能。 |
| **設定の読み書き** | `config.getField`（token / port / 既定モデル等）/ `config.updateField`（白名单: `agents.defaults.model.primary` のみ） | 同上。UI から書き換え可能なのは「既定モデル」まで。 |
| **Skill** | スキル設定の共通 API は未実装。スキル広場は「準備中」表示。 | ローカル OpenClaw のスキルを Dashboard で編集する機能は未実装。 |

**結論**  
- モデル・セッション・既定モデル設定は **API と Preload は接続済み**。  
- 「全ての OpenClaw 設定を Dashboard で編集」は意図的に制限（白名单・安全のため）。  
- スキルは現状、Dashboard との連携 API なし。
