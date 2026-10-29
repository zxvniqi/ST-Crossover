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
 * One mark per world with every person of that world. Built after aliases are assigned,
 * so a name shared by two worlds is only marked through its world-tagged alias.
 * @param {object[]} worlds collected worlds (buildPrompt output)
 * @returns {{ world: string, color: string, names: string[] }[]}
 */
export function buildMarks(worlds) {
    return worlds.map(w => ({
        world: w.label,
        color: w.color,
        names: [...new Set([
            ...w.cast.filter(c => !c.isSetting).map(c => c.alias),
            w.persona.alias,
        ])].filter(n => n && n.length >= MIN_NAME_LENGTH),
    })).filter(m => m.names.length);
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
        pattern.lastIndex = 0;
        if (!pattern.test(text)) continue;
        const parts = [];
        let last = 0;
        for (const match of text.matchAll(pattern)) {
            if (match.index > last) parts.push(text.slice(last, match.index));
            const m = byName.get(match[0]);
            parts.push(h('mark.xo-hl', { title: m.world, style: `--xo-hl: ${hexToRgba(m.color, 0.55)}` }, match[0]));
            last = match.index + match[0].length;
        }
        parts.push(text.slice(last));
        node.replaceWith(...parts);
    }
}
