# 做法 B：把 License API 接到 superclaw-website（一步一步）

把現在放在 **JapanClaw 專案裡** 的 API，複製到你的 **superclaw-website** 專案裡，讓同一個 Vercel 專案同時有官網和驗證 API。

---

## API 現在放在哪裡？

在你这台电脑上，API 在這裡：

- **資料夾路徑**：`JapanClaw/japanclaw-setup/license-api/`
- **需要用到的主要檔案**：
  - `api/verify-license.js`（API 主程式）
  - `package.json`（裡面有依賴 `@neondatabase/serverless`）

也就是說：**不是把整個「license-api 資料夾」上傳到 Vercel**，而是把「API 的檔案」**放進你 superclaw-website 的專案裡**，然後用 Git 推上去，讓 Vercel 從 Git 部署。

---

## 第一步：找到 superclaw-website 專案

1. 想一下：**superclaw-website 這個網站的程式碼，你放在哪？**
   - 可能在你電腦某個資料夾（例如 `~/Desktop/superclaw-website` 或 `~/projects/superclaw-website`）
   - 或是某個 Git 倉庫（GitHub / GitLab）你 clone 下來的那個資料夾
2. 用終端機或檔案總管**打開那個資料夾**，確認裡面有網站的原始碼（例如有 `index.html` 或 `package.json` 或 `src/` 等）。
3. 記住這個資料夾的路徑，後面都叫它 **「網站根目錄」**。

---

## 第二步：在網站根目錄建立 API 的目錄

1. 進入 **網站根目錄**。
2. **若你的專案是 Next.js**：通常已有 `pages/`，請在裡面建 `pages/api/`，然後把後面的 `api/verify-license.js` 改成放在 **`pages/api/verify-license.js`**，其餘步驟一樣。
3. **若不是 Next.js**：若還沒有 `api` 這個資料夾，**新建一個**，名字就叫 `api`（小寫）。
4. 結果會像（非 Next.js）：
   ```text
   網站根目錄/
   ├── api/          ← 新建的
   │   └── verify-license.js
   ├── （其他你原本就有的檔案…）
   ```
   或 Next.js：
   ```text
   網站根目錄/
   ├── pages/
   │   └── api/
   │       └── verify-license.js
   ```

---

## 第三步：複製 API 主程式

1. 從你這台電腦打開：
   - **來源**：`JapanClaw/japanclaw-setup/license-api/api/verify-license.js`
2. **複製整個檔案內容**（Ctrl+A 全選，Ctrl+C 複製）。
3. 在剛才建的 API 目錄裡**新建一個檔案**，檔名：`verify-license.js`。
   - 非 Next.js：**網站根目錄/api/verify-license.js**
   - Next.js：**網站根目錄/pages/api/verify-license.js**
4. 把剛複製的內容貼上，存檔。

這樣你就有（非 Next.js 時）：

```text
網站根目錄/
├── api/
│   └── verify-license.js   ← 剛貼上的
├── （其他你原本的檔案…）
```

---

## 第四步：讓專案裝上 API 需要的依賴

API 需要套件：`@neondatabase/serverless`。

**情況 A：網站根目錄已經有 `package.json`**

1. 打開 **網站根目錄** 的 `package.json`。
2. 找到 `"dependencies"`（沒有就自己加一個區塊）：
   ```json
   "dependencies": {
     "@neondatabase/serverless": "^0.10.0"
   }
   ```
   若已經有別的依賴，就只在裡面**多加這一行**，例如：
   ```json
   "dependencies": {
     "其他套件": "xxx",
     "@neondatabase/serverless": "^0.10.0"
   }
   ```
3. 存檔。
4. 在 **網站根目錄** 打開終端機，執行：
   ```bash
   npm install
   ```
5. 若部署時報錯說 `import` 不支援，在 `package.json` 裡加一行：
   ```json
   "type": "module"
   ```
   （和 `"name"`、`"version"` 同層）

**情況 B：網站根目錄沒有 `package.json`**

1. 在 **網站根目錄** 新建一個 `package.json`，內容至少要有：
   ```json
   {
     "name": "superclaw-website",
     "version": "1.0.0",
     "private": true,
     "type": "module",
     "dependencies": {
       "@neondatabase/serverless": "^0.10.0"
     }
   }
   ```
2. 存檔後，在網站根目錄執行：
   ```bash
   npm install
   ```

---

## 第五步：確認 Vercel 環境變數（superclaw-website 專案）

1. 打開瀏覽器，登入 [Vercel](https://vercel.com)。
2. 進入專案 **superclaw-website**。
3. 點上方 **Settings** → 左側 **Environment Variables**。
4. 確認有這些變數（你之前說已經加過）：
   - `DATABASE_URL`（Neon 連線字串）
   - `LICENSE_TABLE_NAME`（若表名不是 `licenses` 才要設）
   - `LICENSE_KEY_COLUMN`（若欄位名不是 `key` 才要設）
   - `LICENSE_REVOKED_COLUMN`（若沒有「作廢」欄位就設成**空字串**）
5. 若你改過任何一個，儲存後要**重新部署**一次（下一步會做）。

---

## 第六步：推上 Git 並觸發 Vercel 部署

1. 在 **網站根目錄** 打開終端機。
2. 確認改動：
   ```bash
   git status
   ```
   應該會看到至少：
   - `api/verify-license.js`（新檔案）
   - 可能還有 `package.json`、`package-lock.json`
3. 加入並提交：
   ```bash
   git add api/verify-license.js package.json package-lock.json
   git commit -m "Add license verify API for Neon"
   ```
   （若沒有用 Git，就略過 3，改用 Vercel 的「Upload」或從本機匯入專案的方式，把「含 api 的網站根目錄」上傳。）
4. 推送到你連到 Vercel 的那個遠端：
   ```bash
   git push
   ```
5. 到 Vercel 專案頁的 **Deployments**，等最新一次部署完成（綠勾）。

---

## 第七步：測試是否聯通

部署完成後，在終端機執行（網址用你的）：

```bash
cd /Users/x.sean/Desktop/JapanClaw/japanclaw-setup/license-api
node test-verify.js https://superclaw-website.vercel.app
```

- 若看到 **「API 已聯通 Neon」** 或 **「此 key 無効」**（而不是 404），就代表做法 B 已完成，API 已接到 superclaw-website 並連上 Neon。
- 若還是 404，檢查：網站根目錄是不是有 `api/verify-license.js`、Git 有沒有 push 成功、Vercel 是否部署到最新。

---

## 小結（對照用）

| 步驟 | 你做什麼 |
|------|----------|
| 1 | 找到 superclaw-website 的「網站根目錄」 |
| 2 | 在根目錄下新建 `api` 資料夾 |
| 3 | 把 `license-api/api/verify-license.js` 的內容複製到 `api/verify-license.js` |
| 4 | 在根目錄的 `package.json` 加上 `@neondatabase/serverless`，並執行 `npm install`（必要時加 `"type": "module"`） |
| 5 | 在 Vercel 的 superclaw-website 專案裡確認 DATABASE_URL 和三個 LICENSE_* 環境變數 |
| 6 | `git add` → `git commit` → `git push`，等 Vercel 部署完成 |
| 7 | 用 `node test-verify.js https://superclaw-website.vercel.app` 測試 |

你不需要「把 API 單獨上傳到 Vercel」：**只要把檔案放進 superclaw-website 的程式碼裡，再 push，Vercel 就會自動部署包含 API 的版本。**
