// Generation pipeline shared by the popup and the slash command.

import { ctx, log, MAX_WORLDS } from './util.js';
import { collectWorld, buildPrompt } from './prompt.js';
import { buildMarks } from './highlight.js';
import { assertChatOpen, insertIntoChat } from './chat-insert.js';

let running = false;
let cancelled = false;

export function isRunning() {
    return running;
}

/** Stops the request if the backend supports it; the result is discarded either way. */
export function cancel() {
    if (!running) return;
    cancelled = true;
    try {
        ctx().stopGeneration?.();
    } catch (err) {
        log.debug('stopGeneration failed', err);
    }
}

function usableWorlds(set) {
    return (set?.worlds || []).slice(0, MAX_WORLDS).filter(w => w.file && (w.kind === 'group' ? w.groupId : w.avatar));
}

/** Collect + build only (for preview and for generation). */
export async function prepare(set, topic, options) {
    const worlds = usableWorlds(set);
    if (worlds.length < 2) throw new Error('채팅을 2개 이상 선택해 주세요.');
    const collected = await Promise.all(worlds.map((w, i) => collectWorld(w, i, options)));
    const built = buildPrompt(collected, topic, options);
    if (built.worlds.length < 2) {
        const why = built.failed.map(f => `${f.label}: ${f.error}`).join('\n');
        throw new Error(`불러온 채팅이 2개보다 적어요.\n${why}`);
    }
    return built;
}

/**
 * Generates the episode and puts it into the open chat as a hidden message.
 * @returns {Promise<{ text: string, failed: object[] } | null>} null when cancelled
 */
export async function runCrossover(set, topic, options, onStatus = () => {}) {
    if (running) throw new Error('이미 생성 중이에요.');
    assertChatOpen();
    running = true;
    cancelled = false;
    try {
        onStatus('채팅 불러오는 중…');
        const built = await prepare(set, topic, options);
        if (cancelled) return null;

        onStatus('에피소드 쓰는 중…');
        log.debug('prompt chars', built.systemPrompt.length + built.prompt.length);
        const text = String(await ctx().generateRaw({ systemPrompt: built.systemPrompt, prompt: built.prompt }) ?? '').trim();
        if (cancelled) return null;
        if (!text) throw new Error('모델이 빈 응답을 보냈어요. API 연결과 응답 길이 설정을 확인해 주세요.');

        await insertIntoChat({
            text,
            topic,
            worlds: built.worlds.map(w => w.label),
            marks: buildMarks(built.worlds),
        });
        return { text, failed: built.failed };
    } finally {
        running = false;
    }
}
