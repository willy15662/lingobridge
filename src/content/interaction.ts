/** A Ctrl tap is distinct from copy, select-all, and browser modifier chords. */
export class ControlTap {
    private pressed = false;
    private chord = false;
    keyDown(event: Pick<KeyboardEvent, 'key' | 'repeat' | 'altKey' | 'metaKey' | 'shiftKey'>): void {
        if (event.key === 'Control' && !event.repeat) {
            this.pressed = true;
            this.chord = event.altKey || event.metaKey || event.shiftKey;
        }
        else if (this.pressed && event.key !== 'Control') {
            this.chord = true;
        }
    }
    keyUp(key: string): boolean {
        if (key !== 'Control')
            return false;
        const tapped = this.pressed && !this.chord;
        this.reset();
        return tapped;
    }
    reset(): void { this.pressed = false; this.chord = false; }
}
export function translationDirection(language: string): 'rtl' | 'ltr' {
    const subtags = language.toLowerCase().split('-');
    if (subtags.includes('latn'))
        return 'ltr';
    if (subtags.includes('arab') || subtags.includes('hebr'))
        return 'rtl';
    return ['ar', 'arc', 'dv', 'he', 'ckb', 'fa', 'ur', 'ug'].includes(subtags[0] ?? '') ? 'rtl' : 'ltr';
}
