// @ts-check
// A row that scrolls sideways — the start page's covers, a film's other
// copies and titles alike, the guide's days, the tabs in a narrow window —
// with a ‹ and a › over its ends for the mouse: each shown only while there
// is more that way, and a press moves by what the row shows, less one item
// so that the last stays in sight. The keyboard needs neither: a focused
// item scrolls itself into view. Moved out of js/idlehome.js, where only
// the start page had them, and a film's "Similar" row had no way along
// for a mouse without a wheel that scrolls sideways.

import { t } from './i18n.js';
import { svg } from './svg.js';

/**
 * An item of such a row brought into the row's view, whole. The browser
 * scrolls a focused item in by itself, but the arrows lie over the row's
 * ends, and an item under one, the guide's last day say, kept its ring and
 * half its name hidden: measured after the scroll, with room for a ring
 * outside the item. Called for the item that takes the focus, and for one
 * chosen with no focus on it: a tap focuses no button on an iPhone, and a
 * tab chosen at the strip's end stayed under the arrow.
 * @param {HTMLElement} list
 * @param {HTMLElement} item
 */
export function reveal(list, item) {
  item.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  requestAnimationFrame(() => {
    const arrow = (/** @type {string} */ dir) => { const a = list.parentElement?.querySelector(`:scope > .side-scroll-arrow.${dir}`); return a instanceof HTMLElement && !a.hidden ? a : null; };
    const r = item.getBoundingClientRect(), prev = arrow('prev'), next = arrow('next');
    const room = 6;
    if (next) {
      const over = r.right + room - next.getBoundingClientRect().left;
      if (over > 0) { list.scrollBy({ left: over }); return; }
    }
    if (prev) {
      const over = prev.getBoundingClientRect().right - (r.left - room);
      if (over > 0) list.scrollBy({ left: -over });
    }
  });
}

/**
 * The row put in a box with its two arrows. The arrows follow the row's
 * scroll, its size and its items, which may be drawn again under it.
 * @param {HTMLElement} list
 * @param {{ compact?: boolean, className?: string, centreOn?: string, follow?: string }} [options] compact:
 *        smaller arrows inside the row's ends, for a row in a toolbar;
 *        centreOn: the part of an item the arrows stand at the middle of,
 *        where an item is a picture with words under it; follow: the
 *        chosen item's selector, where the row marks one that nothing
 *        focuses (the guide's day in view): it is kept in sight and clear
 *        of the arrows when another is marked and when the row's width
 *        changes. The guide's "today" read "toda" under the arrow on a
 *        phone lying down.
 */
export function sideScroll(list, { compact = false, className = '', centreOn = '', follow = '' } = {}) {
  const box = document.createElement('div');
  box.className = ['side-scroll', compact ? 'compact' : '', className].filter(Boolean).join(' ');
  list.replaceWith(box);
  const arrow = (dir) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `side-scroll-arrow ${dir < 0 ? 'prev' : 'next'}`;
    button.tabIndex = -1;
    button.title = t(dir < 0 ? 'player.idle.prev' : 'player.idle.next');
    button.setAttribute('aria-label', button.title);
    button.append(svg(dir < 0 ? '<path d="m12 4-6 6 6 6"/>' : '<path d="m8 4 6 6-6 6"/>'));
    button.addEventListener('click', () => {
      const item = /** @type {HTMLElement|null} */ (list.firstElementChild);
      const step = item ? item.getBoundingClientRect().width + (parseFloat(getComputedStyle(list).columnGap) || 0) : 0;
      list.scrollBy({ left: dir * Math.max(step, list.clientWidth - step), behavior: 'smooth' });
    });
    return button;
  };
  const prev = arrow(-1), next = arrow(1);
  // The left arrow's width, as last measured while it showed.
  let prevWidth = 24;
  box.append(prev, list, next);
  const sync = () => {
    // The arrows stand at the middle of what the row shows, its scrollbar
    // left out: centred on the whole box they stood 4 px low wherever the
    // row has a scrollbar of its own (the tabs, the guide's days).
    // A row of covers with their names under them: at the covers' middle,
    // not the names' (21 px below it, the film page's similar titles).
    const part = centreOn ? list.querySelector(centreOn) : null;
    const mid = part instanceof HTMLElement
      ? part.getBoundingClientRect().top - box.getBoundingClientRect().top + part.offsetHeight / 2
      : list.offsetTop + list.clientHeight / 2;
    box.style.setProperty('--side-mid', `${mid}px`);
    const max = list.scrollWidth - list.clientWidth;
    // An arrow inside the row's end (compact) lies over the row: for a
    // scroll shorter than itself it would hide more than it leads back
    // to. The guide's days, moved 7 px to clear today of the other arrow,
    // had "Earlier" read "lier" under it.
    prev.hidden = list.scrollLeft <= (compact ? prev.offsetWidth || prevWidth : 1);
    // A hidden arrow has no width to ask: once it shows, its real one is
    // asked and kept. Under a finger it is 40 px wide, not the 24 guessed
    // for it, and a scroll of 34 px showed it over the days it led back
    // to (the guide of an iPad lying down).
    if (compact && !prev.hidden && prev.offsetWidth) {
      prevWidth = prev.offsetWidth;
      prev.hidden = list.scrollLeft <= prevWidth;
    }
    next.hidden = list.scrollLeft >= max - 1;
  };
  list.addEventListener('scroll', sync, { passive: true });
  list.addEventListener('focusin', (event) => {
    if (event.target instanceof HTMLElement && event.target !== list) reveal(list, event.target);
  });
  new ResizeObserver(sync).observe(list);
  new MutationObserver(sync).observe(list, { childList: true });
  if (follow) {
    const show = () => {
      const item = list.querySelector(follow);
      if (item instanceof HTMLElement && list.getClientRects().length) reveal(list, item);
    };
    // After sync's own observers, so that the arrows are as the row now needs them.
    new ResizeObserver(show).observe(list);
    new MutationObserver(show).observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }
  requestAnimationFrame(sync);
  return box;
}

