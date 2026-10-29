// Summary sources. Each adapter reads one extension's storage from a loaded chat
// (chat_metadata / message.extra), so the source extension does not need to be installed or active.
// Supporting another summary extension = adding one adapter object to ADAPTERS.

import { ctx, log, cleanText } from './util.js';

const KEY_FACTS_MAX = 20;

/** Pull readable text out of a string / object / array value. */
function textOf(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join('\n');
    if (typeof value === 'object') {
        for (const key of ['memory', 'summary', 'text', 'content', 'value']) {
            if (typeof value[key] === 'string' && value[key].trim()) return value[key];
        }
    }
    return '';
}

const arr = value => (Array.isArray(value) ? value : []);
const byNum = key => (a, b) => (Number(a?.[key]) || 0) - (Number(b?.[key]) || 0);

/** Pinned first, then most important; disabled/closed dropped. */
function topFacts(list, format) {
    return arr(list)
        .filter(x => x && !x.disabled && x.status !== 'closed')
        .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (Number(b.importance) || 0) - (Number(a.importance) || 0))
        .slice(0, KEY_FACTS_MAX)
        .map(format)
        .filter(Boolean);
}

function section(title, lines) {
    const body = (Array.isArray(lines) ? lines.filter(Boolean).join('\n') : lines || '').trim();
    return body ? `## ${title}\n${body}` : '';
}

function join(...parts) {
    return parts.filter(Boolean).join('\n\n');
}

/** Latest value of message.extra (rolling summaries). */
function latestExtra(messages, read) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const text = read(messages[i]?.extra);
        if (text) return text;
    }
    return '';
}

// Keys handled by dedicated adapters or never summaries.
const META_KNOWN = new Set(['memoria', 'long_memory', 'scenario_summarizer']);
const EXTRA_IGNORE = new Set([
    'memory', 'qvink_memory', 'reasoning', 'reasoning_duration', 'reasoning_type', 'display_text', 'api', 'model',
    'gen_id', 'gen_started', 'gen_finished', 'bias', 'token_count', 'title', 'image', 'file', 'files', 'media',
    'inline_image', 'tool_invocations', 'swipe_info', 'append_title', 'isSmallSys', 'type', 'uses_system_ui',
]);
const SUMMARY_KEY = /summar|memor|recap|scenario|chronicle|요약|기억/i;

/**
 * @typedef {{ metadata: object, messages: object[] }} LoadedChat
 * @typedef {{ id: string, label: string, text: string }} SummaryCandidate
 * @typedef {{ id: string, label: string, read: (chat: LoadedChat) => Promise<string|SummaryCandidate[]>|string|SummaryCandidate[] }} Adapter
 */

/** @type {Adapter[]} order = priority for "auto" */
const ADAPTERS = [
    {
        // dontthinkaboutelephant (chat_metadata.long_memory)
        id: 'elephant',
        label: '코끼리를 생각하지마',
        read: ({ metadata }) => {
            const m = metadata?.long_memory;
            if (!m || typeof m !== 'object') return '';
            const frame = m.frame || {};
            const setting = [frame.work && `Work: ${frame.work}`, frame.au && `AU: ${frame.au}`, frame.notes].filter(Boolean);
            const timeline = arr(m.timeline).slice().sort(byNum('from'))
                .map(t => [t.when && `(${t.when})`, t.title && `${t.title}:`, t.text].filter(Boolean).join(' '));
            const facts = topFacts(m.ledger?.entries, e => e.key && e.value ? `- ${e.key}: ${e.value}` : '');
            const scene = m.ledger?.scene || {};
            const now = [scene.time, scene.place, scene.present, scene.mood].filter(Boolean).join(' / ');
            return join(
                section('Setting', setting),
                section('Story so far', m.saga?.text),
                section('Episodes', timeline),
                section('Key facts', facts),
                section('Current scene', now),
            );
        },
    },
    {
        // ST-memoria (chat_metadata.memoria)
        id: 'memoria',
        label: 'Memoria',
        read: ({ metadata }) => {
            const s = metadata?.memoria;
            if (!s || typeof s !== 'object') return '';
            const story = [...arr(s.arcSummaries), ...arr(s.chunkSummaries)]
                .filter(x => x?.text)
                .sort(byNum('fromTurn'))
                .map(x => x.text);
            const facts = topFacts(s.memories, x => x.summary ? `- ${x.summary}` : '');
            const rules = arr(s.worldRules).filter(r => r?.key && r?.value).map(r => `- ${r.key}: ${r.value}`);
            const milestones = arr(s.milestones).filter(x => x?.summary).map(x => `- ${x.title ? `${x.title}: ` : ''}${x.summary}`);
            return join(
                section('Story so far', story),
                section('Milestones', milestones),
                section('Key memories', facts),
                section('World rules', rules),
            );
        },
    },
    {
        // Scenario-Summarizer (chat_metadata.scenario_summarizer)
        id: 'scenario-summarizer',
        label: '시나리오 자동요약',
        read: ({ metadata }) => {
            const d = metadata?.scenario_summarizer;
            if (!d || typeof d !== 'object') return '';
            const legacy = arr(d.legacySummaries).map(textOf);
            const current = Object.entries(d.summaries || {})
                .sort((a, b) => Number(a[0]) - Number(b[0]))
                .map(([, v]) => textOf(v));
            const events = arr(d.events).map(e => textOf(e) || e?.title || e?.name).filter(Boolean).map(t => `- ${t}`);
            return join(
                section('Earlier chats', legacy),
                section('Story so far', current),
                section('Key events', events),
            );
        },
    },
    {
        id: 'st-memory',
        label: '기본 요약 (Summarize)',
        read: ({ messages }) => latestExtra(messages, extra => textOf(extra?.memory)),
    },
    {
        id: 'qvink',
        label: 'Qvink Memory',
        read: ({ messages }) => messages
            .map(m => (m?.extra?.qvink_memory && !m.extra.qvink_memory.exclude ? textOf(m.extra.qvink_memory) : ''))
            .filter(Boolean).join('\n'),
    },
    {
        // Unknown extensions that store a summary-like key in chat_metadata.
        id: 'meta-scan',
        label: '메타데이터',
        read: ({ metadata }) => Object.entries(metadata || {})
            .filter(([key]) => !META_KNOWN.has(key) && SUMMARY_KEY.test(key))
            .map(([key, value]) => ({ id: `meta:${key}`, label: `메타데이터: ${key}`, text: textOf(value) }))
            .filter(x => x.text.trim()),
    },
    {
        // Unknown extensions that store per-message summaries in message.extra.
        id: 'extra-scan',
        label: '메시지 데이터',
        read: ({ messages }) => {
            const keys = new Set();
            for (const m of messages) {
                for (const key of Object.keys(m?.extra || {})) {
                    if (!EXTRA_IGNORE.has(key) && SUMMARY_KEY.test(key)) keys.add(key);
                }
            }
            return [...keys].map(key => {
                const values = messages.map(m => textOf(m?.extra?.[key])).filter(Boolean);
                const avg = values.reduce((n, v) => n + v.length, 0) / (values.length || 1);
                // Long values are usually rolling summaries (take latest); short ones are per-message.
                const text = avg > 1500 ? values[values.length - 1] : values.join('\n');
                return { id: `extra:${key}`, label: `메시지 데이터: ${key}`, text };
            });
        },
    },
    {
        id: 'chat-lorebook',
        label: '채팅 로어북',
        read: async ({ metadata }) => {
            const name = metadata?.world_info;
            const { loadWorldInfo } = ctx();
            if (!name || typeof loadWorldInfo !== 'function') return '';
            const book = await loadWorldInfo(name);
            return Object.values(book?.entries || {})
                .filter(e => e && !e.disable && e.content)
                .sort(byNum('order'))
                .map(e => (e.comment ? `[${e.comment}]\n` : '') + e.content)
                .join('\n\n');
        },
    },
];

/**
 * All summaries found in a chat, in priority order. One failing adapter never blocks the others.
 * @returns {Promise<SummaryCandidate[]>}
 */
export async function findSummaries(chat) {
    const found = [];
    for (const adapter of ADAPTERS) {
        try {
            const out = await adapter.read(chat);
            const list = Array.isArray(out) ? out : [{ id: adapter.id, label: adapter.label, text: out }];
            for (const item of list) {
                const text = cleanText(item.text);
                if (text) found.push({ ...item, text });
            }
        } catch (err) {
            log.warn(`summary adapter "${adapter.id}" failed`, err);
        }
    }
    log.debug('summaries found', found.map(x => `${x.id} (${x.text.length})`));
    return found;
}

/** 'auto' → first found, 'none' → nothing, otherwise by id (falls back to auto if that source vanished). */
export function pickSummary(candidates, choice) {
    if (choice === 'none') return null;
    if (choice && choice !== 'auto') return candidates.find(x => x.id === choice) || candidates[0] || null;
    return candidates[0] || null;
}
