import { z } from 'zod';
import { rpc } from '../core/messages';
import { vocabularyItemSchema, type VocabularyItem } from '../core/vocabulary';
import { element, input, report, status, downloadJSON } from './shared';
import { wordDetails, wordCardStyles, speakWord } from './word-card';

const styles = document.createElement('style'); styles.textContent = wordCardStyles; document.head.append(styles);
let items: VocabularyItem[] = [];
let mode: 'browse' | 'review' = 'browse';
let queue: VocabularyItem[] = [];
let reviewedCount = 0;
let page = 0;
let loading = false;
let writing = false;
let revision = 0;
const pageSize = 15;
function button(text: string, action: () => void, className = 'secondary'): HTMLButtonElement {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = text; node.className = className; node.onclick = action; return node;
}
function paragraph(text: string, className = ''): HTMLParagraphElement {
    const node = document.createElement('p'); node.textContent = text; node.className = className; return node;
}
function detail(item: VocabularyItem): HTMLElement {
    const body = document.createElement('div');
    body.append(wordDetails(item.term, item.entry, item.target));
    if (item.context) body.append(paragraph(item.context, 'source-context'));
    const meta = paragraph(`收藏於 ${new Date(item.savedAt).toLocaleDateString()} · 已複習 ${item.reviews} 次`, 'word-meta');
    if (/^https?:\/\//.test(item.url)) {
        const link = document.createElement('a'); link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = '回到來源'; meta.append(' · ', link);
    }
    body.append(meta); return body;
}
function empty(title: string, description: string): void {
    const box = document.createElement('div'); box.className = 'empty';
    const heading = document.createElement('h2'); heading.textContent = title;
    box.append(heading, paragraph(description, 'muted')); element('cards').append(box);
}
function render(): void {
    revision++;
    element('total').textContent = String(items.length);
    element('due').textContent = String(items.filter(item => item.dueAt <= Date.now()).length);
    for (const id of ['browse', 'review']) {
        element(id).classList.toggle('selected', mode === id); element(id).setAttribute('aria-pressed', String(mode === id));
    }
    element('cards').replaceChildren();
    element('pagination').hidden = true;
    if (mode === 'review') { renderReview(); return; }
    const query = input('search').value.toLocaleLowerCase().trim();
    const filtered = items.filter(item => (item.term + ' ' + item.entry.senses.map(sense => sense.meaning).join(' ')).toLocaleLowerCase().includes(query));
    if (!filtered.length) { empty(items.length ? '找不到符合的單字' : '從下一個好奇的單字開始', items.length ? '試試其他單字或詞意。' : '在網頁查詞卡按「加入單字本」，單字、例句與語境就會保存在這裡。'); return; }
    const pages = Math.ceil(filtered.length / pageSize);
    page = Math.max(0, Math.min(page, pages - 1));
    for (const item of filtered.slice(page * pageSize, (page + 1) * pageSize)) {
        const card = document.createElement('article'); card.className = 'word-card';
        const heading = document.createElement('div'); heading.className = 'word-heading';
        const term = document.createElement('h2'); term.textContent = item.term;
        const remove = button('移除', () => {
            if (writing) return;
            writing = true; remove.disabled = true;
            void rpc({ kind: 'vocabulary.remove', id: item.id }).then(() => { items = items.filter(value => value.id !== item.id); render(); status('已移除單字。'); }).catch(error => { remove.disabled = false; report(error); }).finally(() => { writing = false; });
        }, 'danger');
        heading.append(term, remove); card.append(heading, detail(item)); element('cards').append(card);
    }
    element('pagination').hidden = pages <= 1;
    element('page').textContent = `${page + 1} / ${pages}`;
    const previous = element('previous'), next = element('next');
    if (previous instanceof HTMLButtonElement) previous.disabled = page === 0;
    if (next instanceof HTMLButtonElement) next.disabled = page === pages - 1;
}
function renderReview(): void {
    const item = queue[0];
    if (!item) { empty(reviewedCount ? '今天的複習完成了' : '目前沒有待複習的單字', reviewedCount ? `這次複習了 ${reviewedCount} 個單字。「還不熟」會在 10 分鐘後再出現。` : '新增單字會立即排入複習；記住的單字會逐次延長複習間隔。'); return; }
    const currentRevision = revision;
    const card = document.createElement('article'); card.className = 'word-card';
    const front = document.createElement('div'); front.className = 'review-front';
    const title = document.createElement('h2'); title.textContent = item.term;
    front.append(title, paragraph('想一想它的意思，再翻開答案。', 'muted'), button('朗讀', () => speakWord(item.term, item.entry.sourceLanguage)));
    const answer = document.createElement('div'); answer.hidden = true; answer.append(detail(item));
    const actions = document.createElement('div'); actions.className = 'review-actions';
    const reveal = button('顯示答案', () => {
        answer.hidden = false; reveal.hidden = true;
        const record = (remembered: boolean): void => {
            if (writing) return;
            writing = true;
            for (const node of actions.querySelectorAll('button')) node.disabled = true;
            void rpc({ kind: 'vocabulary.review', id: item.id, remembered }).then(value => {
                const updated = vocabularyItemSchema.parse(value);
                items = items.map(value => value.id === updated.id ? updated : value);
                queue = queue.filter(value => value.id !== updated.id); reviewedCount++;
                if (currentRevision === revision) { render(); status(remembered ? `已記錄，${updated.interval} 天後再複習。` : '已記錄，10 分鐘後再複習。'); }
            }).catch(error => { if (currentRevision === revision) { for (const node of actions.querySelectorAll('button')) node.disabled = false; report(error); } }).finally(() => { writing = false; });
        };
        actions.append(button('還不熟', () => record(false), 'secondary'), button('已記住', () => record(true), 'primary'));
    }, 'primary');
    actions.append(reveal);
    card.append(paragraph(`已完成 ${reviewedCount} · 剩餘 ${queue.length}`, 'review-progress'), front, answer, actions); element('cards').append(card);
}
async function load(): Promise<void> {
    if (loading || writing) return;
    loading = true; status('正在讀取單字本…');
    try {
        items = z.array(vocabularyItemSchema).parse(await rpc({ kind: 'vocabulary.list' }));
        if (mode === 'review') startReview(); else render();
        status('');
    } catch (error) { report(error); }
    finally { loading = false; }
}
function startReview(): void {
    queue = items.filter(item => item.dueAt <= Date.now()).sort((a, b) => a.dueAt - b.dueAt);
    reviewedCount = 0; mode = 'review'; render();
}
element('browse').onclick = () => { if (!writing) { mode = 'browse'; render(); status(''); } };
element('review').onclick = () => { if (!writing) { startReview(); status(''); } };
input('search').oninput = () => { if (!writing) { mode = 'browse'; page = 0; render(); } };
element('previous').onclick = () => { page--; render(); };
element('next').onclick = () => { page++; render(); };
element('refresh').onclick = () => { void load(); };
element('export').onclick = () => downloadJSON({ version: 1, items }, 'vocabulary-backup.json');
element('settings').onclick = () => { void chrome.runtime.openOptionsPage().catch(report); };
window.addEventListener('focus', () => { if (mode === 'browse') void load(); });
void load();
