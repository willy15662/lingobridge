import {fetchPdfFile,remotePdfURL} from './remote-pdf';
import { rpc, translate } from '../core/messages';
import { DocumentLoadError } from './errors';
import { settingsSchema } from '../core/settings';
import { loadDocument, segmentBatches, type TranslationDocument, type OutputMode } from './formats';
function element<T extends HTMLElement>(id: string, ctor: {
    new (...args: never[]): T;
}): T {
    const value = document.getElementById(id);
    if (!(value instanceof ctor))
        throw new Error('文件介面初始化失敗。');
    return value;
}
const input = element('file', HTMLInputElement);
const start = element('start', HTMLButtonElement);
const cancel = element('cancel', HTMLButtonElement);
const save = element('save', HTMLButtonElement);
const mode = element('output-mode', HTMLSelectElement);
const status = element('status', HTMLElement);
const progress = element('progress', HTMLProgressElement);
const preview = element('preview', HTMLElement);
const title = element('document-name', HTMLElement);
const next = element('next', HTMLButtonElement);
const previous = element('previous', HTMLButtonElement);
const pageLabel = element('page-label', HTMLElement);
let current: TranslationDocument | null = null;
let generation = 0;
let running = false;
let page = 0;
let batchSize = 8;
const PAGE_SIZE = 30;
function updateButtons(): void {
    start.disabled = !current || running || current.segments.every(segment => segment.translation !== null);
    cancel.disabled = !running;
    input.disabled = running;
    save.disabled = !current || running || !current.segments.some(segment => segment.translation !== null);
}
function render(): void {
    preview.replaceChildren();
    if (!current) {
        updateButtons();
        pageLabel.textContent = '';
        return;
    }
    const segments = current.segments.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const fragment = document.createDocumentFragment();
    for (const segment of segments) {
        const row = document.createElement('article');
        row.className = 'pair';
        const source = document.createElement('div');
        source.className = 'source';
        source.textContent = segment.source;
        const translation = document.createElement('div');
        translation.className = 'translation';
        translation.textContent = segment.translation ?? '尚未翻譯';
        if (segment.translation === null)
            translation.classList.add('pending');
        row.append(source, translation);
        fragment.append(row);
    }
    preview.append(fragment);
    const pages = Math.max(1, Math.ceil(current.segments.length / PAGE_SIZE));
    pageLabel.textContent = `第 ${page + 1} / ${pages} 頁`;
    previous.disabled = page === 0;
    next.disabled = page + 1 >= pages;
    const completed = current.segments.filter(segment => segment.translation !== null).length;
    progress.max = Math.max(current.segments.length, 1);
    progress.value = completed;
    element('count', HTMLElement).textContent = `${completed} / ${current.segments.length} 段`;
    updateButtons();
}
function openFile(file:File,token=++generation):void {
    current = null;
    running = false;
    page = 0;
    updateButtons();
    status.textContent = '正在本機讀取文件…';
    void loadDocument(file).then(doc => {
        if (token !== generation)
            return;
        current = doc;
        title.textContent = doc.title;
        status.textContent = doc.segments.length ? '文件已就緒。按「開始翻譯」才會將文字傳給你設定的翻譯服務。' : '文件內沒有可翻譯的文字。';
        render();
    }).catch((error: unknown) => {
        if (token !== generation)
            return;
        status.textContent = error instanceof DocumentLoadError ? error.message : '無法讀取文件。請確認格式正確、檔案未損壞，且 EPUB 未加密。';
        preview.replaceChildren();
        title.textContent = '開啟一份文件';
        updateButtons();
    });
}
input.addEventListener('change',()=>{const file=input.files?.[0];if(file)openFile(file);});
start.addEventListener('click', () => {
    if (!current || running)
        return;
    const doc = current;
    const token = ++generation;
    running = true;
    updateButtons();
    status.textContent = '翻譯中，可隨時停止後繼續。';
    void (async () => {
        const pending = doc.segments.filter(segment => segment.translation === null);
        for (const batch of segmentBatches(pending, batchSize)) {
            if (token !== generation)
                return;
            const results = await translate(batch.map(segment => segment.source));
            if (token !== generation)
                return;
            if (results.length !== batch.length)
                throw new Error('翻譯結果數量不符。');
            for (const [index, segment] of batch.entries())
                segment.translation = results[index] ?? null;
            render();
        }
        status.textContent = '翻譯完成。可選擇雙語或僅譯文下載。';
    })().catch(() => {
        if (token === generation)
            status.textContent = '翻譯失敗，已完成段落已保留。請檢查服務設定、權限與額度，再按「開始翻譯」繼續。';
    }).finally(() => {
        if (token === generation) {
            running = false;
            render();
        }
    });
});
cancel.addEventListener('click', () => { generation++; running = false; status.textContent = '已停止後續批次，完成段落已保留。正在處理的 API 請求仍可能計費。'; render(); });
save.addEventListener('click', () => {
    if (!current || running)
        return;
    const outputMode: OutputMode = mode.value === 'translated' ? 'translated' : 'bilingual';
    try {
        const blob = current.export(outputMode);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = current.title.replace(/\.[^.]+$/, '') + '.' + outputMode + '.' + current.extension;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        status.textContent = current.segments.some(segment => segment.translation === null) ? '已下載部分翻譯，未完成段落保留原文。' : '已下載翻譯文件。';
    }
    catch {
        status.textContent = '無法匯出。文件可能超出 100 MB 輸出上限。';
    }
});
next.addEventListener('click', () => {
    if (current && (page + 1) * PAGE_SIZE < current.segments.length) {
        page++;
        render();
    }
});
previous.addEventListener('click', () => { page = Math.max(0, page - 1); render(); });
element('settings', HTMLButtonElement).addEventListener('click', () => { void chrome.runtime.openOptionsPage(); });
void rpc({ kind: 'settings.public' }).then(value => {
    const settings = settingsSchema.omit({ providers: true }).parse(value);
    batchSize = settings.batchSize;
    element('service', HTMLElement).textContent = `${settings.provider} · ${settings.source === 'auto' ? '自動偵測' : settings.source} → ${settings.target}`;
}).catch(() => { status.textContent = '無法讀取設定。請重新載入擴充套件後再試。'; });
updateButtons();

const pdfUrl=element('pdf-url',HTMLInputElement);
const loadPdf=element('load-pdf',HTMLButtonElement);
const params=new URLSearchParams(location.hash.slice(1));
if(params.has('pdf')){try{pdfUrl.value=remotePdfURL(params.get('pdf')??'').href;}catch{status.textContent='PDF 網址無效，請選擇本機檔案。';}}
if(location.hash==='#local-pdf')element('pdf-help',HTMLElement).textContent='請用下方檔案選擇器重新選擇本機 PDF。瀏覽器內建 PDF 閱讀器的文字無法直接翻譯。';
// Remove the source URL from the workspace address after reading it; never persist it.
if(location.hash)history.replaceState(null,'',location.pathname);
loadPdf.addEventListener('click',()=>{
 if(running)return;
 let url:URL;try{url=remotePdfURL(pdfUrl.value);}catch{status.textContent='請輸入有效的 HTTP／HTTPS PDF 網址。';return;}
 const token=++generation;current=null;render();loadPdf.disabled=true;status.textContent='正在取得 PDF 讀取權限…';
 void chrome.permissions.request({origins:[url.origin+'/*']}).then(async granted=>{
  if(!granted)throw new Error('未授權 PDF 網站。也可以下載 PDF 後選擇本機檔案。');
  if(token!==generation)return;
  status.textContent='正在下載 PDF…';const file=await fetchPdfFile(url.href);
  if(token===generation)openFile(file,token);
 }).catch(error=>{if(token===generation)status.textContent=error instanceof Error?error.message:'PDF 讀取失敗。請下載後選擇本機檔案。';})
 .finally(()=>{loadPdf.disabled=false;});
});
