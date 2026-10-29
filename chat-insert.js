// Puts an episode into the open chat as a hidden message: it renders like any message
// (translators, theme, regex all apply) but is left out of the prompt, so canon stays clean.

import { ctx, log } from './util.js';
import { applyHighlights } from './highlight.js';

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
 * @param {{ text: string, marks: object[], topic: string, worlds: string[] }} episode
 * @returns {Promise<number>} index of the new message
 */
export async function insertIntoChat(episode) {
    assertChatOpen();
    const c = ctx();
    const message = {
        name: c.name2 || 'Crossover',
        is_user: false,
        is_system: true, // hidden: shown in the chat, never sent to the model
        send_date: typeof c.humanizedDateTime === 'function' ? c.humanizedDateTime() : new Date().toISOString(),
        mes: episode.text,
        extra: {
            [EXTRA_KEY]: { topic: episode.topic, worlds: episode.worlds, marks: episode.marks },
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

/**
 * (Re)apply name highlights to crossover messages currently in the DOM.
 * Debounced; safe to call often because already-marked text is skipped.
 */
export function highlightChat() {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
        const chat = ctx().chat || [];
        chat.forEach((m, i) => {
            const marks = m?.extra?.[EXTRA_KEY]?.marks;
            if (!marks?.length) return;
            const body = document.querySelector(`#chat .mes[mesid="${i}"] .mes_text`);
            if (!body) return;
            try {
                applyHighlights(body, marks);
            } catch (err) {
                log.debug('highlight failed', i, err);
            }
        });
    });
}
