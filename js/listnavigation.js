// Selection and return positions belong to items, not to transient DOM rows.
const keyOf = item => item ? `${item.k}:${item.id}` : null;
export const rowDomId = index => `row-${index}`;

export class ListNavigation {
  constructor(viewport) {
    this.viewport = viewport;
    this.rows = [];
    this.index = -1;
    this.pendingKey = null;
  }

  select(index) {
    this.index = Number.isInteger(index) && index >= 0 && index < this.rows.length ? index : -1;
    this.sync();
  }

  setRows(rows, { loading = false, keepSelection = false } = {}) {
    const key = keepSelection ? keyOf(this.rows[this.index]) || this.pendingKey : null;
    this.pendingKey = loading ? key : null;
    this.rows = rows;
    this.index = key ? rows.findIndex(item => keyOf(item) === key) : -1;
    this.sync();
  }

  // Called after every virtual-list paint, including a pointer scroll that
  // takes the selected item out of the DOM. Never name a missing descendant.
  sync() {
    let active = null;
    for (const row of this.viewport.querySelectorAll('[role="option"]')) {
      const index = Number(row.id.replace('row-', ''));
      const selected = index === this.index;
      row.setAttribute('aria-selected', String(selected));
      row.classList.toggle('selected', selected);
      row.setAttribute('aria-posinset', String(index + 1));
      row.setAttribute('aria-setsize', String(this.rows.length));
      if (selected) active = row.id;
    }
    if (active) this.viewport.setAttribute('aria-activedescendant', active);
    else this.viewport.removeAttribute('aria-activedescendant');
  }

  move(delta, list) {
    if (!this.rows.length) return;
    this.select(this.index < 0 ? 0 : Math.max(0, Math.min(this.rows.length - 1, this.index + delta)));
    list.scrollToIndex(this.index);
    // The rows in sight are kept and only those a scroll brought in are
    // built: the cursor is a class select() has already moved (sync). A
    // full refresh built every cover again as a new image, hidden until it
    // loaded, and the covers blinked at every arrow.
    list.paint({ reuse: true });
  }

  capture(list) {
    const top = Math.max(0, Math.min(this.rows.length - 1, list.indexAt(this.viewport.scrollTop)));
    return {
      selectedKey: keyOf(this.rows[this.index]),
      topKey: keyOf(this.rows[top]),
      inset: this.viewport.scrollTop - list.offsetOf(top),
      scrollTop: this.viewport.scrollTop,
    };
  }

  restore(list, position, { focus = false } = {}) {
    if (!position) return;
    this.select(this.rows.findIndex(item => keyOf(item) === position.selectedKey));
    const top = this.rows.findIndex(item => keyOf(item) === position.topKey);
    this.viewport.scrollTop = top < 0 ? position.scrollTop : list.offsetOf(top) + position.inset;
    list.refresh();
    if (focus) this.viewport.focus({ preventScroll: true });
  }
}

/**
 * The tile an arrow leads to, from the tiles' boxes in the page's order:
 * left and right go a tile back or on, Home and End to the ends, up and
 * down to the nearest tile in the row above or below. -1 where there is
 * none that way.
 *
 * @param {{left: number, top: number, right: number, bottom: number}[]} rects
 */
export function neighbourTile(rects, at, key) {
  if (key === 'ArrowRight') return at + 1 < rects.length ? at + 1 : -1;
  if (key === 'ArrowLeft') return at > 0 ? at - 1 : -1;
  if (key === 'Home') return rects.length ? 0 : -1;
  if (key === 'End') return rects.length - 1;
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return -1;
  const here = rects[at];
  const centre = (r) => (r.left + r.right) / 2;
  const down = key === 'ArrowDown';
  // The row next that way: the nearest top below this tile's bottom, or
  // the nearest bottom above its top.
  const candidates = rects.map((r, i) => ({ r, i }))
    .filter(({ r }) => (down ? r.top >= here.bottom - 1 : r.bottom <= here.top + 1));
  if (!candidates.length) return -1;
  const edge = down ? Math.min(...candidates.map(({ r }) => r.top)) : Math.max(...candidates.map(({ r }) => r.bottom));
  const row = candidates.filter(({ r }) => Math.abs((down ? r.top : r.bottom) - edge) < 2);
  row.sort((a, b) => Math.abs(centre(a.r) - centre(here)) - Math.abs(centre(b.r) - centre(here)));
  return row[0].i;
}

/**
 * How far one step of the remote's left or right moves the place in a
 * film, in seconds, by how long the key has been held (js/remote.js): ten
 * seconds a press, and held down longer and longer steps, so that an hour
 * away is some six seconds of holding and not three hundred presses.
 * @param {number} heldMs
 */
export function scrubStep(heldMs) {
  if (heldMs < 1000) return 10;
  if (heldMs < 2500) return 30;
  if (heldMs < 5000) return 60;
  return 180;
}

/**
 * The box an arrow leads to from another, among boxes anywhere on the
 * page (js/remote.js): the nearest one that way among those in line with
 * the first, however far, and only with none in line the nearest one off
 * to the side. A column a pixel to the left would otherwise take the
 * arrow from the field straight below. -1 where there is none that way.
 *
 * @typedef {{left: number, top: number, right: number, bottom: number}} Box
 * @param {Box} from
 * @param {Box[]} boxes
 * @param {number[]} way [1, 0] right, [-1, 0] left, [0, 1] down, [0, -1] up
 */
export function towards(from, boxes, [dx, dy]) {
  let best = -1;
  let bestScore = Infinity;
  boxes.forEach((box, i) => {
    const centre = dx ? (box.left + box.right - from.left - from.right) * dx : (box.top + box.bottom - from.top - from.bottom) * dy;
    const ahead = dx ? (dx > 0 ? box.left - from.right : from.left - box.right) : (dy > 0 ? box.top - from.bottom : from.top - box.bottom);
    // A box beside this one, however tall, is not above or below it.
    if (centre <= 0 || ahead < -4) return;
    // How far off the line: nothing while the two overlap across it.
    const aside = dx ? Math.max(0, box.top - from.bottom, from.top - box.bottom) : Math.max(0, box.left - from.right, from.left - box.right);
    const score = Math.max(0, ahead) + (aside ? 100000 + aside * 3 : 0);
    if (score < bestScore) { bestScore = score; best = i; }
  });
  return best;
}
