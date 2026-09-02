// A light virtualised list: only the visible rows are painted, so a list
// of 55,000 movies scrolls as smoothly as a list of ten.
//
// Rows are the same height by default, which makes the visible range a
// division. Collection views need section headings, so a row may be
// taller than the others when it wants to: then the heights are summed
// once up front and the range is found by binary search.

export class VirtualList {
  /**
   * @param {HTMLElement} viewport the scrolling container
   * @param {number} rowHeight default row height in pixels
   * @param {(index:number)=>HTMLElement} renderRow
   * @param {{overscan?:number, onVisible?:(first:number,last:number)=>void}} [options]
   */
  constructor(viewport, rowHeight, renderRow, options = {}) {
    this.viewport = viewport;
    this.rowHeight = rowHeight;
    this.renderRow = renderRow;
    this.overscan = options.overscan ?? 6;
    this.onVisible = options.onVisible || null;
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

  /** Repaints one row if it is visible. */
  refreshRow(index) {
    if (!this.nodes.has(index)) return;
    const fresh = this.renderRow(index);
    this.window.replaceChild(fresh, this.nodes.get(index));
    this.nodes.set(index, fresh);
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
    const frag = document.createDocumentFragment();
    this.nodes.clear();
    for (let i = first; i < last; i++) {
      const node = this.renderRow(i);
      this.nodes.set(i, node);
      frag.appendChild(node);
    }
    this.window.replaceChildren(frag);
    this.window.style.transform = `translateY(${this.offsetOf(first)}px)`;
    if (this.onVisible) this.onVisible(first, last);
  }
}

/** Cumulative start offsets; offsets[count] = total height. */
function buildOffsets(count, heightAt) {
  const offsets = new Float64Array(count + 1);
  for (let i = 0; i < count; i++) offsets[i + 1] = offsets[i] + heightAt(i);
  return offsets;
}
