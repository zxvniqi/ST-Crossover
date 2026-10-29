// Reads characters, groups and chat files without switching the open chat.

import { ctx, log, postJson, stripExt } from './util.js';

const CACHE_TTL_MS = 2 * 60 * 1000;
const CACHE_MAX = 8;
/** key -> { at, data } ; data = { metadata, messages } */
const chatCache = new Map();

export function clearCache() {
    chatCache.clear();
    loreCache.clear();
}

/** [{ avatar, name, label }] — label adds the file name when two cards share a name. */
export function listCharacters() {
    const list = (ctx().characters || []).filter(c => c && c.avatar);
    const seen = new Map();
    list.forEach(c => seen.set(c.name, (seen.get(c.name) || 0) + 1));
    return list
        .map(c => ({ avatar: c.avatar, name: c.name, label: seen.get(c.name) > 1 ? `${c.name} (${c.avatar})` : c.name }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

export function listGroups() {
    return (ctx().groups || [])
        .filter(g => g && g.id)
        .map(g => ({ id: g.id, name: g.name, avatar: groupAvatar(g) }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

export function findCharacter(avatar) {
    const list = ctx().characters || [];
    const index = list.findIndex(c => c?.avatar === avatar);
    return index < 0 ? null : { index, char: list[index] };
}

export function findGroup(groupId) {
    return (ctx().groups || []).find(g => g?.id === groupId) || null;
}

/** Newer ST loads characters lazily; make sure card fields are present. */
export async function getFullCharacter(avatar) {
    const found = findCharacter(avatar);
    if (!found) return null;
    const { unshallowCharacter } = ctx();
    if (found.char.shallow && typeof unshallowCharacter === 'function') {
        try {
            await unshallowCharacter(String(found.index));
        } catch (err) {
            log.warn('unshallowCharacter failed', avatar, err);
        }
    }
    return (ctx().characters || [])[found.index] || found.char;
}

/** Chat files of a world, newest first: [{ file, label, count, last }] */
export async function listChats(world) {
    if (world.kind === 'group') {
        const group = findGroup(world.groupId);
        if (!group) return [];
        // Group chat ids carry no dates; keep ST's order, newest last → reverse.
        return [...(group.chats || [])].reverse().map(id => ({ file: id, label: id, count: null, last: null }));
    }
    if (!world.avatar) return [];
    const data = await postJson('/api/characters/chats', { avatar_url: world.avatar });
    if (!Array.isArray(data)) return [];
    return data
        .filter(x => x && x.file_name)
        .map(x => ({
            file: stripExt(x.file_name),
            label: stripExt(x.file_name),
            count: Number(x.chat_items) || null,
            last: x.last_mes || null,
            preview: typeof x.mes === 'string' ? x.mes : '',
            size: x.file_size || '',
        }))
        .sort((a, b) => (new Date(b.last).getTime() || 0) - (new Date(a.last).getTime() || 0));
}

function isOpenChat(world) {
    const c = ctx();
    const openId = typeof c.getCurrentChatId === 'function' ? c.getCurrentChatId() : c.chatId;
    if (!openId || String(openId) !== String(world.file)) return false;
    if (world.kind === 'group') return String(c.groupId) === String(world.groupId);
    if (c.groupId) return false;
    return c.characterId !== undefined && c.characters?.[c.characterId]?.avatar === world.avatar;
}

/**
 * Load a world's chat. The open chat is read from memory (fresh, includes unsaved edits);
 * others are fetched from the server and cached briefly.
 * @returns {Promise<{metadata: object, messages: object[]}>}
 */
export async function loadChat(world, { force = false } = {}) {
    if (!world.file) throw new Error('채팅이 선택되지 않았어요.');

    if (isOpenChat(world)) {
        const c = ctx();
        log.debug('using open chat', world.file);
        return { metadata: c.chatMetadata || {}, messages: c.chat || [] };
    }

    const key = world.kind === 'group' ? `g|${world.groupId}|${world.file}` : `c|${world.avatar}|${world.file}`;
    const hit = chatCache.get(key);
    if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) {
        log.debug('cache hit', key);
        return hit.data;
    }

    let raw;
    if (world.kind === 'group') {
        raw = await postJson('/api/chats/group/get', { id: world.file });
    } else {
        const found = findCharacter(world.avatar);
        raw = await postJson('/api/chats/get', {
            avatar_url: world.avatar,
            file_name: world.file,
            ch_name: found?.char?.name, // ignored by current ST, kept for older builds
        });
    }
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error(`채팅 파일을 읽지 못했어요: ${world.file}`);
    }

    // First line is the header when it has chat_metadata or no message text.
    const hasHeader = raw[0] && (raw[0].chat_metadata || raw[0].mes === undefined);
    const data = {
        metadata: hasHeader ? (raw[0].chat_metadata || {}) : {},
        messages: hasHeader ? raw.slice(1) : raw,
    };

    chatCache.set(key, { at: Date.now(), data });
    while (chatCache.size > CACHE_MAX) chatCache.delete(chatCache.keys().next().value);
    log.debug('loaded chat', key, data.messages.length, 'messages');
    return data;
}

/** Characters who appear in a world (one for solo chats, active members for groups). */
export async function worldCharacters(world) {
    let avatars = [];
    if (world.kind === 'group') {
        const group = findGroup(world.groupId);
        const disabled = new Set(group?.disabled_members || []);
        avatars = (group?.members || []).filter(a => !disabled.has(a));
    } else if (world.avatar) {
        avatars = [world.avatar];
    }
    const result = [];
    for (const avatar of avatars) {
        const char = await getFullCharacter(avatar);
        if (char) result.push(char);
    }
    return result;
}

const loreCache = new Map(); // bookName -> { at, entries }

/** "[👼]세라프" → "세라프"; falls back to the first key when the comment is empty or long. */
function entryName(comment, keys) {
    const cleaned = String(comment || '').replace(/\[[^\]]*\]|\([^)]*\)/g, '').trim();
    if (cleaned && cleaned.length <= 20) return cleaned;
    return keys.find(k => k.length >= 2) || cleaned.slice(0, 20) || '';
}

function normalizeEntry(e, uid) {
    const keys = (e.key || e.keys || []).map(k => String(k).trim()).filter(Boolean);
    return {
        uid: String(uid),
        name: entryName(e.comment ?? e.name, keys),
        keys,
        content: String(e.content || ''),
        constant: !!e.constant,
    };
}

/**
 * Enabled entries of a character's lorebook (linked world first, embedded book as fallback).
 * Multi-character cards keep their cast here.
 * @returns {Promise<{ book: string, entries: {uid, name, keys, content, constant}[] }>}
 */
export async function getLoreEntries(char) {
    const linked = char?.data?.extensions?.world;
    const { loadWorldInfo } = ctx();
    if (linked && typeof loadWorldInfo === 'function') {
        const hit = loreCache.get(linked);
        if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { book: linked, entries: hit.entries };
        try {
            const data = await loadWorldInfo(linked);
            const entries = Object.values(data?.entries || {})
                .filter(e => e && !e.disable && e.content)
                .map(e => normalizeEntry(e, e.uid));
            loreCache.set(linked, { at: Date.now(), entries });
            return { book: linked, entries };
        } catch (err) {
            log.warn('lorebook load failed', linked, err);
        }
    }
    const embedded = char?.data?.character_book?.entries || [];
    return {
        book: `embedded:${char?.avatar}`,
        entries: embedded.filter(e => e && e.enabled !== false && e.content).map((e, i) => normalizeEntry(e, e.id ?? i)),
    };
}

/** Thumbnail URL for a character avatar (small, cached by ST). */
export function avatarUrl(avatar) {
    if (!avatar) return '';
    const { getThumbnailUrl } = ctx();
    return typeof getThumbnailUrl === 'function' ? getThumbnailUrl('avatar', avatar) : `/thumbnail?type=avatar&file=${encodeURIComponent(avatar)}`;
}

/** Picture for a world: the character, or the group's own avatar / first member. */
export function worldAvatar(world) {
    if (world.kind !== 'group') return avatarUrl(world.avatar);
    const group = findGroup(world.groupId);
    return group?.avatar_url || avatarUrl(group?.members?.[0]);
}

export function groupAvatar(group) {
    return group?.avatar_url || avatarUrl(group?.members?.[0]);
}

export function worldDisplayName(world) {
    if (world.kind === 'group') return findGroup(world.groupId)?.name || '(삭제된 그룹)';
    return findCharacter(world.avatar)?.char?.name || '(삭제된 캐릭터)';
}
