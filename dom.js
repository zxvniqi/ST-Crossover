// Tiny DOM helpers so UI code stays declarative without a framework.

/**
 * h('button.rf-btn', { onclick, title }, 'Text', child)
 * Tag string supports ".class" suffixes. Props starting with "on" become listeners.
 */
export function h(tag, props = {}, ...children) {
    const [name, ...classes] = tag.split('.');
    const el = document.createElement(name || 'div');
    if (classes.length) el.classList.add(...classes);
    for (const [key, value] of Object.entries(props || {})) {
        if (value == null || value === false) continue;
        if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
        else if (key === 'dataset') Object.assign(el.dataset, value);
        else if (key in el && key !== 'list' && key !== 'style') el[key] = value;
        else el.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
        if (child == null || child === false) continue;
        el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
}

export function icon(name) {
    return h(`i.fa-solid.fa-${name}`);
}

/**
 * A <select> with a filter box above it — usable with hundreds of options.
 * @param {{ options: {value: string, label: string}[], value: string, placeholder?: string, onChange: (v: string) => void }} cfg
 */
export function searchSelect({ options, value, placeholder = '검색…', onChange }) {
    const select = h('select.rf-input');
    const filter = h('input.rf-input.rf-filter', { type: 'search', placeholder });

    const fill = () => {
        const q = filter.value.trim().toLowerCase();
        const shown = q ? options.filter(o => o.label.toLowerCase().includes(q) || o.value === value) : options;
        // The current value always stays in the list so filtering never changes the selection silently.
        select.replaceChildren(...shown.map(o => h('option', { value: o.value, selected: o.value === value }, o.label)));
    };
    filter.addEventListener('input', fill);
    select.addEventListener('change', () => {
        value = select.value;
        onChange(value);
    });
    fill();

    // Hide the filter when the list is short.
    return h('div.rf-stack', {}, options.length > 12 ? filter : null, select);
}
