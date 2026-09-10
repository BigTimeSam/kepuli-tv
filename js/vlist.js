// A light virtualised list: only the visible rows are painted, so a list
// of 55,000 movies scrolls as smoothly as a list of ten.
//
// Rows are the same height by default, which makes the visible range a
// division. Collection views need section headings, so a row may be
// taller than the others when it wants to: then the heights are summed
// once up front and the range is found by binary search.

/**
 * A CSS length as the browser has resolved it, in pixels.
 *
 * The row heights are written in rem so that they grow with the reader's own
 * font setting, which means the number a virtualised list divides by is no
 * longer a constant anyone can write down. It is asked for instead, and asked
 * for again whenever the setting changes — see watchLength.
 */
export function cssPixels(name, fallback) {
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;width:0;height:var(${name})`;
  document.body.appendChild(probe);
  const px = probe.getBoundingClientRect().height;
  probe.remove();
  return px > 0 ? px : fallback;
}

/**
 * The same, watched: onChange is called whenever the resolved length moves,
 * which is what happens when the browser's default font size is changed under
 * a running page. The probe stays in the document for the observer to watch.
 */
export function watchLength(name, fallback, onChange) {
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;width:0;height:var(${name})`;
  probe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(probe);
  let last = probe.getBoundingClientRect().height || fallback;
  new ResizeObserver(() => {
    const px = probe.getBoundingClientRect().height;
    if (px > 0 && Math.abs(px - last) > 0.5) { last = px; onChange(px); }
  }).observe(probe);
  return last;
}

export class VirtualList {
  /**
   * @param {HTMLElement} viewport the scrolling container
   * @param {number} rowHeight default row height in pixels
   * @param {(index:number)=>HTMLElement} renderRow
   * @param {{overscan?:number, onVisible?:(first:number,last:number)=>void, onPaint?:()=>void}} [options]
   */
  constructor(viewport, rowHeight, renderRow, options = {}) {
    this.viewport = viewport;
    this.rowHeight = rowHeight;
    this.renderRow = renderRow;
    this.overscan = options.overscan ?? 6;
    this.onVisible = options.onVisible || null;
    this.onPaint = options.onPaint || null;
    this.count = 0;
    this.offsets = null;      // null = every row is the same height
    this.ticking = false;
    this.nodes = new Map();   // index → element, kept for reuse

    this.spacer = document.createElement('div');
    this.spacer.className = 'vlist-spacer';
    this.window = document.createElement('div');
    this.window.className = 'vlist-window';
    this.spacer.appendChild(this.window);
    viewport.appendChild(this.spacer);

    this.onScroll = () => {
      if (this.ticking) return;
      this.ticking = true;
      requestAnimationFrame(() => { this.ticking = false; this.paint(); });
    };
    viewport.addEventListener('scroll', this.onScroll, { passive: true });
    this.resizeObserver = new ResizeObserver(() => this.paint());
    this.resizeObserver.observe(viewport);
  }

  /**
   * @param {number} count
   * @param {{keepScroll?:boolean, heightAt?:(index:number)=>number}} [options]
   *   heightAt is given only when the rows differ in height.
   */
  setCount(count, { keepScroll = false, heightAt = null } = {}) {
    this.count = count;
    this.offsets = heightAt ? buildOffsets(count, heightAt) : null;
    this.spacer.style.height = `${this.offsetOf(count)}px`;
    if (!keepScroll) this.viewport.scrollTop = 0;
    this.paint();
  }

  refresh() { this.paint(); }

  /** The rows are taller or shorter than they were: re-measure and repaint. */
  setRowHeight(rowHeight, heightAt = null) {
    if (rowHeight === this.rowHeight && !heightAt) return;
    this.rowHeight = rowHeight;
    this.offsets = heightAt ? buildOffsets(this.count, heightAt) : null;
    this.spacer.style.height = `${this.offsetOf(this.count)}px`;
    this.paint();
  }

  /** Repaints one row if it is visible, keeping the focus it holds. */
  refreshRow(index) {
    if (!this.nodes.has(index)) return;
    const held = this.heldFocus();
    const fresh = this.renderRow(index);
    this.window.replaceChild(fresh, this.nodes.get(index));
    this.nodes.set(index, fresh);
    if (held?.index === index) descend(fresh, held.path)?.focus?.({ preventScroll: true });
    this.onPaint?.();
  }

  offsetOf(index) {
    return this.offsets ? this.offsets[index] : index * this.rowHeight;
  }

  heightOf(index) {
    return this.offsets ? this.offsets[index + 1] - this.offsets[index] : this.rowHeight;
  }

  /** The first row whose bottom edge passes the given offset. */
  indexAt(px) {
    if (!this.offsets) return Math.floor(px / this.rowHeight);
    let lo = 0;
    let hi = this.count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.offsets[mid + 1] <= px) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  scrollToIndex(index) {
    const top = this.offsetOf(index);
    const height = this.heightOf(index);
    const { scrollTop, clientHeight } = this.viewport;
    if (top < scrollTop) this.viewport.scrollTop = top;
    else if (top + height > scrollTop + clientHeight) {
      this.viewport.scrollTop = top + height - clientHeight;
    }
  }

  visibleRange() {
    const { scrollTop, clientHeight } = this.viewport;
    const first = Math.max(0, this.indexAt(scrollTop) - this.overscan);
    const last = Math.min(this.count, this.indexAt(scrollTop + clientHeight) + 1 + this.overscan);
    return [first, last];
  }

  paint() {
    const [first, last] = this.visibleRange();
    // Every paint builds the rows again, so a control the viewer is using
    // would lose the focus under it — and a paint is queued by a scroll,
    // which is exactly what moving a row with the keyboard causes. The
    // place the focus held is found again in the row that replaces it.
    const held = this.heldFocus();
    const frag = document.createDocumentFragment();
    this.nodes.clear();
    for (let i = first; i < last; i++) {
      const node = this.renderRow(i);
      this.nodes.set(i, node);
      frag.appendChild(node);
    }
    this.window.replaceChildren(frag);
    this.window.style.transform = `translateY(${this.offsetOf(first)}px)`;
    if (held) {
      // preventScroll: putting the focus back must not scroll the list out
      // from under the scroll that caused this paint.
      descend(this.nodes.get(held.index), held.path)?.focus?.({ preventScroll: true });
    }
    this.onPaint?.();
    if (this.onVisible) this.onVisible(first, last);
  }

  /** Which row the focus is in, and where inside it. */
  heldFocus() {
    const active = document.activeElement;
    if (!active || !this.window.contains(active)) return null;
    for (const [index, node] of this.nodes) {
      if (node.contains(active)) return { index, path: pathTo(node, active) };
    }
    return null;
  }
}

/** A node's position inside a row, as the child index at every step down. */
function pathTo(root, node) {
  const path = [];
  for (let el = node; el && el !== root && el.parentElement; el = el.parentElement) {
    path.unshift([...el.parentElement.children].indexOf(el));
  }
  return path;
}

function descend(root, path) {
  let el = root;
  for (const i of path) el = el?.children[i];
  return el;
}

/** Cumulative start offsets; offsets[count] = total height. */
function buildOffsets(count, heightAt) {
  const offsets = new Float64Array(count + 1);
  for (let i = 0; i < count; i++) offsets[i + 1] = offsets[i] + heightAt(i);
  return offsets;
}
