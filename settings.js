// Persistent settings in extensionSettings. Only small data lives here;
// generated episodes go to the archive (localforage).

import { MODULE_NAME, uid, ctx } from './util.js';

const SETTINGS_VERSION = 1;

export const defaultOptions = Object.freeze({
    recentMessages: 20,     // recent messages per world
    charsPerWorld: 8000,    // rough character budget per world
    includeCard: true,      // character description/personality/scenario
    loreMembers: 4,         // multi-character cards: lorebook people picked automatically per world
    includeLoreSetting: true, // always-on lorebook entries as world setting
    length: 'medium',       // short | medium | long
    language: 'Korean',     // output language (sent to the model)
    extraInstruction: '',   // free-form, sent as-is
});

const defaultSettings = Object.freeze({
    version: SETTINGS_VERSION,
    debug: false,
    activeSetId: '',
    sets: [],
    options: defaultOptions,
    lastTopic: '',
    colors: {},             // highlighter overrides: markKey -> hex
    markNames: {},          // extra names to highlight: markKey -> string[]
});

/**
 * World slot shape:
 * { id, kind: 'char'|'group', avatar, groupId, file, label, persona: ''|avatarKey, summary: 'auto'|'none'|sourceId,
 *   members: null (auto) | string[] (lorebook entry ids) }
 */
export function newWorld() {
    return { id: uid(), kind: 'char', avatar: '', groupId: '', file: '', label: '', persona: '', summary: 'auto', members: null };
}

export function newSet(name) {
    return { id: uid(), name: name || '새 세트', worlds: [newWorld(), newWorld()] };
}

export function getSettings() {
    const { extensionSettings } = ctx();
    let s = extensionSettings[MODULE_NAME];
    if (!s || typeof s !== 'object') {
        s = extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (!Object.hasOwn(s, key)) s[key] = structuredClone(value);
    }
    for (const [key, value] of Object.entries(defaultOptions)) {
        if (!Object.hasOwn(s.options, key)) s.options[key] = value;
    }
    if (!Array.isArray(s.sets)) s.sets = [];
    if (s.sets.length === 0) s.sets.push(newSet('기본 세트'));
    if (!s.sets.some(x => x.id === s.activeSetId)) s.activeSetId = s.sets[0].id;
    return s;
}

export function getActiveSet() {
    const s = getSettings();
    return s.sets.find(x => x.id === s.activeSetId);
}

export function save() {
    ctx().saveSettingsDebounced();
}
