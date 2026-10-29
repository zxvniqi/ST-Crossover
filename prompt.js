// Builds the crossover prompt. Everything the model reads here is English.

import { ctx, cleanText, clipHead, clipTail, fillNames } from './util.js';
import { loadChat, worldCharacters, worldDisplayName } from './sources.js';
import { resolvePersona } from './persona.js';
import { findSummaries, pickSummary } from './summaries.js';
import { collectLore } from './lore.js';
import { worldColor } from './highlight.js';

/** The model appends a name map after this line; it is parsed for highlights and removed from the episode. */
export const NAME_MAP_MARKER = '[[NAMES]]';

// Per-item caps (characters) so one huge card or summary cannot crowd out the others,
// kept modest because the user's whole preset is sent along. No cap on how many people take part.
const LIMIT = Object.freeze({
    card: 2000,
    member: 1200,
    settingEntry: 800,
    persona: 1000,
    summary: 3000,
    recentChars: 3500,
    recentMessages: 12,
});

const LOCALE_LANGUAGE = { ko: 'Korean', ja: 'Japanese', zh: 'Chinese', en: 'English', ru: 'Russian', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', vi: 'Vietnamese', th: 'Thai', id: 'Indonesian' };

/**
 * The language of the ST interface, i.e. what a translator extension most likely translates into.
 * Asking for that spelling too keeps highlights working after translation.
 */
function readerLanguage() {
    const { getCurrentLocale } = ctx();
    const code = String(typeof getCurrentLocale === 'function' ? getCurrentLocale() : navigator.language || '').slice(0, 2).toLowerCase();
    return LOCALE_LANGUAGE[code] || '';
}

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
export async function collectWorld(world, index) {
    const label = world.label?.trim() || `${worldDisplayName(world)} #${index + 1}`;
    try {
        const chat = await loadChat(world);
        const persona = resolvePersona(world, chat);
        const chars = await worldCharacters(world);
        const candidates = await findSummaries(chat);
        const summary = pickSummary(candidates, world.summary);

        const scanText = chat.messages.slice(-30).map(m => m?.mes || '').join('\n') + '\n' + (summary?.text || '');
        const lore = await collectLore(chars, scanText, world.members);
        const fill = text => cleanText(fillNames(text, chars[0]?.name, persona.name));

        // A card whose people live in its lorebook (multi-character bot) is a setting, not a person.
        const ownersWithMembers = new Set(lore.members.map(m => m.owner));
        const cast = [
            ...chars.map(c => ({
                name: c.name,
                avatar: c.avatar,
                isSetting: ownersWithMembers.has(c.avatar),
                card: clipHead(cardText(c, persona.name), LIMIT.card),
            })),
            ...lore.members.map(m => ({
                name: m.name,
                loreId: m.id,
                card: clipHead(fill(m.content), LIMIT.member),
            })),
        ];
        const setting = lore.setting.map(s => `#### ${s.name}\n${clipHead(fill(s.content), LIMIT.settingEntry)}`).join('\n\n');
        const personaText = clipHead(fill(persona.description), LIMIT.persona);
        const summaryText = summary ? clipTail(summary.text, LIMIT.summary) : '';
        const recent = recentScenes(chat.messages, LIMIT.recentMessages, LIMIT.recentChars, persona.name);

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
 * Crossover-specific text only. Language, length and style come from the user's preset (preset.js).
 * @returns {{ parts: { system: string, material: string, request: string }, worlds: object[], failed: object[] }}
 */
export function buildPrompt(collected, topic, story) {
    const worlds = collected.filter(w => w.ok);
    const failed = collected.filter(w => !w.ok);
    const shared = assignAliases(worlds);

    const sameNote = shared.length
        ? `Some people exist in more than one world (${shared.map(s => `"${s}"`).join(', ')}). `
          + 'Each world\'s version is a different person with their own history, relationships and memories. '
          + 'Never merge them, and let their differences show through actions and speech. They may react to meeting another version of themselves.'
        : '';
    const reader = readerLanguage();
    const n = worlds.length;

    const system = [
        '[Crossover side story] Temporarily pause the ongoing RP and write a self-contained crossover side story.',
        `The characters below come from ${n} separate stories ("worlds"). In this side story their worlds collide and they meet.`,
        sameNote,
        'Keep every character true to their own world: personality, speech style, relationships and what they know.',
        'Characters only know what happened in their own world unless the episode shows them learning it.',
        'The user\'s characters are written as full characters in the story, consistent with their logs.',
        'This is a side story. Do not continue or change any world\'s canon, and do not resolve its open plotlines.',
        'Headings below are labels for you, possibly in another language. In the prose, write every name the way it is naturally written in the language you write in.',
        'Never write world names, labels or tags in brackets next to a name, and do not use 「」 brackets.',
    ].filter(Boolean).join('\n');

    const request = [
        '=== EPISODE REQUEST ===',
        `What the user wants to see: ${topic.trim() || 'Surprise the reader with a fun, natural reason for these worlds to meet.'}`,
        '',
        'Structure:',
        story.episodesMin === story.episodesMax
            ? `- Write the story as narrative prose, structured into ${story.episodesMin} episodes.`
            : `- Write the story as narrative prose, structured into ${story.episodesMin} to ${story.episodesMax} episodes.`,
        `- Each episode must be at least ${story.wordsPerEpisode} words.`,
        '- The first episode must depict how the worlds collide and the people first meet.',
        '- The later episodes may take place over hours, days or longer. Let the situation and the relationships between the worlds develop between episodes.',
        '- Vary the situations, locations, conflicts and moods across episodes: daily life, comedy, trouble, tension, affection, disagreement and change where appropriate.',
        '- Each episode must consist of multiple paragraphs. Something must happen and develop through actions, decisions, dialogue, complications and consequences; never a static explanation of the setting.',
        '',
        'Format:',
        '- Begin with an original overall title in exactly this format: # Story Title',
        '- Begin every episode exactly in this format: ###[ Episode 01 / Thematic Title💛 ] (change the number, the thematic title and the fitting emoji for each episode).',
        '- Separate every episode with a horizontal rule (---).',
        '- Output only the story. No explanations, notes, summaries, content warnings or code blocks.',
        '',
        'Name tags (required, the reader never sees them):',
        `- Wrap EVERY occurrence of a person's name in <wN></wN>, where N (1 to ${n}) is the number of the world that person comes from.`,
        '- This includes names inside dialogue, short forms and nicknames, and possessive or particle forms (tag only the name part).',
        '- When two versions of the same person are present, each occurrence gets the number of the version it refers to.',
        '- Tag people only. Never tag places, organisations, titles, species, items or other words, and never tag inside the story title or episode headings.',
        '- Example: <w1>Alice</w1> handed the key to <w2>Alice</w2>. "Thanks, <w1>Al</w1>," said <w2>Alice</w2>.',
        reader
            ? `After the episode, add a line "${NAME_MAP_MARKER}" and then one line per tagged person: "wN: <name as you wrote it> = <how that name is usually written in ${reader}>".`
            : '',
    ].filter(Boolean).join('\n');

    const material = worlds.map((w, i) => worldBlock(w, i + 1)).join('\n\n');
    return { parts: { system, material, request }, worlds, failed };
}
