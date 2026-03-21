# SuperClaw：Developer ID 設定與簽署指南

本指南說明如何取得 **Developer ID Application** 憑證、在本機安裝，並用其簽署 SuperClaw 的 Mac 版 DMG，供官網下載。簽署後使用者在 macOS 上安裝時，Gatekeeper 會顯示「來自已識別開發者」，減少被阻擋的情況。

---

## 前置條件

1. **Apple Developer Program 帳號**（年費約 $99 USD）  
   - 若尚未加入：https://developer.apple.com/programs/enroll/
2. **帳號身份**：建立 **Developer ID Application** 憑證時，通常需為該 Team 的 **Account Holder**（或具備 Certificates 管理權限）。
3. **本機環境**：macOS，且已安裝 Xcode 或至少 **Xcode Command Line Tools**（`xcode-select --install`）。

---

## 第一步：在 Apple Developer 後台建立憑證

1. 登入 [Apple Developer](https://developer.apple.com/account/)。
2. 左側選 **Certificates, Identifiers & Profiles** → **Certificates**。
3. 點右上角 **＋** 新增憑證。
4. 在 **Software** 區塊選 **Developer ID** → **Continue**。
5. 選 **Developer ID Application**（用於簽署 .app，不是 Developer ID Installer）→ **Continue**。
6. 畫面會提示「Create a Certificate Signing Request (CSR)」。先不要關掉此頁，到下一步在本機產生 CSR。

---

## 第二步：在本機產生 CSR（憑證簽署請求）

1. 打開 **鑰匙圈存取**（Keychain Access，Spotlight 搜尋即可）。
2. 選單列：**鑰匙圈存取** → **偏好設定** → **憑證** 分頁 → 將 **「線上憑證狀態協定」與「憑證撤銷清單」** 設為 **關閉**（否則可能無法繼續）。
3. 選單列：**鑰匙圈存取** → **憑證助理** → **從憑證授權單位要求憑證…**。
4. 在彈出視窗中填寫：
   - **使用者電子郵件地址**：填你的 Apple ID 或團隊聯絡用信箱。
   - **一般名稱**：例如 `SuperClaw Developer ID` 或你的名字（會顯示在憑證名稱上）。
   - **CA 電子郵件地址**：可留白。
   - **請求是**：選 **儲存到磁碟**。
5. 點 **繼續**，選擇儲存位置（例如桌面），檔名會是 `CertificateSigningRequest.certSigningRequest`。
6. 儲存後會一併在鑰匙圈裡建立一組 **私鑰**（之後簽署時會用到，請勿刪除、勿匯出給他人）。

---

## 第三步：上傳 CSR 並下載憑證

1. 回到瀏覽器中的 Apple Developer 憑證建立頁面。
2. 點 **Choose File**，選擇剛儲存的 `.certSigningRequest` 檔案。
3. 點 **Continue**，再點 **Download**，下載得到 `.cer` 檔（例如 `developerID_application.cer`）。

---

## 第四步：在本機安裝憑證

1. 雙擊下載的 `.cer` 檔案。
2. 系統會把它加入 **登入鑰匙圈**（或「系統」鑰匙圈，依畫面選擇）。
3. 在 **鑰匙圈存取** 中，左側選 **「我的憑證」**，確認能看到剛安裝的 **Developer ID Application: …** 憑證，且左側有對應的 **私鑰**（同一行顯示鑰匙圖示）。

若沒有私鑰，代表私鑰和憑證不在同一台 Mac（例如 CSR 在別台產生），需在產生 CSR 的那台電腦上安裝此 .cer，或重新在那台電腦上產生 CSR 並重新在 Apple 後台申請。

---

## 第五步：確認簽署用「身分」名稱

1. 在鑰匙圈存取裡點選該 **Developer ID Application** 憑證。
2. 雙擊打開，在 **「詳細資訊」** 裡可看到 **名稱**，格式通常為：  
   `Developer ID Application: 你的名字或公司名 (XXXXXXXXXX)`  
   括號裡是 **Team ID**。
3. **完整複製這串名稱**（含括號），後面會用來設定 `CSC_NAME`。

或在終端機執行（會列出本機可用於簽署的 Developer ID 憑證）：

```bash
security find-identity -v -p codesigning
```

在輸出中找 **Developer ID Application** 那一行，整串就是你的 **簽署身分**（identity）。

---

## 第六步：在專案裡設定簽署身分（不寫進 Git）

建議用 **環境變數** 傳給 electron-builder，不要把身分字串寫進版控。

在專案根目錄（`japanclaw-setup/`）建立 `.env` 或 `.env.local`（並把 `.env.local` 加入 `.gitignore`），內容例如：

```bash
# 把下面換成你在鑰匙圈裡看到的「完整名稱」
CSC_NAME="Developer ID Application: 你的名字或公司 (XXXXXXXXXX)"
```

或每次打包前在終端機先執行（一次有效）：

```bash
export CSC_NAME="Developer ID Application: 你的名字或公司 (XXXXXXXXXX)"
```

然後再執行打包指令。  
**注意**：`CSC_NAME` 必須與鑰匙圈中的 **Developer ID Application** 憑證名稱**完全一致**（含空格與括號）。

---

## 第七步：執行簽署打包

在 `japanclaw-setup` 目錄下：

**Apple Silicon (ARM64)：**

```bash
# 若用 .env / .env.local，先讓 shell 讀取（例如）
source .env.local   # 或 source .env

npm run dist:mac:arm64
```

**Intel (x64)：**

```bash
source .env.local   # 同上，若使用環境變數
npm run dist:mac:x64
```

若未設定 `CSC_NAME`，electron-builder 會跳過簽署並提示找不到有效憑證；設定正確後，建出的 `.app` 與 DMG 會帶有你的 Developer ID 簽章。

---

## 第八步（可選）：公證（Notarization）

macOS 10.15 起，從網路下載的 app 若未經 **Apple 公證**，預設可能被 Gatekeeper 阻擋或標示為「無法驗證開發者」。若要讓使用者安裝體驗更順暢，建議再送交 **公證**。

### 公證前置

1. **Apple ID**：用於 `notarytool`（可與 Developer 帳號相同）。
2. **App 專用密碼**：  
   - 前往 https://appleid.apple.com → 登入 → **登入與安全** → **App 專用密碼** → 產生一組，名稱例如 `SuperClaw notarization`。  
   - 此密碼只輸入在本機或 CI，不要寫進程式碼或 Git。
3. **Team ID**：與 Developer ID 憑證括號內的 ID 相同。

### 使用 notarytool 公證（Xcode 13+ 內建）

簽署並打包出 DMG 後：

```bash
# 先壓縮 .app（公證時需上傳 zip）
cd dist
ditto -c -k --keepParent mac-arm64/SuperClaw.app SuperClaw-arm64.zip
# 或 Intel：ditto -c -k --keepParent mac/SuperClaw.app SuperClaw-x64.zip

# 送交公證（替換成你的 Apple ID、Team ID、專用密碼）
xcrun notarytool submit SuperClaw-arm64.zip \
  --apple-id "your-apple-id@example.com" \
  --team-id "XXXXXXXXXX" \
  --password "xxxx-xxxx-xxxx-xxxx" \
  --wait

# 公證通過後，給 DMG 釘選（staple）公證票
xcrun stapler staple dist/SuperClaw-1.0.0-arm64.dmg
```

Intel 版則對應使用 `SuperClaw-x64.zip` 與 `SuperClaw-1.0.0-x64.dmg`。  
公證通過並完成 `stapler staple` 後，使用者下載該 DMG 安裝時，Gatekeeper 會顯示為已公證的開發者。

---

## 若 electron-builder 內建簽名崩潰（isbinaryfile bug）

當 `extraResources` 內檔案很多時，electron-builder 的 osx-sign 可能觸發 `RangeError: Invalid array length`。可改用「先打包不簽名、再手動簽名」：

```bash
# 關閉內建簽名，只產出 .app
CSC_IDENTITY_AUTO_DISCOVERY=false npm run prepare-openclaw && npm run prepare-node-runtime:arm64 && CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --arm64 --dir

# 使用專案腳本簽名
node scripts/sign-mac-app.js

# 再製作 DMG
node scripts/create-dmg.js
```

或一次執行：`npm run dist:mac:arm64:signed`。

若簽名完成但 `codesign -v --deep --strict` 顯示 **「invalid signature (code or signature have been modified)”**：多半是 .app 移回 dist 後，系統又加上了 `com.apple.provenance` 等屬性。請改用 **就地簽名**（需在 **「終端機」** 執行，且於 **系統設定 > 隱私權與安全性 > 完整磁碟取用** 中加入 **「終端機」**）：

```bash
# 先打包產出 .app（不簽名）
CSC_IDENTITY_AUTO_DISCOVERY=false npm run prepare-openclaw && npm run prepare-node-runtime:arm64 && CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --arm64 --dir

# 就地清除 xattr 並簽名（在「終端機」執行，並已授予完整磁碟取用）
SIGN_IN_PLACE=1 node scripts/sign-mac-app.js

# 再製作 DMG
node scripts/create-dmg.js
```

若手動簽名時出現 **「resource fork, Finder information, or similar detritus not allowed」**：代表 .app 內仍有延伸屬性或 resource fork。可改用上方 `SIGN_IN_PLACE=1` 在終端機執行；若仍失敗，見下方方案 C。

---

## 方案 C：手動除錯簽名失敗

若 `node scripts/sign-mac-app.js` 一直出現 detritus 錯誤，可在終端機自行執行以下指令協助排查：

```bash
# 1. 確認 .app 是否存在
ls -la dist/mac-arm64/SuperClaw.app

# 2. 檢視目前簽名狀態（若尚未簽過會報錯，可忽略）
codesign -dv --verbose=4 dist/mac-arm64/SuperClaw.app 2>&1

# 3. 遞歸清除擴展屬性後再試簽名（若本機 xattr 支援 -r）
xattr -rc dist/mac-arm64/SuperClaw.app
codesign --force --sign "Developer ID Application: SEAN XIAO (G7VUNQ8M6B)" --options runtime --entitlements build/entitlements.mac.plist dist/mac-arm64/SuperClaw.app
```

若本機 `xattr` 不支援 `-r`，可改用：

```bash
find dist/mac-arm64/SuperClaw.app -type f -exec xattr -c {} \;
find dist/mac-arm64/SuperClaw.app -type d -exec xattr -c {} \;
```

再執行上面的 `codesign`。簽名成功後，可再執行 `node scripts/create-dmg.js` 產出 DMG。

---

## 需要你配合：Apple 公證（Notarization）

若**簽名已成功**，但使用者在他台 Mac 解壓 zip（或下載 DMG）後開啟時出現**「已損壞，應移至廢紙簍」**，代表尚未完成 **Apple 公證**。公證後，同一份 zip/DMG 分發出去即可正常開啟。公證必須由你本機執行（需登入你的 Apple ID），無法由他人代做。

### 你需要準備的三樣東西

| 項目 | 說明 | 哪裡取得 |
|------|------|----------|
| **Apple ID** | 用於登入 notarytool | 你的 Apple ID 信箱（與 Developer 帳號相同即可） |
| **App 專用密碼** | 非你平常登入密碼 | [appleid.apple.com](https://appleid.apple.com) → 登入與安全 → App 專用密碼 → 產生（名稱可填 `SuperClaw notarization`） |
| **Team ID** | 開發者團隊 ID | 與憑證括號內相同，你的是 **G7VUNQ8M6B** |

### 公證流程（你本機執行）

1. **已有一份簽好名的產物**：`dist/SuperClaw-1.0.0-arm64.zip`（由 `node scripts/sign-mac-app.js` 產出），或 `dist/mac-arm64/SuperClaw.app`。

2. **送交公證**（在專案目錄 `japanclaw-setup/` 下執行，請替換成你的 Apple ID 與 App 專用密碼）：

```bash
cd dist
ditto -c -k --keepParent mac-arm64/SuperClaw.app SuperClaw-arm64.zip

xcrun notarytool submit SuperClaw-arm64.zip \
  --apple-id "你的AppleID@信箱.com" \
  --team-id "G7VUNQ8M6B" \
  --password "xxxx-xxxx-xxxx-xxxx" \
  --wait
```

`--wait` 會等公證結果（通常幾分鐘）。若成功，最後會顯示 `status: Accepted`。

3. **把公證票釘到 DMG 上**：

```bash
xcrun stapler staple SuperClaw-1.0.0-arm64.dmg
```

完成後，**對外發佈這個 DMG**，使用者下載後即可直接打開，不需再「右鍵 → 開啟」或改系統設定。

### 使用專案腳本（可選）

若你已把 Apple ID、Team ID、App 專用密碼設成環境變數，可使用：

```bash
# 在 japanclaw-setup 目錄下（會使用 dist/SuperClaw-1.0.0-arm64.zip 送交公證）
APPLE_ID="你的信箱" NOTARY_PASSWORD="xxxx-xxxx-xxxx-xxxx" TEAM_ID="G7VUNQ8M6B" node scripts/notarize-mac.js
```

腳本會優先使用 **dist/SuperClaw-1.0.0-arm64.zip** 送交公證；若無則用 `dist/mac-arm64/SuperClaw.app` 壓縮後上傳。公證通過後，**直接分發該 zip**，使用者解壓即可正常開啟。若有 DMG，腳本會對 DMG 執行 stapler staple。**請勿把密碼寫進程式碼或提交到 Git。**

---

## 常見問題

- **「no valid Developer ID Application identity」**  
  表示目前鑰匙圈裡沒有可用的 Developer ID Application 憑證，或 `CSC_NAME` 與憑證名稱不一致。請依第一步～第五步確認憑證已安裝且名稱正確，並用 `security find-identity -v -p codesigning` 檢查。

- **憑證過期**  
  Developer ID 憑證有效期限較長，若過期需在 Apple Developer 後台重新產生（重新產生 CSR → 上傳 → 下載新 .cer → 安裝），並更新本機鑰匙圈與 `CSC_NAME`（若名稱有變）。

- **公證失敗**  
  常見原因：未簽署、簽署身分錯誤、或 dylib/內建二進位未一起簽署。electron-builder 預設會簽署 app 內主要二進位；若錯誤日誌中有指定檔案，可依提示用 `codesign` 手動補簽後再重新打包並送交公證。

---

## 本專案相關設定摘要

| 項目 | 位置 | 說明 |
|------|------|------|
| App ID | `package.json` → `build.appId` | `ai.superclaw.setup` |
| 憑證類型 | 本機鑰匙圈 | **Developer ID Application**（非 Developer ID Installer） |
| 簽署身分 | 環境變數 `CSC_NAME` | 與鑰匙圈中憑證名稱完全一致 |
| entitlements | `build/entitlements.mac.plist` | 已設定，供 hardened runtime 使用 |
| 打包指令 | `package.json` | `npm run dist:mac:arm64` / `npm run dist:mac:x64` |

完成上述步驟後，即可產出已簽署（以及可選的公證）DMG，供官網提供使用者下載。
