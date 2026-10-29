// Wraps the crossover material in the user's current Chat Completion preset, so language, length,
// style and jailbreak rules come from the preset instead of extension settings.
// Card/persona/world-info markers are skipped: they would pull in the open chat's character.

import { ctx, log } from './util.js';

const GLOBAL_ORDER_ID = '100001';
// The crossover material takes the chat history's place; these markers would describe the open chat instead.
const SKIPPED_MARKERS = new Set(['charDescription', 'charPersonality', 'scenario', 'personaDescription', 'worldInfoBefore', 'worldInfoAfter', 'dialogueExamples']);

/** {{char}}/{{user}} in preset text would name the open chat's people; make them generic first. */
function neutral(text) {
    const replaced = String(text ?? '')
        .replace(/\{\{char\}\}/gi, 'the characters')
        .replace(/\{\{user\}\}/gi, "the user's characters");
    const { substituteParams } = ctx();
    try {
        return typeof substituteParams === 'function' ? substituteParams(replaced) : replaced;
    } catch {
        return replaced;
    }
}

function activeOrder(settings) {
    const orders = settings?.prompt_order || [];
    return (orders.find(o => String(o.character_id) === GLOBAL_ORDER_ID) || orders[0])?.order || [];
}

/**
 * @param {{ system: string, material: string, request: string }} parts English text from prompt.js
 * @returns {{ messages: {role: string, content: string}[] } | { systemPrompt: string, prompt: string }}
 *   messages for Chat Completion (preset applied), or a plain prompt for other APIs
 */
export function assemble(parts) {
    const c = ctx();
    const settings = c.chatCompletionSettings;
    if (c.mainApi !== 'openai' || !settings?.prompts) {
        return { systemPrompt: parts.system, prompt: `${parts.material}\n\n${parts.request}` };
    }

    const byId = new Map(settings.prompts.map(p => [p.identifier, p]));
    const messages = [];
    const inChat = []; // prompts injected at depth sit between the material and the request, like in a chat
    let placed = false;
    const request = { role: 'user', content: parts.request };
    const placeMaterial = () => {
        messages.push({ role: 'system', content: parts.system }, { role: 'system', content: parts.material }, request);
        placed = true;
    };

    for (const entry of activeOrder(settings)) {
        if (!entry?.enabled) continue;
        if (entry.identifier === 'chatHistory') {
            placeMaterial();
            continue;
        }
        const p = byId.get(entry.identifier);
        if (!p || p.marker || SKIPPED_MARKERS.has(p.identifier)) continue;
        const content = neutral(p.content).trim();
        if (!content) continue;
        const message = { role: p.role || 'system', content };
        if (Number(p.injection_position) === 1) inChat.push(message);
        else messages.push(message);
    }
    if (!placed) placeMaterial(); // preset without a chat history marker
    messages.splice(messages.indexOf(request), 0, ...inChat);

    log.debug('preset messages', messages.length);
    return { messages };
}
