# In-stock Tracker Bot
# 即時補貨追蹤機器人

Cloudflare Workers + Telegram Bot，讓每位使用者最多追蹤三個商品網址。它每分鐘透過 Cron 檢查庫存，連續兩次確認為「有貨」才會通知，並使用 D1 儲存資料。

## 功能
- Telegram 指令：`/start`、`/help`、`/list`、`/variant`（可點選網址與變體）或 `/variant <option#>` / `/variant <#> <option#>`、`/remove`（可點選項目刪除）或 `/remove <#|url>`、`/end`
- 每位使用者最多 3 個追蹤連結，並依網址雜湊去重
- 每分鐘的 Cron 檢查，具主機群組速率限制與雙重確認防止跳動
- 輕量 HTML 解析與站點 Profile（generic、Nike、Amazon UK、Jellycat、Noodoll）
- D1 儲存唯一性約束、失敗指數退避與錯誤標記

## 設定步驟
1. 安裝依賴
   ```bash
   npm install
   ```
2. 建立 D1 資料庫並匯入 Schema
   ```bash
   wrangler d1 create instock_db
   wrangler d1 execute instock_db --file=./src/db/schema.sql
   ```
3. 設定環境機密
   ```bash
   wrangler secret put TELEGRAM_BOT_TOKEN
   ```
4. 本地與部署
   ```bash
   wrangler dev
   wrangler deploy
   curl -X POST "https://api.telegram.org/bot<token>/setWebhook" \
     -d url="https://<your-worker>/telegram"
   ```

## GitHub CI/CD
推送到 `main` 分支會觸發 GitHub Actions，先執行 `npm ci`、`npm run lint`、`npm test`，通過後使用 Wrangler 部署到 Cloudflare Workers。

在 GitHub repository 的 `Settings` -> `Secrets and variables` -> `Actions` 新增：
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare account ID
- `CLOUDFLARE_API_TOKEN`：具備部署 Worker 權限的 Cloudflare API token

首次部署前，請確認 `wrangler.toml` 已填入實際的 D1 `database_id` / `preview_database_id`，並已在 Cloudflare Workers 設定 `TELEGRAM_BOT_TOKEN` secret。

## 使用方式
- 先送 `/start` 取得說明
- 一次一個貼上商品網址，若有多個變體會直接顯示可點選按鈕；也可用 `/variant` 開啟選擇器，或輸入 `/variant <option#>`（多筆待選時 `/variant <#> <option#>`）選定後才開始輪詢
- `/list` 顯示每筆狀態、變體資訊、最後檢查時間與 ⚠ 需人工旗標
- `/remove` 會列出可點選的刪除項目；也可用 `/remove <#|url>` 移除單筆；`/end` 全數清除
- 只有連續兩次偵測到「AVAILABLE」才推送通知，通知後該 URL 會被自動刪除

## 注意事項
- Cron 每分鐘觸發（`* * * * *`），全域上限 40 併發、每主機 4 並保留 1 秒間隔
- 預設請求逾時 10 秒，可用 `REQUEST_TIMEOUT_MS` 覆寫；若偵測到驗證碼或需要 JS 會以 ⚠ 提醒
- JS 重渲染的網站可能需要人工確認；必要時重新貼 URL 再追蹤
- 專案已整合 ESLint、Prettier、Vitest，請執行 `npm run lint` / `npm run test`

# In-stock Tracker Bot
A Cloudflare Workers + Telegram bot that watches up to three product URLs per user and notifies when stock flips to AVAILABLE (after two confirmations). It stores state in D1, polls pages every minute via Cron, and sends alerts via Telegram messages.

## Features
- Telegram commands: `/start`, `/help`, `/list`, `/variant` (tap-to-pick URL/variant) or `/variant <option#>` / `/variant <#> <option#>`, `/remove` (tap-to-remove picker) or `/remove <#|url>`, `/end`
- Up to 3 active URLs per user with deduped hashes
- Cron-driven checker with per-host rate limiting and anti-flicker confirmations
- Lightweight HTML parsing + site profiles (generic + Nike + Amazon UK + Jellycat + Noodoll)
- D1 persistence with enforced uniqueness and exponential backoff on errors

## Setup
1. Install deps
   ```bash
   npm install
   ```
2. Create the D1 database (once)
   ```bash
   wrangler d1 create instock_db
   wrangler d1 execute instock_db --file=./src/db/schema.sql
   ```
3. Configure secrets
   ```bash
   wrangler secret put TELEGRAM_BOT_TOKEN
   ```
4. Deploy + set webhook
   ```bash
   # local development
   wrangler dev

   # deploy
   wrangler deploy

   # set Telegram webhook to your worker URL
   curl -X POST "https://api.telegram.org/bot<token>/setWebhook" \
     -d url="https://<your-worker>/telegram"
   ```

## GitHub CI/CD
Pushing to `main` triggers GitHub Actions. The workflow runs `npm ci`, `npm run lint`, and `npm test`, then deploys to Cloudflare Workers with Wrangler.

Add these in your GitHub repository under `Settings` -> `Secrets and variables` -> `Actions`:
- `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account ID
- `CLOUDFLARE_API_TOKEN`: a Cloudflare API token with permission to deploy the Worker

Before the first deployment, make sure `wrangler.toml` contains the real D1 `database_id` / `preview_database_id`, and that the `TELEGRAM_BOT_TOKEN` secret is configured in Cloudflare Workers.

## Usage
- Send `/start` to get instructions
- Paste up to 3 product URLs (one per message). If a product has multiple variants, you will get tap-to-select variant buttons immediately; polling starts after selection.
- `/list` shows tracked items, their status, selected variant (or a prompt to select one), last check timestamp, and warning flags (⚠ when manual review needed)
- `/variant` opens a picker like `/remove`: if several tracked URLs have variants, choose URL first, then choose variant. You can still use `/variant <option#>` or `/variant <#> <option#>` for manual input.
- `/remove` shows a tap-to-remove list; `/remove <#|url>` still stops a single entry by list index or URL
- `/end` clears everything for your account

Alerts arrive only when two consecutive checks report `AVAILABLE` for the selected variant (or any available size when none were specified). After alerting, the URL is removed automatically so you can add a new one.

## Notes
- Cron scheduler hits every minute (`* * * * *`) and enforces max concurrency of 40 overall / 4 per host with ~1s host spacing
- Requests time out after 10s (configurable via `REQUEST_TIMEOUT_MS` env). A manual flag appears when captchas/geo walls are detected.
- Some JS-heavy sites may not render server-side; such entries can flip to `needs_manual` until inspected
- Repo ships with ESLint, Prettier, and Vitest tests (`npm run lint`, `npm run test`)
