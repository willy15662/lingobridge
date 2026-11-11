# 伴讀翻譯 ReadAlong

看外文網頁、看 YouTube、讀 PDF，讓原文旁邊多一份看得懂的翻譯。

伴讀翻譯是一款 Chrome 擴充套件，支援雙語閱讀、影片字幕與文件翻譯。不需要註冊本專案帳號；準備自己的翻譯服務 API Key，就能開始使用。

[![下載擴充套件 ZIP](docs/assets/download.svg)](https://github.com/willy15662/translate/raw/refs/heads/main/local-bilingual-reading.zip) [![Google AI Studio 申請 API Key](docs/assets/ai-studio.svg)](https://aistudio.google.com/apikey)

**第一次使用：下載 ZIP → 解壓縮 → 載入 Chrome → 填入 Gemini API Key。** 不需要安裝 Node.js，也不需要寫程式。

> 安裝包版本：0.3.0。Chrome 中目前顯示的名稱是「本機雙語閱讀」，就是本專案。下載檔名保留為 `local-bilingual-reading.zip`。

## 1. 下載與安裝

建議使用電腦版 Chrome 124 或更新版本。

1. 按上方「下載擴充套件 ZIP」。請下載 `local-bilingual-reading.zip`，不要選 GitHub 的「Code → Download ZIP」，後者是開發用原始碼。
2. 在下載的 ZIP 上按右鍵，選擇「全部解壓縮」。將資料夾放在固定位置，例如 `C:\Tools\ReadAlong`。
3. 打開解壓縮後的資料夾，確認裡面有 `manifest.json`。如果還有一層同名資料夾，就再進去一層。
4. 在 Chrome 網址列輸入 `chrome://extensions`，按 Enter。
5. 開啟右上角的「開發人員模式」。
6. 按「載入未封裝項目」，選擇**直接放著 `manifest.json` 的資料夾**。
7. 按瀏覽器右上角的拼圖圖示，將「本機雙語閱讀」釘選到工具列。

**不要把 ZIP 直接拖進擴充功能頁面。** 要先解壓縮，再選擇資料夾。安裝完成後也不要刪除或搬動該資料夾，Chrome 仍會從這裡載入程式。

## 2. 申請 Gemini API Key

API Key 是讓擴充套件呼叫翻譯服務的通行證。每個人使用自己的 Key，不需要向專案作者索取。

1. 開啟 [Google AI Studio 的 API Key 頁面](https://aistudio.google.com/apikey)，登入 Google 帳號。
2. 若是首次使用，依畫面接受條款，建立或選擇專案。
3. 按「Create API key／建立 API 金鑰」，依畫面完成建立，複製 Key。
4. 下一步把 Key 貼進擴充套件設定，不要貼到 GitHub、聊天室或分享給朋友。

建議先使用 **Gemini 3.5 Flash-Lite**，設定時要填的模型代碼是 `gemini-3.5-flash-lite`。[官方模型說明](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)

Google 官方目前提供此模型的免費輸入與輸出額度，但**免費不等於無限量**，實際可用性與請求限制依你的專案及官方政策而定。先確認 AI Studio 顯示的免費層級；若自行啟用付費方案，就依 Google 的計費規則使用。資料查核日期：2026-11-11。[官方價格與免費層級](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite)

## 3. 設定翻譯服務

1. 點工具列上的擴充套件圖示，再點齒輪開啟設定。
2. 在「閱讀偏好」將「使用的翻譯服務」選為 **Gemini**。
3. 在「翻譯服務」區塊切換到 **Gemini** 分頁，填入下表內容。
4. 按「儲存設定」，允許連線到 Google API 網域。

| 欄位 | 填入內容 |
| --- | --- |
| API Key | 你剛從 Google AI Studio 複製的 Key |
| API 基底網址 | `https://generativelanguage.googleapis.com/v1beta` |
| 模型 | `gemini-3.5-flash-lite` |
| 翻譯 Prompt | 先保留原本內容即可 |
| 原文語言 | 自動偵測 |
| 目標語言 | 繁體中文／中文（台灣） |

目前安裝包可能預填其他模型，請**手動改成上面的模型代碼**。只切換服務設定分頁不會改變使用中的服務，記得完成第 2 步並儲存。

先開啟一小段英文文章，按擴充套件中的「翻譯此頁」。看到原文下方出現中文，就設定成功了。OpenAI、相容 API 與 DeepL 也能使用，但需要各自的 Key。

## 平常怎麼使用？

### 翻譯網頁

開啟文章後，點擴充套件圖示，再按「翻譯此頁」。可選「雙語對照」、「僅譯文」，或切回「原文」。雙語模式會保留原文連結，適合邊讀邊對照。側欄短標籤在原文旁顯示譯文；GitHub 等會自動收合的分頁導覽列保留原樣，避免翻譯改變寬度造成反覆收合。

反白任何文字後按 **Alt+Q**，會開啟一般翻譯小視窗；單字、片語與整段文字都使用一般翻譯，不會自動進入查詞卡。反白本身不顯示按鈕，也不送出請求。

| 快捷鍵 | 用途 |
| --- | --- |
| Alt+A | 切換原文與雙語 |
| Alt+Q | 翻譯反白文字（一般翻譯） |
| Alt+S | 開啟文字翻譯側邊欄，貼上文字翻譯 |

若快捷鍵沒有反應，可到 `chrome://extensions/shortcuts` 檢查是否與其他擴充套件衝突。

### 查單字、片語與複習

1. 在擴充套件面板開啟「懸停查詞」，並允許連線到目前設定的 API 服務。
2. 回到網頁，按住 Ctrl，將滑鼠停在單字上約 0.7 秒，會出現 28×28 的小查詞圖標。點圖標才查詞，提前放開 Ctrl 則取消待顯示的圖標。要查片語，可先反白短片語，再按住 Ctrl 停留在反白範圍內，點圖標查用法；較長文字請按 Alt+Q 翻譯。
3. 查詞卡顯示發音、詞性、常見詞意、雙語例句及這段文字中的意思。按「朗讀」可使用瀏覽器語音，按 Esc 或點卡片外可關閉。
4. 按「加入單字本」，保存單字、例句、語境與來源網址。
5. 在擴充套件面板或查詞卡按「單字本」，可搜尋收藏。按「開始複習」先回想詞意，再按「顯示答案」，選擇「還不熟」或「已記住」。

「還不熟」會在 10 分鐘後再排入複習；「已記住」從 1 天開始，每次加倍，最多 365 天。重複收藏會保留原本進度。單字本只存於這台裝置，可匯出 JSON；設定中的「清除全部本機資料」也會刪除單字本。

詞意與例句由目前設定的 OpenAI／Gemini 產生，會傳送所查文字及附近語境，需有可用的 API Key。DeepL 仍可翻譯段落，但不提供此查詞功能。懸停查詞預設關閉；目前分頁可直接在面板啟用，其他網站若要自動載入，請在設定授權網站。

### 自動翻譯影片字幕

1. 在設定開啟「雙語影片字幕」並儲存。
2. 在影片頁開啟擴充套件面板，按「允許此網站自動翻譯媒體」，允許網站與 API 連線。若要在所有網站自動啟動，可在設定按「授權媒體自動翻譯」。
3. 重新整理影片頁並播放。字幕會自動翻譯，不必按「翻譯此頁」；頁面上的標題、留言與導覽文字保留原文。

能取得字幕軌時，會先翻譯當前字幕，再按播放位置預讀接下來 90 秒內的字幕。暫停後不再送出新預讀請求，已翻好的當前字幕仍可閱讀。切回頁面「原文」不會關閉字幕翻譯；要關閉字幕，請取消「自動翻譯影片字幕」。

YouTube 會嘗試直接讀取字幕軌；取不到時使用畫面中已開啟的 CC 字幕。一般 HTML5 播放器會嘗試載入已有的字幕軌，不會辨識沒有字幕的影片聲音。切換影片、字幕軌或翻譯語言會使用新的字幕內容，舊回應不會覆蓋新影片。

### 自動翻譯圖片與漫畫

1. 選擇支援圖片輸入的 OpenAI／Gemini 模型，填好 API Key 並儲存。
2. 開啟「自動翻譯圖片／漫畫」，儲存後按「授權媒體自動翻譯」，允許網站及跨網站圖片來源。
3. 重新整理圖片／漫畫頁。只處理目前看得到的圖片；長條漫畫會切成區塊，捲動到新區塊時才辨識與翻譯。
4. 圖片上的「顯示原圖／顯示譯文」可以切換對照。失敗時將滑鼠移到重試按鈕查看原因，補好權限或模型設定後再重試。

圖片翻譯預設關閉。開啟後，可見圖片區塊會傳到你設定的服務，辨識文字並將譯文疊在圖片文字區域；DeepL 不提供圖片辨識。AI 的辨識、定位及翻譯可能有誤，原圖始終保留。

目前處理網頁中的 `<img>` 圖片，略過小圖示及導覽圖片；不處理 CSS 背景圖或 canvas 閱讀器。跨網站圖片需要來源授權，下載不帶網站 Cookie；來源檔案上限 8 MB。影片頁不會自動辨識縮圖，讓字幕先使用資源。圖片設定開啟時，整頁文字同樣等你按「翻譯此頁」才翻譯。

圖片輸入格式依 [OpenAI 官方說明](https://developers.openai.com/api/docs/guides/images-vision)及 [Gemini 官方說明](https://ai.google.dev/gemini-api/docs/image-understanding)實作；實際可用性取決於你設定的模型與端點。

### 翻譯 PDF、電子書與其他文件

點擴充套件中的「文件與字幕」，進入文件工作區。

- **本機 PDF**：選擇電腦上的 PDF，等待文字預覽，再按「開始翻譯」。
- **網路 PDF**：貼上公開 PDF 網址，按「讀取 PDF 網址」並授權。需要登入或無法直接讀取時，先下載到電腦再選取。
- **其他文件**：可選擇未加密 EPUB、TXT、Markdown、HTML、SRT 或 VTT。

完成後可選雙語或僅譯文匯出。PDF 會匯出成可列印的 HTML，**不保留原始圖像與排版**；掃描件與照片型 PDF 尚不支援 OCR。PDF 上限為 50 MB／500 頁。

Chrome 內建 PDF 閱讀器不能直接插入譯文或使用本套件的選取翻譯。請按「開啟 PDF 翻譯」進入文件工作區；本機檔案需要重新選取一次。

## 遇到問題時

| 情況 | 先試試這個方法 |
| --- | --- |
| 載入擴充套件時找不到 manifest | 確認 ZIP 已解壓縮，選到直接含有 `manifest.json` 的資料夾 |
| 點翻譯沒有結果 | 確認使用服務已選 Gemini、Key 已填入、設定已儲存並授權 API 網域；重新整理頁面再試 |
| 顯示 HTTP 401／403 | 檢查 Key 是否正確，以及該 Key 的服務權限 |
| 顯示 HTTP 429 | 可能達到請求速率或額度限制；先暫停，並到 AI Studio 檢查額度 |
| 模型不存在或無權使用 | 確認填的是 `gemini-3.5-flash-lite`；若帳號不可用，改用 AI Studio 中對該專案開放的模型 |
| 留言能翻譯，字幕沒有 | 確認 CC 和「雙語影片字幕」都已開啟；暫停影片等第一批結果 |
| PDF 無法讀取 | 改用文件工作區選取本機檔案；確認不是掃描件、密碼文件或登入頁 |

要回報問題，可到 [Issues](https://github.com/willy15662/translate/issues) 提供操作步驟、錯誤訊息及套件版本。截圖請遮住 API Key 與私人內容。

## 更新到新版

重新下載上方 ZIP，解壓縮並覆蓋原本的擴充套件資料夾。到 `chrome://extensions` 按本套件的重新載入按鈕，再重新整理要翻譯的網頁。

一般更新不需要移除擴充套件，也不需要重新建立 API Key。

## 資料會送去哪裡？

設定、Key 與翻譯快取儲存在本機瀏覽器。**實際要翻譯的文字會傳給你選擇的翻譯服務**，因此不是完全離線工具。Key 存在本機 Chrome storage，未加密；設定匯出不包含 Key。

Google 的免費層級可能使用提交內容改善產品。不要用免費服務翻譯不適合交給第三方的私人或機密資料；使用前可查看 [Google 的資料使用說明與價格表](https://ai.google.dev/gemini-api/docs/pricing)。

本專案為獨立實作，沒有會員、廣告或雲端同步。

<details>
<summary>給開發者：原始碼、建置與測試</summary>

使用 TypeScript、Chrome Manifest V3 與 esbuild，需要 Node.js 22。

```sh
npm ci
npm run check
npm run test:e2e
npm run test:content:e2e
node tests/documents.e2e.mjs
node tests/documents-pdf.e2e.mjs
python3 scripts/package.py
```

瀏覽器測試需要 Playwright Chromium。可執行 `node node_modules/playwright-core/cli.js install chromium`，或用 `CHROME_PATH` 指定支援載入擴充套件的瀏覽器。

0.2.3 有 79 項單元／邊界測試通過，四組瀏覽器腳本已有使用者終端成功紀錄，詳見 [測試結果](TEST_RESULTS.md)。API 自動化測試使用模擬服務，不代表每個模型或網站都已實測。

下載按鈕直接讀取 `main` 分支根目錄的 `local-bilingual-reading.zip`。更新套件時，請把建置後的 ZIP 一併提交；只推送 README 不會更新安裝包。`dist/`、金鑰與本機證據仍不納入 Git。

- [功能與限制](FEATURE_MATRIX.md)
- [架構](ARCHITECTURE.md)
- [PDF.js 來源與授權](public/vendor/pdfjs/PROVENANCE.md)

</details>
