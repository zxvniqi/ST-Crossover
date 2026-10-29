// Reading view for one episode: color legend, highlighted text, copy / edit.

import { h, icon } from './dom.js';
import { copyToClipboard } from './util.js';
import { legend, parseNames } from './highlight.js';
import { renderEpisode } from './reading.js';
import { hexToRgba } from './colors.js';
import { getSettings, save } from './settings.js';
import { updateEpisode } from './archive.js';

/**
 * @param {object} episode archive item (mutated in place on edit)
 * @param {{ extraButtons?: Node[], onSaved?: () => void }} [opts]
 */
export function episodeView(episode, { extraButtons = [], onSaved = () => {} } = {}) {
    const root = h('div.xo-episode');
    let editing = false;
    let timer = 0;

    const persist = patch => {
        clearTimeout(timer);
        timer = setTimeout(() => updateEpisode(episode.id, patch).then(onSaved), 500);
    };

    const onColor = (key, hex) => {
        const settings = getSettings();
        settings.colors[key] = hex; // remembered for future episodes of the same world
        save();
        episode.marks = (episode.marks || []).map(m => (m.key === key ? { ...m, color: hex } : m));
        persist({ marks: episode.marks });
        draw();
    };

    const onNames = (key, text) => {
        const settings = getSettings();
        const extra = parseNames(text);
        settings.markNames[key] = extra; // reused by future episodes of the same world
        save();
        episode.marks = (episode.marks || []).map(m => (m.key === key ? { ...m, names: [m.label, ...extra] } : m));
        persist({ marks: episode.marks });
    };

    const namesEditor = () => h('div.xo-names', {},
        h('div.xo-muted', {}, '본문에 다르게 쓰인 이름도 칠하려면 추가하세요 (쉼표로 구분). 다음 에피소드에도 기억돼요.'),
        ...(episode.marks || []).map(m => h('div.xo-names-row', {},
            h('span.xo-chip-static', { style: `--xo-hl: ${hexToRgba(m.color, 0.55)}` }, m.label),
            h('input.text_pole', {
                type: 'text',
                value: m.names.filter(n => n !== m.label).join(', '),
                placeholder: '예: 카시안, 루시안',
                onchange: e => onNames(m.key, e.target.value),
            }))));

    const draw = () => {
        const body = editing
            ? h('textarea.text_pole.xo-output', {
                value: episode.text,
                oninput: e => { episode.text = e.target.value; persist({ text: episode.text }); },
            })
            : renderEpisode(episode.text, episode.marks);

        root.replaceChildren(...[
            legend(episode.marks, onColor),
            editing && episode.marks?.length ? namesEditor() : null,
            body,
            h('div.xo-row', {},
                h('button.menu_button', {
                    type: 'button',
                    onclick: async () => toastr.success((await copyToClipboard(episode.text)) ? '복사했어요.' : '복사하지 못했어요.'),
                }, icon('copy'), ' 복사'),
                h('button.menu_button', {
                    type: 'button',
                    onclick: () => { editing = !editing; draw(); },
                }, icon(editing ? 'check' : 'pen'), editing ? ' 편집 끝' : ' 편집 · 이름'),
                ...extraButtons,
            ),
        ].filter(Boolean));
    };

    draw();
    return root;
}
