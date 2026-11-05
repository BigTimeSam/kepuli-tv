// The topic bar above the channel list: the chips of a country's topics,
// its height that the viewer can drag, and the counts on the chips.
//
// Moved out of app.js. It takes the player's state and helpers from app.js
// (a cycle that ES modules resolve: nothing here runs while the modules
// load, only when the player calls in).

import { crumbLabel } from './seriesui.js';
import { emptyState } from './rows.js';
import { nf } from './format.js';
import { t } from './i18n.js';
import { viewToggle } from './coversui.js';
import * as store from './config.js';
import { activateTab, isAbort, isCollection, kindLabel, mediaFilters, openHiddenList, refreshRows, renderSidebar, showListCancelled, showListError, state, tabType, unit } from './app.js';
import { hideProgress, progressSignal, showProgress, updateProgress } from './progressdialog.js';
import { clearHistory } from './collections.js';
import { $, el } from './dom.js';
import { configured, openSetup } from './setupui.js';

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
  const column = el.subcats.parentElement.clientHeight || window.innerHeight;
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
  if (mediaFilters.filtering) node = emptyState(t('filters.nohits'), t('filters.nohits.text'), { label: t('filters.reset'), onClick: () => mediaFilters.clear() }, 'search');
  else if (state.query) node = emptyState(t('empty.nohits'), t('empty.nohits.text', { query: state.query }), null, 'search');
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
      : `${state.group}${group && group.cats.length > 1 ? ` (${t('list.topics', { n: group.cats.length })})` : ''}`);
  }

  el.listinfo.replaceChildren(document.createTextNode(parts.join(', ')));
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
