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
    list.refresh();
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
