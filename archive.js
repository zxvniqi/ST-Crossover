// Saved episodes. Kept in localforage (IndexedDB) so large texts never bloat settings.json.

import { MODULE_NAME, log, uid } from './util.js';

const STORE_KEY = `${MODULE_NAME}_archive`;
const MAX_ITEMS = 300;

function store() {
    return SillyTavern.libs?.localforage;
}

/** @returns {Promise<Array<{id, at, title, topic, setName, worlds: string[], marks: object[], text}>>} newest first */
export async function listEpisodes() {
    try {
        const items = await store()?.getItem(STORE_KEY);
        return Array.isArray(items) ? items : [];
    } catch (err) {
        log.error('archive read failed', err);
        return [];
    }
}

async function write(items) {
    const lf = store();
    if (!lf) throw new Error('저장소(localforage)를 사용할 수 없어요.');
    await lf.setItem(STORE_KEY, items.slice(0, MAX_ITEMS));
}

export async function addEpisode({ topic, setName, worlds, marks = [], text }) {
    const firstLine = text.split('\n').find(l => l.trim()) || '';
    const episode = {
        id: uid(),
        at: Date.now(),
        title: firstLine.replace(/^[#*\s]+|[*\s]+$/g, '').slice(0, 60) || topic.slice(0, 60) || '제목 없음',
        topic,
        setName,
        worlds,
        marks,
        text,
    };
    const items = await listEpisodes();
    items.unshift(episode);
    await write(items);
    return episode;
}

export async function updateEpisode(id, patch) {
    const items = await listEpisodes();
    const item = items.find(x => x.id === id);
    if (!item) return;
    Object.assign(item, patch);
    await write(items);
}

export async function removeEpisode(id) {
    const items = await listEpisodes();
    await write(items.filter(x => x.id !== id));
}
