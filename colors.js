// Highlighter colors: picked from each character's / persona's avatar, cached per image.

import { ctx, log } from './util.js';

const cache = new Map();

function nameHue(name) {
    let hash = 0;
    for (const ch of String(name)) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
    return hash % 360;
}

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l * 100];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s * 100, l * 100];
}

function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
    return '#' + [f(0), f(8), f(4)].map(x => x.toString(16).padStart(2, '0')).join('');
}

/** Saturation-weighted average hue of a small thumbnail → bright highlighter tone. */
function sampleImage(url) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            try {
                const size = 24;
                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = size;
                const g = canvas.getContext('2d', { willReadFrequently: true });
                g.drawImage(img, 0, 0, size, size);
                const px = g.getImageData(0, 0, size, size).data;
                let x = 0, y = 0, weight = 0;
                for (let i = 0; i < px.length; i += 4) {
                    if (px[i + 3] < 128) continue;
                    const [h, s, l] = rgbToHsl(px[i], px[i + 1], px[i + 2]);
                    const w = (s / 100) * (1 - Math.abs(l - 50) / 50); // vivid mid-tones count most
                    x += Math.cos(h * Math.PI / 180) * w;
                    y += Math.sin(h * Math.PI / 180) * w;
                    weight += w;
                }
                if (weight < 1) return resolve(null); // greyscale image
                const hue = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
                resolve(hue);
            } catch {
                resolve(null);
            }
        };
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

/**
 * @param {'avatar'|'persona'} type
 * @returns {Promise<number|null>} hue in degrees, or null when the image has no clear color
 */
async function avatarHue(type, file) {
    if (!file) return null;
    const key = `${type}|${file}`;
    if (!cache.has(key)) {
        const { getThumbnailUrl } = ctx();
        const url = typeof getThumbnailUrl === 'function' ? getThumbnailUrl(type, file) : `/thumbnail?type=${type}&file=${encodeURIComponent(file)}`;
        cache.set(key, sampleImage(url).catch(err => { log.debug('color sample failed', file, err); return null; }));
    }
    return cache.get(key);
}

/**
 * Colors for every highlighted name. The same person appearing in several worlds keeps its hue
 * family but shifts per world, so the versions stay distinguishable.
 * @param {{ key: string, type: 'avatar'|'persona'|'lore', file: string, name: string, occurrence: number }[]} people
 * @returns {Promise<Map<string, string>>} key → hex
 */
export async function pickColors(people) {
    const out = new Map();
    await Promise.all(people.map(async p => {
        // No avatar (lorebook members) or a greyscale one → a stable hue derived from the name.
        const hue = (p.type === 'lore' ? null : await avatarHue(p.type, p.file)) ?? nameHue(p.name);
        const shift = [0, 35, -35, 70][p.occurrence % 4];
        out.set(p.key, hslToHex((hue + shift + 360) % 360, 85, p.occurrence % 2 ? 72 : 62));
    }));
    return out;
}

export function hexToRgba(hex, alpha) {
    const n = parseInt(String(hex).replace('#', ''), 16);
    if (Number.isNaN(n)) return `rgba(246, 195, 68, ${alpha})`;
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
