export function translationDirection(language: string): 'rtl' | 'ltr' {
    const subtags = language.toLowerCase().split('-');
    if (subtags.includes('latn'))
        return 'ltr';
    if (subtags.includes('arab') || subtags.includes('hebr'))
        return 'rtl';
    return ['ar', 'arc', 'dv', 'he', 'ckb', 'fa', 'ur', 'ug'].includes(subtags[0] ?? '') ? 'rtl' : 'ltr';
}
