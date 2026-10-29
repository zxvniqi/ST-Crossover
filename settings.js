// Persistent settings in extensionSettings. Only small data lives here;
// generated episodes live in the chat they were put into.
//
// The settings window edits a working copy (`draft`). Saved sets are snapshots the user stores
// with the Save button and loads from the list; editing never changes a saved set by itself.

import { MODULE_NAME, uid, ctx } from './util.js';

// v2: generation options removed. v3: working copy + explicitly saved sets.
const SETTINGS_VERSION = 3;
export const MAX_WORLDS = 3;

const defaultSettings = Object.freeze({
    version: SETTINGS_VERSION,
    debug: false,
    draft: { worlds: [] },
    sets: [],        // [{ id, name, worlds }]
    activeSetId: '', // the saved set the draft was loaded from ('' = unsaved)
    lastTopic: '',
    uiTheme: 'auto', // settings window: 'auto' | 'light' | 'dark'
});

/**
 * World slot shape:
 * { id, kind: 'char'|'group', avatar, groupId, file, label, persona: ''|avatarKey, summary: 'auto'|'none'|sourceId,
 *   members: null (auto) | string[] (lorebook entry ids), color: '' (default per slot) | hex }
 */
export function newWorld() {
    return { id: uid(), kind: 'char', avatar: '', groupId: '', file: '', label: '', persona: '', summary: 'auto', members: null, color: '' };
}

function cloneWorlds(worlds) {
    return structuredClone(worlds || []).slice(0, MAX_WORLDS).map(w => ({ ...newWorld(), ...w, id: uid() }));
}

export function getSettings() {
    const { extensionSettings } = ctx();
    let s = extensionSettings[MODULE_NAME];
    if (!s || typeof s !== 'object') {
        s = extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    if ((s.version || 1) < SETTINGS_VERSION) {
        delete s.options;
        const active = (s.sets || []).find(x => x.id === s.activeSetId);
        s.draft = { worlds: cloneWorlds(active?.worlds) };
        s.sets = (s.sets || []).filter(x => !/^__/.test(x.name)); // drop test sets
        s.version = SETTINGS_VERSION;
    }
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (!Object.hasOwn(s, key)) s[key] = structuredClone(value);
    }
    if (!Array.isArray(s.sets)) s.sets = [];
    if (!s.draft || !Array.isArray(s.draft.worlds)) s.draft = { worlds: [] };
    while (s.draft.worlds.length < 2) s.draft.worlds.push(newWorld());
    if (s.draft.worlds.length > MAX_WORLDS) s.draft.worlds.length = MAX_WORLDS;
    if (!s.sets.some(x => x.id === s.activeSetId)) s.activeSetId = '';
    return s;
}

export function getDraft() {
    return getSettings().draft;
}

/** Overwrite the selected set, or store a new one when `name` is given. Returns the set. */
export function saveSet(name) {
    const s = getSettings();
    let set = name ? null : s.sets.find(x => x.id === s.activeSetId);
    if (!set) {
        set = { id: uid(), name: name || `세트 ${s.sets.length + 1}`, worlds: [] };
        s.sets.push(set);
        s.activeSetId = set.id;
    }
    set.worlds = structuredClone(s.draft.worlds);
    save();
    return set;
}

export function loadSet(id) {
    const s = getSettings();
    const set = s.sets.find(x => x.id === id);
    if (!set) return;
    s.draft = { worlds: cloneWorlds(set.worlds) };
    s.activeSetId = id;
    save();
}

export function deleteSet(id) {
    const s = getSettings();
    s.sets = s.sets.filter(x => x.id !== id);
    if (s.activeSetId === id) s.activeSetId = '';
    save();
}

export function save() {
    ctx().saveSettingsDebounced();
}
