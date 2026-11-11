import { OWN_ATTRIBUTE } from './dom';
export class TranslationPanel {
    private host: HTMLDivElement | null = null;
    private output: HTMLParagraphElement | null = null;
    private sequence = 0;
    private ensure(): HTMLDivElement {
        if (this.host?.isConnected)
            return this.host;
        const host = document.createElement('div');
        host.setAttribute(OWN_ATTRIBUTE, 'panel');
        Object.assign(host.style, { position: 'fixed', zIndex: '2147483647', right: '20px', bottom: '24px', maxWidth: 'min(380px, calc(100vw - 32px))' });
        const shadow = host.attachShadow({ mode: 'closed' });
        const style = document.createElement('style');
        style.textContent = ':host{all:initial}.box{font:14px/1.65 system-ui,sans-serif;color:#292735;background:white;border:1px solid #e7dce2;border-radius:14px;box-shadow:0 8px 40px #30203026;padding:16px;min-width:240px;max-height:60vh;overflow:auto}header{display:flex;justify-content:space-between;align-items:center;color:#b73967;font-weight:650}button{border:0;background:#f8edf1;border-radius:6px;padding:4px 8px;color:#73354d;cursor:pointer}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0 0}';
        const box = document.createElement('div');
        box.className = 'box';
        box.setAttribute('role', 'status');
        const header = document.createElement('header');
        header.textContent = '本機雙語翻譯';
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = '關閉';
        close.onclick = () => this.close();
        header.append(close);
        this.output = document.createElement('p');
        box.append(header, this.output);
        shadow.append(style, box);
        document.documentElement.append(host);
        this.host = host;
        return host;
    }
    show(text: string): void {
        this.ensure();
        if (this.output)
            this.output.textContent = text;
    }
    close(): void { this.sequence++; this.host?.remove(); this.host = null; this.output = null; }
    async translate(text: string, run: (texts: string[]) => Promise<string[]>): Promise<void> {
        const sequence = ++this.sequence;
        this.show('翻譯中…');
        try {
            const results = await run([text]);
            if (sequence === this.sequence)
                this.show(results[0] ?? '未收到翻譯結果');
        }
        catch (error) {
            if (sequence === this.sequence)
                this.show(error instanceof Error ? error.message : '翻譯失敗，請檢查設定。');
        }
    }
}
