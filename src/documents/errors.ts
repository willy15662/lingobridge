const messages = {
    'pdf-browser': 'PDF 文字翻譯需要 Chrome 124 或更新版本；其他文件格式仍可使用。',
    'pdf-size': 'PDF 不能超過 50 MB。請先分割文件後再開啟。',
    'pdf-pages': 'PDF 超過 500 頁。請先分割文件後再開啟。',
    'pdf-empty': 'PDF 沒有可擷取文字，可能是掃描件。此版本尚未提供 OCR。',
    'pdf-password': '此 PDF 需要密碼。目前不支援密碼文件，請先在本機解除密碼後再開啟。',
    'pdf-invalid': 'PDF 讀取失敗。請確認檔案未損壞；此版本尚未驗證所有 PDF 字型與編碼。',
};
export class DocumentLoadError extends Error {
    constructor(readonly code: keyof typeof messages) { super(messages[code]); this.name = 'DocumentLoadError'; }
}
