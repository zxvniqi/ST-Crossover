// Crossover Episodes — writes a side story where characters from several chats meet.
// Entry point: wires the wand-menu button, settings drawer and /crossover command.

import { ctx, log, setDebug } from './util.js';
import { getSettings, save } from './settings.js';
import { h, icon } from './dom.js';
import { openCrossover } from './ui.js';
import { runCrossover } from './runner.js';
import { clearCache } from './sources.js';
import { highlightChat, watchChat } from './chat-insert.js';

const WAND_ID = 'xo_wand_button';
const DRAWER_ID = 'xo_settings_drawer';

let wandObserver = null;

/** Other extensions sometimes rebuild the wand menu; re-add our button only when it goes missing. */
function addWandButton() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return log.warn('#extensionsMenu not found; wand button skipped');
    if (wandObserver?.target !== menu) {
        wandObserver?.disconnect();
        wandObserver = new MutationObserver(() => {
            if (!document.getElementById(WAND_ID)) addWandButton();
        });
        wandObserver.observe(menu, { childList: true });
        wandObserver.target = menu;
    }
    if (document.getElementById(WAND_ID)) return;
    menu.append(h('div.list-group-item.flex-container.flexGap5.interactable', {
        id: WAND_ID,
        tabIndex: 0,
        title: '여러 채팅의 캐릭터가 만나는 크로스오버 에피소드',
        onclick: () => openCrossover(),
    }, h('div.fa-solid.fa-shuffle.extensionsMenuExtensionButton'), h('span', {}, '크로스오버 에피소드')));
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
    host.append(h('div.xo-drawer', { id: DRAWER_ID },
        h('div.inline-drawer', {},
            h('div.inline-drawer-toggle.inline-drawer-header', {},
                h('b', {}, '크로스오버 에피소드'),
                h('div.inline-drawer-icon.fa-solid.fa-circle-chevron-down.down')),
            h('div.inline-drawer-content', {},
                h('p.xo-muted', {}, '마법봉 메뉴 → "크로스오버 에피소드" 또는 /crossover 주제. 결과는 열린 채팅에 숨김 메시지로 들어가요.'),
                h('div.flex-container', {},
                    h('button.menu_button', { type: 'button', onclick: () => openCrossover() }, icon('shuffle'), ' 열기')),
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
        helpString: '<div>선택한 세트로 크로스오버 에피소드를 생성해 열린 채팅에 숨김 메시지로 넣고 본문을 반환합니다. 인자 없이 쓰면 창을 엽니다.</div>'
            + '<div>예: <code>/crossover 두 사람이 같은 카페에서 마주친다</code>, <code>/crossover set="세트 2" 비 오는 날</code></div>',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({ name: 'set', description: '세트 이름 (생략하면 현재 세트)', typeList: [ARGUMENT_TYPE.STRING] }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({ description: '주제', typeList: [ARGUMENT_TYPE.STRING] }),
        ],
        callback: async (args, value) => {
            const topic = String(value ?? '').trim();
            const settings = getSettings();
            if (!topic && !args.set) {
                openCrossover();
                return '';
            }
            const set = args.set
                ? settings.sets.find(s => s.name === String(args.set))
                : settings.sets.find(s => s.id === settings.activeSetId);
            if (!set) {
                toastr.error(`세트를 찾을 수 없어요: ${args.set}`);
                return '';
            }
            try {
                const result = await runCrossover(set, topic);
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
    registerDebugFunction('xo_dump', 'Crossover: 설정 출력', '현재 설정을 콘솔에 출력합니다.', () => {
        console.log('[Crossover] settings', structuredClone(getSettings()));
        toastr.info('F12 콘솔에 출력했어요.');
    });
    registerDebugFunction('xo_clear_cache', 'Crossover: 캐시 비우기', '불러온 채팅 캐시를 비웁니다.', () => {
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
        addWandButton();
        // Backup for when the whole menu element is replaced: check again whenever the wand opens.
        document.addEventListener('click', e => {
            if (e.target instanceof Element && e.target.closest('#extensionsMenuButton')) addWandButton();
        }, true);
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
// The wand menu is static page markup and settings are loaded before extensions run,
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
