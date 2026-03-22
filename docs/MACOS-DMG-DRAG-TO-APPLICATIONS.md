# macOS：「App + Applications フォルダを並べてドラッグ」体験について

## よく見るあの画面は何か

多くの Mac アプリで見られる **左に .app、右に Applications フォルダ（矢印）** の画面は、だいたい **DMG（ディスクイメージ）を開いた Finder ウィンドウのレイアウト** です。  
ユーザーは **Finder 上で .app を Applications エイリアスにドラッグ** します。

これは **Electron 専用の「組み込みコンポーネント」ではなく**、`create-dmg` / **electron-builder の DMG 設定** で **背景画像・ウィンドウ位置・アプリ本体・`/Applications` へのシンボリックリンク** を並べて実現します。

## ZIP 配布との違い

- **ZIP**：解凍すると普通のフォルダに `.app` だけが出ることが多く、**矢印付きの「インストール用」ウィンドウは自動では出ません**。
- **DMG**：マウント時にそのレイアウトの Finder ウィンドウを開くようにできるため、**「ドラッグしてインストール」体験** と相性が良いです。

## 本プロジェクトで DMG を使う場合（参考）

- [electron-builder DMG](https://www.electron.build/configuration/dmg) の `contents` で、`x`/`y` 位置と `type: link` で `path: /Applications` を置き、`.app` と並べる。
- 本リポジトリでは過去に **本機 `hdiutil` が制限で失敗** し ZIP フォールバックしているため、**CI や別 Mac で DMG を生成**する運用が現実的なことが多い。

## アプリ内で「同じ UI」を完全再現するか

Finder と同じ **実ファイルのドラッグ＆ドロップで Applications にコピー** までをアプリ内の小窓だけで再現するのは重く、**標準パターンではない**です。  
代わりにできることの例：

- 初回だけ **説明用のシンプルなウィンドウ**（HTML）＋「Applications を Finder で開く」ボタン（`shell.openPath('/Applications')`）＋「完了したら続行」。
- あるいは **配布を DMG 主** にして、ZIP は上級者向けに残す。

（`app.moveToApplicationsFolder()` は環境によって移動後の起動に失敗することがあり、本プロジェクトでは採用しない。）
