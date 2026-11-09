// The topic bar above the channel list: the chips of a country's topics,
// its height that the viewer can drag, and the counts on the chips.
//
// Moved out of app.js. It takes the player's state, and the parts app.js
// builds, from js/state.js.

import { channelsByFavourite, clearChannelFilters } from './listfilters.js';
import { crumbLabel } from './seriesui.js';
import { emptyState } from './rows.js';
import { nf } from './format.js';
import { t } from './i18n.js';
import { viewToggle } from './coversui.js';
import { LIST_ORDERS, ORDER_MARKS, ORDER_SETTINGS, listOrder, pressedOrder } from './listorder.js';
import * as store from './config.js';
import { activateTab, catalogueSearch, isAbort, isCollection, kindLabel, mediaFilters, openHiddenList, refreshRows, renderSidebar, searchesEveryGroup, searchLimit, showListCancelled, showListError, state, tabType, unit } from './state.js';
import { hideProgress, progressSignal, showProgress, updateProgress } from './progressdialog.js';
import { clearHistory } from './collections.js';
import { $, el } from './dom.js';
import { configured, openSetup } from './setupui.js';
import { svg } from './svg.js';

// A chip row advances 30.6 px and the bar's own padding adds 16, so one row
// comes to 47 px and eight to 261. The fixed 144 px this used to have for
// every group alike was four of them.
const SUBCATS_MIN = 48;          // one row: the bar never shrinks to a stripe
const SUBCATS_AUTO_MAX = 260;    // eight rows: beyond that it is a page of its own
// Sweden's 31 topics and USA's 48 do not fit in four rows, and it is exactly
// there that the bar is the thing being read, so it is given a share of the
// column rather than a number of rows: on a tall window that is six or seven
// rows, on a short one the list still keeps what it needs.
const SUBCATS_AUTO_SHARE = 0.28;
// Dragging is a decision, not a default, so it may go further — up to where
// a few list rows are still under the bar.
const SUBCATS_DRAG_SHARE = 0.6;

/**
 * How tall the topic bar may be: the ceiling it takes by itself, and the one
 * a drag may reach. Both are measured from the column, because a ceiling in
 * pixels that is right on a full screen hides the list on a half one.
 */
function subcatsBounds() {
  // The list column's height, wherever the bar stands now: inside the
  // channels' fold its own parent is only as tall as the bar.
  const column = el.subcats.closest('.listcol')?.clientHeight || window.innerHeight;
  return {
    min: SUBCATS_MIN,
    auto: Math.round(Math.min(SUBCATS_AUTO_MAX, column * SUBCATS_AUTO_SHARE)),
    max: Math.round(Math.max(SUBCATS_MIN * 2, column * SUBCATS_DRAG_SHARE)),
  };
}

/**
 * The bar is as tall as its chips, up to the ceiling. A ceiling rather than
 * a height, because a bar dragged past its last chip would be a band of
 * empty panel, and the list needs the pixels more.
 */
export function applySubcatsHeight() {
  // Inside the channels' fold the bar is as tall as its chips: folding the
  // whole of it is what gives the list its room. Asked before the bar's
  // hidden state, as a ceiling left over from the bar's own place wins over
  // the stylesheet and let a long country's chips run under "Show only
  // favourites".
  if (el.subcats.closest('.channel-filters')) { el.subcats.style.maxHeight = ''; return; }
  if (el.subcats.hidden) return;
  const bounds = subcatsBounds();
  const cap = state.subcatsHeight == null
    ? bounds.auto
    : Math.min(Math.max(state.subcatsHeight, bounds.min), bounds.max);
  el.subcats.style.maxHeight = `${cap}px`;
  el.subcatsGrip.setAttribute('aria-valuemin', String(bounds.min));
  el.subcatsGrip.setAttribute('aria-valuemax', String(bounds.max));
  el.subcatsGrip.setAttribute('aria-valuenow', String(Math.round(el.subcats.getBoundingClientRect().height)));
}

/** A dragged height is the user's, so it is remembered between sessions. */
function setSubcatsHeight(height) {
  const bounds = subcatsBounds();
  state.subcatsHeight = height == null ? null : Math.min(Math.max(Math.round(height), bounds.min), bounds.max);
  applySubcatsHeight();
}

/**
 * The handle at the bar's lower edge. The pointer is captured, so the drag
 * follows it over the list and outside the window as well, and a double
 * click gives the automatic height back.
 */
export function wireSubcatsResize() {
  const grip = el.subcatsGrip;
  let startY = 0;
  let startHeight = 0;

  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    // No preventDefault here: cancelling a pointerdown also cancels the
    // mouse events derived from it, and the double click below is one of
    // them. Dragging over text is kept from selecting it by body.resizing.
    startY = e.clientY;
    startHeight = el.subcats.getBoundingClientRect().height;
    grip.setPointerCapture(e.pointerId);
    grip.classList.add('dragging');
    document.body.classList.add('resizing');
  });

  grip.addEventListener('pointermove', (e) => {
    if (!grip.hasPointerCapture(e.pointerId)) return;
    // The distance the pointer has come, not where it is: the bar's top
    // edge is not the same as the column's when a breadcrumb is above it.
    setSubcatsHeight(startHeight + (e.clientY - startY));
  });

  const release = (e) => {
    if (!grip.hasPointerCapture(e.pointerId)) return;
    grip.releasePointerCapture(e.pointerId);
    grip.classList.remove('dragging');
    document.body.classList.remove('resizing');
    store.saveUiState({ subcatsHeight: state.subcatsHeight });
  };
  grip.addEventListener('pointerup', release);
  grip.addEventListener('pointercancel', release);

  grip.addEventListener('dblclick', () => {
    setSubcatsHeight(null);
    store.saveUiState({ subcatsHeight: null });
  });

  grip.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    // The same arrows move the cursor in the list, and a handle that has
    // been given the focus is the one being steered.
    e.preventDefault();
    e.stopPropagation();
    setSubcatsHeight(el.subcats.getBoundingClientRect().height + step * (e.shiftKey ? 48 : 12));
    store.saveUiState({ subcatsHeight: state.subcatsHeight });
  });

  // Both ceilings are measured from the column, so a window that changes
  // size changes them. The observer looks at the column and the callback
  // touches only the bar inside it, so nothing here can feed itself.
  new ResizeObserver(() => applySubcatsHeight()).observe(el.subcats.parentElement);
}

/**
 * The chips are a toolbar: one Tab stop, held by the chosen chip, and the
 * arrows between them, Home and End to the ends. The arrows move the focus
 * only; Enter or Space chooses, since choosing loads a list. Up and down
 * stay the list's, as they are from every other button.
 */
export function wireSubcatsKeys() {
  el.subcats.addEventListener('keydown', (e) => {
    const chips = [...el.subcats.querySelectorAll('.chip-main')];
    const at = chips.indexOf(e.target);
    if (at < 0 || e.ctrlKey || e.metaKey || e.altKey) return;
    const next = e.key === 'ArrowRight' ? Math.min(at + 1, chips.length - 1)
      : e.key === 'ArrowLeft' ? Math.max(at - 1, 0)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? chips.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    e.stopPropagation();
    for (const chip of chips) chip.tabIndex = -1;
    chips[next].tabIndex = 0;
    chips[next].focus();
  });
}

export async function selectSub(categoryId) {
  state.sub = categoryId;
  state.cursor = -1;
  await refreshRows();
}

export async function ensureFull(type, reason, current = () => true) {
  if (state.lib.isFull(type)) return true;
  showProgress(t('progress.list', { what: t(`progress.list.${type}`) }), reason);
  try {
    await state.lib.ensureFull(type, {
      signal: progressSignal(),
      onProgress: (received, total) => { if (current()) updateProgress(received, total); },
    });
    if (current()) renderSidebar();
    return true;
  } catch (err) {
    if (!current()) return false;
    hideProgress();
    if (isAbort(err)) showListCancelled(() => refreshRows()); else showListError(err, () => refreshRows());
    return false;
  } finally {
    if (current()) hideProgress();
  }
}

export function renderEmptyState() {
  // Before the first connection there is no list to describe, and the
  // column's heading would be an empty one: it names the tab all the same.
  renderListHeading();
  const existing = el.list.querySelector('.empty');
  if (existing) existing.remove();
  if (state.rows.length > 0) return;
  // The strip above says it already, and with a bar and a way out.
  if (state.listLoading && !el.listProgress.hidden) return;
  if (state.listLoading) {
    const loading = document.createElement('div');
    loading.className = 'empty list-loading';
    loading.setAttribute('role', 'status');
    const spinner = document.createElement('span');
    spinner.className = 'list-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = t('progress.loading');
    loading.append(spinner, label);
    el.list.appendChild(loading);
    return;
  }
  // Before the first connection the list says so, with the way to make
  // one: an empty column under the sidebar's empty one said nothing at all.
  // While a connection is being made, the strip above it says that.
  if (!state.lib && !isCollection()) {
    if (configured()) return;
    el.list.appendChild(emptyState(t('empty.noserver'), '', { label: t('setup.title.connect'), onClick: () => openSetup() }));
    return;
  }
  const type = tabType();
  const browse = { label: t('empty.browse'), onClick: () => activateTab('live') };
  let node;
  // A filter that left nothing says so, with Reset, the channels' "Show
  // only favourites" as the films' filters ("Category is empty" was wrong).
  // Reset takes itself away with the empty list: the focus goes to the list.
  const reset = (clear) => ({ label: t('filters.reset'), onClick: async () => {
    await clear();
    if (!document.activeElement || document.activeElement === document.body) el.list.focus();
  } });
  if (mediaFilters.filtering) node = emptyState(t('filters.nohits'), t('filters.nohits.text'), reset(() => mediaFilters.clear()), 'search');
  else if (type === 'live' && channelsByFavourite() && !state.query && !state.detail && !isCollection()) {
    node = emptyState(t('filters.nohits.channels'), t('filters.nohits.text'), reset(clearChannelFilters), 'search');
  }
  else if (state.query) {
    // A search that found nothing says what it did not read — the
    // countries or the categories "Filter countries/categories" leaves out —
    // and offers them too, besides the way back to the list.
    const limit = !isCollection() && !state.detail && type && !searchesEveryGroup() ? searchLimit(type) : null;
    const actions = [{ label: t('search.clear'), onClick: () => { catalogueSearch.clear(); el.list.focus(); } }];
    if (limit) actions.unshift({ label: t('search.all'), onClick: () => { state.searchAll = `${state.tab}\n${state.query}`; refreshRows(); } });
    node = emptyState(t('empty.nohits'), [t('empty.nohits.text', { query: state.query }), limit].filter(Boolean), actions, 'search');
  }
  else if (state.detail && state.detail.view === 'category') {
    node = emptyState(t('empty.category'), t('empty.category.text'));
  } else if (state.tab === 'fav') {
    node = emptyState(t('empty.fav'), t('empty.fav.text'), browse, 'star');
  } else if (state.tab === 'recent') {
    node = emptyState(t('empty.recent'), t('empty.recent.text'), browse, 'history');
  } else node = emptyState(t('empty.plain'), t('empty.plain.text'));
  el.list.appendChild(node);
}

export function renderListInfo() {
  renderListHeading();
  if (state.listLoading) {
    el.listinfo.textContent = t('progress.loading');
    return;
  }
  // "0 channels" under a list that is empty for want of a connection counts
  // something that was never asked for.
  if (!state.lib && !isCollection()) { el.listinfo.replaceChildren(); return; }
  const type = tabType();
  const parts = [];
  const count = state.rows.length;
  if (state.detail && state.detail.view === 'category') {
    const entry = state.detail.entry;
    parts.push(unit(entry.t, count));
    parts.push(crumbLabel(entry));
  } else if (state.detail) {
    parts.push(t('list.episodes', { count, n: nf.format(count) }));
  } else if (isCollection()) {
    parts.push(t('list.items', { count, n: nf.format(count) }));
  } else {
    parts.push(unit(type, count));
  }
  if (isCollection() && state.kind != null) parts.push(kindLabel(state.kind).toLowerCase());
  if (state.group && !state.detail && !state.query) {
    const group = state.lib.group(type, state.group);
    parts.push(state.sub
      ? state.lib.categoryName(type, state.sub)
      : `${state.group}${group && group.cats.length > 1 ? ` (${t('list.topics', { n: nf.format(group.cats.length) })})` : ''}`);
  }

  // The tab's own mark before the count, so the line reads as the list's
  // summary: the same drawing as the tab above, nothing new to learn.
  const mark = document.querySelector(`#tabs [data-tab="${state.tab}"] .tab-icon`)?.cloneNode(true);
  el.listinfo.replaceChildren(...(mark ? [mark] : []), document.createTextNode(parts.join(', ')));
  const hidden = state.channelPrefs.hiddenChannels.length + state.channelPrefs.hiddenCategories.length;
  if (state.tab === 'live' && state.lib && hidden) {
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'btn-hidden';
    button.textContent = t('hidden.count', { n: nf.format(hidden) });
    button.addEventListener('click', openHiddenList);
    el.listinfo.append(spacer, button);
  }
  if (state.tab === 'recent' && state.recents.length) {
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    el.listinfo.append(spacer, clearHistoryButton());
  }
  if ((state.tab === 'movie' || state.tab === 'series') && !state.detail && state.lib) {
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    el.listinfo.append(spacer, viewToggle());
  }
  // The list's order at its foot, the same marks on every list that has
  // an order of its own to choose: the channels, the favourites, the films
  // and the series, the history, and a favourite category of any of them.
  // A search keeps the order of its hits, and a series' episodes theirs.
  const list = orderList();
  if (list) {
    if (!el.listinfo.querySelector('.spacer')) {
      const spacer = document.createElement('span');
      spacer.className = 'spacer';
      el.listinfo.append(spacer);
    }
    el.listinfo.append(listOrderToggle(list));
  }
}

/**
 * The list whose order the foot shows, by LIST_ORDERS' names, or null
 * where the order is not the viewer's to choose.
 */
export function orderList() {
  if (state.query) return null;
  if (state.detail) return state.detail.view === 'category' && LIST_ORDERS[state.detail.entry.t] ? state.detail.entry.t : null;
  if (isCollection()) return state.tab;
  return state.lib && LIST_ORDERS[state.tab] ? state.tab : null;
}

// The marks, a picture for each order: a letter with the arrow down the
// alphabet (A for A–Z, Z for Z–A), a #, a calendar with the arrow of the
// years, a star, a clock for what was added lately, and the history's
// clock turning back for what was watched lately.
const ARROW_DOWN = 'M15 4.5v11M12.6 13.2 15 15.6l2.4-2.4';
const ARROW_UP = 'M15 15.5v-11M12.6 6.8 15 4.4l2.4 2.4';
const CALENDAR = 'M3.7 5.5h5.1a1.2 1.2 0 0 1 1.2 1.2v7.6a1.2 1.2 0 0 1-1.2 1.2H3.7a1.2 1.2 0 0 1-1.2-1.2V6.7a1.2 1.2 0 0 1 1.2-1.2zM2.5 9h7.5M5 3.8v3M7.5 3.8v3';
const ORDER_ICONS = {
  az: `<path d="M3.5 15 7 5l3.5 10M4.7 11.6h4.6${ARROW_DOWN}"/>`,
  za: `<path d="M3.5 5h6.5L3.5 15h6.5${ARROW_DOWN}"/>`,
  num: '<path d="M8 3.5 6.5 16.5M13.5 3.5 12 16.5M4 7.5h12.5M3.5 12.5H16"/>',
  newest: `<path d="${CALENDAR}${ARROW_DOWN}"/>`,
  oldest: `<path d="${CALENDAR}${ARROW_UP}"/>`,
  rating: '<path d="m10 3.2 2.1 4.3 4.7.7-3.4 3.3.8 4.7-4.2-2.2-4.2 2.2.8-4.7-3.4-3.3 4.7-.7z"/>',
  added: '<circle cx="10" cy="10" r="6.5"/><path d="M10 6.2V10l2.7 1.7"/>',
  watched: '<path d="M4.2 10a5.8 5.8 0 1 0 1.7-4.1M3.8 3.4v3h3"/><path d="M10 6.8V10l2.4 1.5"/>',
};

/** What each order is called, on its mark. */
export function orderName(order) {
  switch (order) {
    case 'az': case 'za': case 'num': return t(`setup.channelsort.${order}`);
    case 'added': return t('favs.sort.added');
    default: return t(`order.${order}`);
  }
}

// The name of each list's order, for its group of marks.
const ORDER_LABELS = { live: 'setup.channelsort', fav: 'favs.sort', movie: 'setup.moviesort', series: 'setup.seriessort', recent: 'setup.historysort' };

/**
 * The marks for a list's order, the one in force lit. A mark that stands
 * for two orders shows the one it is at: pressing a lit A–Z turns it to
 * Z–A and the A to a Z, and pressing it again turns it back. The channel
 * list's mark once showed A–Z lit while Z–A was set and did nothing.
 */
function listOrderToggle(list) {
  const current = listOrder(state.settings, list);
  const box = document.createElement('span');
  box.className = 'view-toggle order-toggle';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', t(ORDER_LABELS[list]));
  for (const orders of ORDER_MARKS[list]) {
    const lit = orders.includes(current);
    const shown = lit ? current : orders[0];
    const button = document.createElement('button');
    button.type = 'button';
    button.title = orderName(shown);
    button.dataset.order = shown;
    button.setAttribute('aria-label', orderName(shown));
    button.setAttribute('aria-pressed', String(lit));
    button.append(svg(ORDER_ICONS[shown]));
    button.addEventListener('click', () => setListOrder(list, pressedOrder(orders, listOrder(state.settings, list))));
    box.appendChild(button);
  }
  return box;
}

async function setListOrder(list, order) {
  if (listOrder(state.settings, list) === order) return;
  const focused = el.listinfo.contains(document.activeElement);
  state.settings = await store.saveSettings({ [ORDER_SETTINGS[list]]: order });
  state.cursor = -1;
  await refreshRows();
  // The press rebuilt the marks: the focus goes to the one standing where
  // the pressed one was, so that a second press turns the order back.
  const at = ORDER_MARKS[list].findIndex((orders) => orders.includes(order));
  if (focused && at >= 0) el.listinfo.querySelectorAll('.order-toggle button')[at]?.focus();
}

/**
 * The list column's heading, heard by a screen reader that walks the
 * headings: the tab, and the group and topic the list shows.
 */
function renderListHeading() {
  const type = tabType();
  const group = !isCollection() && !state.query && state.lib && state.group ? state.group : null;
  const where = group && state.sub ? state.lib.categoryName(type, state.sub) : group;
  $('list-heading').textContent = [t(`tab.${state.tab}`), where].filter(Boolean).join(': ');
}

/**
 * Clearing the history cannot be undone, so it takes a second tap. A dialog
 * of its own would be too much for something of this weight.
 */
function clearHistoryButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = t('history.clear');
  let armed = false;
  let timer = null;
  button.addEventListener('click', () => {
    if (armed) { clearTimeout(timer); clearHistory(); return; }
    armed = true;
    button.textContent = t('history.clear.confirm');
    button.classList.add('armed');
    timer = setTimeout(() => {
      armed = false;
      button.textContent = t('history.clear');
      button.classList.remove('armed');
    }, 4000);
  });
  return button;
}
