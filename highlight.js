// Name highlighting ("형광펜"): one colour per world, so readers see at a glance
// which chat each person comes from.

import { h } from './dom.js';

const MIN_NAME_LENGTH = 2; // one-letter names would mark half the text
export const WORLD_COLORS = ['#f6c344', '#7ec8e3', '#f28fad', '#9ad18b'];

export function worldColor(world, index) {
    return world?.color || WORLD_COLORS[index % WORLD_COLORS.length];
}

export function hexToRgba(hex, alpha) {
    const n = parseInt(String(hex).replace('#', ''), 16);
    if (Number.isNaN(n)) return `rgba(246, 195, 68, ${alpha})`;
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Split the model's name map off the episode.
 * @param {string} raw model output
 * @param {string} marker line that starts the map
 * @returns {{ text: string, spellings: Map<string, string[]> }} label → spellings used in the text
 */
export function splitNameMap(raw, marker) {
    const at = raw.lastIndexOf(marker);
    if (at < 0) return { text: raw.trim(), spellings: new Map() };
    const spellings = new Map();
    for (const line of raw.slice(at + marker.length).split('\n')) {
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const label = line.slice(0, eq).replace(/^[\s\-*"“]+|[\s"”]+$/g, '');
        const names = line.slice(eq + 1).split(/[,，、]/).map(s => s.replace(/^[\s"“「]+|[\s"”」]+$/g, '')).filter(Boolean);
        if (label && names.length) spellings.set(label, names);
    }
    return { text: raw.slice(0, at).trim(), spellings };
}

/**
 * One mark per world with every person of that world, using the spellings the model reported
 * (labels as a fallback). A spelling claimed by two worlds is ambiguous and left unmarked.
 * @param {object[]} worlds collected worlds (buildPrompt output, aliases assigned)
 * @param {Map<string, string[]>} [spellings]
 * @returns {{ world: string, color: string, names: string[] }[]}
 */
export function buildMarks(worlds, spellings = new Map()) {
    const marks = worlds.map(w => {
        const labels = [...w.cast.filter(c => !c.isSetting).map(c => c.alias), w.persona.alias];
        const names = labels.flatMap(l => [l, ...(spellings.get(l) || [])]);
        return { world: w.label, color: w.color, names: [...new Set(names)].filter(n => n && n.length >= MIN_NAME_LENGTH) };
    });
    const owners = new Map();
    marks.forEach((m, i) => m.names.forEach(n => owners.set(n, owners.has(n) && owners.get(n) !== i ? -1 : i)));
    return marks
        .map((m, i) => ({ ...m, names: m.names.filter(n => owners.get(n) === i) }))
        .filter(m => m.names.length);
}

function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Wrap name occurrences in <mark> inside already-rendered content.
 * Only text nodes are touched, so markup produced by the formatter stays intact.
 */
export function applyHighlights(root, marks = []) {
    const byName = new Map();
    for (const m of marks) for (const n of m.names || []) if (n.length >= MIN_NAME_LENGTH) byName.set(n, m);
    if (!byName.size) return;
    const pattern = new RegExp([...byName.keys()].sort((a, b) => b.length - a.length).map(escapeRegex).join('|'), 'g');

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: node => (node.parentElement?.closest('code, pre, mark') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (const node of nodes) {
        const text = node.nodeValue;
        // matchAll only; a prior test() would advance lastIndex and skip the first name.
        const matches = [...text.matchAll(pattern)];
        if (!matches.length) continue;
        const parts = [];
        let last = 0;
        for (const match of matches) {
            if (match.index > last) parts.push(text.slice(last, match.index));
            const m = byName.get(match[0]);
            parts.push(h('mark.xo-hl', { title: m.world, style: `--xo-hl: ${hexToRgba(m.color, 0.55)}` }, match[0]));
            last = match.index + match[0].length;
        }
        parts.push(text.slice(last));
        node.replaceWith(...parts);
    }
}
