export interface ImagePalette { background: string; foreground: string }
export const fallbackPalette: ImagePalette = { background: '#fff', foreground: '#191919' };
/** Sampled RGBA pixels stay on-device; choose the most frequent coarse color. */
export function imagePalette(pixels: Uint8ClampedArray): ImagePalette {
    const colors = new Map<string, { count: number; red: number; green: number; blue: number }>();
    for (let i = 0; i + 3 < pixels.length; i += 4) {
        if ((pixels[i + 3] ?? 0) < 128) continue;
        const red = pixels[i] ?? 255, green = pixels[i + 1] ?? 255, blue = pixels[i + 2] ?? 255;
        const key = `${red >> 4}:${green >> 4}:${blue >> 4}`;
        const color = colors.get(key);
        if (color) { color.count++; color.red += red; color.green += green; color.blue += blue; }
        else colors.set(key, { count: 1, red, green, blue });
    }
    let best: { count: number; red: number; green: number; blue: number } | undefined;
    for (const color of colors.values()) if (!best || color.count > best.count) best = color;
    if (!best) return fallbackPalette;
    const rgb = [best.red, best.green, best.blue].map(channel => Math.round(channel / best.count));
    const luminance = rgb.reduce((sum, channel, i) => {
        const value = channel / 255;
        return sum + (value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4) * ([.2126, .7152, .0722][i] ?? 0);
    }, 0);
    return { background: `rgb(${rgb.join(',')})`, foreground: luminance > .179 ? '#191919' : '#fff' };
}
/** Conservative width measurement also supports scripts without word spaces. */
export function imageFontSize(text: string, width: number, height: number, measure: (text: string, size: number) => number): number {
    for (let size = 24; size >= 7; size--) {
        let lines = 1, line = '';
        for (const char of text) {
            if (lines * size * 1.2 > Math.max(0, height - 4)) break;
            if (char === '\n') { lines++; line = ''; continue; }
            if (line && measure(line + char, size) > Math.max(1, width - 6)) { lines++; line = char; }
            else line += char;
        }
        if (lines * size * 1.2 <= Math.max(0, height - 4)) return size;
    }
    return 7;
}
