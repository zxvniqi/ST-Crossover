// Puts an episode into the open chat as a hidden message: it renders like any message
// (translators, theme, regex all apply) but is left out of the prompt, so canon stays clean.

import { ctx, log, EXT_NAME } from './util.js';
import { applyHighlights, normalizeHl } from './highlight.js';

const EXTRA_KEY = 'crossover_episode';

function openChatId() {
    const c = ctx();
    return typeof c.getCurrentChatId === 'function' ? c.getCurrentChatId() : c.chatId;
}

/** Fail before spending a generation when there is nowhere to put the result. */
export function assertChatOpen() {
    if (!openChatId() || !Array.isArray(ctx().chat)) throw new Error('결과를 넣을 채팅을 먼저 열어 주세요.');
}

/**
 * @param {{ text: string, hl: object, topic: string }} episode hl = highlight data from parseEpisode
 * @returns {Promise<number>} index of the new message
 */
export async function insertIntoChat(episode) {
    assertChatOpen();
    const c = ctx();
    const message = {
        name: c.name2 || EXT_NAME,
        is_user: false,
        is_system: true, // hidden: shown in the chat, never sent to the model
        send_date: typeof c.humanizedDateTime === 'function' ? c.humanizedDateTime() : new Date().toISOString(),
        mes: episode.text,
        extra: {
            [EXTRA_KEY]: { topic: episode.topic, hl: episode.hl },
        },
    };
    c.chat.push(message);
    c.addOneMessage(message);
    await c.saveChat();
    const index = c.chat.length - 1;
    highlightChat();
    document.querySelector(`#chat .mes[mesid="${index}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return index;
}

let pending = 0;
let observer = null;

function isCrossoverNode(node) {
    const mes = (node instanceof Element ? node : node?.parentElement)?.closest?.('#chat .mes');
    if (!mes) return false;
    return !!ctx().chat?.[Number(mes.getAttribute('mesid'))]?.extra?.[EXTRA_KEY];
}

/**
 * Translators and other extensions redraw message text without emitting events
 * (updateMessageBlock). Watch the chat and repaint only when a crossover message changed.
 */
export function watchChat() {
    const chatEl = document.getElementById('chat');
    if (!chatEl || observer) return;
    observer = new MutationObserver(mutations => {
        if (mutations.some(m => isCrossoverNode(m.target))) highlightChat();
    });
    observer.observe(chatEl, { childList: true, subtree: true });
}

/**
 * (Re)apply name highlights to crossover messages currently in the DOM.
 * Debounced; safe to call often because already-marked text is skipped.
 */
export function highlightChat() {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
        const chat = ctx().chat || [];
        chat.forEach((m, i) => {
            const hl = normalizeHl(m?.extra?.[EXTRA_KEY]);
            if (!hl) return;
            const body = document.querySelector(`#chat .mes[mesid="${i}"] .mes_text`);
            if (!body) return;
            try {
                applyHighlights(body, hl);
            } catch (err) {
                log.debug('highlight failed', i, err);
            }
        });
    });
}
