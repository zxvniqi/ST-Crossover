// Persistent settings in extensionSettings. Only small data lives here;
// generated episodes live in the chat they were put into.

import { MODULE_NAME, uid, ctx } from './util.js';

// v2: generation options removed (language, length and style come from the preset).
const SETTINGS_VERSION = 2;

const defaultSettings = Object.freeze({
    version: SETTINGS_VERSION,
    debug: false,
    activeSetId: '',
    sets: [],
    lastTopic: '',
});

/**
 * World slot shape:
 * { id, kind: 'char'|'group', avatar, groupId, file, label, persona: ''|avatarKey, summary: 'auto'|'none'|sourceId,
 *   members: null (auto) | string[] (lorebook entry ids), color: '' (default per slot) | hex }
 */
export function newWorld() {
    return { id: uid(), kind: 'char', avatar: '', groupId: '', file: '', label: '', persona: '', summary: 'auto', members: null, color: '' };
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
    if (s.version < SETTINGS_VERSION) {
        delete s.options;
        s.version = SETTINGS_VERSION;
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
