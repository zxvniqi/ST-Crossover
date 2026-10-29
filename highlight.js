// Name highlighting for generated episodes ("형광펜").

import { h } from './dom.js';
import { pickColors, hexToRgba } from './colors.js';
import { getSettings } from './settings.js';

const MIN_NAME_LENGTH = 2; // one-letter names would mark half the text

/**
 * One mark per person per world. Built after aliases are assigned (buildPrompt).
 * @returns {Promise<Array<{ key: string, label: string, world: string, names: string[], color: string }>>}
 */
export async function buildMarks(worlds) {
    const { colors: overrides = {}, markNames = {} } = getSettings();
    const seen = new Map();
    const people = [];
    worlds.forEach(w => {
        const entries = [
            ...w.cast.filter(c => !c.isSetting).map(c => (c.loreId
                ? { type: 'lore', file: c.loreId, name: c.name, alias: c.alias }
                : { type: 'avatar', file: c.avatar, name: c.name, alias: c.alias })),
            { type: 'persona', file: w.persona.avatar, name: w.persona.name, alias: w.persona.alias },
        ];
        for (const e of entries) {
            const identity = `${e.type}|${e.file || e.name}`;
            const occurrence = seen.get(identity) || 0;
            seen.set(identity, occurrence + 1);
            people.push({ ...e, key: `${w.worldId}|${identity}`, world: w.label, occurrence });
        }
    });

    const colors = await pickColors(people);
    // By default only the alias is marked: a plain name shared by several worlds could belong to any of them.
    // Extra names (e.g. a Korean spelling, people inside a multi-character card) come from the user.
    return people
        .map(p => ({
            key: p.key,
            label: p.alias,
            world: p.world,
            names: [p.alias, ...(markNames[p.key] || [])],
            color: overrides[p.key] || colors.get(p.key),
        }))
        .filter(m => m.label);
}

export function parseNames(text) {
    return [...new Set(String(text).split(/[,，、\n]/).map(s => s.trim()).filter(s => s.length >= MIN_NAME_LENGTH))];
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

/** Color chips; clicking one opens a color picker. onChange(key, hex) persists and re-renders. */
export function legend(marks, onChange) {
    if (!marks?.length) return null;
    return h('div.xo-legend', {}, ...marks.map(m => {
        const input = h('input.xo-color', {
            type: 'color',
            value: m.color,
            title: '색 바꾸기',
            onchange: e => onChange(m.key, e.target.value),
        });
        return h('label.xo-chip', { title: m.world }, input, h('span', { style: `--xo-hl: ${hexToRgba(m.color, 0.55)}` }, m.label));
    }));
}
