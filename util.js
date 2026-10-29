// Small shared helpers. No ST state is cached here.

export const MODULE_NAME = 'crossover_episodes'; // storage key; keep stable across renames
export const EXT_NAME = 'Rift';                   // shown in the UI

let debugEnabled = false;

export function setDebug(on) {
    debugEnabled = !!on;
}

export const log = {
    debug: (...args) => { if (debugEnabled) console.debug('[Crossover]', ...args); },
    info: (...args) => console.info('[Crossover]', ...args),
    warn: (...args) => console.warn('[Crossover]', ...args),
    error: (...args) => console.error('[Crossover]', ...args),
};

export function ctx() {
    return SillyTavern.getContext();
}

export function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Strip HTML, code blocks and status-bar noise so only prose reaches the prompt. */
export function cleanText(text) {
    return String(text ?? '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/<(style|script|details)[\s\S]*?<\/\1>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** Keep the head of a text within a character budget. */
export function clipHead(text, max) {
    if (!text || text.length <= max) return text || '';
    return text.slice(0, max).trimEnd() + ' …';
}

/** Keep the tail of a text within a character budget (most recent part). */
export function clipTail(text, max) {
    if (!text || text.length <= max) return text || '';
    return '… ' + text.slice(text.length - max).trimStart();
}

/** Replace {{char}} / {{user}} with the names of a specific world, not the open chat. */
export function fillNames(text, charName, userName) {
    return String(text ?? '')
        .replace(/\{\{char\}\}/gi, charName || 'Character')
        .replace(/\{\{user\}\}/gi, userName || 'User');
}

export function stripExt(fileName) {
    return String(fileName ?? '').replace(/\.jsonl$/i, '');
}

export function formatDate(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // Fallback for non-secure contexts
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
    }
}

export async function postJson(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: ctx().getRequestHeaders(),
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    return res.json();
}
