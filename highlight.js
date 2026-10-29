// Name highlighting ("형광펜"): one colour per world.
// The model wraps every character name in <wN>…</wN> while writing, so only real names are marked
// (no guessing from lorebooks or summaries). The tags are removed before the message is saved;
// what is kept is { name → world }, plus the per-occurrence order when one spelling is used in two worlds.

import { h } from './dom.js';

const MIN_NAME_LENGTH = 2; // a one-letter name would also match inside other words
export const WORLD_COLORS = ['#f6c344', '#7ec8e3', '#f28fad'];
const TAG = /<w(\d+)>([\s\S]*?)<\/w\1>/gi;
const STRAY_TAG = /<\/?w\d+>/gi;

export function worldColor(world, index) {
    return world?.color || WORLD_COLORS[index % WORLD_COLORS.length];
}

export function hexToRgba(hex, alpha) {
    const n = parseInt(String(hex).replace('#', ''), 16);
    if (Number.isNaN(n)) return `rgba(246, 195, 68, ${alpha})`;
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Turn the model output into clean text + highlight data.
 * @param {string} raw model output with <wN> tags and an optional name map after `marker`
 * @param {{ label: string, color: string }[]} worlds in prompt order (world N = worlds[N-1])
 * @returns {{ text: string, hl: { worlds: {label: string, color: string}[], names: Record<string, number|number[]> } }}
 */
export function parseEpisode(raw, worlds, marker) {
    let body = String(raw ?? '');
    const extra = new Map(); // reader-language spelling → world index
    const at = body.lastIndexOf(marker);
    if (at >= 0) {
        for (const line of body.slice(at + marker.length).split('\n')) {
            const m = line.match(/^\s*[-*]?\s*w?(\d+)\s*[:：]\s*(.+?)\s*=\s*(.+?)\s*$/i);
            if (!m) continue;
            const idx = Number(m[1]) - 1;
            if (idx < 0 || idx >= worlds.length) continue;
            for (const spelling of m[3].split(/[,，、]/).map(s => s.trim()).filter(Boolean)) {
                extra.set(spelling, extra.has(spelling) && extra.get(spelling) !== idx ? -1 : idx);
            }
        }
        body = body.slice(0, at);
    }

    // Strip the tags while remembering where each tagged name ends up in the clean text.
    let text = '';
    let last = 0;
    const tagged = []; // { pos, name, idx }
    for (const m of body.matchAll(TAG)) {
        text += body.slice(last, m.index).replace(STRAY_TAG, '');
        const idx = Number(m[1]) - 1;
        const name = m[2].trim();
        if (name && idx >= 0 && idx < worlds.length) tagged.push({ pos: text.length + m[2].indexOf(name), name, idx });
        text += m[2];
        last = m.index + m[0].length;
    }
    text += body.slice(last).replace(STRAY_TAG, '');
    const lead = text.length - text.trimStart().length;
    text = text.trim();
    tagged.forEach(t => { t.pos -= lead; });

    const worldsOf = new Map(); // name → set of world indexes it was tagged with
    tagged.forEach(t => (worldsOf.get(t.name) || worldsOf.set(t.name, new Set()).get(t.name)).add(t.idx));

    const names = {};
    for (const [name, set] of worldsOf) if (set.size === 1) names[name] = [...set][0];

    // A spelling used by two worlds is coloured per occurrence. Occurrences the model forgot to tag
    // take the world of the nearest tagged one, so a few missing tags no longer blank the whole name.
    const ambiguous = [...worldsOf].filter(([, set]) => set.size > 1).map(([name]) => name);
    if (ambiguous.length) {
        const all = [...worldsOf.keys()].sort((a, b) => b.length - a.length); // longest first, like the renderer
        const scan = new RegExp(all.map(escapeRegex).join('|'), 'g');
        const at = new Map(tagged.map(t => [`${t.pos}|${t.name}`, t.idx]));
        const seqs = new Map(ambiguous.map(n => [n, []]));
        for (const m of text.matchAll(scan)) {
            if (seqs.has(m[0])) seqs.get(m[0]).push(at.has(`${m.index}|${m[0]}`) ? at.get(`${m.index}|${m[0]}`) : null);
        }
        for (const [name, seq] of seqs) {
            let known = seq.find(v => v !== null);
            names[name] = seq.map(v => (v === null ? known : (known = v)));
        }
    }
    for (const [spelling, idx] of extra) {
        if (idx >= 0 && !Object.hasOwn(names, spelling)) names[spelling] = idx;
    }
    return { text, hl: { worlds: worlds.map(w => ({ label: w.label, color: w.color })), names } };
}

/** Messages saved by 0.2.x stored `marks: [{ world, color, names }]`; read them the new way. */
export function normalizeHl(data) {
    if (data?.hl) return data.hl;
    if (!Array.isArray(data?.marks)) return null;
    const names = {};
    data.marks.forEach((m, i) => (m.names || []).forEach(n => { names[n] = i; }));
    return { worlds: data.marks.map(m => ({ label: m.world, color: m.color })), names };
}

function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Characters translators and models swap freely: full/half-width brackets and middle dots.
const LOOSE_CHARS = { '(': '[(（]', '（': '[(（]', ')': '[)）]', '）': '[)）]', '・': '[・·･]', '·': '[・·･]', '･': '[・·･]' };

/** Spacing and bracket width are ignored, so a translator's "아델 스타인" still matches "아델스타인". */
function loosePattern(name) {
    return [...name].filter(ch => !/\s/.test(ch)).map(ch => LOOSE_CHARS[ch] || escapeRegex(ch)).join('\\s*');
}

/**
 * Wrap the tagged names in <mark> inside already-rendered content (text nodes only).
 * A spelling used by two worlds is coloured per occurrence when the count still matches
 * the original (untranslated) text, and left plain otherwise.
 */
export function applyHighlights(root, hl) {
    if (!hl?.names) return;
    const entries = Object.entries(hl.names)
        .filter(([name]) => name.length >= MIN_NAME_LENGTH)
        .sort((a, b) => b[0].length - a[0].length);
    if (!entries.length) return;
    const pattern = new RegExp(entries.map(([name]) => `(${loosePattern(name)})`).join('|'), 'g');

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: node => (node.parentElement?.closest('code, pre, mark') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const found = []; // [{ node, matches: [{ match, entry }] }]
    const counts = new Map();
    while (walker.nextNode()) {
        const node = walker.currentNode;
        const matches = [...node.nodeValue.matchAll(pattern)].map(match => {
            const entry = entries[match.slice(1).findIndex(g => g !== undefined)];
            counts.set(entry[0], (counts.get(entry[0]) || 0) + 1);
            return { match, entry };
        });
        if (matches.length) found.push({ node, matches });
    }

    const used = new Map();
    const worldOf = ([name, value]) => {
        if (!Array.isArray(value)) return value;
        if (counts.get(name) !== value.length) return -1; // text changed (translation): can't tell which world
        const k = used.get(name) || 0;
        used.set(name, k + 1);
        return value[k];
    };

    for (const { node, matches } of found) {
        const text = node.nodeValue;
        const parts = [];
        let last = 0;
        for (const { match, entry } of matches) {
            const idx = worldOf(entry);
            const world = hl.worlds?.[idx];
            if (!world) continue;
            if (match.index > last) parts.push(text.slice(last, match.index));
            parts.push(h('mark.xo-hl', { title: world.label, style: `--xo-hl: ${hexToRgba(world.color, 0.55)}` }, match[0]));
            last = match.index + match[0].length;
        }
        if (!parts.length) continue;
        parts.push(text.slice(last));
        node.replaceWith(...parts);
    }
}
