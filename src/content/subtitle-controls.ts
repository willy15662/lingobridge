export class SubtitleControls {
    enabled = true;
    private statusNode: HTMLParagraphElement | null = null;
    private statusText = '字幕翻譯已啟用';
    setStatus(text: string): void {
        this.statusText = text;
        if (this.statusNode && this.statusNode.textContent !== text) this.statusNode.textContent = text;
        const button = this.host?.querySelector('button');
        if (button) button.title = '伴讀字幕設定：' + text;
    }
    private host: HTMLSpanElement | null = null;
    private panel: HTMLDivElement | null = null;
    private listeners: AbortController | null = null;
    mode = 'bilingual';
    sourceSize = 100;
    sourceColor = '#ffffff';
    weight = 400;
    sourceWeight = 400;
    font = 'sans-serif';
    sourceFont = 'sans-serif';
    private sheet: HTMLStyleElement | null = null;
    size = 100;
    color = '#ffffff';
    background = '#000000';
    opacity = 75;
    position = 'below';
    attach(): void {
        this.refresh();
        const bar = document.querySelector('.ytp-right-controls');
        if (!bar || this.host?.isConnected)
            return;
        this.dispose();
        this.listeners = new AbortController();
        const host = document.createElement('span');
        host.dataset.localTranslate = 'controls';
        this.host = host;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ytp-button';
        button.textContent = '譯';
        button.title = '伴讀字幕設定';
        button.setAttribute('aria-label', button.title);
        button.setAttribute('aria-expanded', 'false');
        const panel = document.createElement('div');
        this.panel = panel;
        panel.hidden = true;
        Object.assign(panel.style, { position: 'absolute', right: '12px', bottom: '52px', width: '280px', maxWidth: 'calc(100vw - 24px)', padding: '14px 16px', background: 'rgba(20,20,20,.96)', color: 'white', borderRadius: '14px', font: '14px/1.5 system-ui', zIndex: '100', maxHeight: 'min(420px, calc(100vh - 120px))', overflowY: 'auto' });
        panel.dataset.localTranslate = 'controls';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', '字幕外觀與顯示');
        const skin = document.createElement('style');
        skin.textContent = `[data-local-translate="controls"] [role="dialog"]{box-sizing:border-box;box-shadow:0 12px 40px #0008;border:1px solid #ffffff26;scrollbar-width:thin;color-scheme:dark;text-align:left;line-height:1.45!important}[data-local-translate="controls"] select{font:13px system-ui;color:#f5f5f5;background:#303035;border:1px solid #ffffff30;border-radius:8px;padding:5px 7px;max-width:135px}[data-local-translate="controls"] input{accent-color:#e5a2c3}[data-local-translate="controls"] input[type=color]{width:34px;height:26px;padding:2px;border:1px solid #ffffff40;border-radius:6px;background:transparent}[data-local-translate="controls"] button:focus-visible,[data-local-translate="controls"] input:focus-visible,[data-local-translate="controls"] select:focus-visible{outline:2px solid #e5a2c3;outline-offset:3px}[data-local-translate="controls"] input[type=checkbox]{width:18px;height:18px}`;
        host.append(skin);
        const heading = document.createElement('strong');
        heading.textContent = '字幕設定';
        heading.style.fontSize = '16px';
        panel.append(heading);
        const help = document.createElement('p');
        help.textContent = '調整此頁面的字幕顯示與外觀';
        Object.assign(help.style, { margin: '2px 0 8px', font: '12px system-ui', color: '#bdbdc8' });
        panel.append(help);
        this.statusNode = document.createElement('p');
        this.statusNode.setAttribute('role','status');
        this.statusNode.style.cssText='font:12px/1.4 system-ui;color:#e5b8cf;margin:6px 0';
        this.statusNode.textContent=this.statusText;
        panel.append(this.statusNode);
        const field = (label: string, input: HTMLElement) => { const row = document.createElement('label'); Object.assign(row.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginTop: '8px' }); row.append(document.createTextNode(label), input); panel.append(row); };
        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.checked = this.enabled;
        toggle.setAttribute('aria-label', '開啟字幕翻譯');
        toggle.onchange = () => { this.enabled = toggle.checked; };
        field('開啟字幕翻譯', toggle);
        for (const [label, key, values] of [['字幕顯示', 'mode', [['bilingual', '雙語字幕'], ['translated', '僅譯文'], ['original', '僅原文']]], ['譯文字型', 'font', [['sans-serif', '無襯線'], ['serif', '襯線'], ['monospace', '等寬']]], ['原文字型', 'sourceFont', [['sans-serif', '無襯線'], ['serif', '襯線'], ['monospace', '等寬']]]] as const) {
            const select = document.createElement('select');
            select.setAttribute('aria-label', label);
            for (const [value, text] of values) {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = text;
                select.append(option);
            }
            select.value = this[key];
            select.onchange = () => { this[key] = select.value; };
            field(label, select);
        }
        const position = document.createElement('select');
        position.setAttribute('aria-label', '譯文位置');
        for (const [value, label] of [['below', '原文下方'], ['above', '原文上方']]) {
            const option = document.createElement('option');
            option.value = value ?? '';
            option.textContent = label ?? '';
            position.append(option);
        }
        position.value = this.position;
        position.onchange = () => { this.position = position.value; };
        field('譯文位置', position);
        for (const [label, key, min, max] of [['譯文字型大小', 'size', 50, 200], ['背景不透明度', 'opacity', 0, 100], ['原文字型大小', 'sourceSize', 50, 200], ['譯文粗細', 'weight', 100, 900], ['原文粗細', 'sourceWeight', 100, 900]] as const) {
            const input = document.createElement('input');
            input.type = 'range';
            input.min = String(min);
            input.max = String(max);
            input.value = String(this[key]);
            input.style.width = '100px';
            const value = document.createElement('output');
            value.textContent = input.value + (key === 'weight' || key === 'sourceWeight' ? '' : '%');
            value.style.cssText = 'font:12px system-ui;min-width:34px;text-align:right';
            input.oninput = () => { this[key] = Number(input.value); value.textContent = input.value + (key === 'weight' || key === 'sourceWeight' ? '' : '%'); };
            input.setAttribute('aria-label', label);
            const group = document.createElement('span');
            group.style.cssText = 'display:flex;align-items:center;gap:6px';
            group.append(input, value);
            field(label, group);
        }
        for (const [label, key] of [['譯文字型顏色', 'color'], ['背景顏色', 'background'], ['原文字型顏色', 'sourceColor']] as const) {
            const input = document.createElement('input');
            input.type = 'color';
            input.setAttribute('aria-label', label);
            input.value = this[key];
            input.oninput = () => { this[key] = input.value; };
            field(label, input);
        }
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = '關閉';
        close.style.cssText = 'margin-top:18px;width:100%;padding:8px;border:1px solid #ffffff30;border-radius:8px;background:#373139;color:white;font:14px system-ui;cursor:pointer';
        const dismiss = () => { panel.hidden = true; button.setAttribute('aria-expanded', 'false'); };
        close.onclick = () => { dismiss(); button.focus(); };
        panel.append(close);
        document.addEventListener('pointerdown', e => { if (e.target instanceof Node && !host.contains(e.target))
            dismiss(); }, { signal: this.listeners.signal });
        panel.addEventListener('keydown', e => { if (e.key === 'Escape') {
            e.preventDefault();
            dismiss();
            button.focus();
        } if (e.key === 'Tab') {
            const items = Array.from(panel.querySelectorAll<HTMLElement>('button,input,select'));
            const first = items[0], last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last?.focus();
            }
            else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first?.focus();
            }
        } });
        for (const event of ['click', 'keydown', 'keyup'])
            panel.addEventListener(event, e => e.stopPropagation());
        button.onclick = e => { e.stopPropagation(); panel.hidden = !panel.hidden; button.setAttribute('aria-expanded', String(!panel.hidden)); if (!panel.hidden)
            toggle.focus(); };
        host.append(button, panel);
        bar.prepend(host);
        this.refresh();
    }
    private refresh(): void {
        if (!this.sheet) {
            this.sheet = document.createElement('style');
            this.sheet.dataset.localTranslate = 'styles';
            document.documentElement.append(this.sheet);
        }
        const css = this.enabled && this.mode !== 'original' ? `.ytp-caption-window-container .caption-window{background:${this.background}${Math.round(this.opacity * 2.55).toString(16).padStart(2, '0')}!important;border-radius:12px;height:auto!important;max-height:none!important;overflow:visible!important}.ytp-caption-window-container .captions-text{overflow:visible!important}.ytp-caption-window-container .ytp-caption-segment{background:transparent!important;color:${this.sourceColor}!important;${this.sourceSize===100?'':`zoom:${this.sourceSize/100};`}font-family:${this.sourceFont}!important;font-weight:${this.sourceWeight}!important;${this.mode === 'translated' ? 'visibility:hidden;display:none!important;' : ''}}` : '';
        if (this.sheet.textContent !== css)
            this.sheet.textContent = css;
    }
    dispose(): void { this.listeners?.abort(); this.listeners = null; this.sheet?.remove(); this.sheet = null; this.host?.remove(); this.host = null; this.panel = null; }
}
