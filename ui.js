// - openPrompt(): ST's own input popup, plus ⚙ (chat picker) and clear buttons in its corner
// - openSettings(): choose the chats (worlds), save / load sets

import { ctx, log, formatDate, EXT_NAME } from './util.js';
import { h, icon, searchSelect } from './dom.js';
import { getSettings, getDraft, getStory, newWorld, save, saveSet, loadSet, deleteSet, worldInclude, MAX_WORLDS } from './settings.js';
import { clearCache, worldDisplayName, worldAvatar, listChats, openChatSource } from './sources.js';
import { listPersonas } from './persona.js';
import { collectWorld } from './prompt.js';
import { worldColor, hexToRgba } from './highlight.js';
import { runCrossover, prepare, isRunning } from './runner.js';
import { openModal, button, askText, confirmBox } from './modal.js';
import { pickSource, pickChat } from './pickers.js';

/* ---------- world (chat) card ---------- */

function field(label, control) {
    return h('div.rf-field', {}, h('div.rf-label', {}, label), control);
}

function worldCard(world, index, onRemove) {
    const card = h('div.rf-world');

    const render = () => {
        const hasSource = world.kind === 'group' ? world.groupId : world.avatar;
        const info = h('div.rf-info');
        const chatLine = h('div.rf-muted.rf-ellipsis', {}, world.file || '채팅을 골라 주세요');

        // Fill in the chat's date once the list arrives (cheap: one cached request per character).
        if (world.file && hasSource) {
            listChats(world).then(chats => {
                const c = chats.find(x => x.file === world.file);
                if (c) chatLine.textContent = [c.last && formatDate(c.last), c.count && `${c.count}개`, c.label].filter(Boolean).join(' · ');
            }).catch(() => {});
        }

        async function chooseSource() {
            const picked = await pickSource(world.kind);
            if (!picked) return;
            Object.assign(world, picked.kind === 'group'
                ? { kind: 'group', groupId: picked.id, avatar: '' }
                : { kind: 'char', avatar: picked.id, groupId: '' });
            Object.assign(world, { file: '', summary: 'auto', members: null });
            save();
            render();
            chooseChat();
        }
        function useOpenChat() {
            const source = openChatSource();
            if (!source) return toastr.info('지금 열린 채팅이 없어요.');
            Object.assign(world, source, { summary: 'auto', members: null });
            save();
            render();
        }
        async function chooseChat() {
            const file = await pickChat(world);
            if (!file) return;
            Object.assign(world, { file, summary: 'auto' });
            save();
            render();
        }

        const who = h('button.rf-who', { type: 'button', title: '봇 바꾸기', onclick: chooseSource },
            h('div.rf-avatar.rf-avatar-lg', {}, hasSource ? h('img', { src: worldAvatar(world), alt: '', onerror: e => e.target.remove() }) : icon('plus')),
            h('div.rf-who-text', {},
                h('div.rf-who-name', {}, hasSource ? worldDisplayName(world) : '봇 고르기'),
                hasSource ? chatLine : h('div.rf-muted', {}, '눌러서 캐릭터나 그룹을 골라요')));

        // Who from this chat appears: both, only the bot, or only the user (at least one).
        const include = worldInclude(world);
        const appear = h('div.rf-appear', {},
            h('span.rf-label', {}, '등장'),
            ...[['bot', '봇'], ['user', '유저']].map(([key, label]) => h('button', {
                type: 'button',
                className: `rf-chip${include[key] ? ' rf-on' : ''}`,
                title: include[key] ? `${label} 빼기` : `${label} 넣기`,
                onclick: () => {
                    const next = { ...include, [key]: !include[key] };
                    if (!next.bot && !next.user) return toastr.info('봇이나 유저 중 하나는 등장해야 해요.');
                    world.include = next;
                    save();
                    render();
                },
            }, include[key] ? icon('check') : null, label)));

        const personaPicker = searchSelect({
            options: [{ value: '', label: '자동 감지' }, ...listPersonas().map(p => ({ value: p.avatar, label: p.name }))],
            value: world.persona,
            placeholder: '페르소나 검색…',
            onChange: v => { world.persona = v; save(); inspect(); },
        });
        const summarySelect = h('select.rf-input', {
            onchange: () => { world.summary = summarySelect.value; save(); inspect(); },
        }, h('option', { value: 'auto' }, '자동'));

        let inspectSeq = 0;
        async function inspect() {
            if (!world.file) return;
            info.textContent = '확인 중…';
            info.classList.remove('rf-warn');
            const seq = ++inspectSeq;
            const r = await collectWorld(world, index);
            if (seq !== inspectSeq) return; // a newer check started meanwhile
            if (!r.ok) {
                info.textContent = `⚠ ${r.error}`;
                info.classList.add('rf-warn');
                return;
            }
            const opts = [['auto', '자동'], ['none', '사용 안 함'], ...r.candidates.map(c => [c.id, `${c.label} · ${c.size.toLocaleString()}자`])];
            summarySelect.replaceChildren(...opts.map(([v, l]) => h('option', { value: v, selected: v === world.summary }, l)));
            info.replaceChildren(
                h('span', {}, `페르소나 ${r.persona.name}`),
                h('span', {}, r.summary ? `요약 ${r.summary.label}` : '요약 없음'));
        }

        const paint = color => card.style.setProperty('--rf-world', hexToRgba(color, 0.8));
        paint(worldColor(world, index));
        const swatch = h('label.rf-swatch', { title: '이 채팅의 형광펜 색' },
            h('input', {
                type: 'color',
                value: worldColor(world, index),
                oninput: e => paint(e.target.value),
                onchange: e => { world.color = e.target.value; save(); },
            }));

        card.replaceChildren(...[
            h('div.rf-world-head', {},
                swatch,
                h('span.rf-world-num', {}, `채팅 ${index + 1}`),
                h('input.rf-input.rf-alias', {
                    type: 'text',
                    value: world.label,
                    placeholder: '별칭 (선택)',
                    title: '같은 캐릭터를 여러 번 쓸 때 AI가 구분하는 이름이에요. 본문에는 나오지 않아요.',
                    oninput: e => { world.label = e.target.value; save(); },
                }),
                h('button.rf-icon', { type: 'button', title: '이 채팅 빼기', onclick: onRemove }, icon('xmark'))),
            who,
            h('div.rf-row.rf-wrap', {},
                hasSource ? button('다른 채팅 고르기', { iconName: 'comments', onclick: chooseChat }) : null,
                button('지금 열린 채팅', { iconName: 'location-crosshairs', onclick: useOpenChat, title: '지금 보고 있는 채팅을 이 칸에 넣어요' })),
            world.file ? appear : null,
            world.file ? h('details.rf-details', {},
                h('summary', {}, '페르소나 · 요약'),
                field('페르소나', personaPicker),
                field('요약', summarySelect)) : null,
            world.file ? info : null,
        ].filter(Boolean)); // replaceChildren would print "null" for skipped parts
        inspect();
    };

    render();
    return card;
}

/* ---------- settings window ---------- */

export function openSettings() {
    const settings = getSettings();
    const worldsBox = h('div.rf-worlds');
    const status = h('div.rf-status');

    const setSelect = h('select.rf-input', { onchange: () => {
        if (setSelect.value) loadSet(setSelect.value);
        else settings.activeSetId = '';
        renderWorlds();
    } });
    // '' = a new, not yet saved set; Save then asks for its name.
    const fillSets = () => setSelect.replaceChildren(
        h('option', { value: '' }, '새 세트 (저장 안 됨)'),
        ...settings.sets.map(s => h('option', { value: s.id, selected: s.id === settings.activeSetId }, s.name)));

    const addBtn = button('채팅 추가', { iconName: 'plus', onclick: () => {
        const draft = getDraft();
        if (draft.worlds.length >= MAX_WORLDS) return;
        draft.worlds.push(newWorld());
        save();
        renderWorlds();
    } });

    function renderWorlds() {
        const draft = getDraft();
        worldsBox.replaceChildren(...draft.worlds.map((w, i) => worldCard(w, i, () => {
            draft.worlds.splice(i, 1);
            save();
            renderWorlds();
        })));
        addBtn.hidden = draft.worlds.length >= MAX_WORLDS;
        fillSets();
    }

    async function onSave() {
        const active = settings.sets.find(s => s.id === settings.activeSetId);
        if (active) {
            saveSet();
            toastr.success(`"${active.name}"에 저장했어요.`);
        } else {
            const name = await askText('세트 이름', `세트 ${settings.sets.length + 1}`);
            if (!name) return;
            saveSet(name);
            toastr.success(`"${name}"(으)로 저장했어요.`);
        }
        fillSets();
    }
    async function onRename() {
        const active = settings.sets.find(s => s.id === settings.activeSetId);
        if (!active) return toastr.info('이름을 바꿀 세트를 먼저 불러오세요.');
        const name = await askText('세트 이름 바꾸기', active.name);
        if (!name) return;
        active.name = name;
        save();
        fillSets();
    }
    async function onDelete() {
        const active = settings.sets.find(s => s.id === settings.activeSetId);
        if (!active) return toastr.info('지울 세트를 먼저 불러오세요.');
        if (!await confirmBox('세트 삭제', `"${active.name}" 세트를 지울까요? 지금 고른 채팅은 그대로 남아요.`)) return;
        deleteSet(active.id);
        fillSets();
    }

    async function preview() {
        try {
            status.textContent = '불러오는 중…';
            const built = await prepare(getDraft(), getSettings().lastTopic || '');
            const { prompt, systemPrompt } = built.request;
            const full = Array.isArray(prompt)
                ? prompt.map(m => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n')
                : `[SYSTEM]\n${systemPrompt}\n\n[PROMPT]\n${prompt}`;
            let tokens = '';
            try { tokens = ` · 약 ${(await ctx().getTokenCountAsync(full)).toLocaleString()} 토큰`; } catch { /* optional */ }
            status.textContent = '';
            const warn = built.failed.length ? `⚠ 건너뛴 채팅: ${built.failed.map(f => f.label).join(', ')}\n\n` : '';
            openModal({
                title: '보낼 프롬프트',
                width: '880px',
                themeButton: true,
                body: h('div.rf-stack', {},
                    h('div.rf-muted', {}, `${full.length.toLocaleString()}자${tokens}`),
                    h('textarea.rf-input.rf-mono', { readOnly: true, value: warn + full })),
            });
        } catch (err) {
            status.textContent = `⚠ ${err.message}`;
        }
    }

    renderWorlds();

    // Length of the story: episode count range and words per episode (sent to the model as-is).
    const story = settings.story;
    const num = (key, min, max, step = 1) => h('input.rf-input.rf-num', {
        type: 'number', min, max, step, value: getStory()[key],
        onchange: e => { story[key] = Number(e.target.value); save(); e.target.value = getStory()[key]; },
    });
    const storyRow = h('div.rf-story', {},
        h('span.rf-label', {}, '분량'),
        h('span', {}, '에피소드'), num('episodesMin', 1, 20), h('span', {}, '~'), num('episodesMax', 1, 20), h('span', {}, '개'),
        h('span.rf-sep', {}, '·'),
        h('span', {}, '각'), num('wordsPerEpisode', 50, 5000, 50), h('span', {}, '단어 이상'));

    return openModal({
        title: `${EXT_NAME} 설정`,
        width: '760px',
        themeButton: true,
        body: h('div.rf-stack', {},
            h('div.rf-row', {},
                setSelect,
                button('저장', { primary: true, iconName: 'floppy-disk', onclick: onSave, title: '지금 구성을 이 세트에 저장 (새 세트면 이름을 정해요)' }),
                h('button.rf-icon', { type: 'button', title: '세트 이름 바꾸기', onclick: onRename }, icon('pen')),
                h('button.rf-icon', { type: 'button', title: '세트 삭제', onclick: onDelete }, icon('trash-can'))),
            worldsBox,
            addBtn,
            storyRow,
            status),
        actions: [
            button('새로고침', { iconName: 'rotate', title: '채팅을 다시 읽어와요', onclick: () => { clearCache(); renderWorlds(); } }),
            button('미리보기', { iconName: 'eye', title: '모델에게 보낼 내용을 확인해요', onclick: preview }),
        ],
    }).done;
}

/* ---------- topic prompt: ST's own input popup + two corner buttons ---------- */

/** "대전쟁AU(봇) × 루시안(봇·유저)" — alias, else the bot name, plus who appears. */
function draftSummary() {
    const worlds = getDraft().worlds.filter(w => w.file);
    return worlds.map(w => {
        const { bot, user } = worldInclude(w);
        return `${w.label?.trim() || worldDisplayName(w)}(${[bot && '봇', user && '유저'].filter(Boolean).join('·')})`;
    }).join(' × ');
}

export async function openPrompt() {
    if (isRunning()) return toastr.info('이미 쓰는 중이에요.', EXT_NAME);
    const settings = getSettings();
    const { Popup, POPUP_TYPE } = ctx();
    const popup = new Popup('어떤 크로스오버를 볼까요?', POPUP_TYPE.INPUT, settings.lastTopic || '', { rows: 5, okButton: 'Ok', cancelButton: '취소' });

    // Which chats will meet, right under the text box; refreshed after the chat picker closes.
    const chosen = h('div.rf-popup-chosen');
    const showChosen = () => {
        const s = draftSummary();
        chosen.textContent = s ? `채팅: ${s}` : '⚙ 를 눌러 크로스오버할 채팅을 골라 주세요';
    };
    showChosen();
    popup.mainInput.after(chosen);

    const tools = h('div.rf-popup-tools', {},
        h('div.menu_button.menu_button_icon.fa-solid.fa-eraser', {
            title: '입력 내용 지우기',
            onclick: () => { popup.mainInput.value = ''; popup.mainInput.focus(); },
        }),
        h('div.menu_button.menu_button_icon.fa-solid.fa-gear', {
            title: '크로스오버할 채팅 고르기',
            onclick: async () => { await openSettings(); showChosen(); popup.mainInput.focus(); },
        }));
    popup.dlg.append(tools);

    const result = await popup.show();
    if (typeof result !== 'string') return; // cancelled
    settings.lastTopic = result;
    save();

    // Progress is shown the ST way: the Send button turns into Stop while writing (see runner.js).
    try {
        const done = await runCrossover(getDraft(), result);
        if (done?.failed.length) toastr.warning(`건너뛴 채팅: ${done.failed.map(f => f.label).join(', ')}`);
    } catch (err) {
        log.error('generation failed', err);
        toastr.error(err.message, EXT_NAME);
    }
}
