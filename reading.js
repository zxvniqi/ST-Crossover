// Theme-matched reading view: the episode is formatted exactly like a chat message
// (ST markdown + regex scripts) and the theme's `.mes_text` rules are mirrored onto our box.

import { ctx, log } from './util.js';
import { h } from './dom.js';
import { applyHighlights } from './highlight.js';

const STYLE_ID = 'xo_theme_mirror';
const SCOPE = '.xo-reading .mes_text';
const BLOCKED_TAGS = ['script', 'iframe', 'frame', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'template', 'noscript'];
const BLOCKED_ATTRS = ['id', 'name', 'for', 'form', 'formaction', 'srcdoc', 'popovertarget'];
// Typography read from a real chat message so fonts/colours match even when set outside `.mes_text` rules.
const BASE_PROPS = ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'word-spacing', 'color', 'text-align', 'text-shadow'];

let mirroredSignature = '';
let mirroredRules = [];

function sheetRules(sheet) {
    try {
        return sheet.cssRules ? [...sheet.cssRules] : [];
    } catch {
        return []; // cross-origin sheet
    }
}

// Prefix tokens that describe the normal chat view. Anything else (another extension's dialog,
// a special mode class) means the rule does not apply to regular chat messages.
const CHAT_PREFIX_TOKENS = /#chat\b|\.mes_block\b|\.last_mes\b|\.mes(?![\w-])|\bbody\b|\bhtml\b|:root|\[is_user=["']?false["']?\]|\[is_system=["']?false["']?\]|:not\([^)]*\)|[>+~\s]/g;

// The innermost chat container named in a selector; what follows it is message content.
const ANCHOR = /(\.mes_text|\.mes_block|\.mes(?![\w-])|#chat)(?![\w-])/g;

/** `#chat .mes q::before` → `.xo-reading .mes_text q::before`; null when it is not a chat-content rule. */
function chatSelector(part) {
    let last = null;
    for (const m of part.matchAll(ANCHOR)) last = m;
    if (!last) return null;
    const end = last.index + last[0].length;
    if (part.slice(0, end).replace(CHAT_PREFIX_TOKENS, '').replace(/\.mes_text/g, '') !== '') return null;
    const rest = part.slice(end);
    // Rules on the bubble/container itself are covered by BOX_PROPS; only `.mes_text` may style the root.
    if (last[0] !== '.mes_text' && !/^\s*[>+~\s]/.test(rest)) return null;
    return SCOPE + rest;
}

/** Re-scope one rule from the chat view onto the reading box; unrelated rules are dropped. */
function scopeRule(rule) {
    if (rule instanceof CSSStyleRule) {
        const parts = rule.selectorText.split(/,(?![^(]*\))/)
            .map(s => chatSelector(s.trim()))
            .filter(Boolean);
        return parts.length ? `${parts.join(', ')} { ${rule.style.cssText} }` : '';
    }
    if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
        const inner = [...rule.cssRules].map(scopeRule).filter(Boolean).join('\n');
        if (!inner) return '';
        return rule instanceof CSSMediaRule ? `@media ${rule.conditionText} { ${inner} }` : `@supports ${rule.conditionText} { ${inner} }`;
    }
    return '';
}

// The message bubble look (background, border) of a character message.
const BOX_PROPS = ['background-color', 'background-image', 'border-color', 'border-width', 'border-style', 'border-radius', 'box-shadow', 'backdrop-filter'];

/** Typography of a real chat message (+ its bubble), so we match even rules set outside `.mes_text`. */
function baseTypography() {
    const mes = document.querySelector('#chat .mes:not([is_user="true"])') || document.querySelector('#chat .mes');
    const text = mes?.querySelector('.mes_text');
    if (!text) return '';
    const read = (el, props) => {
        const cs = getComputedStyle(el);
        return props.map(p => `${p}: ${cs.getPropertyValue(p)}`).join('; ');
    };
    return `${SCOPE} { ${read(text, BASE_PROPS)} }\n.xo-root .xo-reading { ${read(mes, BOX_PROPS)} }`;
}

/** Rule scan reruns only when the page's stylesheets change (theme switch, custom CSS edit). */
export function mirrorTheme() {
    const sheets = [...document.styleSheets].filter(s => s.ownerNode?.id !== STYLE_ID);
    const signature = sheets.map(s => `${s.href || s.ownerNode?.id || ''}:${sheetRules(s).length}:${s.ownerNode?.textContent?.length || 0}`).join('|');
    if (signature !== mirroredSignature) {
        mirroredSignature = signature;
        mirroredRules = [];
        for (const sheet of sheets) {
            for (const rule of sheetRules(sheet)) {
                const out = scopeRule(rule);
                if (out) mirroredRules.push(out);
            }
        }
    }
    // Base typography is cheap and depends on which chat is open, so it is read every time.
    const css = [baseTypography(), ...mirroredRules];
    let style = document.getElementById(STYLE_ID);
    if (!style) {
        style = document.createElement('style');
        style.id = STYLE_ID;
        document.head.append(style);
    }
    style.textContent = css.join('\n');
    log.debug('theme mirrored', css.length, 'rules');
}

function formatted(text) {
    const { messageFormatting } = ctx();
    const purify = SillyTavern.libs?.DOMPurify;
    if (typeof messageFormatting !== 'function' || typeof purify?.sanitize !== 'function') return null;
    try {
        const html = messageFormatting(text, '', false, false, undefined);
        const fragment = purify.sanitize(html, { RETURN_DOM_FRAGMENT: true, FORBID_TAGS: BLOCKED_TAGS, FORBID_ATTR: BLOCKED_ATTRS });
        fragment.querySelectorAll('a[href]').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
        fragment.querySelectorAll('style').forEach(s => s.remove()); // inline styles could leak to the page
        return fragment;
    } catch (err) {
        log.warn('messageFormatting failed, showing plain text', err);
        return null;
    }
}

/** @returns {HTMLElement} */
export function renderEpisode(text, marks) {
    mirrorTheme();
    const body = h('div.mes_text');
    const fragment = formatted(text);
    if (fragment) body.append(fragment);
    else {
        body.style.whiteSpace = 'pre-wrap';
        body.textContent = text;
    }
    applyHighlights(body, marks);
    return h('div.xo-reading', {}, body);
}
