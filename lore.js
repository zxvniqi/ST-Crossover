// Lorebook cast for multi-character cards (and NPCs of normal cards).
// Picks the entries that matter for this chat instead of sending the whole book.

import { getLoreEntries } from './sources.js';

const MIN_KEY_LENGTH = 2; // one-letter keys match almost any Korean sentence

function countHits(text, entry) {
    let score = 0;
    const words = new Set([entry.name, ...entry.keys].filter(k => k && k.length >= MIN_KEY_LENGTH));
    for (const word of words) {
        if (text.includes(word)) score += word === entry.name ? 2 : 1;
    }
    return score;
}

/**
 * @param {object[]} chars full character objects of the world
 * @param {string} scanText recent chat + summary, used to rank entries
 * @param {string[]|null} chosen world.members: null = automatic (everyone mentioned), otherwise entry ids
 * @returns {Promise<{ setting: {name: string, content: string}[], members: object[], candidates: {id, name, score, picked}[] }>}
 */
export async function collectLore(chars, scanText, chosen) {
    const setting = [];
    const pool = [];
    for (const char of chars) {
        const { entries } = await getLoreEntries(char);
        for (const e of entries) {
            if (e.constant) setting.push({ name: e.name, content: e.content });
            else pool.push({ ...e, id: `${char.avatar}|${e.uid}`, owner: char.avatar, score: countHits(scanText, e) });
        }
    }

    let picked;
    if (Array.isArray(chosen)) {
        const ids = new Set(chosen);
        picked = pool.filter(e => ids.has(e.id));
    } else {
        picked = pool.filter(e => e.score > 0).sort((a, b) => b.score - a.score);
    }
    const pickedIds = new Set(picked.map(e => e.id));

    return {
        setting,
        members: picked,
        candidates: pool
            .map(e => ({ id: e.id, name: e.name, score: e.score, picked: pickedIds.has(e.id) }))
            .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
    };
}
