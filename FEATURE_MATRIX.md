# 功能矩陣

更新日期：2026-11-11。

「已實作」表示功能已納入建置並通過對應測試。API 自動化測試使用本機模擬回應（fixtures），不涵蓋第三方服務商即時可用性。

| 功能 | 實作狀態 | 已執行驗證 | 限制與說明 |
| --- | --- | --- | --- |
| 原文／雙語／僅譯文 | 已實作 | 文字還原、節點保留單測、Content DOM E2E | 僅譯文模式不進行逐詞連結對齊；雙語模式保留原文連結 |
| 語言自動偵測 | 已實作 Chrome i18n 與 Provider auto | TypeScript、Build | 依賴瀏覽器與目標翻譯服務之語言判斷 |
| 段落擷取 | 已實作 leaf block 策略 | 文字分段單測、Content DOM E2E | 排除程式碼、數學公式、隱藏與可編輯區域 |
| 反白翻譯 | 反白後按 Alt+Q，一律一般翻譯，不顯示按鈕 | Selection E2E、MV3 E2E | 可於 Chrome 快捷鍵管理頁修改 |
| 懸停查詞／片語 | 按住 Ctrl 停留 700ms 顯示 28×28 圖標，點擊查單字／短片語；詞性、詞意、雙語例句、語境與朗讀 | MV3 E2E、Lookup E2E、結構驗證單測 | 預設關閉；需要 OpenAI／Gemini；AI 解釋，非出版詞典 |
| 單字本與複習 | 本機收藏、去重、搜尋、來源、翻面、間隔複習、移除、JSON 匯出 | 持久化／並行儲存／排程單測、worker 存取邊界、MV3 E2E | 不同步到其他裝置；DeepL 不生成詞意與例句 |
| 自動翻譯與黑白名單 | 已實作，黑名單優先 | 規則單測 | 僅自動注入使用者已授予權限的網站 |
| 快捷鍵 | Alt+A、Alt+S 側邊欄、Alt+Q 反白翻譯 | Manifest 與 worker 命令邊界單測 | 若與系統或其他擴充套件衝突，可於 `chrome://extensions/shortcuts` 調整 |
| 右鍵選單 | 頁面與選取文字 | TypeScript、Build、worker 邊界單測 | PDF 分頁點選右鍵翻譯會導向文件工作區 |
| SPA／動態 DOM | MutationObserver、URL 變化檢查 | 過期／還原底層單測、Content DOM E2E | 動態載入段落與路由切換自動重設 |
| 可見區域翻譯 | IntersectionObserver | TypeScript、Build、MV3 E2E | 捲動進入視窗範圍才排入翻譯批次 |
| 譯文樣式 | plain、highlight、gray、underline、dotted、dashed、wavy、blockquote、mask，RTL 方向 | schema、樣式切換、遮罩鍵盤入口、RTL 單測、MV3 E2E | 遮罩樣式支援滑鼠懸停與鍵盤 Tab 聚焦顯示 |
| OpenAI／相容 API | 已實作 Chat Completions adapter | HTTP 請求／回應 fixture 單測 | 需使用者自備 API Key |
| Gemini | 已實作 generateContent adapter | header、JSON、token fixture 單測 | 需使用者自備 API Key |
| DeepL | 已實作 translate adapter | 語言碼／回應 fixture 單測 | 需使用者自備 API Key |
| API Key／模型／Prompt | 已實作各 Provider 設定 | 匯入匯出、來源權限單測、MV3 E2E | 金鑰僅存於本機 `storage.local` |
| 批次翻譯 | 最多 60k 字元／UI request，worker 80k 防線 | 大批次單測 | 單次過長自動切分批次，停止時取消後續批次 |
| 快取／去重 | SHA-256 key、30 日、約 3MB cap、持久 storage | 重複／並行／重建 engine 單測 | 快取鍵包含服務、模型、Prompt 與語言，不含 API Key |
| 重試／速率限制 | 429／5xx，最多 3 次，串行間隔；字幕優先、一般批次間讓出 | fixture 重試與非重試錯誤單測 | 認證錯誤（401/403）不重試 |
| API 用量 | requests／characters／cacheHits／errors／tokens | engine 持久化單測 | 本機估算統計，非服務商正式帳單 |
| PDF 雙語 | 本機 PDF.js 抽字、分頁雙語預覽、可列印 HTML、公開 PDF 網址授權下載 | PDF.js 擷取單測、PDF E2E、遠端下載匯出 E2E | 需 Chrome 124+；上限 50 MB／500 頁；不保留原始圖像與排版，不支援 OCR 與密碼文件 |
| EPUB | 未加密 EPUB 讀取、spine、雙語／僅譯文匯出 | ZIP CRC、DEFLATE、路徑與大小限制單測、HTML／EPUB E2E | 上限 100 MB；不支援 DRM 加密或混淆字型 |
| TXT／Markdown／HTML | 已實作 | TXT／Markdown／URL 過濾單測、HTML E2E | 文字檔上限 10 MB；Markdown 保留程式碼圍欄 |
| SRT／VTT | 保留時間軸，雙語／僅譯文匯出 | 字幕結構與注入防護單測 | 阻擋譯文注入偽造時間軸或標籤 |
| YouTube 字幕 | 播放時獨立自動啟動，90 秒預讀、依時間顯示；可見字幕 fallback；播放器字幕外觀設定 | JSON3、同源 URL、預讀／快轉／取消、優先佇列單測 | 直接字幕軌不可用時需開啟 CC；暫停不再預讀；無語音辨識 |
| 圖片／漫畫 | 可視 `<img>` 像素辨識與譯文區塊疊加、長圖分區、背景取色、文字量測排版、原圖切換、重試 | 影像格式與回應邊界單測、Media E2E、MV3 圖片自動注入 E2E | 預設關閉；需視覺模型及來源授權；無 CSS 背景／canvas／文字擦除重繪 |
| 其他影片字幕 | HTML5 TextTrack 完整 cues 預讀與 activeCues fallback | TypeScript、Build、時間軸單測 | 支援可載入的字幕軌，必要時以 hidden 載入；無語音辨識 |
| 文字側邊欄 | Alt+S／Popup 開啟，語言交換、批次、停止、複製 | 文字分批、過期取消、command 邊界單測、MV3 E2E | 草稿不持久保存，重新載入即清除 |
| Popup／Options | 繁體中文獨立 UI | TypeScript、Build、資料轉換單測、MV3 E2E | 支援網站黑白名單快速切換與樣式即時預覽 |
| 本機資料管理 | 匯出不含 key、同 origin 匯入保留 key，換 origin 清除、清快取／統計／全部資料 | 單測 | 瀏覽器已授予的網站權限可於 Chrome 擴充套件管理頁移除 |
| Key 隔離與訊息來源 | TRUSTED_CONTEXTS、sender 驗證、public projection | worker 模擬 Chrome 邊界單測、MV3 E2E | Content Script 與網頁 DOM 無法讀取 API Key |
| XSS 防護 | textContent、匯出 markup 白名單、CSP | 字串與 URL 單測、Content 與 Document E2E | 翻譯結果一律以純文字插入，匯出檔案移除主動腳本與外部資源 |
| Chrome 載入套件 | `dist/` 與 `local-bilingual-reading.zip` 已生成 | manifest／資源路徑／雜湊與 E2E 驗證 | 不含 Source Maps 與開發測試檔案 |

## 明確不包含之範圍

- 帳號系統、付費訂閱、廣告或雲端同步。
- 跨來源 iframe 注入、DRM 加密影音字幕、音訊即時語音辨識（ASR）。
- 保留原始複雜排版的 PDF 重建、掃描型 PDF 之 OCR 辨識、密碼保護 PDF。
- Chrome 內建原生 PDF 閱讀器畫面內的直接雙語插入與選取翻譯（統一導流至本套件的文件工作區處理）。
