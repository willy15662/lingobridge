import type { DictionaryEntry } from '../core/vocabulary';
import { translationDirection } from '../content/interaction';

export function speakWord(term: string, language: string): void {
    if (!('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(term);
    utterance.lang = language;
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
}
export function wordDetails(term: string, entry: DictionaryEntry, target: string): HTMLElement {
    const content = document.createElement('div');
    content.className = 'word-details';
    content.lang = target;
    content.dir = translationDirection(target);
    const pronunciation = document.createElement('p');
    pronunciation.className = 'pronunciation';
    pronunciation.textContent = entry.pronunciation;
    const audio = document.createElement('button');
    audio.type = 'button';
    audio.textContent = '朗讀';
    audio.setAttribute('aria-label', `朗讀 ${term}`);
    audio.onclick = () => speakWord(term, entry.sourceLanguage);
    pronunciation.append(' ', audio);
    content.append(pronunciation);
    for (const sense of entry.senses) {
        const section = document.createElement('section');
        section.className = 'sense';
        const meaning = document.createElement('p');
        const pos = document.createElement('span');
        pos.className = 'part-of-speech';
        pos.textContent = sense.partOfSpeech;
        meaning.append(pos, ' ', sense.meaning);
        const example = document.createElement('p');
        example.className = 'example';
        example.lang = entry.sourceLanguage;
        example.dir = translationDirection(entry.sourceLanguage);
        example.textContent = sense.example;
        const translation = document.createElement('p');
        translation.className = 'example-translation';
        translation.textContent = sense.translation;
        section.append(meaning, example, translation);
        content.append(section);
    }
    const context = document.createElement('section');
    context.className = 'contextual-meaning';
    const label = document.createElement('strong');
    label.textContent = '在這裡的意思';
    const explanation = document.createElement('p');
    explanation.textContent = entry.contextualMeaning;
    context.append(label, explanation);
    content.append(context);
    return content;
}
export const wordCardStyles = `
.word-details{line-height:1.7;overflow-wrap:anywhere}.word-details p{margin:8px 0}
.pronunciation,.part-of-speech,.example-translation{color:var(--muted,#746c7e)}
.sense{margin:20px 0}.part-of-speech{font-size:13px}.example,.example-translation{padding-inline-start:16px;border-inline-start:2px solid var(--border,#e9e4ed)}
.contextual-meaning{padding:16px;background:var(--soft,#f8f4f8);border-radius:12px;margin:18px 0}
`;
