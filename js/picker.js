// @ts-check
// Every drop-down in the app, with a filter field.
//
// The menus run from two choices (http, https) to a few hundred (the
// countries in the guide, the channel editor's groups), and the browser's
// own menu can only be scrolled. This one opens in its place, with a field
// that narrows the list by the words typed, wherever they sit in an
// option's name and without the marks a keyboard does not have.
//
// The <select> stays where it is and stays the control: its id, its label,
// its value, its styles, its `hidden` and every listener the app has put on
// it are untouched. Only the opening is taken over — a press or a key that
// would drop the browser's menu drops this one instead — and a choice is
// written back into the select with the input and change events the
// browser would have sent. The listeners are on the document, so a select
// made later (the media filters build theirs) is covered without being
// registered, and in the capture phase, because a dialog stops the keys it
// contains from reaching the document.
//
// The list is a popover in the top layer, so it shows over a dialog; it is
// placed inside the dialog all the same, since a modal dialog makes the
// rest of the page inert.

import { searchKey, searchTerms, matchesTerms } from './name.js';
import { t } from './i18n.js';
import { caretWelcome } from './caret.js';
import { svg } from './svg.js';

/** A list longer than this gets the filter field; a short one is read at a glance. */
export const FILTER_FROM = 7;
const GAP = 4;
const MARGIN = 8;

let open = null;   // { select, pop, input, list, items, active }
let uid = 0;

export function wirePickers(root = document) {
  root.addEventListener('mousedown', onPress, true);
  root.addEventListener('keydown', onKey, true);
  root.addEventListener('pointerdown', onOutside, true);
  // A window that changes its width moves the select from under the list.
  // Its height alone is a phone's keyboard opening for the filter, and the
  // page scrolled to keep the field in sight is the same keyboard: closed
  // on either, the list flashed and took the keyboard with it (Orion,
  // iPhone), and nothing could be typed into it.
  let width = innerWidth;
  addEventListener('resize', () => { if (innerWidth !== width) { width = innerWidth; close(); } }, { passive: true });
  root.addEventListener('scroll', (e) => {
    if (!open || open.pop.contains(/** @type {Node} */ (e.target)) || open.pop.contains(document.activeElement)) return;
    close();
  }, { capture: true, passive: true });
}

const pickable = (node) => node instanceof HTMLSelectElement && !node.multiple && !node.disabled && node.size <= 1;

function onPress(e) {
  if (e.button !== 0 || !pickable(e.target)) return;
  e.preventDefault();
  const select = e.target;
  if (open?.select === select) { close({ focus: true }); return; }
  select.focus();
  show(select);
}

function onOutside(e) {
  if (!open || open.pop.contains(e.target) || e.target === open.select) return;
  close();
}

function onKey(e) {
  if (open && open.pop.contains(e.target)) { onListKey(e); return; }
  if (!pickable(e.target) || e.ctrlKey || e.metaKey) return;
  const opener = e.key === 'Enter' || e.key === ' ' || e.key === 'F4'
    || ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.altKey);
  const typed = e.key.length === 1 && e.key !== ' ' && !e.altKey;
  // Up and Down on a closed select step through the choices, as the
  // browser's own does; that is left to it.
  if (!opener && !typed) return;
  e.preventDefault();
  e.stopPropagation();
  show(e.target, typed ? e.key : '');
}

function options(select) {
  const out = [];
  for (const node of select.children) {
    if (node instanceof HTMLOptGroupElement) {
      for (const option of node.querySelectorAll('option')) if (!option.hidden) out.push({ option, group: node.label });
    } else if (node instanceof HTMLOptionElement && !node.hidden) out.push({ option: node, group: null });
  }
  return out;
}

function show(select, typed = '') {
  close();
  const entries = options(select);
  if (!entries.length) return;
  const id = `picker-${++uid}`;
  const pop = document.createElement('div');
  pop.className = 'picker-pop';
  pop.setAttribute('popover', 'manual');
  const filterable = entries.length >= FILTER_FROM;
  let input = null;
  if (filterable) {
    input = document.createElement('input');
    input.type = 'search';
    input.className = 'picker-filter';
    input.placeholder = t('picker.filter');
    input.setAttribute('aria-label', t('picker.filter'));
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-controls', `${id}-list`);
    input.setAttribute('aria-expanded', 'true');
    input.autocomplete = 'off';
    input.spellcheck = false;
    // A magnifier, as every search field in the app has.
    const field = document.createElement('span');
    field.className = 'search-field';
    field.append(svg('<circle cx="9" cy="9" r="6"/><path d="M13.5 13.5 18 18"/>'));
    field.append(input);
    pop.append(field);
  }
  const list = document.createElement('ul');
  list.className = 'picker-list';
  list.id = `${id}-list`;
  list.setAttribute('role', 'listbox');
  list.tabIndex = filterable ? -1 : 0;
  const name = select.getAttribute('aria-label') || select.closest('label')?.querySelector('span')?.textContent || select.title;
  if (name) list.setAttribute('aria-label', name);
  const empty = document.createElement('p');
  empty.className = 'picker-empty';
  empty.textContent = t('picker.none');
  empty.hidden = true;
  pop.append(list, empty);

  const items = [];
  let group = null;
  entries.forEach(({ option, group: label }, i) => {
    if (label != null && label !== group) {
      const head = document.createElement('li');
      head.className = 'picker-group';
      head.setAttribute('role', 'presentation');
      head.textContent = label;
      list.append(head);
      group = label;
    }
    const li = document.createElement('li');
    li.id = `${id}-${i}`;
    li.className = 'picker-option';
    li.setAttribute('role', 'option');
    li.textContent = option.textContent;
    if (option.title) li.title = option.title;
    const chosen = option.value === select.value && option.selected;
    li.setAttribute('aria-selected', String(chosen));
    if (option.disabled) li.setAttribute('aria-disabled', 'true');
    li.addEventListener('mousedown', (e) => e.preventDefault());
    li.addEventListener('click', () => { if (!option.disabled) choose(option); });
    li.addEventListener('mousemove', () => setActive(items.indexOf(item)));
    const item = { li, option, key: searchKey(option.textContent), head: null };
    items.push(item);
    list.append(li);
  });
  // Each group header belongs to the options that follow it, for hiding
  // the header when the filter leaves none of them.
  let currentHead = null;
  for (const node of list.children) {
    if (node.classList.contains('picker-group')) currentHead = node;
    else items.find((item) => item.li === node).head = currentHead;
  }

  (select.closest('dialog') || document.body).append(pop);
  open = { select, pop, input, list, items, empty, active: -1 };
  select.setAttribute('aria-expanded', 'true');
  select.setAttribute('aria-controls', list.id);
  pop.showPopover();
  place();

  const current = items.findIndex((item) => item.option.selected);
  if (input) {
    input.addEventListener('input', () => filter(input.value));
    input.value = typed;
    filter(typed, current);
    // On a touch screen the list takes the focus instead, as it does for a
    // picker without a filter: the keyboard would cover the choices.
    if (caretWelcome() || typed) input.focus();
    else list.focus();
  } else {
    setActive(typed ? typeAhead(typed, current) : Math.max(0, current));
    list.focus();
  }
}

function place() {
  if (!open) return;
  const { select, pop } = open;
  const rect = select.getBoundingClientRect();
  pop.style.minWidth = `${Math.round(rect.width)}px`;
  pop.style.maxWidth = `${Math.max(rect.width, Math.min(420, innerWidth - 2 * MARGIN))}px`;
  const below = innerHeight - rect.bottom - GAP - MARGIN;
  const above = rect.top - GAP - MARGIN;
  const downward = below >= Math.min(280, pop.scrollHeight) || below >= above;
  const room = Math.max(120, downward ? below : above);
  pop.style.maxHeight = `${Math.min(room, 360)}px`;
  const height = pop.getBoundingClientRect().height;
  const width = pop.getBoundingClientRect().width;
  pop.style.left = `${Math.round(Math.min(Math.max(MARGIN, rect.left), innerWidth - width - MARGIN))}px`;
  pop.style.top = `${Math.round(downward ? rect.bottom + GAP : rect.top - GAP - height)}px`;
}

function filter(text, prefer = -1) {
  const terms = searchTerms(text);
  const { items, empty } = open;
  let first = -1;
  items.forEach((item, i) => {
    const shown = !terms.length || matchesTerms(item.key, terms);
    item.li.hidden = !shown;
    if (shown && first < 0) first = i;
  });
  for (const head of open.list.querySelectorAll('.picker-group')) {
    head.hidden = !items.some((item) => item.head === head && !item.li.hidden);
  }
  empty.hidden = first >= 0;
  setActive(prefer >= 0 && !items[prefer].li.hidden && !terms.length ? prefer : first);
  place();
}

function typeAhead(text, from) {
  const key = searchKey(text);
  const { items } = open;
  for (let step = 1; step <= items.length; step++) {
    const i = (from + step + items.length) % items.length;
    if (items[i].key.startsWith(key)) return i;
  }
  return Math.max(0, from);
}

function setActive(index) {
  if (!open) return;
  const { items, input, list } = open;
  items.forEach((item, i) => item.li.classList.toggle('active', i === index));
  open.active = index;
  const owner = input || list;
  if (index >= 0) {
    owner.setAttribute('aria-activedescendant', items[index].li.id);
    items[index].li.scrollIntoView({ block: 'nearest' });
  } else owner.removeAttribute('aria-activedescendant');
}

function step(delta) {
  const { items, active } = open;
  const visible = items.map((item, i) => (item.li.hidden ? -1 : i)).filter((i) => i >= 0);
  if (!visible.length) return;
  const at = visible.indexOf(active);
  const next = at < 0 ? (delta > 0 ? 0 : visible.length - 1) : Math.min(visible.length - 1, Math.max(0, at + delta));
  setActive(visible[next]);
}

function onListKey(e) {
  // The keys are the list's: neither the dialog nor the player's shortcuts
  // may act on them, and Escape closes the list rather than the dialog.
  e.stopPropagation();
  const { items, active, input } = open;
  const page = Math.max(1, Math.floor(open.list.clientHeight / 32));
  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); step(1); return;
    case 'ArrowUp': e.preventDefault(); step(-1); return;
    case 'PageDown': e.preventDefault(); step(page); return;
    case 'PageUp': e.preventDefault(); step(-page); return;
    case 'Home': if (!input) { e.preventDefault(); step(-items.length); } return;
    case 'End': if (!input) { e.preventDefault(); step(items.length); } return;
    case 'Enter': {
      e.preventDefault();
      const item = items[active];
      if (item && !item.li.hidden && !item.option.disabled) choose(item.option);
      return;
    }
    case 'Escape': e.preventDefault(); close({ focus: true }); return;
    case 'Tab': close({ focus: true }); return;
    default:
      if (!input && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setActive(typeAhead(e.key, active));
      }
  }
}

/**
 * The choice, written into the select by its value. The <option> the list
 * was built from may be gone by now: the app rebuilds some menus while
 * they are open — the media filters fill in years and genres as the
 * visible films' details arrive — and selecting a detached option changed
 * nothing, so the viewer's choice was dropped without a word. The value is
 * what the choice means; the select's current option with it is chosen.
 */
function choose(option) {
  const { select } = open;
  close({ focus: true });
  const current = option.isConnected && option.parentElement && select.contains(option) ? option
    : [...select.options].find((o) => o.value === option.value && !o.disabled);
  if (!current || current.selected) return;
  current.selected = true;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Whether the app's list is open for this select, for code that would rebuild its options. */
export const isPicking = (select) => open?.select === select;

function close({ focus = false } = {}) {
  if (!open) return;
  const { select, pop } = open;
  open = null;
  select.removeAttribute('aria-expanded');
  select.removeAttribute('aria-controls');
  if (pop.matches(':popover-open')) pop.hidePopover();
  pop.remove();
  if (focus && select.isConnected) select.focus();
}
