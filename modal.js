// Self-styled modal dialogs (independent of the ST theme). Stackable; Esc / backdrop closes the top one.

import { h, icon } from './dom.js';

const stack = [];

function onKey(e) {
    const top = stack[stack.length - 1];
    if (!top) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        top.close(null);
    }
}

/**
 * @param {{ title?: string, body: Node, actions?: Node[], headerExtra?: Node, width?: string }} cfg
 * @returns {{ close: (value?: any) => void, done: Promise<any>, root: HTMLElement }}
 */
export function openModal({ title = '', body, actions = [], headerExtra = null, width = '480px' }) {
    let resolve;
    const done = new Promise(r => { resolve = r; });
    const card = h('div.rf-card', { role: 'dialog', 'aria-modal': 'true', style: `--rf-width: ${width}` },
        h('div.rf-head', {},
            h('div.rf-title', {}, title),
            headerExtra,
            h('button.rf-icon', { type: 'button', title: '닫기', onclick: () => api.close(null) }, icon('xmark'))),
        h('div.rf-body', {}, body),
        actions.length ? h('div.rf-actions', {}, ...actions) : null);
    const root = h('div.rf-overlay', { onmousedown: e => { if (e.target === root) api.close(null); } }, card);

    const api = {
        root,
        done,
        close(value) {
            const i = stack.indexOf(api);
            if (i < 0) return;
            stack.splice(i, 1);
            root.remove();
            if (!stack.length) document.removeEventListener('keydown', onKey, true);
            resolve(value);
        },
    };
    if (!stack.length) document.addEventListener('keydown', onKey, true);
    stack.push(api);
    document.body.append(root);
    return api;
}

export function button(label, { primary = false, danger = false, onclick, iconName = '', title = '' } = {}) {
    const cls = ['button.rf-btn', primary && 'rf-primary', danger && 'rf-danger'].filter(Boolean).join('.');
    return h(cls, { type: 'button', onclick, title }, iconName ? icon(iconName) : null, label);
}

/** Small text prompt in the same style. Resolves to the trimmed text, or null when cancelled. */
export function askText(title, value = '', placeholder = '') {
    const input = h('input.rf-input', { type: 'text', value, placeholder });
    const m = openModal({
        title,
        width: '360px',
        body: input,
        actions: [
            button('취소', { onclick: () => m.close(null) }),
            button('확인', { primary: true, onclick: () => m.close(input.value.trim() || null) }),
        ],
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') m.close(input.value.trim() || null); });
    setTimeout(() => input.focus(), 0);
    return m.done;
}

export function confirmBox(title, message) {
    const m = openModal({
        title,
        width: '360px',
        body: h('p.rf-text', {}, message),
        actions: [
            button('취소', { onclick: () => m.close(false) }),
            button('확인', { primary: true, onclick: () => m.close(true) }),
        ],
    });
    return m.done;
}
