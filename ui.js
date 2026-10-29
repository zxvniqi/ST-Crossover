// Main popup: pick worlds, write a topic, generate into the open chat.

import { ctx, log, MAX_WORLDS, formatDate, uid } from './util.js';
import { h, icon, searchSelect } from './dom.js';
import { getSettings, getActiveSet, newSet, newWorld, save } from './settings.js';
import { listCharacters, listGroups, listChats, clearCache, worldDisplayName } from './sources.js';
import { listPersonas } from './persona.js';
import { collectWorld } from './prompt.js';
import { worldColor, hexToRgba } from './highlight.js';
import { runCrossover, prepare, cancel, isRunning } from './runner.js';

const LENGTHS = [['short', '짧게'], ['medium', '보통'], ['long', '길게']];

/* ---------- world card ---------- */

function worldCard(world, index, onRemove) {
    const card = h('div.xo-world');
    const settings = getSettings();
    let collapsed = !!world.file; // configured worlds start folded to keep the list short

    const render = () => {
        const kindToggle = h('div.xo-seg', {},
            ...[['char', '캐릭터'], ['group', '그룹']].map(([kind, label]) => h('button.xo-seg-btn', {
                type: 'button',
                className: `xo-seg-btn${world.kind === kind ? ' xo-on' : ''}`,
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
                world.file = '';
                world.summary = 'auto';
                world.members = null;
                save();
                render();
            },
        });

        const chatSelect = h('select.text_pole.xo-select', { disabled: true }, h('option', {}, '먼저 캐릭터를 고르세요'));
        const personaPicker = searchSelect({
            options: [{ value: '', label: '자동 감지' }, ...listPersonas().map(p => ({ value: p.avatar, label: p.name }))],
            value: world.persona,
            placeholder: '페르소나 검색…',
            onChange: v => { world.persona = v; save(); inspect(); },
        });
        const summarySelect = h('select.text_pole.xo-select', {
            onchange: () => { world.summary = summarySelect.value; save(); inspect(); },
        }, h('option', { value: 'auto' }, '자동'));
        const info = h('div.xo-info');
        const membersBox = h('div.xo-field', { hidden: true });
        let membersOpen = false;
        let inspectSeq = 0;

        /** Lorebook people (multi-character cards / NPCs): automatic by mentions, or picked by hand. */
        function renderMembers(candidates) {
            membersBox.hidden = !candidates.length;
            if (!candidates.length) return;
            const auto = !Array.isArray(world.members);
            const picked = candidates.filter(c => c.picked);
            const setMembers = ids => { world.members = ids; save(); inspect(); };

            const filter = h('input.text_pole.xo-filter', { type: 'search', placeholder: '이름 검색…' });
            const rows = candidates.map(c => h('label.checkbox_label.xo-member', { dataset: { name: c.name.toLowerCase() } },
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
                c.score ? h('span.xo-muted', {}, `언급 ${c.score}`) : null));
            filter.addEventListener('input', () => {
                const q = filter.value.trim().toLowerCase();
                rows.forEach(r => { r.hidden = q && !r.dataset.name.includes(q); });
            });

            const names = picked.map(c => c.name);
            const summaryText = names.length ? `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` 외 ${names.length - 3}명` : ''}` : '없음';
            const details = h('details.xo-members', { open: membersOpen, ontoggle: e => { membersOpen = e.target.open; } },
                h('summary', {}, `${auto ? '자동' : '직접 선택'} · ${summaryText}`),
                h('label.checkbox_label', {},
                    h('input', { type: 'checkbox', checked: auto, onchange: e => setMembers(e.target.checked ? null : picked.map(p => p.id)) }),
                    h('span', {}, `자동 (대화·요약에 많이 나온 순, 최대 ${settings.options.loreMembers}명)`)),
                candidates.length > 12 ? filter : null,
                h('div.xo-member-list', {}, ...rows));
            membersBox.replaceChildren(h('span', {}, '등장인물 (로어북)'), details);
        }

        async function inspect() {
            if (!world.file) {
                info.textContent = '';
                return;
            }
            info.textContent = '확인 중…';
            info.className = 'xo-info';
            const seq = ++inspectSeq;
            const r = await collectWorld(world, index, settings.options);
            if (seq !== inspectSeq) return; // a newer check started meanwhile
            if (!r.ok) {
                info.textContent = `⚠ ${r.error}`;
                info.className = 'xo-info xo-warn';
                return;
            }
            const opts = [['auto', '자동'], ['none', '사용 안 함'], ...r.candidates.map(c => [c.id, `${c.label} · ${c.size.toLocaleString()}자`])];
            summarySelect.replaceChildren(...opts.map(([v, l]) => h('option', { value: v, selected: v === world.summary }, l)));
            renderMembers(r.loreCandidates || []);
            info.replaceChildren(
                h('span', {}, `메시지 ${r.messageCount.toLocaleString()}개`),
                h('span', {}, `페르소나: ${r.persona.name} (${r.persona.via})`),
                h('span', {}, r.summary ? `요약: ${r.summary.label}` : '요약 없음 — 최근 대화만 사용'),
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
            world.file = chatSelect.value;
            world.summary = 'auto';
            save();
            inspect();
        });

        const grid = h('div.xo-grid', { hidden: collapsed },
            h('div.xo-field', {}, h('div.xo-field-head', {}, h('span', {}, world.kind === 'group' ? '그룹' : '캐릭터'), kindToggle), sourcePicker),
            h('div.xo-field', {}, h('span', {}, '채팅'), chatSelect),
            h('div.xo-field', {}, h('span', {}, '페르소나'), personaPicker),
            h('div.xo-field', {}, h('span', {}, '요약'), summarySelect),
            membersBox,
        );
        const sourceName = (world.kind === 'group' ? world.groupId : world.avatar) ? worldDisplayName(world) : '';
        const compact = h('button.xo-compact', {
            type: 'button',
            hidden: !collapsed,
            title: '펼쳐서 설정 바꾸기',
            onclick: () => toggle(false),
        }, [sourceName, world.file].filter(Boolean).join(' · ') || '설정 안 됨');
        const fold = h('button.xo-icon-btn', { type: 'button', title: '접기/펼치기', onclick: () => toggle(!collapsed) },
            icon(collapsed ? 'chevron-down' : 'chevron-up'));
        function toggle(value) {
            collapsed = value;
            grid.hidden = collapsed;
            compact.hidden = !collapsed;
            fold.replaceChildren(icon(collapsed ? 'chevron-down' : 'chevron-up'));
        }

        const paint = color => card.style.setProperty('--xo-world', hexToRgba(color, 0.55));
        paint(worldColor(world, index));
        const swatch = h('label.xo-swatch', { title: '이 세계의 형광펜 색' },
            h('input', {
                type: 'color',
                value: worldColor(world, index),
                oninput: e => paint(e.target.value),
                onchange: e => { world.color = e.target.value; save(); },
            }));

        card.replaceChildren(
            h('div.xo-world-head', {},
                swatch,
                h('span.xo-world-num', {}, `세계 ${index + 1}`),
                h('input.text_pole.xo-label', {
                    type: 'text',
                    value: world.label,
                    placeholder: '별칭 (예: 현대AU)',
                    title: '같은 캐릭터가 여러 세계에 나올 때 구분하는 이름',
                    oninput: e => { world.label = e.target.value; save(); },
                }),
                fold,
                h('button.xo-icon-btn', { type: 'button', title: '이 세계 빼기', onclick: onRemove }, icon('xmark')),
            ),
            compact,
            grid,
            info,
        );
        loadChatList();
    };

    render();
    return card;
}

/* ---------- compose tab ---------- */

function composePane(onDone) {
    const settings = getSettings();
    const pane = h('div.xo-pane');
    const worldsBox = h('div.xo-worlds');
    const status = h('div.xo-status');

    const setSelect = h('select.text_pole.xo-select', {
        onchange: () => { settings.activeSetId = setSelect.value; save(); renderSet(); },
    });
    const fillSets = () => setSelect.replaceChildren(...settings.sets.map(s =>
        h('option', { value: s.id, selected: s.id === settings.activeSetId }, s.name)));

    const addBtn = h('button.menu_button.xo-add', { type: 'button', onclick: () => {
        const set = getActiveSet();
        if (set.worlds.length >= MAX_WORLDS) return;
        set.worlds.push(newWorld());
        save();
        renderSet();
    } }, icon('plus'), ' 세계 추가');

    function renderSet() {
        const set = getActiveSet();
        worldsBox.replaceChildren(...set.worlds.map((w, i) => worldCard(w, i, () => {
            set.worlds.splice(i, 1);
            save();
            renderSet();
        })));
        addBtn.disabled = set.worlds.length >= MAX_WORLDS;
        addBtn.title = addBtn.disabled ? `최대 ${MAX_WORLDS}개까지` : '';
    }

    async function setAction(kind) {
        const { Popup } = ctx();
        const set = getActiveSet();
        if (kind === 'new') {
            const name = await Popup.show.input('새 세트', '세트 이름', `세트 ${settings.sets.length + 1}`);
            if (!name) return;
            const created = newSet(String(name).trim());
            settings.sets.push(created);
            settings.activeSetId = created.id;
        } else if (kind === 'copy') {
            const copy = structuredClone(set);
            copy.id = uid();
            copy.name = `${set.name} 복사본`;
            copy.worlds.forEach(w => { w.id = uid(); });
            settings.sets.push(copy);
            settings.activeSetId = copy.id;
        } else if (kind === 'rename') {
            const name = await Popup.show.input('세트 이름 바꾸기', '새 이름', set.name);
            if (!name) return;
            set.name = String(name).trim() || set.name;
        } else if (kind === 'delete') {
            if (settings.sets.length <= 1) return toastr.info('세트가 하나뿐이라 지울 수 없어요.');
            if (!await Popup.show.confirm('세트 삭제', `"${set.name}" 세트를 지울까요? 채팅에 넣은 에피소드는 남아요.`)) return;
            settings.sets = settings.sets.filter(s => s.id !== set.id);
            settings.activeSetId = settings.sets[0].id;
        }
        save();
        fillSets();
        renderSet();
    }

    const topic = h('textarea.text_pole.xo-topic', {
        rows: 3,
        placeholder: '보고 싶은 내용 (예: 두 세계의 {{user}}가 같은 카페에서 마주친다)',
        value: settings.lastTopic,
        oninput: e => { settings.lastTopic = e.target.value; save(); },
    });

    const o = settings.options;
    const opt = (key, el) => { el.addEventListener('change', () => {
        o[key] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
        save();
    }); return el; };
    const lengthSeg = h('div.xo-seg', {}, ...LENGTHS.map(([v, l]) => h('button', {
        type: 'button',
        className: `xo-seg-btn${o.length === v ? ' xo-on' : ''}`,
        onclick: e => {
            o.length = v;
            save();
            lengthSeg.querySelectorAll('.xo-seg-btn').forEach(b => b.classList.toggle('xo-on', b === e.currentTarget));
        },
    }, l)));

    const optionsBox = h('details.xo-options', {},
        h('summary', {}, '세부 옵션'),
        h('div.xo-grid', {},
            h('div.xo-field', {}, h('span', {}, '분량'), lengthSeg),
            h('div.xo-field', {}, h('span', {}, '세계별 최근 메시지'),
                opt('recentMessages', h('input.text_pole', { type: 'number', min: 0, max: 200, value: o.recentMessages }))),
            h('div.xo-field', {}, h('span', {}, '세계별 최대 글자 수'),
                opt('charsPerWorld', h('input.text_pole', { type: 'number', min: 2000, max: 60000, step: 1000, value: o.charsPerWorld }))),
            h('div.xo-field', {}, h('span', {}, '출력 언어'),
                opt('language', h('input.text_pole', { type: 'text', value: o.language, placeholder: 'Korean' }))),
            h('div.xo-field', {}, h('span', {}, '다인봇 자동 등장인물 수'),
                opt('loreMembers', h('input.text_pole', { type: 'number', min: 0, max: 12, value: o.loreMembers }))),
            h('label.checkbox_label.xo-check', {},
                opt('includeCard', h('input', { type: 'checkbox', checked: o.includeCard })), h('span', {}, '캐릭터 카드 설정 포함')),
            h('label.checkbox_label.xo-check', {},
                opt('includeLoreSetting', h('input', { type: 'checkbox', checked: o.includeLoreSetting })), h('span', {}, '로어북 상시 항목을 세계 설정으로 포함')),
        ),
        h('div.xo-field', {}, h('span', {}, '추가 지시 (선택)'),
            opt('extraInstruction', h('textarea.text_pole', { rows: 2, value: o.extraInstruction, placeholder: '문체, 시점, 금지 사항 등' }))),
    );

    const genBtn = h('button.menu_button.xo-primary', { type: 'button', onclick: generate }, icon('wand-magic-sparkles'), ' 생성');
    const stopBtn = h('button.menu_button', { type: 'button', hidden: true, onclick: () => { cancel(); status.textContent = '중지했어요.'; } }, icon('stop'), ' 중지');
    const previewBtn = h('button.menu_button', { type: 'button', onclick: preview, title: '모델에게 보낼 내용을 확인' }, icon('eye'), ' 미리보기');
    const refreshBtn = h('button.menu_button', { type: 'button', title: '채팅을 다시 읽어오기', onclick: () => { clearCache(); renderSet(); } }, icon('rotate'));

    const setBusy = busy => {
        genBtn.disabled = busy;
        previewBtn.disabled = busy;
        stopBtn.hidden = !busy;
    };

    async function preview() {
        try {
            status.textContent = '불러오는 중…';
            const built = await prepare(getActiveSet(), topic.value, o);
            const full = `[SYSTEM]\n${built.systemPrompt}\n\n[PROMPT]\n${built.prompt}`;
            let tokens = '';
            try { tokens = ` · 약 ${(await ctx().getTokenCountAsync(full)).toLocaleString()} 토큰`; } catch { /* optional */ }
            status.textContent = '';
            const warn = built.failed.length ? `⚠ 건너뛴 세계: ${built.failed.map(f => f.label).join(', ')}\n\n` : '';
            const box = h('div.xo-root.xo-preview', {},
                h('h3', {}, '프롬프트 미리보기'),
                h('div.xo-muted', {}, `${full.length.toLocaleString()}자${tokens}`),
                h('textarea.text_pole', { readOnly: true, value: warn + full }));
            const { Popup, POPUP_TYPE } = ctx();
            await new Popup(box, POPUP_TYPE.TEXT, '', { wide: true, large: true, okButton: '닫기' }).show();
        } catch (err) {
            status.textContent = `⚠ ${err.message}`;
        }
    }

    async function generate() {
        if (isRunning()) return;
        setBusy(true);
        try {
            const result = await runCrossover(getActiveSet(), topic.value, o, s => { status.textContent = s; });
            if (!result) return;
            if (result.failed.length) toastr.warning(`건너뛴 세계: ${result.failed.map(f => f.label).join(', ')}`);
            toastr.success('채팅에 숨김 메시지로 넣었어요.');
            onDone(); // close the popup so the new message is in view
        } catch (err) {
            log.error('generation failed', err);
            status.textContent = `⚠ ${err.message}`;
        } finally {
            setBusy(false);
        }
    }

    fillSets();
    renderSet();

    pane.append(
        h('div.xo-row.xo-set-row', {},
            h('span.xo-muted', {}, '세트'),
            setSelect,
            h('button.xo-icon-btn', { type: 'button', title: '새 세트', onclick: () => setAction('new') }, icon('plus')),
            h('button.xo-icon-btn', { type: 'button', title: '복제', onclick: () => setAction('copy') }, icon('clone')),
            h('button.xo-icon-btn', { type: 'button', title: '이름 바꾸기', onclick: () => setAction('rename') }, icon('pen')),
            h('button.xo-icon-btn', { type: 'button', title: '삭제', onclick: () => setAction('delete') }, icon('trash-can')),
        ),
        worldsBox,
        addBtn,
        h('div.xo-field', {}, h('span', {}, '주제 / 보고 싶은 장면'), topic),
        optionsBox,
        h('div.xo-muted', {}, '결과는 지금 열린 채팅에 숨김 메시지로 들어가요. 번역·테마는 적용되고, AI 맥락에는 들어가지 않아요.'),
        h('div.xo-row.xo-actions', {}, refreshBtn, previewBtn, stopBtn, genBtn),
        status,
    );
    return pane;
}


/* ---------- popup ---------- */

export async function openCrossover() {
    const { Popup, POPUP_TYPE } = ctx();
    let popup = null;
    const close = () => {
        if (typeof popup?.completeAffirmative === 'function') popup.completeAffirmative();
        else root.closest('dialog')?.querySelector('.popup-button-ok')?.click();
    };
    const root = h('div.xo-root', {}, composePane(close));
    popup = new Popup(root, POPUP_TYPE.TEXT, '', { wide: true, large: true, okButton: '닫기', allowVerticalScrolling: true });
    await popup.show();
    if (isRunning()) toastr.info('창을 닫아도 생성은 계속돼요. 끝나면 지금 열린 채팅에 들어가요.');
}