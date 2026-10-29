// Self-styled windows (independent of the ST theme), built on <dialog> so they sit in the browser's
// top layer: centred on every screen, above ST's own popups, unaffected by theme transforms.

import { h, icon } from './dom.js';
import { getSettings, save } from './settings.js';

const TAP_GUARD_MS = 450;

/** 'light' | 'dark' — the user's choice for these windows, defaulting to the device setting. */
function currentTheme() {
    const saved = getSettings().uiTheme;
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(dialog) {
    dialog.dataset.theme = currentTheme();
}

/** Header button that flips light/dark for every open window and remembers the choice. */
function themeToggle() {
    const btn = h('button.rf-icon', { type: 'button', title: '라이트/다크 전환' });
    const paint = () => btn.replaceChildren(icon(currentTheme() === 'dark' ? 'sun' : 'moon'));
    btn.addEventListener('click', () => {
        getSettings().uiTheme = currentTheme() === 'dark' ? 'light' : 'dark';
        save();
        document.querySelectorAll('dialog.rf-dialog').forEach(applyTheme);
        paint();
    });
    paint();
    return btn;
}

/**
 * @param {{ title?: string, body: Node, actions?: Node[], headerExtra?: Node, width?: string, themeButton?: boolean }} cfg
 * @returns {{ close: (value?: any) => void, done: Promise<any>, root: HTMLDialogElement }}
 */
export function openModal({ title = '', body, actions = [], headerExtra = null, width = '480px', themeButton = false }) {
    let resolve;
    const done = new Promise(r => { resolve = r; });
    const dialog = h('dialog.rf-dialog', { 'aria-label': title },
        h('div.rf-card', { style: `--rf-width: ${width}` },
            h('div.rf-head', {},
                h('div.rf-title', {}, title),
                headerExtra,
                themeButton ? themeToggle() : null,
                h('button.rf-icon', { type: 'button', title: '닫기', onclick: () => api.close(null) }, icon('xmark'))),
            h('div.rf-body', {}, body),
            actions.length ? h('div.rf-actions', {}, ...actions) : null));
    applyTheme(dialog);

    let closed = false;
    const api = {
        root: dialog,
        done,
        close(value) {
            if (closed) return;
            closed = true;
            dialog.close();
            dialog.remove();
            resolve(value);
        },
    };
    // A window that opens right after a tap (bot → chat picker) must not take that same tap.
    const readyAt = Date.now() + TAP_GUARD_MS;
    dialog.addEventListener('cancel', e => { e.preventDefault(); api.close(null); }); // Esc
    dialog.addEventListener('mousedown', e => { if (e.target === dialog && Date.now() >= readyAt) api.close(null); }); // backdrop
    dialog.addEventListener('click', e => {
        if (Date.now() < readyAt) {
            e.stopPropagation();
            e.preventDefault();
        }
    }, true);
    document.body.append(dialog);
    dialog.showModal();
    return api;
}

export function button(label, { primary = false, onclick, iconName = '', title = '' } = {}) {
    return h(primary ? 'button.rf-btn.rf-primary' : 'button.rf-btn', { type: 'button', onclick, title }, iconName ? icon(iconName) : null, label);
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
