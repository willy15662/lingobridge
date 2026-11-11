# 測試結果

更新日期：2026-11-11。

## 單元與邊界測試（`npm run check`）

`npm run check` 完成 TypeScript strict 檢查、六個入口的 esbuild 打包、79 項單元／邊界測試、Manifest V3 與產物資源檢查。

| 測試檔 | 通過數 | 實際驗證內容 |
| --- | ---: | --- |
| backend.test.mjs | 14 | schema、網站規則、端點驗證、三 Provider fixture、回應格式、快取／重啟 engine、重試與限速、優先佇列 |
| content.test.mjs | 8 | Unicode 分段、原文字節點還原、框架改寫保護、已移除節點、大批次上限、停止後不再發出批次、Ctrl 手勢與 RTL |
| documents-pdf.test.mjs | 4 | 匹配版本與授權、文字行分組、安全匯出、實際 PDF.js adapter 擷取有效雙頁 PDF 與錯誤型別 |
| documents.test.mjs | 11 | ZIP、CRC、DEFLATE、拒絕不合法壓縮檔、字幕、TXT／Markdown、URL 過濾、批次上限 |
| pdf-entry.test.mjs | 4 | 本機／遠端 PDF 路由、MIME 探測、下載安全設定（省略 Cookie／禁 Redirect）、非法網址與非 PDF 回應 |
| reading-tools.test.mjs | 6 | 側邊欄分批、取消、輸入與結果驗證、九種樣式、遮罩鍵盤入口、訊息錯誤傳遞 |
| subtitles.test.mjs | 5 | 舊 session 隔離、fallback 不累積請求、時間軸播放／快轉與停止 |
| caption-timeline.test.mjs | 6 | JSON3、時間窗上限、同源 URL／影片 ID、下載與錯誤邊界 |
| ui.test.mjs | 10 | 匯出移除 Key、同 origin 匯入保留 Key、跨 origin 清 Key、非法設定、端點與協定驗證、網站規則更新 |
| worker.test.mjs | 11 | storage 存取層級、來源驗證、秘密隔離、非法訊息、API 網域權限、公開設定廣播、Alt+S 開啟、YouTube 字幕 metadata 邊界、PDF 導流 |

Provider 測試使用模擬 HTTP 回應，worker 測試使用 Chrome API 邊界模擬。測試過程不使用任何真實服務金鑰，亦不向外發送網路請求。

## 瀏覽器端對端測試（Playwright Chromium E2E）

四組瀏覽器自動化測試腳本皆已於支援載入 MV3 擴充套件的 Chromium 環境執行通過：

| 測試腳本 | 狀態 | 驗證範圍 |
| --- | :---: | --- |
| `npm run test:e2e` (`tests/e2e.mjs`) | PASS | 實際載入 MV3 Service Worker、Options 儲存設定、網頁雙語翻譯、動態新增段落、原文還原、文字翻譯側邊欄、遮罩樣式、遠端 PDF 下載／翻譯／匯出 HTML，並確認頁面 DOM 不洩漏 API Key |
| `npm run test:content:e2e` (`tests/content.e2e.mjs`) | PASS | 真實 Chromium DOM 段落擷取（排除 code/contenteditable/hidden/translate=no）、保留連結點擊事件、自身 DOM 寫入不觸發重複請求、MutationObserver 動態更新、遲到回覆丟棄、惡意 HTML 字串安全插入（防禦 XSS） |
| `node tests/documents.e2e.mjs` | PASS | 真實 DOMParser 與文件頁 CSP 阻擋外部資源請求、HTML 匯出移除危險標籤與事件屬性、EPUB spine 順序與 XHTML 雙語／僅譯文匯出 |
| `node tests/documents-pdf.e2e.mjs` | PASS | 實際擴充套件文件頁透過本機 PDF.js module worker 解析雙頁 PDF 文字，以及損壞 PDF 檔案的錯誤處理與按鈕狀態 |

## 建置與發行套件驗證

`python3 scripts/package.py` 由驗證後的 `dist/` 產生 `local-bilingual-reading.zip`：
- 確認 ZIP 壓縮檔 CRC 完整無損。
- 確認 `manifest.json` 與 `background/worker.js` 等所有必要入口存在。
- 排除 `.map` source map 檔案與本機開發測試紀錄，確保發行包乾淨且不含敏感資訊。
