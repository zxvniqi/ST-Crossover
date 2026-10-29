// Pickers in the style of ST's own lists: bots with round profile pictures, chats like the chat history view.

import { h, icon } from './dom.js';
import { cleanText, formatDate, log } from './util.js';
import { listCharacters, listGroups, listChats, avatarUrl } from './sources.js';
import { openModal } from './modal.js';

function avatarImg(src) {
    return h('div.rf-avatar', {}, src ? h('img', { src, loading: 'lazy', alt: '', onerror: e => e.target.remove() }) : icon('user'));
}

/**
 * Choose a character or a group.
 * @param {'char'|'group'} kind tab to open on
 * @returns {Promise<{ kind: 'char'|'group', id: string } | null>}
 */
export function pickSource(kind = 'char') {
    const search = h('input.rf-input', { type: 'search', placeholder: '이름으로 검색…' });
    const list = h('div.rf-pick-grid');
    const tabs = h('div.rf-seg');

    const draw = () => {
        const q = search.value.trim().toLowerCase();
        const items = kind === 'group'
            ? listGroups().map(g => ({ id: g.id, name: g.name, src: g.avatar }))
            : listCharacters().map(c => ({ id: c.avatar, name: c.label, src: avatarUrl(c.avatar) }));
        const shown = q ? items.filter(x => x.name.toLowerCase().includes(q)) : items;
        list.replaceChildren(...(shown.length
            ? shown.map(x => h('button.rf-pick', { type: 'button', title: x.name, onclick: () => m.close({ kind, id: x.id }) },
                avatarImg(x.src), h('span.rf-pick-name', {}, x.name)))
            : [h('div.rf-empty', {}, kind === 'group' ? '그룹이 없어요' : '찾는 캐릭터가 없어요')]));
        tabs.replaceChildren(...[['char', '캐릭터'], ['group', '그룹']].map(([k, label]) =>
            h('button', { type: 'button', className: k === kind ? 'rf-on' : '', onclick: () => { kind = k; draw(); } }, label)));
    };
    search.addEventListener('input', draw);
    draw();

    const m = openModal({
        title: '봇 고르기',
        width: '640px',
        themeButton: true,
        body: h('div.rf-stack', {}, h('div.rf-row', {}, search, tabs), list),
    });
    setTimeout(() => search.focus(), 0);
    return m.done;
}

/**
 * Choose one chat of a world, shown like ST's chat history (name, date, last message), without its buttons.
 * @returns {Promise<string|null>} chat file id
 */
export function pickChat(world) {
    const list = h('div.rf-chat-list', {}, h('div.rf-empty', {}, '불러오는 중…'));
    const m = openModal({ title: '채팅 고르기', width: '640px', themeButton: true, body: list });

    listChats(world).then(chats => {
        if (!chats.length) {
            list.replaceChildren(h('div.rf-empty', {}, '채팅이 없어요'));
            return;
        }
        list.replaceChildren(...chats.map(c => h('button.rf-chat', {
            type: 'button',
            className: `rf-chat${c.file === world.file ? ' rf-on' : ''}`,
            onclick: () => m.close(c.file),
        },
        h('div.rf-chat-top', {},
            h('span.rf-chat-name', {}, c.label),
            h('span.rf-muted', {}, c.last ? formatDate(c.last) : '')),
        c.preview ? h('div.rf-chat-preview', {}, cleanText(c.preview)) : null,
        h('div.rf-muted', {}, [c.count && `메시지 ${c.count}개`, c.size].filter(Boolean).join(' · ')))));
    }).catch(err => {
        log.error('chat list failed', err);
        list.replaceChildren(h('div.rf-empty.rf-warn', {}, '채팅 목록을 불러오지 못했어요'));
    });
    return m.done;
}
