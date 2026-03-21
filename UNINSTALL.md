# テスト用：OpenClaw を完全にアンインストールする

新しいインストールパッケージで「初回インストール」の流れをやり直したいときに、テスト機で以下を実行してください。

## 1. 設定・データの削除

OpenClaw の設定とエージェントデータは **ユーザーのホーム** にあります。

- **macOS / Linux**  
  ターミナルで実行：
  ```bash
  rm -rf ~/.openclaw
  ```
- **Windows**  
  ```cmd
  rmdir /s /q "%USERPROFILE%\.openclaw"
  ```

これで `openclaw.json` や `agents` など、OpenClaw が使う設定・データは消えます。

## 2. デーモン（バックグラウンド常駐）の停止・削除（任意）

インストール時に「デーモンを入れる」を実行している場合、バックグラウンドで **openclaw のデーモン** が動いていることがあります。

- **Mac**  
  - デーモンのサービス名は OpenClaw のバージョンによって異なります。  
  - ターミナルで `launchctl list | grep -i openclaw` や `launchctl list | grep -i claw` で確認し、該当するラベルがあれば：
    ```bash
    launchctl unload ~/Library/LaunchAgents/<該当の.plist>
    ```
    必要なら `~/Library/LaunchAgents/` 内のその plist ファイルも削除してください。
- 公式の「アンインストール」手順がある場合は、それに従ってデーモンを止め・削除するとより確実です。

## 3. SuperClaw アプリ本体

- **Mac**  
  アプリケーションから「SuperClaw」をゴミ箱に移動（または `rm -rf /Applications/SuperClaw.app`）。
- **Windows**  
  設定の「アプリと機能」などから SuperClaw をアンインストール。

## 4. 再インストール

上記のあと、新しい DMG（またはインストーラ）で再度インストールすると、「既存の OpenClaw はありません」として、最初のインストールフローからやり直せます。
