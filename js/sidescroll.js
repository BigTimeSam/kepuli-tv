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
 * The row put in a box with its two arrows. The arrows follow the row's
 * scroll, its size and its items, which may be drawn again under it.
 * @param {HTMLElement} list
 * @param {{ compact?: boolean, className?: string }} [options] compact:
 *        smaller arrows inside the row's ends, for a row in a toolbar
 */
export function sideScroll(list, { compact = false, className = '' } = {}) {
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
  box.append(prev, list, next);
  const sync = () => {
    const max = list.scrollWidth - list.clientWidth;
    prev.hidden = list.scrollLeft <= 1;
    next.hidden = list.scrollLeft >= max - 1;
  };
  list.addEventListener('scroll', sync, { passive: true });
  new ResizeObserver(sync).observe(list);
  new MutationObserver(sync).observe(list, { childList: true });
  requestAnimationFrame(sync);
  return box;
}

