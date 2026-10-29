// Two windows:
//  - openPrompt(): the QR-style topic box (with ⚙ in the corner) that starts a generation
//  - openSettings(): pick the chats (worlds), save / load sets

import { ctx, log, formatDate, EXT_NAME } from './util.js';
import { h, icon, searchSelect } from './dom.js';
import { getSettings, getDraft, newWorld, save, saveSet, loadSet, deleteSet, MAX_WORLDS } from './settings.js';
import { listCharacters, listGroups, listChats, clearCache, worldDisplayName } from './sources.js';
import { listPersonas } from './persona.js';
import { collectWorld } from './prompt.js';
import { worldColor, hexToRgba } from './highlight.js';
import { runCrossover, prepare, cancel, isRunning } from './runner.js';
import { openModal, button, askText, confirmBox } from './modal.js';

/* ---------- world card ---------- */

function field(label, control, extra = null) {
    return h('div.rf-field', {}, h('div.rf-label', {}, label, extra), control);
}

function worldCard(world, index, onRemove) {
    const card = h('div.rf-world');
    let collapsed = !!world.file; // configured worlds start folded to keep the list short

    const render = () => {
        const kindToggle = h('div.rf-seg', {},
            ...[['char', '캐릭터'], ['group', '그룹']].map(([kind, label]) => h('button', {
                type: 'button',
                className: world.kind === kind ? 'rf-on' : '',
                onclick: () => {
                    if (world.kind === kind) return;
                    Object.assign(world, { kind, avatar: '', groupId: '', file: '', summary: 'auto', members: null });
                    save();
                    render();
                },
            }, label)));

        const sourceOptions = world.kind === 'group'
            ? listGroups().map(g => ({ value: g.id, label: g.name }))
            : listCharacters().map(c => ({ value: c.avatar, label: c.label }));
        const sourcePicker = searchSelect({
            options: [{ value: '', label: world.kind === 'group' ? '— 그룹 선택 —' : '— 캐릭터 선택 —' }, ...sourceOptions],
            value: world.kind === 'group' ? world.groupId : world.avatar,
            placeholder: '이름으로 검색…',
            onChange: v => {
                if (world.kind === 'group') world.groupId = v; else world.avatar = v;
                Object.assign(world, { file: '', summary: 'auto', members: null });
                save();
                render();
            },
        });

        const chatSelect = h('select.rf-input', { disabled: true }, h('option', {}, '먼저 캐릭터를 고르세요'));
        const personaPicker = searchSelect({
            options: [{ value: '', label: '자동 감지' }, ...listPersonas().map(p => ({ value: p.avatar, label: p.name }))],
            value: world.persona,
            placeholder: '페르소나 검색…',
            onChange: v => { world.persona = v; save(); inspect(); },
        });
        const summarySelect = h('select.rf-input', {
            onchange: () => { world.summary = summarySelect.value; save(); inspect(); },
        }, h('option', { value: 'auto' }, '자동'));
        const info = h('div.rf-info');
        const membersBox = h('div', { hidden: true });
        let membersOpen = false;
        let inspectSeq = 0;

        /** Lorebook people (multi-character cards / NPCs): everyone mentioned, or picked by hand. */
        function renderMembers(candidates) {
            membersBox.hidden = !candidates.length;
            if (!candidates.length) return;
            const auto = !Array.isArray(world.members);
            const picked = candidates.filter(c => c.picked);
            const setMembers = ids => { world.members = ids; save(); inspect(); };

            const filter = h('input.rf-input', { type: 'search', placeholder: '이름 검색…' });
            const rows = candidates.map(c => h('label.rf-check', { dataset: { name: c.name.toLowerCase() } },
                h('input', {
                    type: 'checkbox',
                    checked: c.picked,
                    onchange: e => {
                        const ids = new Set(picked.map(p => p.id));
                        if (e.target.checked) ids.add(c.id); else ids.delete(c.id);
                        setMembers([...ids]); // touching a box switches to manual
                    },
                }),
                h('span', {}, c.name),
                c.score ? h('span.rf-muted', {}, `언급 ${c.score}`) : null));
            filter.addEventListener('input', () => {
                const q = filter.value.trim().toLowerCase();
                rows.forEach(r => { r.hidden = q && !r.dataset.name.includes(q); });
            });

            const names = picked.map(c => c.name);
            const summaryText = names.length ? `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` 외 ${names.length - 3}명` : ''}` : '없음';
            membersBox.replaceChildren(field('등장인물 (로어북)', h('details.rf-details', { open: membersOpen, ontoggle: e => { membersOpen = e.target.open; } },
                h('summary', {}, `${auto ? '자동' : '직접 선택'} · ${summaryText}`),
                h('label.rf-check', {},
                    h('input', { type: 'checkbox', checked: auto, onchange: e => setMembers(e.target.checked ? null : picked.map(p => p.id)) }),
                    h('span', {}, '자동 (대화·요약에 나온 인물 모두)')),
                candidates.length > 12 ? filter : null,
                h('div.rf-list', {}, ...rows))));
        }

        async function inspect() {
            if (!world.file) {
                info.textContent = '';
                return;
            }
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
            renderMembers(r.loreCandidates || []);
            info.replaceChildren(
                h('span', {}, `메시지 ${r.messageCount.toLocaleString()}개`),
                h('span', {}, `페르소나 ${r.persona.name}`),
                h('span', {}, r.summary ? `요약 ${r.summary.label}` : '요약 없음'),
            );
        }

        async function loadChatList() {
            const hasSource = world.kind === 'group' ? world.groupId : world.avatar;
            if (!hasSource) return;
            chatSelect.replaceChildren(h('option', {}, '불러오는 중…'));
            try {
                const chats = await listChats(world);
                if (!chats.length) {
                    chatSelect.replaceChildren(h('option', {}, '채팅이 없어요'));
                    return;
                }
                if (!chats.some(c => c.file === world.file)) {
                    world.file = chats[0].file; // newest
                    save();
                }
                chatSelect.replaceChildren(...chats.map(c => h('option', { value: c.file, selected: c.file === world.file },
                    [c.last && formatDate(c.last), c.count && `${c.count}개`, c.label].filter(Boolean).join(' · '))));
                chatSelect.disabled = false;
                inspect();
            } catch (err) {
                log.error('chat list failed', err);
                chatSelect.replaceChildren(h('option', {}, '채팅 목록을 불러오지 못했어요'));
            }
        }
        chatSelect.addEventListener('change', () => {
            Object.assign(world, { file: chatSelect.value, summary: 'auto' });
            save();
            inspect();
        });

        const body = h('div.rf-world-body', { hidden: collapsed },
            field(world.kind === 'group' ? '그룹' : '캐릭터', sourcePicker, kindToggle),
            field('채팅', chatSelect),
            field('페르소나', personaPicker),
            field('요약', summarySelect),
            membersBox);
        const sourceName = (world.kind === 'group' ? world.groupId : world.avatar) ? worldDisplayName(world) : '';
        const compact = h('button.rf-compact', { type: 'button', hidden: !collapsed, onclick: () => toggle(false) },
            [sourceName, world.file].filter(Boolean).join(' · ') || '아직 고르지 않았어요');
        const fold = h('button.rf-icon', { type: 'button', title: '접기/펼치기', onclick: () => toggle(!collapsed) },
            icon(collapsed ? 'chevron-down' : 'chevron-up'));
        function toggle(value) {
            collapsed = value;
            body.hidden = collapsed;
            compact.hidden = !collapsed;
            fold.replaceChildren(icon(collapsed ? 'chevron-down' : 'chevron-up'));
        }

        const paint = color => card.style.setProperty('--rf-world', hexToRgba(color, 0.7));
        paint(worldColor(world, index));
        const swatch = h('label.rf-swatch', { title: '이 채팅의 형광펜 색' },
            h('input', {
                type: 'color',
                value: worldColor(world, index),
                oninput: e => paint(e.target.value),
                onchange: e => { world.color = e.target.value; save(); },
            }));

        card.replaceChildren(
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
                fold,
                h('button.rf-icon', { type: 'button', title: '이 채팅 빼기', onclick: onRemove }, icon('xmark'))),
            compact,
            body,
            info);
        loadChatList();
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
    const fillSets = () => setSelect.replaceChildren(
        h('option', { value: '' }, settings.sets.length ? '— 저장된 세트 불러오기 —' : '저장된 세트 없음'),
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
        addBtn.disabled = draft.worlds.length >= MAX_WORLDS;
        addBtn.title = addBtn.disabled ? `최대 ${MAX_WORLDS}개까지예요` : '';
        fillSets();
    }

    async function onSave() {
        const active = settings.sets.find(s => s.id === settings.activeSetId);
        if (active) {
            saveSet();
            toastr.success(`"${active.name}"에 저장했어요.`);
        } else {
            await onSaveAs();
        }
        fillSets();
    }
    async function onSaveAs() {
        const name = await askText('세트 이름', `세트 ${settings.sets.length + 1}`);
        if (!name) return;
        saveSet(name);
        toastr.success(`"${name}"(으)로 저장했어요.`);
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
                body: h('div.rf-stack', {},
                    h('div.rf-muted', {}, `${full.length.toLocaleString()}자${tokens}`),
                    h('textarea.rf-input.rf-mono', { readOnly: true, value: warn + full })),
            });
        } catch (err) {
            status.textContent = `⚠ ${err.message}`;
        }
    }

    renderWorlds();

    const body = h('div.rf-stack', {},
        h('div.rf-row', {},
            setSelect,
            button('저장', { primary: true, iconName: 'floppy-disk', onclick: onSave }),
            button('', { iconName: 'copy', title: '새 이름으로 저장', onclick: onSaveAs }),
            button('', { iconName: 'trash-can', title: '불러온 세트 삭제', onclick: onDelete })),
        worldsBox,
        addBtn,
        status);

    return openModal({
        title: `${EXT_NAME} 설정 — 크로스오버할 채팅`,
        width: '760px',
        body,
        actions: [
            button('새로고침', { iconName: 'rotate', title: '채팅을 다시 읽어와요', onclick: () => { clearCache(); renderWorlds(); } }),
            button('미리보기', { iconName: 'eye', title: '모델에게 보낼 내용을 확인해요', onclick: preview }),
        ],
    }).done;
}

/* ---------- topic prompt (QR) ---------- */

function draftSummary() {
    const worlds = getDraft().worlds.filter(w => w.file);
    return worlds.length ? worlds.map((w, i) => w.label || `${worldDisplayName(w)}${worlds.length > 1 ? ` ${i + 1}` : ''}`).join(' × ') : '';
}

export function openPrompt() {
    const settings = getSettings();
    const topic = h('textarea.rf-input.rf-topic', {
        rows: 5,
        placeholder: '보고 싶은 장면을 자유롭게 적어 주세요',
        value: settings.lastTopic,
        oninput: e => { settings.lastTopic = e.target.value; save(); },
    });
    const worldsLine = h('div.rf-muted');
    const refreshLine = () => {
        const s = draftSummary();
        worldsLine.textContent = s ? `채팅: ${s}` : '⚙ 를 눌러 크로스오버할 채팅을 먼저 골라 주세요';
    };
    refreshLine();

    const gear = h('button.rf-icon', {
        type: 'button',
        title: '채팅 고르기',
        onclick: async () => {
            await openSettings();
            refreshLine();
        },
    }, icon('gear'));

    const go = async () => {
        if (isRunning()) return;
        m.close(true);
        const handle = ctx().loader?.show?.({ blocking: false, message: `${EXT_NAME}: 크로스오버 쓰는 중…`, toastMode: 'stoppable', onStop: cancel });
        try {
            const result = await runCrossover(getDraft(), topic.value);
            if (!result) return;
            if (result.failed.length) toastr.warning(`건너뛴 채팅: ${result.failed.map(f => f.label).join(', ')}`);
        } catch (err) {
            log.error('generation failed', err);
            toastr.error(err.message, EXT_NAME);
        } finally {
            await handle?.hide?.();
        }
    };

    // The topic is kept between uses, so offer a one-click clear.
    const clear = button('지우기', {
        iconName: 'eraser',
        title: '입력 내용 지우기',
        onclick: () => {
            topic.value = '';
            settings.lastTopic = '';
            save();
            topic.focus();
        },
    });
    clear.classList.add('rf-left');

    const m = openModal({
        title: '어떤 크로스오버를 볼까요?',
        headerExtra: gear,
        width: '520px',
        body: h('div.rf-stack', {}, topic, worldsLine),
        actions: [
            clear,
            button('취소', { onclick: () => m.close(null) }),
            button('Ok', { primary: true, onclick: go }),
        ],
    });
    topic.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) go(); });
    setTimeout(() => topic.focus(), 0);
}
