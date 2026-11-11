/** DOM extraction deliberately excludes controls and generated translations. */
export const OWN_ATTRIBUTE = 'data-local-translate';
const LABEL_SELECTOR = 'a[href],[role="menuitem"],[role="tab"]';
const PROSE_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,td,th,dt,dd';
export const BLOCK_SELECTOR = `p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,td,th,dt,dd,summary,div,section,article,${LABEL_SELECTOR}`;
export function standaloneLabel(element: Element): boolean {
    return element.matches(LABEL_SELECTOR) && !element.closest(PROSE_SELECTOR);
}
// Responsive tab bars measure their children to decide what fits. Adding text
// changes that measurement and can make the site alternate visibility forever.
const EXCLUDED = 'overflow-nav,.UnderlineNav,nav[aria-label="Repository" i],[role="tablist"],[role="tree"],[role="treeitem"],nav[aria-label*="breadcrumb" i],.react-code-view-header-path,.react-directory-filename-column,a[href*="/blob/"],a[href*="/tree/"],script,style,noscript,template,textarea,input,select,option,button,pre,code,kbd,samp,svg,canvas,math,rp,rt,[role="code"],.katex,.MathJax,.MathJax_Display,.MathJax_SVG,.MathJax_CHTML,.math-inline,.math-block,[hidden],[inert],[aria-hidden="true"],[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,[data-local-translate],.ytp-caption-window-container';
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
export function compactTranslation(element: HTMLElement, text: string): boolean {
    return text.length <= 80 && (standaloneLabel(element) || element.matches('h1,h2,h3,h4,h5,h6,th,dt,summary') ||
        element.closest('nav,header,aside,[role="navigation"],[role="tablist"],td,th') !== null ||
        ['flex', 'inline-flex', 'grid', 'inline-grid'].includes(getComputedStyle(element).display));
}
export function candidate(element: HTMLElement): boolean {
    if (isExcluded(element) || element.hidden || element.getAttribute('aria-hidden') === 'true')
        return false;
    // A standalone UI link owns its nested icon/label wrappers. Prose links
    // remain part of their paragraph so sentence extraction stays intact.
    if (element.matches(LABEL_SELECTOR) && !standaloneLabel(element)) return false;
    const labelOwner = element.parentElement?.closest(LABEL_SELECTOR);
    if (labelOwner && standaloneLabel(labelOwner)) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden')
        return false;
    // A leaf block owns the entire sentence, including inline links and emphasis.
    if (!standaloneLabel(element) && Array.from(element.querySelectorAll(BLOCK_SELECTOR)).some(child => !isExcluded(child) && (!child.matches(LABEL_SELECTOR) || standaloneLabel(child))))
        return false;
    const text = normalizedText(sourceNodes(element));
    // Preserve identifiers, filenames, project IDs, hashes, and numeric metadata.
    if (/^[\w.@/-]+$/.test(text) && (/[._/@-]/.test(text) || !/[a-zA-Z]{2}/.test(text)))
        return false;
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
