# 本機雙語翻譯架構

本專案為獨立實作的 Chrome Manifest V3 雙語閱讀擴充套件，僅使用本機儲存與使用者自備的翻譯服務 API Key。

## 呼叫方式

Content Script 呼叫 `translate(texts)`，只收到字串陣列。Popup/Options 透過 `rpc` 管理設定。頁面不能取得 API Key。

## 邊界與擁有者

- `core/settings.ts`：Zod schema、預設值、網站規則，黑名單優先。
- `core/messages.ts`：經驗證的 discriminated union request、成功／失敗 reply。
- `background/`：唯一的秘密與持久化擁有者；Provider HTTP、批次、重試、排程、快取與統計。storage.local 限 TRUSTED_CONTEXTS，Content Script 僅可讀 public settings。
- `content/`：掃描可翻譯區塊、IntersectionObserver 排程、MutationObserver 更新、原文還原、選取／懸停與字幕。以 textContent 插入譯文；不向頁面傳遞 secrets。
- `ui/`：Popup 的頁面操作、文字側邊欄與 Options 設定、權限請求、匯入匯出。
- `documents/`：本機文件解析、分段、翻譯、預覽與下載。

## 流程與失敗

使用者點擊翻譯 → activeTab 注入 content → 取得 public settings → 掃描段落 → 可見段落組成批次 → worker 驗證 → cache → provider → 檢查結果長度 → 更新統計/cache → content 安全插入。模式變更／原文修改會使舊結果失效，避免遲到的請求覆蓋新內容。

失敗回傳清理過的錯誤，不含 API 回應本文、金鑰或 prompt。HTTP 429/5xx 有限次重試，其他錯誤直接回報。設定變更、快取清除與 provider 選擇影響快取命名。語言偵測使用 Chrome i18n，auto 亦傳給 provider。

## 權限

必要權限：storage、activeTab、scripting、contextMenus、sidePanel。網站與 Provider origins 以 optional_host_permissions 在使用者操作時請求；持續自動翻譯只註冊到已授權的網站。無遠端腳本、會員、雲端同步。

## 比較的設計

1. Content Script 各自發 API：較少訊息，但秘密散落、各分頁無共同限速且受 CORS 影響，拒絕。
2. Worker 集中翻譯與持久化：採用。頁面生命週期與秘密隔離；MV3 worker 重啟後持久快取仍可用，進行中的工作以錯誤提示及重試處理。

## 驗證重點與風險

重複請求、DOM 自我觀察、SPA 改寫、取消後遲到回覆、翻譯回應 XSS、不同模型與 prompt 的快取隔離、設定輸入驗證、未授權 origin。PDF 排版與受 DRM 影片字幕不能由一般 DOM 翻譯推論完成。

## 預設行為與本機文件解析

Content Script 採 leaf-block 擷取與已授權網站注入，背景由 worker 唯一管理 `storage.local`。

新安裝預設採 plain 樣式並關閉懸停查詞。既有 style 不含 theme 時解析為 highlight，避免舊設定失去原本樣式。查詞由 `WordLookup` 追蹤游標與 Ctrl 按住狀態，停留 700ms 後顯示 28×28 圖標，點擊才請求詞意；短片語可先反白再以相同操作查詞。提前放開、快捷鍵組合、捲動或失焦會取消待顯示的圖標。反白文字使用 Chrome 的 `translate-selection` 命令，預設 Alt+Q，任何長度都走一般翻譯面板，不使用查詞服務。

PDF 在文件頁以動態 ESM 載入本地 PDF.js，讀入使用者選取 bytes，設定本地 module worker、CMap 與標準字型。解析器關閉 eval、WASM、XFA 與 font-face，僅呼叫 getTextContent。文件頁仍透過既有 worker 發翻譯請求；輸出可列印 HTML，不偽裝成保留排版的原 PDF。

Build 先在唯一 staging 目錄完成，再替換正式產物，避免編譯失敗清掉上一版。

## 側邊欄、主題與金鑰信任邊界

側邊欄採 Chrome sidePanel extension page，透過既有 worker 的 translate request 翻譯貼上的文字。面板持有輸入與結果，不自行呼叫 Provider、不持久保存草稿；語言可在單次請求覆寫。Alt+S 與 Popup 按鈕從使用者操作直接開啟面板，避免先經任意非同步工作而遺失 user gesture。保留原 Popup 作為頁面控制，而不改成所有 toolbar 點擊都開 sidePanel。

譯文主題採封閉 theme enum 與共用樣式函式，Options 預覽與 Content Script 使用同一份規則。plain 與 highlight 保留原設定相容；新增底線、虛線、波浪線、引文、灰色與遮罩。遮罩在 hover/focus 可讀，避免只能滑鼠操作。

設定變更後 worker 僅向內容腳本廣播 public settings。內容腳本使舊請求失效並套用黑名單；不廣播 providers 或 API Key。網頁與字幕重設使用各自的 generation，舊 promise 的完成或失敗不能刪除新請求或改動新狀態。

安全匯入以 API origin 為金鑰信任邊界：來源網域改變時清除該 Provider 的舊 Key，避免備份檔把已有 Key 移到另一個伺服器。

## 字幕時間軸與排程

`caption-timeline.ts` 負責解析 JSON3、驗證字幕 URL、依播放時間挑選字幕與後續 90 秒的預讀範圍。YouTube content 透過 `captions.info` 要求 worker 在相同 tab 的 MAIN world 讀取播放器字幕 metadata。bridge 不注入 API Key，不回傳整份 player response。content 驗證 videoId、同 origin 與 `/api/timedtext` 後下載字幕，限制 5 MB、50,000 個事件與 15 秒載入時間；不規避登入或字幕存取限制。

`SubtitleTranslator` 擁有時間軸、當前 video 與 session。優先使用 showing TextTrack 的完整 cues，YouTube 則嘗試下載播放器所選語言字幕。每批最多 12 個不重複字幕、24,000 字元，只預讀當前位置後 90 秒。以 currentTime 查找譯文，不以 API 完成時間作為顯示時機。快轉後下一批從新位置開始；已發出的批次不能撤回。停止會 abort 字幕下載、清除 session；舊翻譯結果不再套用。

無法取得時間軸時繼續使用可見字幕，最多一個待處理請求，避免把每句過期字幕持續排隊。關閉 CC 時時間軸模式停止新增批次並隱藏譯文。譯文節點的 `data-subtitle-mode` 為 `prefetch` 或 `live`，可用開發工具診斷。

worker 翻譯訊息可指定 subtitle 優先級。engine 保留單一 writer、全域限速、快取與統計，改為在 batch 邊界選下一個工作。最多連續三個優先工作後讓一般工作執行，避免留言／文件永久飢餓。已發出的 API 或目前批次重試不會被中斷；沒有新增第二條不限速連線。

限制：不是完整 YouTube client；簽名／token／字幕格式變更可能使下載失敗而回退。切換 YouTube 字幕語言後，需切回原文再啟動翻譯以重讀 metadata。沒有音訊辨識，也不保證直播即時翻譯。

## PDF 分頁導流

`core/pdf-entry.ts` 由 URL 及受限的 MIME／PDF embed 探測區分 PDF 分頁。Popup、快捷鍵與右鍵入口一致轉到 `documents.html`，避免回報一般網頁翻譯成功。本機路徑不傳給工作區，只帶 `local-pdf` 提示；遠端網址放在 fragment，工作區讀入後立即清除 fragment，不持久儲存。

文件頁必須經按鈕操作才能請求指定 origin 的 optional host permission 並下載 PDF。`remote-pdf.ts` 禁止帳密 URL、Cookie 與 redirects，限制下載 30 秒／50 MB，檢查 PDF header，產生 File 後沿用 `loadDocument`。網路下載不呼叫翻譯 Provider。文件頁 CSP `connect-src` 允許 HTTP／HTTPS，供明確授權下載使用；script、style、image、frame、object 的限制保留，匯入 HTML 不執行腳本與主動資源。未新增 manifest 權限。

下載與檔案選取共用 generation：選擇新檔案後舊下載不可覆蓋預覽。Chrome 原生 PDF 閱讀器的選取文字無法由此方案直接翻譯，此功能不支援。
