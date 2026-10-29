// Works out which persona (user character) belongs to a given chat.

import { ctx } from './util.js';

function power() {
    return ctx().powerUserSettings || {};
}

/** [{ avatar, name }] for the persona dropdown. */
export function listPersonas() {
    const names = power().personas || {};
    return Object.entries(names)
        .map(([avatar, name]) => ({ avatar, name: String(name || avatar) }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

function describe(avatar) {
    const p = power();
    const name = p.personas?.[avatar];
    if (!name) return null;
    return { avatar, name: String(name), description: p.persona_descriptions?.[avatar]?.description || '' };
}

/** `force_avatar` looks like "/thumbnail?type=persona&file=foo.png" or "User Avatars/foo.png". */
function avatarFromMessage(message) {
    const raw = message?.force_avatar;
    if (!raw) return '';
    const match = String(raw).match(/[?&]file=([^&]+)/);
    const file = match ? decodeURIComponent(match[1]) : String(raw).split('/').pop();
    return file || '';
}

function connectedToCharacter(charAvatar) {
    if (!charAvatar) return '';
    const descriptions = power().persona_descriptions || {};
    for (const [avatar, info] of Object.entries(descriptions)) {
        if ((info?.connections || []).some(x => x?.type === 'character' && x?.id === charAvatar)) return avatar;
    }
    return '';
}

/**
 * Resolution order: manual choice → persona locked to the chat → avatar on the last user message
 * → persona connected to the character → default persona → user name seen in the chat.
 * @returns {{ name: string, description: string, via: string }}
 */
export function resolvePersona(world, chat) {
    const tryAvatar = (avatar, via) => {
        const found = avatar ? describe(avatar) : null;
        return found ? { ...found, via } : null;
    };

    const lastUser = [...(chat.messages || [])].reverse().find(m => m?.is_user);

    const resolved = tryAvatar(world.persona, '직접 선택')
        || tryAvatar(chat.metadata?.persona, '채팅 고정')
        || tryAvatar(avatarFromMessage(lastUser), '마지막 메시지')
        || tryAvatar(connectedToCharacter(world.kind === 'char' ? world.avatar : ''), '캐릭터 연결')
        || tryAvatar(power().default_persona, '기본 페르소나');
    if (resolved) return resolved;

    // Persona was deleted or never saved: fall back to the name in the log.
    return { name: lastUser?.name || ctx().name1 || 'User', description: '', via: '채팅 속 이름' };
}
