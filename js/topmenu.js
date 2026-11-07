// The top bar's menu: where the bar's buttons go when they do not fit.
//
// A tablet held upright is some 900 CSS pixels wide, and there the bar
// broke onto two rows: the tabs and the search on one, Refresh, Help, the
// theme, full screen and Settings alone on the next, costing the lists a
// row of height. Below the width at which the bar no longer fits on one
// row, those five go into a menu behind a hamburger at the end of the bar
// and the search takes what room is left. The recordings and the account
// switch stay out: they say something (a recording under way, the account
// in use) rather than wait to be asked.
//
// Whether the bar fits is measured, not set by a breakpoint: the tabs'
// names differ by some 120 px between English and German, so any one width
// would be wrong for some language. The phone layout (600 px and less) has
// rows of its own by design and is left alone.
//
// The menu's items are made from the buttons themselves and a choice
// presses the button, so each action keeps one handler and the theme's and
// full screen's words and marks are whatever their buttons show now.

import { $ } from './dom.js';
import { sideScroll } from './sidescroll.js';

// The buttons that go into the menu, in the bar's order.
const MOVED = ['btn-refresh', 'btn-help', 'btn-theme', 'btn-screen', 'btn-settings'];
const PHONE = '(max-width: 600px)';

let bar;
let button;
let pop;

const items = () => [...pop.querySelectorAll('.popitem')];

/** What the button says, for the menu's row: its label, else its word. */
function words(source) {
  return source.getAttribute('aria-label') || source.textContent.trim();
}

/** The mark the button shows now: the sun or the moon, corners out or in. */
function mark(source) {
  const shown = [...source.querySelectorAll('svg')].find((svg) => getComputedStyle(svg).display !== 'none');
  return shown ? /** @type {SVGElement} */ (shown.cloneNode(true)) : null;
}

/** The items as the buttons are now: built at each opening. */
function build() {
  pop.replaceChildren(...MOVED.map((id) => $(id)).filter((source) => source && !source.hidden).map((source) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'popitem';
    item.setAttribute('role', 'menuitem');
    const icon = mark(source);
    if (icon) item.append(icon);
    const label = document.createElement('span');
    label.textContent = words(source);
    item.append(label);
    item.addEventListener('click', () => {
      // Closed first: Settings and Help open dialogs that take the focus,
      // and full screen wants the press's gesture, which a click keeps.
      toggle(false);
      source.click();
    });
    return item;
  }));
}

/**
 * Opens or closes the menu. focusButton returns the focus to the hamburger,
 * where a keyboard left it, as the player's own menu does.
 */
export function toggle(open, { focusButton = false } = {}) {
  const show = open ?? pop.hidden;
  if (show) build();
  pop.hidden = !show;
  button.setAttribute('aria-expanded', String(show));
  if (show) items()[0]?.focus();
  else if (focusButton) button.focus();
}

/**
 * The bar on one row with every button if it fits, else with the menu.
 * Measured with the buttons out: where the bar's parts no longer share a
 * row, the wide form does not fit.
 */
export function fitTopBar() {
  if (!bar) return;
  if (matchMedia(PHONE).matches) { bar.classList.remove('compact'); return; }
  bar.classList.remove('compact');
  const parts = [bar.querySelector('.brand'), $('tabs'), bar.querySelector('.search'), bar.querySelector('.topbar-end')];
  const middles = parts.filter(Boolean).map((part) => { const r = part.getBoundingClientRect(); return r.top + r.height / 2; });
  const wrapped = Math.max(...middles) - Math.min(...middles) > 8;
  bar.classList.toggle('compact', wrapped);
  if (!wrapped && !pop.hidden) toggle(false);
}

export function wireTopMenu() {
  bar = document.querySelector('.topbar');
  // A narrow window scrolls the tabs sideways (css/narrow.css).
  sideScroll($('tabs'), { compact: true, className: 'tabs-scroll' });
  button = $('btn-topmenu');
  pop = $('topmenu-pop');
  button.addEventListener('click', () => toggle());
  pop.addEventListener('keydown', (e) => {
    const list = items();
    const at = list.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (step) list[(at + step + list.length) % list.length]?.focus();
    else if (e.key === 'Home') list[0]?.focus();
    else if (e.key === 'End') list.at(-1)?.focus();
    else if (e.key === 'Escape') toggle(false, { focusButton: true });
    else return;
    // The page's own keys must not act on these as well: an arrow would
    // move down the channel list, Esc close a search.
    e.preventDefault();
    e.stopPropagation();
  });
  // Tabbing out closes it, and so does a press anywhere else; the button
  // is left out, or its own press would reopen what it closed.
  pop.addEventListener('focusout', (e) => {
    if (!pop.contains(/** @type {Node} */ (e.relatedTarget)) && e.relatedTarget !== button) toggle(false);
  });
  document.addEventListener('pointerdown', (e) => {
    const target = /** @type {Node} */ (e.target);
    if (!pop.hidden && !pop.contains(target) && !button.contains(target)) toggle(false);
  });
  // The window's width, and the bar's own parts: a language with longer
  // tab names, or the recordings button appearing, changes what fits.
  // The fitting waits for the next frame: done inside the observer's
  // callback it resizes the very elements observed, and the browser
  // reports a ResizeObserver loop as an error (uicheck caught it). The
  // final sizes equal the reported ones, so it settles at once.
  let pending = 0;
  const watch = new ResizeObserver(() => {
    if (!pending) pending = requestAnimationFrame(() => { pending = 0; fitTopBar(); });
  });
  watch.observe(document.documentElement);
  watch.observe($('tabs'));
  watch.observe(bar.querySelector('.topbar-end'));
  fitTopBar();
}
