// Builds the crossover prompt. Everything the model reads here is English.

import { cleanText, clipHead, clipTail, fillNames } from './util.js';
import { loadChat, worldCharacters, worldDisplayName } from './sources.js';
import { resolvePersona } from './persona.js';
import { findSummaries, pickSummary } from './summaries.js';
import { collectLore } from './lore.js';
import { worldColor } from './highlight.js';

const LENGTH_HINT = {
    short: 'about 600 words',
    medium: 'about 1,200 words',
    long: 'about 2,500 words',
};

/** Push markdown headings inside card/summary text below our own section levels. */
function demote(text) {
    return String(text ?? '').replace(/^#{1,3}(?=\s)/gm, '####');
}

function cardText(char, userName) {
    const d = char.data || {};
    const parts = [
        ['Description', char.description ?? d.description],
        ['Personality', char.personality ?? d.personality],
        ['Scenario', char.scenario ?? d.scenario],
    ];
    return parts
        .map(([k, v]) => (v && String(v).trim() ? `${k}: ${cleanText(fillNames(v, char.name, userName))}` : ''))
        .filter(Boolean)
        .join('\n');
}

/** Newest-first walk that stops when the budget is spent; returns chronological lines. */
function recentScenes(messages, count, budget, userName) {
    const lines = [];
    let used = 0;
    for (let i = messages.length - 1; i >= 0 && lines.length < count; i--) {
        const m = messages[i];
        if (!m || m.is_system || !m.mes) continue; // hidden / system / summarized-and-hidden
        const name = m.is_user ? userName : (m.name || 'Character');
        const line = `${name}: ${cleanText(m.mes)}`;
        if (used + line.length > budget) {
            if (lines.length === 0) lines.push(clipTail(line, budget));
            break;
        }
        lines.push(line);
        used += line.length;
    }
    return lines.reverse().join('\n\n');
}

/**
 * Gather everything for one world. Errors bubble up with the world label so the UI can point at it.
 * @returns {Promise<object>}
 */
export async function collectWorld(world, index, options) {
    const label = world.label?.trim() || `${worldDisplayName(world)} #${index + 1}`;
    try {
        const chat = await loadChat(world);
        const persona = resolvePersona(world, chat);
        const chars = await worldCharacters(world);
        const candidates = await findSummaries(chat);
        const summary = pickSummary(candidates, world.summary);

        // Rough shares of the per-world budget; the recent log takes whatever is left.
        const budget = Math.max(2000, Number(options.charsPerWorld) || 8000);
        const share = ratio => Math.floor(budget * ratio);

        const scanText = chat.messages.slice(-30).map(m => m?.mes || '').join('\n') + '\n' + (summary?.text || '');
        const lore = await collectLore(chars, scanText, world.members, Number(options.loreMembers) || 0);
        const memberBudget = lore.members.length ? Math.floor(share(0.25) / lore.members.length) : 0;
        const settingBudget = lore.setting.length ? Math.floor(share(0.1) / lore.setting.length) : 0;
        const fill = text => cleanText(fillNames(text, chars[0]?.name, persona.name));

        // A card whose people live in its lorebook (multi-character bot) is a setting, not a person.
        const ownersWithMembers = new Set(lore.members.map(m => m.owner));
        const cardBudget = options.includeCard ? Math.floor(share(0.2) / Math.max(1, chars.length)) : 0;
        const cast = [
            ...chars.map(c => ({
                name: c.name,
                avatar: c.avatar,
                isSetting: ownersWithMembers.has(c.avatar),
                card: cardBudget ? clipHead(cardText(c, persona.name), cardBudget) : '',
            })),
            ...lore.members.map(m => ({
                name: m.name,
                loreId: m.id,
                card: clipHead(fill(m.content), memberBudget),
            })),
        ];
        const setting = options.includeLoreSetting
            ? lore.setting.map(s => `#### ${s.name}\n${clipHead(fill(s.content), settingBudget)}`).join('\n\n')
            : '';
        const personaText = clipHead(fill(persona.description), share(0.08));
        const summaryText = summary ? clipTail(summary.text, share(0.25)) : '';
        const used = cast.reduce((n, c) => n + c.card.length, 0) + setting.length + personaText.length + summaryText.length;
        const recent = recentScenes(chat.messages, Number(options.recentMessages) || 20, Math.max(1500, budget - used), persona.name);

        return {
            ok: true,
            index,
            worldId: world.id,
            label,
            color: worldColor(world, index),
            cast,
            setting,
            loreCandidates: lore.candidates,
            persona: { name: persona.name, avatar: persona.avatar || '', via: persona.via, description: personaText },
            summary: summary ? { id: summary.id, label: summary.label, text: summaryText } : null,
            candidates: candidates.map(({ id, label: l, text }) => ({ id, label: l, size: text.length })),
            recent,
            messageCount: chat.messages.length,
        };
    } catch (err) {
        return { ok: false, index, label, error: err?.message || String(err) };
    }
}

/**
 * Same character or persona name in several worlds → give each a world-tagged alias
 * so the model never merges two versions into one person.
 */
function assignAliases(worlds) {
    const count = new Map();
    const bump = name => count.set(name, (count.get(name) || 0) + 1);
    for (const w of worlds) {
        w.cast.forEach(c => bump(c.name));
        bump(w.persona.name);
    }
    const alias = (name, w) => (count.get(name) > 1 ? `${name} (${w.label})` : name);
    for (const w of worlds) {
        w.cast.forEach(c => { c.alias = c.isSetting ? c.name : alias(c.name, w); });
        w.persona.alias = alias(w.persona.name, w);
    }
    // Setting cards are not people, so they never count as "the same person in two worlds".
    for (const w of worlds) w.cast.filter(c => c.isSetting).forEach(c => count.delete(c.name));
    return [...count.entries()].filter(([, n]) => n > 1).map(([name]) => name);
}

function worldBlock(w, n) {
    const overview = w.cast.filter(c => c.isSetting && c.card).map(c => `### ${c.name} (story card)\n${demote(c.card)}`);
    const castLines = w.cast.filter(c => !c.isSetting).map(c => {
        const head = c.alias === c.name ? `### ${c.name}` : `### ${c.alias} — a version of "${c.name}" that exists only in this world`;
        return [head, demote(c.card)].filter(Boolean).join('\n');
    });
    const personaHead = w.persona.alias === w.persona.name
        ? `### ${w.persona.name} (the user's character in this world)`
        : `### ${w.persona.alias} — the user's character in this world (a separate version of "${w.persona.name}")`;

    return [
        `=== WORLD ${n}: "${w.label}" ===`,
        overview.length || w.setting ? `## World setting\n${[...overview, demote(w.setting)].filter(Boolean).join('\n\n')}` : '',
        '## Characters',
        castLines.join('\n\n'),
        personaHead,
        demote(w.persona.description),
        w.summary ? `## Story so far (summary)\n${demote(w.summary.text)}` : '',
        w.recent ? `## Most recent scenes (chat log, oldest first)\n${w.recent}` : '',
        `=== END OF WORLD ${n} ===`,
    ].filter(Boolean).join('\n\n');
}

/**
 * @returns {{ systemPrompt: string, prompt: string, worlds: object[], failed: object[] }}
 */
export function buildPrompt(collected, topic, options) {
    const worlds = collected.filter(w => w.ok);
    const failed = collected.filter(w => !w.ok);
    const shared = assignAliases(worlds);

    const sameNote = shared.length
        ? `Some people exist in more than one world (${shared.map(s => `"${s}"`).join(', ')}). `
          + 'Each world\'s version is a different person with their own history, relationships and memories. '
          + 'Always refer to them by the world-tagged names given below, never merge them, and let their differences show. '
          + 'They may react to meeting another version of themselves.'
        : '';

    const systemPrompt = [
        'You are a skilled fiction writer creating a standalone crossover episode.',
        `The characters below come from ${worlds.length} separate stories ("worlds"). For this episode they meet in one shared scene.`,
        sameNote,
        'Keep every character true to their own world: personality, speech style, relationships and what they know.',
        'Characters only know what happened in their own world unless the episode shows them learning it.',
        'The user\'s characters are written as full characters in the story, consistent with their logs.',
        'This is a side story. Do not continue or change any world\'s canon, and do not resolve its open plotlines.',
        `Write in ${options.language || 'Korean'}. Length: ${LENGTH_HINT[options.length] || LENGTH_HINT.medium}.`,
        'Match the formatting style of the chat logs (for example *narration* in asterisks or "dialogue" in quotes, if the logs use them).',
        'Output only the episode text: an optional short title on the first line, then the prose. No notes or explanations.',
    ].filter(Boolean).join('\n');

    const request = [
        '=== EPISODE REQUEST ===',
        `Topic / what the user wants to see: ${topic.trim() || 'Surprise the reader with a fun, natural reason for these worlds to meet.'}`,
        options.extraInstruction?.trim() ? `Additional instructions: ${options.extraInstruction.trim()}` : '',
    ].filter(Boolean).join('\n');

    const prompt = [...worlds.map((w, i) => worldBlock(w, i + 1)), request].join('\n\n');
    return { systemPrompt, prompt, worlds, failed };
}
