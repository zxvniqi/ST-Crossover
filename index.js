// 크로스오버 — writes a crossover side story where characters from several chats meet.
// Entry point: QR-bar button, wand-menu item, settings drawer and /crossover command.

import { ctx, log, setDebug, EXT_NAME } from './util.js';
import { getSettings, getDraft, save } from './settings.js';
import { h, icon } from './dom.js';
import { openPrompt, openSettings } from './ui.js';
import { runCrossover } from './runner.js';
import { clearCache } from './sources.js';
import { highlightChat, watchChat } from './chat-insert.js';

const WAND_ID = 'rf_wand_button';
const QR_ID = 'rf_qr_button';
const DRAWER_ID = 'rf_settings_drawer';

/**
 * Keep one of our elements present inside a container that other code re-renders
 * (QR rebuilds its bar, some extensions rebuild the wand menu). Re-adds only when missing.
 */
function keepPresent(watchRoot, id, attach) {
    const run = () => { if (!document.getElementById(id)) attach(); };
    run();
    if (watchRoot) new MutationObserver(run).observe(watchRoot, { childList: true, subtree: true });
}

function addWandButton() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return;
    menu.append(h('div.list-group-item.flex-container.flexGap5.interactable', {
        id: WAND_ID,
        tabIndex: 0,
        title: '여러 채팅의 캐릭터가 만나는 크로스오버',
        onclick: () => openPrompt(),
    }, h('div.fa-solid.fa-shuffle.extensionsMenuExtensionButton'), h('span', {}, EXT_NAME)));
}

/** A button in front of the Quick Reply buttons above the input box, like a QR. */
function addQrButton() {
    const bar = document.getElementById('qr--bar');
    if (!bar) return; // QR disabled: the wand item still works
    bar.prepend(h('div.qr--buttons', {},
        h('div.qr--button.menu_button.interactable', {
            id: QR_ID,
            title: '크로스오버 쓰기 (⚙ 로 채팅 고르기)',
            onclick: () => openPrompt(),
        }, EXT_NAME)));
}

function addSettingsDrawer() {
    if (document.getElementById(DRAWER_ID)) return;
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host) return;
    const settings = getSettings();
    const debug = h('input', {
        type: 'checkbox',
        checked: settings.debug,
        onchange: e => { settings.debug = e.target.checked; setDebug(settings.debug); save(); },
    });
    host.append(h('div', { id: DRAWER_ID },
        h('div.inline-drawer', {},
            h('div.inline-drawer-toggle.inline-drawer-header', {},
                h('b', {}, EXT_NAME),
                h('div.inline-drawer-icon.fa-solid.fa-circle-chevron-down.down')),
            h('div.inline-drawer-content', {},
                h('p', {}, '입력창 위 QR 바의 버튼(또는 마법봉 메뉴)으로 열어요. 결과는 열린 채팅에 숨김 메시지로 들어가요.'),
                h('div.flex-container', {},
                    h('button.menu_button', { type: 'button', onclick: () => openPrompt() }, icon('pen'), ' 쓰기'),
                    h('button.menu_button', { type: 'button', onclick: () => openSettings() }, icon('gear'), ' 채팅 고르기')),
                h('label.checkbox_label', {}, debug, h('span', {}, '디버그 로그 (F12 콘솔)')),
            ),
        ),
    ));
}
function registerCommand() {
    const { SlashCommandParser, SlashCommand, SlashCommandArgument, SlashCommandNamedArgument, ARGUMENT_TYPE } = ctx();
    if (!SlashCommandParser?.addCommandObject) return;
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'crossover',
        returns: 'the generated episode text',
        helpString: '<div>지금 고른 채팅(또는 저장된 세트)으로 크로스오버를 생성해 열린 채팅에 숨김 메시지로 넣고 본문을 반환합니다. 인자 없이 쓰면 입력창을 엽니다.</div>'
            + '<div>예: <code>/crossover 두 사람이 같은 카페에서 마주친다</code>, <code>/crossover set="세트 2" 비 오는 날</code></div>',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({ name: 'set', description: '저장된 세트 이름 (생략하면 지금 고른 채팅)', typeList: [ARGUMENT_TYPE.STRING] }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({ description: '주제', typeList: [ARGUMENT_TYPE.STRING] }),
        ],
        callback: async (args, value) => {
            const topic = String(value ?? '').trim();
            if (!topic && !args.set) {
                openPrompt();
                return '';
            }
            const config = args.set ? getSettings().sets.find(s => s.name === String(args.set)) : getDraft();
            if (!config) {
                toastr.error(`세트를 찾을 수 없어요: ${args.set}`);
                return '';
            }
            try {
                const result = await runCrossover(config, topic);
                if (!result) return '';
                toastr.success('채팅에 숨김 메시지로 넣었어요.');
                return result.text;
            } catch (err) {
                log.error(err);
                toastr.error(err.message);
                return '';
            }
        },
    }));
}

function registerDebug() {
    const { registerDebugFunction } = ctx();
    if (typeof registerDebugFunction !== 'function') return;
    registerDebugFunction('rf_dump', `${EXT_NAME}: 설정 출력`, '현재 설정을 콘솔에 출력합니다.', () => {
        console.log(`[${EXT_NAME}] settings`, structuredClone(getSettings()));
        toastr.info('F12 콘솔에 출력했어요.');
    });
    registerDebugFunction('rf_clear_cache', `${EXT_NAME}: 캐시 비우기`, '불러온 채팅 캐시를 비웁니다.', () => {
        clearCache();
        toastr.info('캐시를 비웠어요.');
    });
}

let initialized = false;

function init() {
    if (initialized) return;
    initialized = true;
    try {
        const settings = getSettings();
        setDebug(settings.debug);
        keepPresent(document.getElementById('extensionsMenu'), WAND_ID, addWandButton);
        keepPresent(document.getElementById('send_form'), QR_ID, addQrButton);
        addSettingsDrawer();
        watchChat();
        registerCommand();
        registerDebug();
        // The archive was removed in 0.2.0; drop its leftover storage.
        SillyTavern.libs?.localforage?.removeItem('crossover_episodes_archive').catch(() => {});
        log.info('loaded');
    } catch (err) {
        log.error('init failed', err);
    }
}

const { eventSource, event_types } = ctx();
// The wand menu and input form are static page markup and settings are loaded before extensions run,
// so set up right away instead of waiting for the chat to finish loading (APP_READY).
if (document.getElementById('extensionsMenu')) init();
else eventSource.on(event_types.APP_INITIALIZED ?? event_types.APP_READY, init);
// The chat we just left may have new messages on disk; drop cached copies so the next read is fresh.
eventSource.on(event_types.CHAT_CHANGED, () => {
    clearCache();
    highlightChat();
});
// Messages get re-rendered on load, edit, swipe and translation; paint the highlights again each time.
for (const name of ['MORE_MESSAGES_LOADED', 'MESSAGE_UPDATED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED', 'CHARACTER_MESSAGE_RENDERED']) {
    if (event_types[name]) eventSource.on(event_types[name], highlightChat);
}
