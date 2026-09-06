import { VirtualList, watchLength } from './vlist.js';
import { channelPreferences, ordered, placeInOrder, arrangeOrder, sortChannels } from './channelprefs.js';
import { t, localeTag } from './i18n.js';
import { wireModal } from './modal.js';
import { searchKey, searchTerms, matchesTerms } from './name.js';
import { poster } from './poster.js';

const $ = (id) => document.getElementById(id);

// .organize-row in player.css, in rem so that it grows with the reader's
// font setting. What that comes to is the browser's answer, asked again when
// the setting moves.
let ROW_H = 44;
const EDGE = 48;    // how near an edge a drag starts scrolling the list
const SPEED = 0.4;  // pixels of scroll per pixel into that edge, per frame

const GRIP_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">'
  + [4, 8, 12].map((y) => `<circle cx="6" cy="${y}" r="1.3"/><circle cx="10" cy="${y}" r="1.3"/>`).join('')
  + '</svg>';

export class ChannelEditor {
  constructor(onSave) {
    this.dialog = $('channel-editor');
    this.onSave = onSave;
    this.rows = [];
    this.drag = null;
    this.sort = 'az';
    this.list = new VirtualList($('channel-editor-list'), ROW_H, (i) => this.row(i));
    ROW_H = watchLength('--organize-row-h', ROW_H, (px) => { ROW_H = px; this.list.setRowHeight(px); });
    this.list.setRowHeight(ROW_H);
    for (const id of ['channel-editor-kind', 'channel-editor-group', 'channel-editor-filter']) {
      $(id).addEventListener('input', () => this.render());
    }
    const close = () => { if (!$('channel-editor-save').disabled) this.dialog.close(); };
    wireModal(this.dialog, close);
    $('channel-editor-cancel').addEventListener('click', close);
    $('channel-editor-hide').addEventListener('click', () => this.setHidden(true));
    $('channel-editor-show').addEventListener('click', () => this.setHidden(false));
    $('channel-editor-reset').addEventListener('click', () => {
      this.draft[this.orderKey] = [];
      this.render();
    });
    $('channel-editor-save').addEventListener('click', async () => {
      const button = $('channel-editor-save');
      button.disabled = true;
      this.dialog.querySelector('.editor-content').inert = true;
      try { await this.onSave(this.draft); this.dialog.close(); }
      catch { $('channel-editor-status').textContent = t('organize.savefailed'); }
      finally { button.disabled = false; this.dialog.querySelector('.editor-content').inert = false; }
    });
    // A drag left running would keep listening after the dialog had gone.
    this.dialog.addEventListener('close', () => this.endDrag(false));
  }

  get categories() { return $('channel-editor-kind').value === 'categories'; }
  get orderKey() { return this.categories ? 'categoryOrder' : 'channelOrder'; }
  get hiddenKey() { return this.categories ? 'hiddenCategories' : 'hiddenChannels'; }

  show(channels, groups, prefs, { group, sort } = {}) {
    this.channels = channels;
    this.groups = groups;
    // Category id → its own name, for the line under a channel's.
    this.catNames = new Map(groups.flatMap((g) => g.cats.map((c) => [c.id, c.sub || g.name])));
    this.sort = sort || 'az';
    this.draft = channelPreferences(prefs);
    $('channel-editor-filter').value = '';
    $('channel-editor-kind').value = 'channels';
    $('channel-editor-group').replaceChildren(new Option(t('groups.all'), ''),
      ...groups.map((g) => new Option(g.name, g.name)));
    $('channel-editor-group').value = group || '';
    this.dialog.showModal();
    this.render();
  }

  render({ keepScroll = false } = {}) {
    const group = this.groups.find((g) => g.name === $('channel-editor-group').value);
    const cats = group ? group.cats : this.groups.flatMap((g) => g.cats);
    const ids = new Set(cats.map((c) => c.id));
    const items = this.categories
      ? cats.map((c) => ({ id: c.id, n: c.name })).sort((a, b) => a.n.localeCompare(b.n, localeTag()))
      : sortChannels(this.channels.filter((c) => !group || c.cats.some((id) => ids.has(id))), this.sort);
    const terms = searchTerms($('channel-editor-filter').value);
    this.rows = ordered(items, this.draft[this.orderKey]).filter((c) => matchesTerms(searchKey(c.n), terms));
    this.list.setCount(this.rows.length, { keepScroll });
    $('channel-editor-status').textContent = t('organize.count', { count: this.rows.length,
      hidden: this.draft[this.hiddenKey].length });
    $('channel-editor-hide').disabled = $('channel-editor-show').disabled = !this.rows.length;
    // Nothing to reset until something has been arranged by hand; while it
    // is empty the order is the one Settings chose.
    $('channel-editor-reset').disabled = !this.draft[this.orderKey].length;
  }

  setHidden(hide, id = null) {
    const ids = id == null ? this.rows.map((r) => String(r.id)) : [String(id)];
    const hidden = new Set(this.draft[this.hiddenKey]);
    for (const key of ids) { if (hide) hidden.add(key); else hidden.delete(key); }
    this.draft[this.hiddenKey] = [...hidden];
    this.render({ keepScroll: true });
    if (id != null) this.focus(id, 'visibility');
  }

  focus(id, action) {
    const index = this.rows.findIndex((r) => String(r.id) === String(id));
    this.list.scrollToIndex(index);
    this.list.refresh();
    const row = this.list.nodes.get(index);
    (row?.querySelector(`[data-action="${action}"]:not(:disabled)`) || row?.querySelector('input'))?.focus();
  }

  /**
   * Seed untouched IDs in the global default order. Moving within Finland
   * must not also promote Finland ahead of every country. The seed follows
   * the sort setting, so arranging one channel does not silently return
   * the rest to A–Z.
   */
  savedOrder() {
    const defaults = this.categories
      ? this.groups.flatMap((g) => g.cats).sort((a, b) => a.name.localeCompare(b.name, localeTag()))
      : sortChannels(this.channels, this.sort);
    return [...new Set([...this.draft[this.orderKey], ...defaults.map((r) => String(r.id))])];
  }

  /** One row to a position among those on screen. Refuses a move to nowhere. */
  moveTo(id, to) {
    const displayed = this.rows.map((r) => String(r.id));
    const at = displayed.indexOf(String(id));
    if (at < 0 || to < 0 || to >= displayed.length || to === at) return;
    this.draft[this.orderKey] = placeInOrder(this.savedOrder(), displayed, id, to);
    this.render({ keepScroll: true });
    this.focus(id, 'move');
  }

  /* ------------------------------------------------------- drag and drop */

  /**
   * The list paints only the rows on screen, so there is no element to
   * carry from one end to the other: what moves is the order itself. A
   * floating copy of the row follows the pointer, the rows underneath
   * shuffle as it passes, and near either edge the list scrolls — so a
   * channel can travel the whole way without being let go.
   *
   * The listeners sit on the window rather than on the handle: the handle
   * is destroyed by the first repaint, and pointer capture would go with it.
   */
  startDrag(event, id) {
    if (this.drag || event.button > 0 || this.rows.length < 2) return;
    const at = this.rows.findIndex((r) => String(r.id) === String(id));
    if (at < 0) return;
    const row = event.currentTarget.closest('.organize-row');
    const box = row.getBoundingClientRect();
    event.preventDefault();
    const ghost = row.cloneNode(true);
    ghost.classList.add('organize-ghost');
    ghost.style.left = `${box.left}px`;
    ghost.style.top = `${box.top}px`;
    ghost.style.width = `${box.width}px`;
    this.dialog.append(ghost);
    this.list.viewport.classList.add('is-dragging');
    this.drag = { id: String(id), at, ghost, moved: false, frame: 0, pointerId: event.pointerId,
      from: this.rows.map((r) => String(r.id)), grab: event.clientY - box.top, y: event.clientY };
    // A second finger on the list is not this drag.
    const mine = (e) => this.drag && e.pointerId === this.drag.pointerId;
    this.onPointerMove = (e) => { if (mine(e)) this.dragMove(e); };
    this.onPointerUp = (e) => { if (mine(e)) this.endDrag(true); };
    this.onPointerCancel = (e) => { if (mine(e)) this.endDrag(false); };
    // Escape puts the row back rather than closing the whole editor, and a
    // window left mid-drag must not come back still holding one.
    this.onDragKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      this.endDrag(false);
    };
    this.onDragBlur = () => this.endDrag(false);
    addEventListener('pointermove', this.onPointerMove);
    addEventListener('pointerup', this.onPointerUp);
    addEventListener('pointercancel', this.onPointerCancel);
    addEventListener('keydown', this.onDragKey, true);
    addEventListener('blur', this.onDragBlur);
    this.list.refresh();
    this.step();
  }

  dragMove(event) {
    if (!this.drag) return;
    this.drag.y = event.clientY;
    // The floating row stays within the list even when the pointer leaves
    // it: past an edge it is the list that moves, under the row.
    const box = this.list.viewport.getBoundingClientRect();
    const top = Math.max(box.top, Math.min(box.bottom - ROW_H, event.clientY - this.drag.grab));
    this.drag.ghost.style.top = `${top}px`;
    this.dragTo(this.indexAt(event.clientY));
  }

  /** Where the floating row's top edge now sits, as a row number. */
  indexAt(clientY) {
    const view = this.list.viewport;
    const top = clientY - this.drag.grab - view.getBoundingClientRect().top + view.scrollTop;
    return Math.max(0, Math.min(this.rows.length - 1, Math.round(top / ROW_H)));
  }

  dragTo(to) {
    if (!this.drag || to === this.drag.at) return;
    this.rows.splice(to, 0, ...this.rows.splice(this.drag.at, 1));
    this.drag.at = to;
    this.drag.moved = true;
    this.list.refresh();
  }

  /** Held near an edge, the list keeps scrolling — faster the nearer it is. */
  step() {
    if (!this.drag) return;
    const view = this.list.viewport;
    const box = view.getBoundingClientRect();
    const over = Math.max(0, box.top + EDGE - this.drag.y) - Math.max(0, this.drag.y - (box.bottom - EDGE));
    if (over) {
      const before = view.scrollTop;
      view.scrollTop = before - Math.sign(over) * Math.min(Math.abs(over), EDGE) * SPEED;
      if (view.scrollTop !== before) this.dragTo(this.indexAt(this.drag.y));
    }
    this.drag.frame = requestAnimationFrame(() => this.step());
  }

  endDrag(commit) {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    cancelAnimationFrame(drag.frame);
    removeEventListener('pointermove', this.onPointerMove);
    removeEventListener('pointerup', this.onPointerUp);
    removeEventListener('pointercancel', this.onPointerCancel);
    removeEventListener('keydown', this.onDragKey, true);
    removeEventListener('blur', this.onDragBlur);
    drag.ghost.remove();
    this.list.viewport.classList.remove('is-dragging');
    if (drag.moved && commit) {
      this.draft[this.orderKey] = arrangeOrder(this.savedOrder(), drag.from, this.rows.map((r) => String(r.id)));
    }
    if (!this.dialog.open) return;
    // Committed or not, the rows are painted from the draft again: an
    // abandoned drag leaves the spliced working copy behind. The handle
    // keeps the focus, so the keyboard can carry the move on from there.
    this.render({ keepScroll: true });
    this.focus(drag.id, 'move');
  }

  /* ------------------------------------------------------------- one row */

  row(index) {
    const item = this.rows[index];
    const hidden = this.draft[this.hiddenKey].includes(String(item.id));
    const row = document.createElement('div');
    row.className = 'organize-row' + (hidden ? ' is-hidden' : '')
      + (this.drag?.at === index ? ' is-dragging' : '');
    row.dataset.id = item.id;
    row.append(this.grip(item, index), this.visibility(item, hidden));
    return row;
  }

  /**
   * The handle. The pointer drags it; the keyboard moves it a step with the
   * arrows and the whole way with Home and End, which is what a list of
   * hundreds needs. Its name carries the position, so a screen reader says
   * where the row landed when the focus returns to it after the move.
   */
  grip(item, index) {
    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'organize-grip';
    grip.dataset.action = 'move';
    grip.innerHTML = GRIP_ICON;
    // One row on its own has nowhere to go; a handle that did nothing would
    // only invite the attempt.
    grip.disabled = this.rows.length < 2;
    grip.title = t('organize.move', { name: item.n });
    grip.setAttribute('aria-label', t('organize.moveat',
      { name: item.n, at: index + 1, of: this.rows.length }));
    grip.addEventListener('pointerdown', (event) => this.startDrag(event, item.id));
    grip.addEventListener('keydown', (event) => {
      const to = { ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: this.rows.length - 1 }[event.key];
      if (to == null) return;
      event.preventDefault();
      this.moveTo(item.id, to);
    });
    return grip;
  }

  /** The category a channel is filed under, for telling two of a name apart. */
  whereOf(item) {
    if (!item.cats || !item.cats.length) return '';
    const cat = this.catNames?.get(item.cats[0]);
    return cat || '';
  }

  visibility(item, hidden) {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    // defaultChecked as well: the floating copy of a dragged row is a clone,
    // and a clone carries the attribute rather than the property.
    checkbox.checked = checkbox.defaultChecked = !hidden;
    checkbox.dataset.action = 'visibility';
    checkbox.setAttribute('aria-label', t('organize.visible', { name: item.n }));
    checkbox.addEventListener('change', () => this.setHidden(!checkbox.checked, item.id));
    // The logo and the category, because a provider files several channels
    // under one name — three "Maple Cinema"s in a list of names alone are
    // three identical rows, and hiding the wrong one is silent.
    const body = document.createElement('span');
    body.className = 'organize-body';
    const name = document.createElement('span');
    name.className = 'organize-name';
    name.textContent = item.n;
    const where = this.whereOf(item);
    body.append(name);
    if (where) {
      const sub = document.createElement('span');
      sub.className = 'organize-where';
      sub.textContent = where;
      body.append(sub);
    }
    label.title = where ? `${item.n} · ${where}` : item.n;
    // Categories have no logo of their own, and a placeholder television
    // beside every one of them is noise rather than information.
    label.append(checkbox);
    if (!this.categories) label.append(poster('organize-logo', item.logo, 'channel'));
    label.append(body);
    return label;
  }
}
