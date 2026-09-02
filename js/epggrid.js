// The interactive programme guide: channels as rows, time on the
// horizontal axis.
//
// Both axes are virtualised. 500 channels × 7 days would be hundreds of
// thousands of elements, so only the screenful that is really visible gets
// painted — for the same reason as the list (vlist.js). The grid lines come
// from a background pattern rather than from the DOM, which makes a canvas
// 46,000 pixels wide cost nothing.
//
// The time axis has its zero at midnight: that way the half-hour grid and
// the day boundaries line up with the background pattern without an
// offset.

import { clock, shortDay, stampFmt, progressOf } from './format.js';
import { t } from './i18n.js';

const ROW_H = 48;              // keep in step with --epg-row in the CSS
const ZOOMS = [2, 3, 5, 8];    // pixels per minute
const PAST_DAYS = 2;
const FUTURE_DAYS = 5;
const SLOT_MIN = 30;
const MARGIN_MIN = 90;         // buffer painted outside the visible area
const LEAD_MIN = 15;           // how much of the past shows at the "Now" position
const TICK_MS = 20e3;

/** Is the programme watchable from the channel's catch-up window? */
export function catchupAvailable(channel, programme, now = Date.now()) {
  if (!channel || !programme || !channel.archive) return false;
  if (programme.stop > now) return false;
  return programme.start > now - channel.archive * 86400e3;
}

export class EpgGrid {
  /**
   * @param {object} refs { scroll, canvas, timesInner, chansInner, corner, days, clock }
   * @param {object} opts { label, onSelect, onActivate, onChannel, onWindow }
   */
  constructor(refs, opts = {}) {
    this.el = refs;
    this.epg = null;               // set once the connection is open
    this.channels = [];
    this.playingId = null;
    this.zoomIndex = 2;
    this.origin = 0;
    this.end = 0;
    this.width = 0;
    this.focusTime = Date.now();
    this.cursorRow = 0;
    this.selection = null;         // { row, programme }
    this.open = false;
    this.ticking = false;
    this.timer = null;
    this.lastWindowKey = '';
    this.dayButtons = [];

    this.label = opts.label || ((channel) => channel.n);
    this.onSelect = opts.onSelect || (() => {});
    this.onActivate = opts.onActivate || (() => {});
    this.onChannel = opts.onChannel || (() => {});
    this.onWindow = opts.onWindow || (() => {});

    this.nowLine = document.createElement('div');
    this.nowLine.className = 'epg-nowline';
    this.nowHead = document.createElement('div');
    this.nowHead.className = 'epg-nowhead';

    this.el.scroll.addEventListener('scroll', () => this.schedule(), { passive: true });
    this.resizeObserver = new ResizeObserver(() => this.paint());
    this.resizeObserver.observe(this.el.scroll);
    this.el.canvas.addEventListener('click', (e) => this.pick(e, false));
    this.el.canvas.addEventListener('dblclick', (e) => this.pick(e, true));
    this.el.chansInner.addEventListener('click', (e) => {
      const row = e.target.closest('[data-row]');
      if (row) this.onChannel(this.channels[Number(row.dataset.row)]);
    });
  }

  get zoom() { return ZOOMS[this.zoomIndex]; }

  /* ---------------------------------------------------------- aika-akseli */

  minutes(ms) { return (ms - this.origin) / 60000; }
  x(ms) { return this.minutes(ms) * this.zoom; }
  timeAt(px) { return this.origin + (px / this.zoom) * 60000; }

  /**
   * The timeline's dimensions and fixed parts. Does not paint: painting
   * also requests programme data for the visible channels, so it must wait
   * until the scroll is in the right place — otherwise the wrong window's
   * data gets fetched.
   */
  layout() {
    const midnight = new Date().setHours(0, 0, 0, 0);
    this.origin = startOfDay(midnight, -PAST_DAYS);
    this.end = startOfDay(midnight, FUTURE_DAYS);
    this.width = this.minutes(this.end) * this.zoom;

    this.el.canvas.style.width = `${this.width}px`;
    this.el.timesInner.style.width = `${this.width}px`;
    this.el.canvas.style.setProperty('--slot', `${SLOT_MIN * this.zoom}px`);
    this.el.canvas.style.setProperty('--hour', `${60 * this.zoom}px`);

    this.renderTicks();
    this.renderDays();
  }

  renderTicks() {
    const frag = document.createDocumentFragment();
    const total = this.minutes(this.end);
    for (let m = 0; m < total; m += SLOT_MIN) {
      const at = this.origin + m * 60000;
      const d = new Date(at);
      const midnight = d.getHours() === 0 && d.getMinutes() === 0;
      const tick = document.createElement('div');
      tick.className = 'epg-tick'
        + (d.getMinutes() === 0 ? ' hour' : '')
        + (midnight ? ' day' : '');
      tick.style.left = `${m * this.zoom}px`;
      tick.style.width = `${SLOT_MIN * this.zoom}px`;
      tick.textContent = midnight ? shortDay(at) : clock(at);
      frag.appendChild(tick);
    }
    this.el.timesInner.replaceChildren(frag);
    this.el.timesInner.appendChild(this.nowHead);
  }

  renderDays() {
    const frag = document.createDocumentFragment();
    this.dayButtons = [];
    for (let at = this.origin; at < this.end; at = startOfDay(at, 1)) {
      const day = at;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'epg-day';
      button.textContent = shortDay(day);
      button.addEventListener('click', () => this.goDay(day));
      this.dayButtons.push({ at: day, node: button });
      frag.appendChild(button);
    }
    this.el.days.replaceChildren(frag);
  }

  /* ------------------------------------------------------------ painting */

  schedule() {
    if (this.ticking) return;
    this.ticking = true;
    requestAnimationFrame(() => { this.ticking = false; this.paint(); });
  }

  paint() {
    if (!this.open || !this.width) return;
    const { scrollLeft, scrollTop, clientWidth, clientHeight } = this.el.scroll;

    // The header row and the channel column follow the scroll by
    // translating; their own scrollbars would show three overlapping bars.
    this.el.timesInner.style.transform = `translateX(${-scrollLeft}px)`;
    this.el.chansInner.style.transform = `translateY(${-scrollTop}px)`;

    const from = this.timeAt(scrollLeft);
    const to = this.timeAt(scrollLeft + clientWidth);
    const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 2);
    const last = Math.min(this.channels.length, Math.ceil((scrollTop + clientHeight) / ROW_H) + 2);

    this.paintChannels(first, last);
    this.paintBlocks(first, last, scrollLeft, clientWidth);
    this.moveNow();

    this.el.corner.textContent = shortDay(from);
    for (const day of this.dayButtons) {
      day.node.classList.toggle('active', from >= day.at && from < startOfDay(day.at, 1));
    }

    const key = `${first}:${last}:${Math.round(from / 6e5)}:${Math.round(to / 6e5)}`;
    if (key !== this.lastWindowKey) {
      this.lastWindowKey = key;
      this.onWindow(this.channels.slice(first, last), from, to);
    }
  }

  paintChannels(first, last) {
    const frag = document.createDocumentFragment();
    for (let i = first; i < last; i++) {
      const ch = this.channels[i];
      const row = document.createElement('div');
      row.className = 'epg-chan'
        + (String(ch.id) === String(this.playingId) ? ' playing' : '')
        + (i === this.cursorRow ? ' cursor' : '');
      row.dataset.row = String(i);
      row.style.top = `${i * ROW_H}px`;
      row.title = ch.n;

      const img = document.createElement('img');
      img.className = 'epg-chan-logo';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = '';
      if (ch.logo) img.src = ch.logo; else img.classList.add('blank');
      img.addEventListener('error', () => img.classList.add('blank'), { once: true });
      row.appendChild(img);

      const body = document.createElement('div');
      body.className = 'epg-chan-body';
      if (ch.num) {
        const num = document.createElement('span');
        num.className = 'epg-chan-num';
        num.textContent = String(ch.num).padStart(4, '0');
        body.appendChild(num);
      }
      const name = document.createElement('span');
      name.className = 'epg-chan-name';
      name.textContent = this.label(ch);
      body.appendChild(name);
      row.appendChild(body);

      if (ch.archive > 0) {
        const badge = document.createElement('span');
        badge.className = 'epg-chan-rec';
        badge.textContent = t('row.archive', { days: ch.archive });
        badge.title = t('guide.catchup.title', { days: ch.archive });
        row.appendChild(badge);
      }
      frag.appendChild(row);
    }
    this.el.chansInner.replaceChildren(frag);
  }

  paintBlocks(first, last, scrollLeft, clientWidth) {
    const now = Date.now();
    const visFrom = this.timeAt(scrollLeft);
    const visTo = this.timeAt(scrollLeft + clientWidth);
    const margin = MARGIN_MIN * 60000;
    const frag = document.createDocumentFragment();

    for (let i = first; i < last; i++) {
      const ch = this.channels[i];
      const listings = this.epg ? this.epg.listingsIn(ch.id, visFrom - margin, visTo + margin) : null;
      if (!listings) {
        frag.appendChild(this.gap(i, visFrom, visTo, t(ch.epgId ? 'guide.loading' : 'guide.noepg')));
        continue;
      }
      if (!listings.length) {
        frag.appendChild(this.gap(i, visFrom, visTo, t('guide.noepg')));
        continue;
      }
      for (const p of listings) frag.appendChild(this.block(i, ch, p, now, scrollLeft));
    }

    this.el.canvas.replaceChildren(frag);
    this.el.canvas.appendChild(this.nowLine);
  }

  block(row, ch, p, now, scrollLeft) {
    const left = Math.max(0, this.x(p.start));
    const right = Math.min(this.width, this.x(p.stop));
    const width = Math.max(2, right - left - 2);
    const live = p.start <= now && now < p.stop;

    const node = document.createElement('div');
    node.className = 'epg-prog'
      + (live ? ' live' : p.stop <= now ? ' past' : '')
      + (this.isSelected(row, p) ? ' sel' : '')
      + (catchupAvailable(ch, p, now) ? ' rec' : '');
    node.style.left = `${left}px`;
    node.style.width = `${width}px`;
    node.style.top = `${row * ROW_H + 3}px`;
    node.dataset.row = String(row);
    node.dataset.start = String(p.start);
    node.title = `${clock(p.start)}–${clock(p.stop)}  ${p.title}`;

    const label = document.createElement('div');
    label.className = 'epg-prog-label';
    // A programme running past the edge of the screen: the name and the
    // continuation mark are nudged into view instead of being left behind
    // the scroll. A block entirely outside the edge is not nudged — it is
    // not visible anyway.
    const clip = scrollLeft - left;
    if (clip > 0 && clip < width - 40) {
      node.style.setProperty('--clip', `${clip}px`);
      label.style.paddingLeft = `${clip + 14}px`;
      node.classList.add('clipped');
    }
    label.textContent = p.title || 'Ohjelma';
    node.appendChild(label);

    if (live) {
      const share = progressOf(p, now);
      if (share != null) {
        const fill = document.createElement('i');
        fill.style.width = `${Math.round(share * 100)}%`;
        node.appendChild(fill);
      }
    }
    return node;
  }

  gap(row, from, to, text) {
    const left = Math.max(0, this.x(from));
    const node = document.createElement('div');
    node.className = 'epg-prog empty';
    node.style.left = `${left}px`;
    node.style.width = `${Math.max(2, Math.min(this.width, this.x(to)) - left - 2)}px`;
    node.style.top = `${row * ROW_H + 3}px`;
    node.dataset.row = String(row);
    const label = document.createElement('div');
    label.className = 'epg-prog-label';
    label.textContent = text;
    node.appendChild(label);
    return node;
  }

  moveNow() {
    const now = Date.now();
    const inside = now >= this.origin && now <= this.end;
    this.nowLine.hidden = !inside;
    this.nowHead.hidden = !inside;
    if (this.el.clock) this.el.clock.textContent = stampFmt.format(new Date(now));
    if (!inside) return;
    const x = `${this.x(now)}px`;
    this.nowLine.style.left = x;
    this.nowLine.style.height = `${Math.max(this.channels.length * ROW_H, this.el.scroll.clientHeight)}px`;
    this.nowHead.style.left = x;
  }

  /* -------------------------------------------------------------- valinta */

  isSelected(row, p) {
    const sel = this.selection;
    return !!(sel && sel.row === row && sel.programme && sel.programme.start === p.start);
  }

  /**
   * Changes only the highlights. Repainting the whole canvas would pull the
   * elements out from under the mouse mid-click, which would lose the block
   * between a click and a double-click.
   */
  mark() {
    for (const node of this.el.canvas.querySelectorAll('.epg-prog.sel')) node.classList.remove('sel');
    const sel = this.selection;
    if (sel && sel.programme) {
      const hit = this.el.canvas.querySelector(`.epg-prog[data-row="${sel.row}"][data-start="${sel.programme.start}"]`);
      if (hit) hit.classList.add('sel');
    }
    for (const node of this.el.chansInner.children) {
      node.classList.toggle('cursor', Number(node.dataset.row) === this.cursorRow);
    }
  }

  /** Selects the programme on air at the given time on that channel. */
  selectAt(row, time) {
    const ch = this.channels[row];
    if (!ch) return;
    const listings = this.epg ? this.epg.listings(ch.id) : null;
    let programme = null;
    if (listings && listings.length) {
      programme = listings.find((p) => p.start <= time && time < p.stop)
        || listings.reduce((best, p) => (Math.abs(p.start - time) < Math.abs(best.start - time) ? p : best));
    }
    this.cursorRow = row;
    if (programme) this.focusTime = programme.start;
    this.selection = { row, programme };
    this.onSelect(ch, programme);
    this.mark();
  }

  pick(e, activate) {
    const node = e.target.closest('.epg-prog');
    if (!node) return;
    const row = Number(node.dataset.row);
    const ch = this.channels[row];
    if (!ch) return;

    let programme = null;
    if (!node.classList.contains('empty')) {
      const start = Number(node.dataset.start);
      const listings = (this.epg && this.epg.listings(ch.id)) || [];
      programme = listings.find((p) => p.start === start) || null;
      if (programme) this.focusTime = programme.start;
    }
    this.cursorRow = row;
    this.selection = { row, programme };
    this.onSelect(ch, programme);
    this.mark();
    if (activate) this.onActivate(ch, programme);
  }

  /* ------------------------------------------------------------ movement */

  /**
   * align 'lead' leaves a moment of the past in view, so that the programme
   * on air does not start right at the edge of the screen. The short lead
   * is deliberate: every visible minute of the past means epg.js has to
   * fetch the channel's whole programme table instead of the short list.
   */
  scrollToTime(ms, { align = 'left' } = {}) {
    const view = this.el.scroll.clientWidth;
    const lead = align === 'lead' ? Math.min(view * 0.2, LEAD_MIN * this.zoom) : 0;
    const left = this.x(ms) - lead;
    this.el.scroll.scrollLeft = Math.max(0, Math.min(this.width - view, left));
    this.schedule();
  }

  ensureRowVisible(row) {
    const top = row * ROW_H;
    const { scrollTop, clientHeight } = this.el.scroll;
    if (top < scrollTop) this.el.scroll.scrollTop = top;
    else if (top + ROW_H > scrollTop + clientHeight) this.el.scroll.scrollTop = top + ROW_H - clientHeight;
    this.schedule();
  }

  ensureTimeVisible(programme) {
    const view = this.el.scroll.clientWidth;
    const left = this.el.scroll.scrollLeft;
    const a = this.x(programme.start);
    const b = this.x(programme.stop);
    if (a < left) this.el.scroll.scrollLeft = Math.max(0, a - 40);
    else if (b > left + view) this.el.scroll.scrollLeft = Math.min(this.width - view, Math.max(a - 40, b - view + 40));
    this.schedule();
  }

  goNow() {
    const now = Date.now();
    this.focusTime = now;
    this.scrollToTime(now, { align: 'lead' });
    this.selectAt(this.cursorRow, now);
  }

  /**
   * Scrolls to the start of a day — or to the current time when the day is
   * today. A day boundary is approached without the lead, otherwise
   * "tomorrow" would stop a quarter of an hour inside today.
   */
  goDay(at) {
    const now = Date.now();
    const today = now >= at && now < startOfDay(at, 1);
    const target = today ? now : at;
    this.focusTime = target;
    this.scrollToTime(target, { align: today ? 'lead' : 'left' });
    this.selectAt(this.cursorRow, target);
  }

  nudge(minutes) {
    this.scrollToTime(this.timeAt(this.el.scroll.scrollLeft) + minutes * 60000);
  }

  zoomBy(delta) {
    const next = Math.max(0, Math.min(ZOOMS.length - 1, this.zoomIndex + delta));
    if (next === this.zoomIndex) return;
    const anchor = this.timeAt(this.el.scroll.scrollLeft);
    this.zoomIndex = next;
    this.layout();
    this.scrollToTime(anchor);
    this.paint();
  }

  /** Moves the selection to the neighbouring programme on the same channel. */
  step(delta) {
    const ch = this.channels[this.cursorRow];
    const listings = ch && this.epg ? this.epg.listings(ch.id) : null;
    if (!listings || !listings.length) { this.nudge(delta * SLOT_MIN); return; }

    const current = this.selection && this.selection.programme;
    let index = current ? listings.findIndex((p) => p.start === current.start) : -1;
    if (index === -1) index = listings.findIndex((p) => p.start <= this.focusTime && this.focusTime < p.stop);
    const next = listings[index + delta];
    if (!next) { this.nudge(delta * SLOT_MIN); return; }

    this.focusTime = next.start;
    this.selection = { row: this.cursorRow, programme: next };
    this.ensureTimeVisible(next);
    this.onSelect(ch, next);
    this.mark();
  }

  moveRow(delta) {
    if (!this.channels.length) return;
    const row = Math.max(0, Math.min(this.channels.length - 1, this.cursorRow + delta));
    this.ensureRowVisible(row);
    this.selectAt(row, this.focusTime);
  }

  activate() {
    const ch = this.channels[this.cursorRow];
    if (ch) this.onActivate(ch, this.selection ? this.selection.programme : null);
  }

  /** @returns {boolean} whether the key was handled */
  handleKey(e) {
    switch (e.key) {
      case 'ArrowDown': this.moveRow(1); return true;
      case 'ArrowUp': this.moveRow(-1); return true;
      case 'PageDown': this.moveRow(this.rowsPerScreen()); return true;
      case 'PageUp': this.moveRow(-this.rowsPerScreen()); return true;
      case 'ArrowRight': this.step(1); return true;
      case 'ArrowLeft': this.step(-1); return true;
      case 'Home': this.goNow(); return true;
      case 'Enter': this.activate(); return true;
      case '+': this.zoomBy(1); return true;
      case '-': this.zoomBy(-1); return true;
      default: return false;
    }
  }

  rowsPerScreen() { return Math.max(1, Math.floor(this.el.scroll.clientHeight / ROW_H) - 1); }

  /* ----------------------------------------------------------------- tila */

  setChannels(items) {
    this.channels = items;
    this.cursorRow = 0;
    this.selection = null;
    this.lastWindowKey = '';
    const height = `${Math.max(1, items.length) * ROW_H}px`;
    this.el.canvas.style.height = height;
    this.el.chansInner.style.height = height;
    this.el.scroll.scrollTop = 0;
    this.paint();
  }

  setPlaying(streamId) {
    this.playingId = streamId == null ? null : String(streamId);
    if (this.open) this.schedule();
  }

  focusChannel(streamId) {
    const row = this.channels.findIndex((c) => String(c.id) === String(streamId));
    if (row < 0) return false;
    this.ensureRowVisible(row);
    this.selectAt(row, this.focusTime);
    return true;
  }

  /** Programme data arrived: the selection is completed if it was left empty. */
  invalidate() {
    if (!this.open) return;
    if (this.selection && !this.selection.programme) this.selectAt(this.selection.row, this.focusTime);
    this.schedule();
  }

  show() {
    this.open = true;
    this.layout();
    this.goNow();
    this.paint();
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  hide() {
    this.open = false;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** The clock runs, so the "now" line and the programmes on air go stale. */
  tick() {
    // The guide can be open when the day turns over, at which point the
    // timeline's zero and the day names ("today") point at yesterday.
    if (startOfDay(Date.now()) !== startOfDay(this.origin, PAST_DAYS)) {
      const anchor = this.timeAt(this.el.scroll.scrollLeft);
      this.layout();
      this.scrollToTime(anchor);
    }
    this.paint();
  }
}

/** The start of the day n days from now. Under daylight saving a day is
 *  not 24 h. */
function startOfDay(ms, offsetDays = 0) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.getTime();
}
