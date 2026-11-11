/** DOM extraction deliberately excludes controls and generated translations. */
export const OWN_ATTRIBUTE = 'data-local-translate';
export const BLOCK_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,td,th,dt,dd,summary,div,section,article';
const EXCLUDED = 'script,style,noscript,template,textarea,input,select,option,button,pre,code,kbd,samp,svg,canvas,math,rp,rt,[role="code"],.katex,.MathJax,.MathJax_Display,.MathJax_SVG,.MathJax_CHTML,.math-inline,.math-block,[hidden],[inert],[aria-hidden="true"],[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,[data-local-translate],.ytp-caption-window-container';
export interface SourceText {
    node: Text;
    original: string;
    written: string | null;
}
export function isExcluded(element: Element): boolean { return element.closest(EXCLUDED) !== null; }
export function sourceNodes(element: HTMLElement): SourceText[] {
    const nodes: SourceText[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, { acceptNode(node) { const parent = node.parentElement; return parent && !isExcluded(parent) && node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; } });
    for (let node = walker.nextNode(); node; node = walker.nextNode())
        if (node instanceof Text)
            nodes.push({ node, original: node.data, written: null });
    return nodes;
}
export function normalizedText(nodes: SourceText[]): string { return nodes.map(n => n.original).join(' ').replace(/\s+/g, ' ').trim(); }
export function candidate(element: HTMLElement): boolean {
    if (isExcluded(element) || element.hidden || element.getAttribute('aria-hidden') === 'true')
        return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden')
        return false;
    // A leaf block owns the entire sentence, including inline links and emphasis.
    if (Array.from(element.querySelectorAll(BLOCK_SELECTOR)).some(child => !isExcluded(child)))
        return false;
    const text = normalizedText(sourceNodes(element));
    return text.length >= 2 && /[\p{L}\p{N}]/u.test(text);
}
export function collectBlocks(root: ParentNode): HTMLElement[] {
    const elements: HTMLElement[] = [];
    if (root instanceof HTMLElement && root.matches(BLOCK_SELECTOR) && candidate(root))
        elements.push(root);
    for (const node of root.querySelectorAll(BLOCK_SELECTOR))
        if (node instanceof HTMLElement && candidate(node))
            elements.push(node);
    return elements;
}
export function changed(nodes: SourceText[]): boolean { return nodes.some(n => !n.node.isConnected || n.node.data !== (n.written ?? n.original)); }
export function restoreText(nodes: SourceText[]): void {
    for (const n of nodes) {
        if (n.written !== null && n.node.data === n.written)
            n.node.data = n.original;
        n.written = null;
    }
}
export function replaceText(nodes: SourceText[], translation: string): void {
    // Retain every element, text node, and listener. Inline text distribution cannot
    // preserve translated word-to-link alignment; bilingual mode retains that context.
    nodes.forEach((n, index) => { n.written = index === 0 ? translation : ''; n.node.data = n.written; });
}
export function splitText(text: string, max = 6000): string[] {
    const chunks: string[] = [];
    let rest = text;
    while (rest.length > max) {
        let cut = rest.lastIndexOf(' ', max);
        if (cut < max / 2)
            cut = max;
        if (/[\uD800-\uDBFF]/.test(rest.charAt(cut - 1)))
            cut--;
        chunks.push(rest.slice(0, cut));
        rest = rest.slice(cut).trimStart();
    }
    if (rest)
        chunks.push(rest);
    return chunks;
}
