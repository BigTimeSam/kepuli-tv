import { XtreamApi, ApiError } from './api.js';
import { Library, sortItems } from './library.js';
import { Epg } from './epg.js';
import { Playback } from './playback.js';
import { VirtualList } from './vlist.js';
import { itemRow, categoryRow, chipRow, favCategoryRow, sectionHeader, emptyState } from './rows.js';
import { nameCleaner } from './name.js';
import { EpgGrid, catchupAvailable } from './epggrid.js';
import { cacheClear, wipeStorage, storageEstimate } from './db.js';
import { parsePlaylistUrl, streamUrl, timeshiftUrl, baseUrl } from './xtream.js';
import { api } from './browser.js';
import { requestAccess, hasAccess } from './permissions.js';
import { externalLabel, handOff } from './external.js';
import { Cast, supported as castSupported } from './cast.js';
import { warmCache, peek, badge as probeBadge, subtitleSummary, shortLanguage } from './probe.js';
import * as store from './config.js';
import { nf, dateTimeFmt, dateFmt, stampFmt, dayLabel, clock, megabytes, duration, progressOf, setLocale } from './format.js';
import { t, applyStatic, setLanguage, localeTag, LANGUAGES } from './i18n.js';

const $ = (id) => document.getElementById(id);
const el = {
  tabs: $('tabs'), search: $('search'), groups: $('groups'), groupsCol: $('groups-col'),
  categoryFilter: $('category-filter'), groupsFilter: $('groups-filter'),
  list: $('list'), crumbs: $('crumbs'), detail: $('detail'),
  listinfo: $('listinfo'), main: $('main'), accountMeta: $('account-meta'), accountExpiry: $('account-expiry'),
  subcats: $('subcats'), subcatsGrip: $('subcats-grip'),
  video: $('video'), overlay: $('overlay'), overlayTitle: $('overlay-title'),
  overlayText: $('overlay-text'), overlayActions: $('overlay-actions'), statbadge: $('statbadge'),
  infostrip: $('infostrip'), nowTitle: $('now-title'), nowSub: $('now-sub'), mode: $('mode'),
  subs: $('subs'), subsize: $('subsize'), cast: $('btn-cast'),
  setup: $('setup'), progress: $('progress'),
  epg: $('epg'), epgPreview: $('epg-preview'),
  pTitle: $('p-title'), pFill: $('p-fill'), pText: $('p-text'), toast: $('toast'),
};

const TYPE_OF_TAB = { live: 'live', movie: 'movie', series: 'series' };
const TYPE_KIND = { live: 0, movie: 1, series: 2 };

/** "3 channels" — the type picks the key, the number picks the plural. */
const unit = (type, count) => t(`unit.${type || 'generic'}`, { count, n: nf.format(count) });

// Favourites and history are not the server's lists but the user's own
// collections: they are always in memory, mix all four types, and are
// organised in the sidebar by type rather than by country.
const COLLECTIONS = new Set(['fav', 'recent']);
// 'c' = a favourite category: not a playable item but a door into a list,
// see favCategoryEntry. In a collection it is a type of its own and comes
// first, because one category row covers dozens of channels.
const kindLabel = (kind) => t(`kind.${kind}`);
const KIND_ORDER = ['c', 0, 1, 2];
const KIND_INDEX = new Map(KIND_ORDER.map((kind, i) => [kind, i]));
// In a collection an episode is only part of a series, so it is counted and
// labelled as a series — otherwise history would show a type that does not
// exist among the tabs.
const kindGroup = (k) => (k === 3 ? 2 : k);
const ROW_H = 50;   // the same number as --row-h in player.css
const SEP_H = 26;   // the same number as --sep-h in player.css

const state = {
  config: null, settings: null, account: null,
  source: null, lib: null, epg: null,
  tab: 'live',
  group: null,            // the chosen country/subject, null = all
  sub: null,              // a topic within the group (category_id)
  groupItems: [],         // every item of the chosen group, in memory
  categoryFilter: '', query: '',
  cleanName: null,        // the row-name tidier, null = the name as it is
  kind: null,             // a collection's type filter, null = all
  rows: [], rowIndex: new Map(), sections: new Map(), cursor: -1,
  // A drill-down into the list. A series and a favourite category share the
  // same place and the same back button, so they are one state with two
  // shapes:
  //   { view: 'series',   item, info, season, back }
  //   { view: 'category', entry, items, back }
  // back carries the previous drill-down: a series opened from a favourite
  // category returns to the category, not to the collection's root.
  detail: null,
  catCounts: null,        // the sizes of favourite categories, when known
  playing: null, playingSpec: null, catchup: null,
  subtitles: [],          // the subtitle tracks of the file being played
  favorites: new Map(), recents: [], resume: new Map(),
  lastGroup: {}, lastKind: {},
  subcatsHeight: null,    // the topic bar's height when dragged, null = automatic
};

const isCollection = () => COLLECTIONS.has(state.tab);

/* ============================================================ connection */

async function connect({ silent = false } = {}) {
  const config = state.config;
  try {
    if (!config.host || !config.username || !config.password) { openSetup(); return false; }
    state.source = new XtreamApi(config);

    if (!silent) showProgress(t('progress.connecting'), config.host);
    state.account = await state.source.account();
    state.lib = new Library(state.source);
    // File headers read earlier into memory, so that list rows can show the
    // result without a network request while painting.
    await warmCache();
    state.epg = new Epg(state.source, onEpgUpdated);
    state.epg.enabled = state.settings.epgEnabled;
    await state.lib.loadCategories();
    hideProgress();

    renderAccount();
    renderNowSub();
    renderSidebar();
    await activateTab(state.tab, { restore: true });
    return true;
  } catch (err) {
    hideProgress();
    showConnectionError(err);
    return false;
  }
}

function showConnectionError(err) {
  const apiError = err instanceof ApiError;
  el.overlay.hidden = false;
  el.overlay.classList.remove('loading');
  el.overlayTitle.textContent = t('error.connect.title');
  el.overlayText.textContent = apiError
    ? err.message
    : t('error.unexpected', { message: err.message });
  const actions = [{ label: t('btn.settings'), onClick: openSetup }];
  showOverlayActions(actions);
  if (state.config.host) {
    offerAccess(baseUrl(state.config), actions, () => connect());
  }
  console.error('[iptv] yhteysvirhe', err);
}

/**
 * A missing host permission looks like the same network error as a server
 * that is down, so the cause cannot be deduced — check the permission and
 * offer to grant it only when it really is missing.
 */
async function offerAccess(url, actions, onGranted) {
  if (!url || await hasAccess(url)) return;
  if (el.overlay.hidden) return;            // tilanne ehti vaihtua
  showOverlayActions([grantAction(url, onGranted), ...actions]);
}

/** A button that asks for the host permission and continues if granted. */
function grantAction(url, onGranted) {
  let origin = url;
  try { origin = new URL(url).host; } catch { /* show the whole URL */ }
  return {
    label: t('error.grant', { origin }),
    // requestAccess is called before the first await, otherwise the user
    // gesture is spent and Chrome shows no permission dialog at all.
    onClick: async () => {
      if (await requestAccess(url)) await onGranted();
      else toast(t('error.grant.denied'));
    },
  };
}

/**
 * The top bar has room for one fact about the account, and the only one
 * that ever calls for action is the expiry date. The connection count and
 * the rest of the details live in the settings dialog.
 */
function renderAccount() {
  const a = state.account;
  if (!a?.expiresAt) { el.accountMeta.hidden = true; el.accountExpiry.textContent = ''; return; }
  const date = dateFmt.format(new Date(a.expiresAt));
  const days = Math.round((a.expiresAt - Date.now()) / 86400e3);
  el.accountExpiry.textContent = date;
  el.accountMeta.title = days < 14 ? t('account.expiring', { date, days }) : t('account.valid', { date });
  el.accountMeta.classList.toggle('warn', a.status !== 'Active' || days < 14);
  el.accountMeta.hidden = false;
}

/* ================================================================= views */

function tabType() { return TYPE_OF_TAB[state.tab] || null; }

async function activateTab(tab, { restore = false } = {}) {
  state.tab = tab;
  for (const button of el.tabs.children) button.classList.toggle('active', button.dataset.tab === tab);
  state.detail = null;
  state.cursor = -1;
  state.sub = null;
  state.group = restore ? (state.lastGroup[tab] ?? null) : null;
  state.kind = restore ? (state.lastKind[tab] ?? null) : null;

  const type = tabType();

  // First open: pick a group, so the list fills from a few kilobytes rather
  // than by loading the type's whole list straight away.
  if (type && state.group == null && !state.lib.isFull(type)) {
    const groups = state.lib.groups[type];
    if (groups.length) state.group = groups[0].name;
  }

  store.saveUiState({ tab });
  renderSidebar();
  await refreshRows();
}

async function refreshRows({ keepScroll = false } = {}) {
  const type = tabType();
  let rows = [];
  renderDetail();   // the detail panel follows the state on a tab change too

  try {
    if (state.detail) {
      rows = state.detail.view === 'category' ? state.detail.items : episodesOfSeason();
    } else if (isCollection()) {
      rows = collectionItems();
      if (state.kind != null) rows = rows.filter((it) => kindGroup(it.k) === state.kind);
      // Array.sort is stable, so grouping by type does not disturb the
      // collection's own order within a type.
      else if (state.tab === 'fav') rows = [...rows].sort((a, b) => kindIndex(a) - kindIndex(b));
    } else if (state.query) {
      if (!(await ensureFull(type, t('progress.reason.search')))) return;
      rows = state.lib.search(type, state.query, null);
    } else if (state.group == null) {
      if (!(await ensureFull(type, t('progress.reason.all')))) return;
      rows = state.lib.full[type];
    } else {
      state.groupItems = await loadGroupItems(type, state.group);
      rows = state.sub
        ? state.groupItems.filter((it) => it.cats.includes(state.sub))
        : state.groupItems;
    }
  } catch (err) {
    hideProgress();
    showConnectionError(err);
    return;
  }

  if (state.query && isCollection()) {
    const q = state.query.toLowerCase();
    rows = rows.filter((it) => it.n.toLowerCase().includes(q));
  }

  // The visible name decides the order: once a prefix has been stripped
  // from a row, the library's sorting no longer matches what the list
  // shows.
  state.cleanName = nameCleanerFor(rows);
  if (state.cleanName) rows = sortItems(rows, state.cleanName);
  state.rows = rows;
  state.catCounts = categoryCountsFor(rows);
  state.rowIndex = new Map(rows.map((it, i) => [`${it.k}:${it.id}`, i]));
  state.sections = sectionsFor(rows);
  vlist.setCount(rows.length, {
    keepScroll,
    heightAt: state.sections.size ? (i) => ROW_H + (state.sections.has(i) ? SEP_H : 0) : null,
  });
  // The guide shows the same set as the list, so search and group selection
  // narrow it without a filter of its own.
  if (guideOpen && state.tab === 'live') grid.setChannels(rows.filter((it) => it.k === 0));
  renderSubcats();
  renderListInfo();
  renderEmptyState();
}

/* ============================================================ collections */

/** The whole set of favourites or history, before any filters. */
function collectionItems() {
  return state.tab === 'fav' ? favoritesNewestFirst() : state.recents;
}

/**
 * Favourites newest first. Older entries have no addedAt, so they keep
 * their stored order behind the newer ones.
 */
function favoritesNewestFirst() {
  return [...state.favorites.values()]
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (b.item.addedAt || 0) - (a.item.addedAt || 0) || b.i - a.i)
    .map((entry) => entry.item);
}

const kindIndex = (item) => KIND_INDEX.get(kindGroup(item.k)) ?? KIND_ORDER.length;

/* ------------------------------------------------ favourite categories */

/**
 * A favourite category fits the same store as the items: it is a collection
 * row like the rest, and the key `${k}:${id}` sets it apart. That is why
 * config.js's favourites list serves as it is.
 *
 * What is kept is an identifier, not the contents: "MTV Liiga" is a
 * favourite as a name and as a category, and its channels are always
 * fetched fresh — which is exactly what makes a favourite category a
 * different thing from a set of individual channels.
 *
 *   c   category_id, or null when the favourite is a whole group ("Finland")
 *   g   the group name, i.e. where in the sidebar the category is found
 *   n   the visible name; full = the provider's complete category name
 */
function favCategoryEntry(type, groupName, cat) {
  return cat
    ? { k: 'c', id: `${type}:${cat.id}`, t: type, c: cat.id, g: groupName, n: cat.sub || groupName, full: cat.name }
    : { k: 'c', id: `${type}:g:${groupName}`, t: type, c: null, g: groupName, n: groupName, full: null };
}

const isFavorite = (entry) => state.favorites.has(`${entry.k}:${entry.id}`);

/**
 * A row's subtitle: what and from where. The type is needed because a
 * collection mixes channel, movie and series categories; the group because
 * the same topic ("Sport") repeats from one country to the next.
 */
function favCategorySubtitle(entry) {
  const bits = [kindLabel(TYPE_KIND[entry.t])];
  if (entry.c == null) {
    const group = state.lib ? state.lib.group(entry.t, entry.g) : null;
    if (group && group.cats.length > 1) bits.push(t('list.topics', { n: group.cats.length }));
  } else if (entry.g && entry.g !== entry.n) bits.push(entry.g);
  return bits.join(' · ');
}

/**
 * The category sizes once per paint rather than per row: the count walks the
 * type's whole list, and the rows are repainted on every scroll frame. The
 * number is known only when the list has already been loaded — the point of
 * a favourite category being precisely that it need not be loaded to see
 * one's favourites.
 */
function categoryCountsFor(rows) {
  if (!state.lib || !rows.some((it) => it.k === 'c')) return null;
  // Either count walks the type's whole list, so the result is kept and not
  // asked for twice for the same type.
  const cache = new Map();
  const source = (kind, type) => {
    const key = `${kind}:${type}`;
    if (!cache.has(key)) {
      cache.set(key, kind === 'groups' ? state.lib.groupCounts(type) : state.lib.categoryCounts(type));
    }
    return cache.get(key);
  };

  const counts = new Map();
  for (const row of rows) {
    if (row.k !== 'c') continue;
    const map = source(row.c == null ? 'groups' : 'cats', row.t);
    const count = map && map.get(row.c == null ? row.g : row.c);
    if (count != null) counts.set(`${row.k}:${row.id}`, count);
  }
  return counts.size ? counts : null;
}

/**
 * Opens a category inside the collection: the same drill-down as a series,
 * so that returning to the favourites is one tap rather than a tab change.
 */
async function openFavCategory(entry) {
  if (!state.lib) { toast(t('error.noserver')); return; }
  const back = state.detail;
  state.detail = { view: 'category', entry, items: [], back };
  state.cursor = -1;
  renderDetail();
  state.rows = [];
  state.sections = new Map();
  vlist.setCount(0);
  const open = state.detail;
  try {
    const items = entry.c == null
      ? await loadGroupItems(entry.t, entry.g)
      : await state.lib.categoryItems(entry.t, entry.c);
    if (state.detail !== open) return;
    state.detail.items = items;
    await refreshRows();
  } catch (err) {
    if (state.detail === open) { state.detail = back; renderDetail(); await refreshRows(); }
    showConnectionError(err);
  }
}

/**
 * A category's star in the browsing views. The favourites list is the
 * collection's own view, so the sidebar and the topic chips are repainted
 * only when we are elsewhere — in the favourites the whole list changes.
 */
function toggleFavCategory(entry) {
  const key = `${entry.k}:${entry.id}`;
  if (state.favorites.has(key)) state.favorites.delete(key);
  else state.favorites.set(key, { ...entry, addedAt: Date.now() });
  store.saveFavorites(state.favorites);
  if (state.tab === 'fav') { renderSidebar(); refreshRows({ keepScroll: true }); }
  else { renderCategories(); renderSubcats(); }
}

/**
 * Section headings: row index → the heading above it. History splits into
 * days, favourites into types — in both, the heading says what the rows do
 * not show themselves. A type filter makes the favourites' headings
 * pointless.
 */
function sectionsFor(rows) {
  const sections = new Map();
  if (!isCollection() || state.detail) return sections;
  if (state.tab === 'fav' && state.kind != null) return sections;

  let previous = null;
  for (let i = 0; i < rows.length; i++) {
    const label = state.tab === 'recent' ? dayLabel(rows[i].watchedAt) : kindLabel(kindGroup(rows[i].k));
    if (label && label !== previous) sections.set(i, label);
    previous = label;
  }
  // A single type heading atop the whole list organises nothing, and the
  // sidebar says the same. A day heading, on the other hand, also says
  // when — that one stays.
  if (state.tab === 'fav' && sections.size < 2) return new Map();
  return sections;
}

async function removeFromHistory(item) {
  state.recents = await store.removeRecent(`${item.k}:${item.id}`);
  renderSidebar();
  await refreshRows({ keepScroll: true });
}

async function clearHistory() {
  await store.clearRecents();
  state.recents = [];
  state.kind = null;
  state.lastKind.recent = null;
  renderSidebar();
  await refreshRows();
  toast(t('history.cleared'));
}

/**
 * A group's contents are fetched one sub-category at a time. Sweden = 31
 * categories at ~2 kB each is still a fraction of the whole list's 634
 * kilobytes, and after this, switching between topics needs no network at
 * all.
 */
async function loadGroupItems(type, groupName) {
  const group = state.lib.group(type, groupName);
  const heavy = group && group.cats.length > 3 && !state.lib.isFull(type);
  if (heavy) showProgress(t('progress.group', { group: groupName }), t('progress.categories', { done: 0, total: group.cats.length }));
  try {
    return await state.lib.groupItems(type, groupName, {
      onProgress: (done, total) => {
        if (!heavy) return;
        el.pFill.parentElement.classList.remove('indeterminate');
        fillBar(done / total);
        el.pText.textContent = t('progress.categories', { done, total });
      },
    });
  } finally {
    if (heavy) hideProgress();
  }
}

/** The topic bar and its handle appear and disappear together. */
function showSubcats(on) {
  el.subcats.hidden = !on;
  el.subcatsGrip.hidden = !on;
}

/** The topic filters within the chosen group. */
function renderSubcats() {
  const type = tabType();
  const group = type && state.group ? state.lib.group(type, state.group) : null;
  if (!group || group.cats.length < 2 || state.detail || state.query) {
    showSubcats(false);
    el.subcats.replaceChildren();
    return;
  }
  const counts = new Map();
  for (const item of state.groupItems) {
    for (const cat of item.cats) counts.set(cat, (counts.get(cat) || 0) + 1);
  }
  // The buttons in alphabetical order, but the group's own general
  // category ("Sweden" with no topic) right after the All button: it is not
  // a topic among topics but the country's main channels.
  const ordered = [...group.cats].sort((a, b) => {
    if (!a.sub !== !b.sub) return a.sub ? 1 : -1;
    return (a.sub || '').localeCompare(b.sub || '', 'fi');
  });

  const frag = document.createDocumentFragment();
  // "All" is the whole group, and its star is on the sidebar row — two
  // buttons for the same favourite would blur both.
  frag.appendChild(chipRow({
    label: t('subcats.all'), count: nf.format(state.groupItems.length), active: state.sub == null,
  }, () => selectSub(null)));
  for (const cat of ordered) {
    const count = counts.get(cat.id) || 0;
    if (count === 0) continue;
    const entry = favCategoryEntry(type, group.name, cat);
    frag.appendChild(chipRow({
      label: cat.sub || t('subcats.general'), count: nf.format(count), active: state.sub === cat.id, title: cat.name,
      favorite: isFavorite(entry),
      onFavorite: () => toggleFavCategory(entry),
    }, () => selectSub(cat.id)));
  }
  el.subcats.replaceChildren(frag);
  showSubcats(true);
  applySubcatsHeight();
}

/* ================================================== the topic bar height */

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
function applySubcatsHeight() {
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
function wireSubcatsResize() {
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

async function selectSub(categoryId) {
  state.sub = categoryId;
  state.cursor = -1;
  await refreshRows();
}

async function ensureFull(type, reason) {
  if (state.lib.isFull(type)) return true;
  showProgress(t('progress.list', { what: t(`progress.list.${type}`) }), reason);
  try {
    await state.lib.ensureFull(type, {
      onProgress: (received, total) => updateProgress(received, total),
    });
    renderSidebar();
    return true;
  } catch (err) {
    hideProgress();
    showConnectionError(err);
    return false;
  } finally {
    hideProgress();
  }
}

function renderEmptyState() {
  const existing = el.list.querySelector('.empty');
  if (existing) existing.remove();
  if (state.rows.length > 0) return;
  const type = tabType();
  const browse = { label: t('empty.browse'), onClick: () => activateTab('live') };
  let node;
  if (state.query) node = emptyState(t('empty.nohits'), t('empty.nohits.text', { query: state.query }));
  else if (state.detail && state.detail.view === 'category') {
    node = emptyState(t('empty.category'), t('empty.category.text'));
  } else if (state.tab === 'fav') {
    node = emptyState(t('empty.fav'), t('empty.fav.text'), browse);
  } else if (state.tab === 'recent') {
    node = emptyState(t('empty.recent'), t('empty.recent.text'), browse);
  } else node = emptyState(t('empty.plain'), t('empty.plain.text'));
  el.list.appendChild(node);
}

function renderListInfo() {
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
      : `${state.group}${group && group.cats.length > 1 ? ` · ${t('list.topics', { n: group.cats.length })}` : ''}`);
  }
  if (type && state.lib && !state.lib.isFull(type) && !state.detail) parts.push(t('list.partial'));

  el.listinfo.replaceChildren(document.createTextNode(parts.join(' · ')));
  if (state.tab === 'recent' && state.recents.length) {
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    el.listinfo.append(spacer, clearHistoryButton());
  }
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

/* =============================================================== sidebar */

/**
 * The sidebar is the same box on every tab, but its contents change: on the
 * lists, countries and topics; in the collections, types. That way
 * favourites and history get the same structure as the other views instead
 * of leaving the column empty.
 */
function renderSidebar() {
  if (isCollection()) renderKinds();
  else renderCategories();
}

function renderKinds() {
  el.groupsFilter.hidden = true;
  const items = collectionItems();
  // An empty collection needs no filter: the empty-state text says more
  // than a row reading "All 0".
  if (!items.length) { el.groups.replaceChildren(); return; }

  const counts = new Map();
  for (const item of items) { const k = kindGroup(item.k); counts.set(k, (counts.get(k) || 0) + 1); }

  const frag = document.createDocumentFragment();
  frag.appendChild(categoryRow(
    { id: null, name: t('groups.all'), count: items.length, active: state.kind == null, all: true },
    selectKind,
  ));
  for (const kind of KIND_ORDER) {
    const count = counts.get(kind) || 0;
    if (count === 0) continue;
    frag.appendChild(categoryRow(
      { id: kind, name: kindLabel(kind), count, active: state.kind === kind },
      selectKind,
    ));
  }
  el.groups.replaceChildren(frag);
}

async function selectKind(kind) {
  state.kind = kind;
  // A sidebar choice concerns the collection, not the list drilled into
  // from it — otherwise the tap would appear to do nothing.
  state.detail = null;
  state.cursor = -1;
  state.lastKind[state.tab] = kind;
  renderKinds();
  await refreshRows();
}

function renderCategories() {
  const type = tabType();
  el.groupsFilter.hidden = false;
  if (!type || !state.lib) { el.groups.replaceChildren(); return; }

  const counts = state.lib.groupCounts(type);
  const filter = state.categoryFilter.trim().toLowerCase();
  // The filter matches sub-categories too, so that "sport" finds the
  // countries that have one even when the country's name lacks the word.
  const groups = state.lib.groups[type].filter((g) => !filter
    || g.name.toLowerCase().includes(filter)
    || g.cats.some((c) => c.name.toLowerCase().includes(filter)));

  const frag = document.createDocumentFragment();
  if (!filter) {
    const total = state.lib.full[type] ? state.lib.full[type].length : null;
    const all = categoryRow(
      { id: null, name: t('groups.all'), count: total, active: state.group == null, all: true, indent: true },
      selectGroup,
    );
    if (total == null) all.title = t('groups.all.title');
    frag.appendChild(all);
  }
  for (const group of groups) {
    // A group favourite covers every sub-category: "Finland" brings the
    // country's whole offering, including what appears in it later.
    const entry = favCategoryEntry(type, group.name, null);
    frag.appendChild(categoryRow({
      id: group.name, name: group.name,
      count: counts ? counts.get(group.name) || 0 : null,
      active: state.group === group.name,
      favorite: isFavorite(entry),
      onFavorite: () => toggleFavCategory(entry),
    }, selectGroup));
  }
  el.groups.replaceChildren(frag);
}

async function selectGroup(name) {
  state.group = name;
  state.sub = null;
  state.detail = null;
  state.cursor = -1;
  state.lastGroup[state.tab] = name;
  renderSidebar();
  await refreshRows();
}

/* ================================================================== rows */

const vlist = new VirtualList(el.list, ROW_H, renderRow, {
  onVisible: (first, last) => {
    // In guide mode the list is hidden, and its visible rows would take the
    // programme-data queue away from the grid.
    if (state.epg && !guideOpen) state.epg.setVisible(state.rows.slice(first, last));
  },
});

function renderRow(index) {
  const item = state.rows[index];
  const key = `${item.k}:${item.id}`;
  const row = item.k === 'c' ? favCategoryRow(item, {
    subtitle: favCategorySubtitle(item),
    count: state.catCounts && state.catCounts.has(key) ? nf.format(state.catCounts.get(key)) : null,
    selected: index === state.cursor,
    onOpen: () => { state.cursor = index; openFavCategory(item); },
    onFavorite: () => toggleFavCategory(item),
  }) : itemRow(item, {
    label: state.cleanName ? state.cleanName(item.n) : null,
    playing: state.playing && `${state.playing.k}:${state.playing.id}` === key,
    selected: index === state.cursor,
    favorite: state.favorites.has(key),
    epg: item.k === 0 && state.epg ? state.epg.nowNext(item.id) : null,
    resume: state.resume.get(key),
    tag: tagFor(item),
    probe: probeFor(item),
    onOpen: () => { state.cursor = index; openItem(item); },
    onFavorite: () => toggleFavorite(item),
    onRemove: state.tab === 'recent' ? () => removeFromHistory(item) : null,
    removeTitle: t('row.remove.history'),
  });

  const label = state.sections.get(index);
  if (!label) return row;
  // The heading travels with the row in the same node, which keeps the
  // virtualisation index-based and spares state.rows any heading entries.
  const group = document.createElement('div');
  group.className = 'rowgroup';
  group.append(sectionHeader(label), row);
  return group;
}

/**
 * Once a country or a category is chosen, the sidebar says what every row
 * name repeats: "US: NHL Ice Center Pass 3 FHD" is, under NHL, merely "Ice
 * Center Pass 3 FHD". In search and in the collections the rows come from
 * different groups, so there the prefix distinguishes — and stays put.
 */
function nameCleanerFor(rows) {
  // Inside a favourite category the filter is known even though the sidebar
  // does not show it, so the row names tidy up as in the browsing view.
  if (state.detail && state.detail.view === 'category') {
    const entry = state.detail.entry;
    return nameCleaner(entry.g && entry.g !== entry.n ? [entry.g, entry.n] : [entry.n], rows);
  }
  if (isCollection() || state.detail || state.query || state.group == null) return null;
  const type = tabType();
  const group = type && state.lib ? state.lib.group(type, state.group) : null;
  if (!group) return null;
  const labels = [group.name];
  if (state.sub) {
    const cat = group.cats.find((c) => c.id === state.sub);
    if (cat && cat.sub) labels.push(cat.sub);
  }
  return nameCleaner(labels, rows);
}

/**
 * A history row states the time of day; the day comes from the section
 * heading. In the favourites the type already shows in the heading and in
 * the sidebar, so the row is left alone on that count — in a narrow column
 * every character is space taken from the name.
 */
function tagFor(item) {
  if (state.tab !== 'recent' || !item.watchedAt) return null;
  return { text: clock(item.watchedAt), title: t('row.watched', { stamp: stampFmt.format(new Date(item.watchedAt)) }) };
}

/**
 * A file header that has been read earlier, if there is one. No network
 * requests are made while painting a row: the header is read only when
 * playback is attempted, and next time the result is already in hand.
 */
function probeFor(item) {
  if (item.k !== 1 && item.k !== 3) return null;
  if (!state.config) return null;
  const url = streamUrl(state.config, item, 'ts');
  return url ? peek(url) : null;
}

function onEpgUpdated(ids) {
  for (const id of ids) {
    const index = state.rowIndex.get(`0:${id}`);
    if (index != null) vlist.refreshRow(index);
  }
  if (state.playing && state.playing.k === 0 && ids.includes(String(state.playing.id))) renderInfoStrip();
  if (guideOpen) grid.invalidate();
}

function toggleFavorite(item) {
  const key = `${item.k}:${item.id}`;
  if (state.favorites.has(key)) state.favorites.delete(key);
  else state.favorites.set(key, { ...stripItem(item), addedAt: Date.now() });
  store.saveFavorites(state.favorites);
  if (state.tab === 'fav') { renderSidebar(); refreshRows({ keepScroll: true }); }
  else vlist.refresh();
  renderFavButton();
}

/** Only the fields the list needs for painting are kept. */
function stripItem(item) {
  const { id, k, n, logo, ext, season, episode, archive, epgId, direct, cats, durationSec } = item;
  return { id, k, n, logo, ext, season, episode, archive, epgId, direct, cats, durationSec };
}

/* ================================================================ series */

async function openItem(item) {
  if (item.k === 'c') return openFavCategory(item);
  if (item.k === 2) return openSeries(item);
  await playItem(item);
}

async function openSeries(item) {
  // A series opened from a favourite category stays inside the category:
  // going back returns to the list it was chosen from.
  const back = state.detail && state.detail.view === 'category' ? state.detail : null;
  state.detail = { view: 'series', item, info: null, season: null, back };
  renderDetail();
  state.rows = [];
  state.sections = new Map();
  vlist.setCount(0);
  try {
    const info = await state.lib.seriesEpisodes(item.id);
    if (!state.detail || state.detail.view !== 'series' || state.detail.item.id !== item.id) return;
    state.detail.info = info;
    const seasons = seasonNumbers(info.episodes);
    state.detail.season = seasons[0] ?? null;
    renderDetail();
    await refreshRows();
  } catch (err) {
    showConnectionError(err);
  }
}

function seasonNumbers(episodes) {
  return [...new Set(episodes.map((e) => e.season))].sort((a, b) => a - b);
}

function episodesOfSeason() {
  const detail = state.detail;
  if (!detail || detail.view !== 'series' || !detail.info) return [];
  const eps = detail.info.episodes;
  return detail.season == null ? eps : eps.filter((e) => e.season === detail.season);
}

// A transparent 1×1 GIF. Chrome draws a thin border and a broken-image mark
// on every image without a loaded source — including when src has been
// removed altogether, so removing it is not enough. With the pixel in place
// all that shows is the element's own background, which is the placeholder
// for a missing cover anyway.
const BLANK_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

/**
 * A cover image that leaves no broken image on screen: some of the library's
 * cover and logo URLs are dead. On list rows (rows.js) the same situation is
 * handled by hiding the image entirely, because there is no background there
 * to fall back on.
 */
function coverImage(className, src) {
  const img = document.createElement('img');
  if (className) img.className = className;
  img.alt = '';
  img.src = src || BLANK_PIXEL;
  if (src) img.addEventListener('error', () => { img.src = BLANK_PIXEL; }, { once: true });
  return img;
}

function renderDetail() {
  const detail = state.detail;
  // A category has neither a plot nor a cover — its contents are a list, and
  // the breadcrumb is enough to say where we are.
  el.detail.hidden = !detail || detail.view === 'category';
  el.crumbs.hidden = !detail;
  if (!detail) { el.detail.replaceChildren(); el.crumbs.replaceChildren(); return; }

  el.crumbs.replaceChildren();
  const back = document.createElement('button');
  back.type = 'button';
  back.textContent = t('crumbs.back');
  back.addEventListener('click', closeDetail);
  const label = document.createElement('span');
  label.textContent = detail.view === 'category' ? crumbLabel(detail.entry) : detail.item.n;
  el.crumbs.append(back, label);

  if (detail.view === 'category') { el.detail.replaceChildren(); return; }

  const info = detail.info;
  const main = document.createElement('div');
  main.className = 'detail-main';

  const cover = coverImage('detail-cover', (info && info.cover) || detail.item.logo);
  cover.loading = 'lazy';
  main.appendChild(cover);

  const body = document.createElement('div');
  body.className = 'detail-body';
  const title = document.createElement('div');
  title.className = 'detail-title';
  title.textContent = detail.item.n;
  body.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'detail-meta';
  const bits = [];
  if (info) {
    if (info.releaseDate) bits.push(String(info.releaseDate).slice(0, 4));
    if (info.genre) bits.push(info.genre);
    if (info.rating) bits.push(`★ ${info.rating}`);
    bits.push(t('list.episodes', { count: info.episodes.length, n: nf.format(info.episodes.length) }));
  } else bits.push(t('progress.loading'));
  for (const bit of bits) {
    const span = document.createElement('span');
    span.textContent = bit;
    meta.appendChild(span);
  }
  body.appendChild(meta);

  if (info && (info.plot || detail.item.plot)) {
    const plot = document.createElement('div');
    plot.className = 'detail-plot';
    plot.textContent = info.plot || detail.item.plot;
    body.appendChild(plot);
  }
  main.appendChild(body);
  el.detail.replaceChildren(main);

  if (info) {
    const seasons = seasonNumbers(info.episodes);
    if (seasons.length > 1) {
      const bar = document.createElement('div');
      bar.className = 'seasons';
      for (const season of seasons) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'season' + (season === detail.season ? ' active' : '');
        chip.textContent = t('season', { season });
        chip.addEventListener('click', () => {
          detail.season = season;
          renderDetail();
          refreshRows();
        });
        bar.appendChild(chip);
      }
      el.detail.appendChild(bar);
    }
  }
}

/** "Finland › MTV Liiga" — the same path by which the category is found
 *  when browsing. */
function crumbLabel(entry) {
  return entry.g && entry.g !== entry.n ? `${entry.g} › ${entry.n}` : entry.n;
}

function closeDetail() {
  state.detail = (state.detail && state.detail.back) || null;
  state.cursor = -1;
  renderDetail();
  refreshRows();
}

/* ============================================================== playback */

const playback = new Playback(el.video, onPlaybackState);

function onPlaybackState(s) {
  if (s.status === 'playing') {
    el.overlay.hidden = true;
    el.overlay.classList.remove('loading');
    showOverlayActions(null);
    renderNowSub(s.engine);
  } else if (s.status === 'loading') {
    el.overlay.hidden = false;
    el.overlay.classList.add('loading');
    el.overlayTitle.textContent = t('progress.connecting');
    el.overlayText.textContent = `${state.playing ? state.playing.n : ''} · ${s.engine}`;
    showOverlayActions(null);
  } else if (s.status === 'reconnecting') {
    el.overlay.hidden = false;
    el.overlay.classList.add('loading');
    el.overlayTitle.textContent = t('player.dropped');
    el.overlayText.textContent = (s.reason ? `${s.reason} · ` : '') + t('player.retrying', { attempt: s.attempt, max: s.max });
  } else if (s.status === 'notice') {
    // Playback continues, but the viewer had better know why it will end
    // early.
    toast(s.message);
  } else if (s.status === 'subtitles') {
    renderSubtitles(s.tracks, s.active);
    // The change came from the browser's own subtitle menu: the same choice
    // as from the selector, so the language is remembered the same way.
    if (s.external) rememberSubtitleLanguage(s.active);
  } else if (s.status === 'probing') {
    el.overlay.hidden = false;
    el.overlay.classList.add('loading');
    el.overlayTitle.textContent = t('player.probing');
    el.overlayText.textContent = t('player.probing.text');
    showOverlayActions(null);
  } else if (s.status === 'blocked') {
    el.overlay.hidden = false;
    el.overlay.classList.remove('loading');
    el.overlayTitle.textContent = t('player.waiting');
    el.overlayText.textContent = s.message;
  } else if (s.status === 'error') {
    el.overlay.hidden = false;
    el.overlay.classList.remove('loading');
    el.overlayTitle.textContent = t('player.failed');
    el.overlayText.textContent = s.message;
    // Right here an external player is worth the most: the browser has
    // already given up.
    const actions = [
      { label: t('player.retry'), onClick: () => state.playing && playItem(state.playing) },
      { label: t('ext.title'), onClick: playExternal },
      { label: t('player.copyurl'), onClick: copyUrl },
    ];
    // The picture will do but the audio track will not: silent playback is
    // on offer, not the default.
    if (s.canSilent) {
      actions.unshift({
        label: t('player.silent'),
        onClick: () => state.playing && playItem(state.playing, { allowSilent: true }),
      });
    }
    showOverlayActions(actions);
    // A stream may point at a different server from the API, so the
    // permission is checked against this stream's own origin.
    if (state.playingSpec) {
      offerAccess(state.playingSpec.url, actions,
                  () => state.playing && playItem(state.playing));
    }
  }
}

function showOverlayActions(actions) {
  el.overlayActions.replaceChildren();
  el.overlayActions.hidden = !actions || !actions.length;
  for (const action of actions || []) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ghost';
    button.textContent = action.label;
    button.addEventListener('click', action.onClick);
    el.overlayActions.appendChild(button);
  }
}

async function playItem(item, { startAt, allowSilent } = {}) {
  const live = item.k === 0;
  const url = streamUrl(state.config, item, 'ts');
  if (!url) { toast(t('player.nourl')); return; }
  const key = `${item.k}:${item.id}`;
  const saved = state.resume.get(key);
  const spec = {
    url,
    hlsUrl: live && !item.direct ? streamUrl(state.config, item, 'm3u8') : null,
    live,
    ext: item.ext,
    mode: el.mode.value,
    allowSilent: Boolean(allowSilent),
    subtitleLang: state.settings.subtitleLang,
    startAt: startAt ?? (state.settings.resumeEnabled && !live && saved ? saved.position : 0),
  };

  state.playing = item;
  state.playingSpec = spec;
  state.catchup = null;
  // Clear the previous file's tracks: the new ones arrive only once the
  // header has been read.
  renderSubtitles([], null);
  el.nowTitle.textContent = item.n;
  renderNowSub();
  renderFavButton();
  document.title = t('player.title', { name: item.n });
  if (guideOpen) grid.setPlaying(live ? item.id : null);

  playback.play(spec);
  vlist.refresh();

  if (live && state.epg) state.epg.want(item, { priority: true });
  renderInfoStrip();
  if (!live) loadVodDetails(item);
  state.recents = await store.pushRecent(stripItem(item));
  if (state.tab === 'recent') { renderSidebar(); refreshRows({ keepScroll: true }); }
}

function renderNowSub(engine) {
  const item = state.playing;
  if (!item) { el.nowSub.textContent = t('player.idle'); return; }
  const bits = [];
  const type = tabType();
  if (state.catchup) bits.push(t('player.catchup', { time: clock(state.catchup.start) }));
  if (item.cats && item.cats.length && state.lib && type) bits.push(state.lib.categoryName(type, item.cats[0]));
  if (item.k === 3) bits.push(`S${item.season} E${item.episode}`);
  if (engine || playback.engineName) bits.push(engine || playback.engineName);
  if (cast.connected) bits.push(t('cast.playing'));
  el.nowSub.textContent = bits.filter(Boolean).join(' · ') || '—';
}

/* ------------------------------------------------------------ subtitles */

/**
 * The subtitle selector. The list comes from the demuxer as soon as the file
 * header has been read, and the same call returns when the track changes —
 * including when the change was made from the browser's own subtitle menu.
 *
 * @param {object[]} tracks the tracks, empty when the file has no subtitles
 * @param {number|null} active the number of the visible track
 */
function renderSubtitles(tracks, active) {
  const list = tracks || [];
  const select = el.subs;
  // The same list arrives again when only the selection changed: the menu
  // is not rebuilt needlessly under the viewer's nose.
  if (list !== state.subtitles) {
    state.subtitles = list;
    select.hidden = !list.length;
    // Size is a pointless choice when there is nothing to show.
    el.subsize.hidden = !list.length;
    const options = [];
    if (list.length) {
      const off = document.createElement('option');
      off.value = 'off';
      off.textContent = t('player.subs.off');
      options.push(off);
    }
    for (const track of list) {
      const option = document.createElement('option');
      option.value = String(track.number);
      option.textContent = track.label;
      option.title = `${track.language} · ${track.format}`;
      options.push(option);
    }
    select.replaceChildren(...options);
  }
  select.value = active == null ? 'off' : String(active);
}

/** The viewer's choice from the selector: show the track, keep the language. */
function chooseSubtitle() {
  const value = el.subs.value;
  const number = value === 'off' ? null : Number(value);
  playback.selectSubtitle(number);
  rememberSubtitleLanguage(number);
}

/** Subtitle size: the CSS reads it from the body attribute, see player.css. */
function applySubtitleSize(size) {
  document.body.dataset.subsize = size || 'small';
  el.subsize.value = document.body.dataset.subsize;
}

async function chooseSubtitleSize() {
  applySubtitleSize(el.subsize.value);
  state.settings = await store.saveSettings({ subtitleSize: el.subsize.value });
}

/**
 * The language is kept for the coming episodes — not the track number,
 * because the numbers vary from one file to the next.
 */
async function rememberSubtitleLanguage(number) {
  const track = state.subtitles.find((t) => t.number === number);
  const language = track ? shortLanguage(track.language) : 'off';
  if (state.settings.subtitleLang === language) return;
  state.settings = await store.saveSettings({ subtitleLang: language });
}

function renderFavButton() {
  const button = $('btn-fav');
  const item = state.playing;
  const on = item && state.favorites.has(`${item.k}:${item.id}`);
  button.textContent = on ? '★' : '☆';
  button.classList.toggle('on', !!on);
  button.disabled = !item;
}

/* ---------------------------------------------------------- info panel */

function renderInfoStrip() {
  const item = state.playing;
  if (!item) { el.infostrip.hidden = true; return; }

  if (item.k === 0) {
    const entry = state.epg ? state.epg.nowNext(item.id) : null;
    if (!entry || (!entry.now && !entry.next)) { el.infostrip.hidden = true; return; }
    el.infostrip.hidden = false;
    const frag = document.createDocumentFragment();
    if (entry.now) {
      const head = document.createElement('div');
      head.className = 'epgnow';
      const time = document.createElement('span');
      time.className = 'epgnow-time';
      time.textContent = `${clock(entry.now.start)}–${clock(entry.now.stop)}`;
      const title = document.createElement('span');
      title.className = 'epgnow-title';
      title.textContent = entry.now.title;
      head.append(time, title);
      frag.appendChild(head);

      const share = progressOf(entry.now);
      if (share != null) {
        const bar = document.createElement('div');
        bar.className = 'epgbar';
        const fill = document.createElement('i');
        fill.style.width = `${Math.round(share * 100)}%`;
        bar.appendChild(fill);
        frag.appendChild(bar);
      }
      if (entry.now.description) {
        const desc = document.createElement('div');
        desc.className = 'epgdesc';
        desc.textContent = entry.now.description;
        frag.appendChild(desc);
      }
    }
    if (entry.next) {
      const next = document.createElement('div');
      next.className = 'epgnext';
      next.textContent = t('info.next', { time: clock(entry.next.start), title: entry.next.title });
      frag.appendChild(next);
    }
    el.infostrip.replaceChildren(frag);
    return;
  }

  const info = item.details;
  el.infostrip.hidden = false;
  const box = document.createElement('div');
  box.className = 'vodinfo';
  if (info && info.cover) box.appendChild(coverImage('', info.cover));
  const body = document.createElement('div');
  const meta = document.createElement('div');
  meta.className = 'meta';
  const bits = [];
  if (info) {
    if (info.releaseDate) bits.push(String(info.releaseDate).slice(0, 10));
    if (info.genre) bits.push(info.genre);
    if (info.rating) bits.push(`★ ${info.rating}`);
    if (info.durationSec) bits.push(duration(info.durationSec));
    if (info.video) bits.push(`${info.video.codec}${info.video.height ? ' ' + info.video.height + 'p' : ''}`);
  }
  if (item.ext) bits.push(item.ext.toUpperCase());
  // A header that has been read is more precise than the API's data: it
  // knows the audio track and the subtitles, neither of which the API
  // reports.
  const probed = probeFor(item);
  if (probed && !probed.error) {
    if (probed.video) bits.push(`${probed.video.codec.toUpperCase()}${probed.video.height ? ' ' + probed.video.height + 'p' : ''}`);
    const track = probed.audio && probed.audio[0];
    if (track) bits.push(`${track.codec.toUpperCase()}${track.channels ? ' ' + track.channels + 'ch' : ''}${track.supported ? '' : t('info.unsupported')}`);
    const subs = subtitleSummary(probed);
    if (subs) {
      bits.push(subs.languages.length
        ? t('info.subs', { count: subs.total, n: subs.total, languages: subs.languages.slice(0, 5).join(', ') })
        : t('info.subs.count', { count: subs.total, n: subs.total }));
    }
  }
  for (const bit of bits) { const s = document.createElement('span'); s.textContent = bit; meta.appendChild(s); }
  body.appendChild(meta);
  if (info && info.plot) {
    const plot = document.createElement('div');
    plot.className = 'plot';
    plot.textContent = info.plot;
    body.appendChild(plot);
  }
  box.appendChild(body);
  el.infostrip.replaceChildren(box);
}

async function loadVodDetails(item) {
  if (item.k !== 1 || item.details) return;
  try {
    const info = await state.lib.movieDetails(item.id);
    item.details = info;
    if (state.playing === item) renderInfoStrip();
  } catch { /* the extra details are optional */ }
}

/* ------------------------------------------------------ programme guide */

const grid = new EpgGrid({
  scroll: $('epg-scroll'), canvas: $('epg-canvas'),
  timesInner: $('epg-times-inner'), chansInner: $('epg-chans-inner'),
  corner: $('epg-corner'), days: $('epg-days'), clock: $('epg-clock'),
}, {
  label: (channel) => (state.cleanName ? state.cleanName(channel.n) : channel.n),
  onSelect: renderGuidePreview,
  onActivate: activateProgramme,
  onChannel: (channel) => channel && playItem(channel),
  onWindow: (items, from, to) => state.epg && state.epg.setVisibleWindow(items, from, to),
});

let guideOpen = false;

async function toggleGuide() {
  if (guideOpen) closeGuide(); else await openGuide();
}

async function openGuide() {
  if (guideOpen) return;
  if (!state.lib || !state.epg) { toast(t('guide.needserver')); return; }
  if (!state.epg.enabled) { toast(t('guide.epgoff')); return; }
  // The guide shows channel rows, so it needs the channel tab's contents.
  if (state.tab !== 'live' || state.detail) await activateTab('live', { restore: true });

  const channels = state.rows.filter((it) => it.k === 0);
  if (!channels.length) { toast(t('guide.needgroup')); return; }

  guideOpen = true;
  el.main.classList.add('guide');
  el.epg.hidden = false;
  el.epgPreview.hidden = false;
  $('btn-guide').classList.add('on');

  renderGuideGroups();
  grid.epg = state.epg;
  grid.setPlaying(state.playing && state.playing.k === 0 ? state.playing.id : null);
  grid.setChannels(channels);
  grid.show();
  if (state.playing && state.playing.k === 0) grid.focusChannel(state.playing.id);
}

function closeGuide() {
  if (!guideOpen) return;
  guideOpen = false;
  grid.hide();
  el.main.classList.remove('guide');
  el.epg.hidden = true;
  el.epgPreview.hidden = true;
  $('btn-guide').classList.remove('on');
  vlist.refresh();
  renderInfoStrip();
}

/** A group selector for the guide: the sidebar is hidden in guide mode. */
function renderGuideGroups() {
  const select = $('epg-group');
  const frag = document.createDocumentFragment();
  const all = document.createElement('option');
  all.value = '';
  all.textContent = t('guide.allchannels');
  frag.appendChild(all);
  for (const group of state.lib.groups.live) {
    const option = document.createElement('option');
    option.value = group.name;
    option.textContent = group.name;
    frag.appendChild(option);
  }
  select.replaceChildren(frag);
  select.value = state.group ?? '';
}

function renderGuidePreview(channel, programme) {
  if (!channel) return;
  const logo = $('epgv-logo');
  logo.classList.toggle('blank', !channel.logo);
  if (channel.logo) logo.src = channel.logo; else logo.removeAttribute('src');

  $('epgv-name').textContent = channel.num
    ? `${String(channel.num).padStart(4, '0')} · ${channel.n}`
    : channel.n;

  const now = Date.now();
  const meta = [];
  if (channel.archive > 0) meta.push(t('guide.catchup', { days: channel.archive }));
  if (state.lib && channel.cats && channel.cats.length) meta.push(state.lib.categoryName('live', channel.cats[0]));
  if (programme) {
    const minutes = Math.round((programme.stop - programme.start) / 60000);
    if (minutes > 0) meta.push(duration(minutes * 60));
    if (programme.stop <= now) meta.push(t('guide.ended'));
    else if (programme.start > now) meta.push(t('guide.startsin', { when: relativeSoon(programme.start, now) }));
  }
  $('epgv-meta').textContent = meta.join(' · ');

  const slot = $('epgv-slot');
  slot.replaceChildren();
  if (programme) {
    slot.appendChild(document.createTextNode(`${clock(programme.start)}–${clock(programme.stop)}`));
    const title = document.createElement('b');
    title.textContent = programme.title;
    slot.appendChild(title);
  }

  $('epgv-desc').textContent = programme
    ? (programme.description || '')
    : t('guide.noepg.channel');

  const actions = $('epgv-actions');
  const buttons = [{ label: t('guide.watch'), primary: true, onClick: () => playItem(channel) }];
  if (catchupAvailable(channel, programme, now)) {
    buttons.unshift({ label: t('guide.watch.recording'), primary: true, onClick: () => playCatchup(channel, programme) });
    buttons[1].primary = false;
  }
  actions.replaceChildren(...buttons.map(({ label, primary, onClick }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = primary ? 'primary' : 'ghost';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }));
}

/** Enter, or a double-click in the grid. */
function activateProgramme(channel, programme) {
  if (!channel) return;
  const now = Date.now();
  if (programme && programme.stop <= now) {
    if (catchupAvailable(channel, programme, now)) playCatchup(channel, programme);
    else toast(t('guide.norecording'));
    return;
  }
  if (programme && programme.start > now) {
    toast(t('guide.starts', { title: programme.title, time: clock(programme.start) }));
    return;
  }
  playItem(channel);
}

/** Keyboard control belongs to the grid, not to the last button pressed. */
function focusGrid() {
  $('epg-scroll').focus({ preventScroll: true });
}

function relativeSoon(start, now) {
  const minutes = Math.round((start - now) / 60000);
  if (minutes < 60) return t('guide.minutes', { minutes });
  return t('guide.at', { time: clock(start) });
}

function playCatchup(item, programme) {
  const minutes = Math.max(1, Math.round((programme.stop - programme.start) / 60000));
  const url = timeshiftUrl(state.config, item.id, programme.start, minutes, state.account.serverUtcOffsetMs || 0);
  state.playing = { ...item, n: `${item.n} — ${programme.title}` };
  state.playingSpec = { url, live: true, mode: 'ts' };
  state.catchup = programme;
  el.nowTitle.textContent = state.playing.n;
  renderNowSub();
  if (guideOpen) grid.setPlaying(item.id);
  playback.play(state.playingSpec);
}

/* ------------------------------------------------- katselukohta & stats */

let lastResumeSave = 0;
el.video.addEventListener('timeupdate', () => {
  const item = state.playing;
  if (!item || item.k === 0 || !state.settings.resumeEnabled) return;
  const now = Date.now();
  if (now - lastResumeSave < 5000) return;
  lastResumeSave = now;
  const { currentTime, duration: total } = el.video;
  if (!Number.isFinite(total) || total <= 0 || currentTime < 20) return;
  const key = `${item.k}:${item.id}`;
  if (currentTime > total * 0.96) state.resume.delete(key);
  else state.resume.set(key, { position: currentTime, duration: total, at: now });
  store.saveResume(state.resume);
});

setInterval(() => {
  const stats = playback.stats();
  if (!stats) { el.statbadge.hidden = true; return; }
  el.statbadge.hidden = false;
  el.statbadge.textContent = [
    `${stats.width}×${stats.height}`,
    stats.kbps ? `${nf.format(stats.kbps)} kbit/s` : null,
    stats.engine,
  ].filter(Boolean).join(' · ');
}, 2000);

// The EPG bar lives in time, so it is repainted even when no data arrives.
setInterval(() => {
  if (state.playing && state.playing.k === 0) renderInfoStrip();
  if (state.epg && state.rows.some((it) => it.k === 0)) vlist.refresh();
}, 30000);

/* =========================================================== progress dialog */

/** The bar's fill, 0…1. A scale rather than a width — see .bar-fill in
 *  player.css. */
function fillBar(ratio) {
  const clamped = Math.min(1, Math.max(0, ratio || 0));
  el.pFill.style.transform = `scaleX(${clamped.toFixed(4)})`;
}

function showProgress(title, text) {
  el.pTitle.textContent = title;
  el.pText.textContent = text || '';
  fillBar(0);
  el.pFill.parentElement.classList.add('indeterminate');
  if (!el.progress.open) el.progress.showModal();
}

function updateProgress(received, total) {
  if (total > 0) {
    el.pFill.parentElement.classList.remove('indeterminate');
    fillBar(received / total);
    el.pText.textContent = t('progress.bytes', { received: megabytes(received), total: megabytes(total) });
  } else {
    el.pText.textContent = t('progress.received', { received: megabytes(received) });
  }
}

function hideProgress() {
  if (el.progress.open) el.progress.close();
}

/* ============================================================== settings */

const FIELDS = ['scheme', 'host', 'port', 'username', 'password'];

function openSetup() {
  for (const f of FIELDS) $(`f-${f}`).value = state.config[f] ?? '';
  $('f-paste').value = '';
  $('f-lang').value = state.settings.lang;
  $('f-epg').checked = state.settings.epgEnabled;
  $('f-resume').checked = state.settings.resumeEnabled;
  showSourceMode(state.config.sourceMode);
  renderAccountBox();
  if (!el.setup.open) el.setup.showModal();
}

/**
 * The connection mode changes only which form is visible. Credentials parsed
 * from a URL land in the same fields as ones typed by hand, so switching
 * mode loses nothing and neither route is more official than the other.
 */
function showSourceMode(mode) {
  const m3u = mode === 'm3u';
  for (const radio of document.querySelectorAll('input[name="source"]')) {
    radio.checked = radio.value === (m3u ? 'm3u' : 'xtream');
  }
  $('src-xtream').hidden = m3u;
  $('src-m3u').hidden = !m3u;
}

const sourceMode = () => (document.querySelector('input[name="source"]:checked') || {}).value || 'xtream';

async function renderAccountBox() {
  const box = $('account-box');
  const a = state.account;
  if (!a) { box.hidden = true; return; }
  box.hidden = false;
  const estimate = await storageEstimate();
  box.innerHTML = '';
  const head = document.createElement('div');
  const status = document.createElement('b');
  status.textContent = a.status + (a.trial ? t('account.trial') : '');
  head.append(`${t('account.title')} `, status);
  box.appendChild(head);
  const cols = document.createElement('div');
  cols.className = 'cols';
  const loaded = ['live', 'movie', 'series'].filter((type) => state.lib && state.lib.isFull(type));
  const rows = [
    [t('account.connections.label'), a.maxConnections ? `${a.activeConnections} / ${a.maxConnections}` : '–'],
    [t('account.valid.label'), a.expiresAt ? dateFmt.format(new Date(a.expiresAt)) : '–'],
    [t('account.formats'), a.outputFormats.join(', ') || '–'],
    [t('account.servertime'), a.serverTimezone || '–'],
    [t('account.cache'), estimate ? megabytes(estimate.usage || 0) : '–'],
    [t('account.lists'), loaded.map((type) => kindLabel(TYPE_KIND[type])).join(', ') || t('account.none')],
  ];
  for (const [label, value] of rows) {
    const cell = document.createElement('div');
    cell.append(label, document.createElement('br'));
    const strong = document.createElement('b');
    strong.textContent = value;
    cell.appendChild(strong);
    cols.appendChild(cell);
  }
  box.appendChild(cols);
}

/**
 * Back to the initial state: credentials, settings, favourites, history,
 * resume points and the whole cache gone. The page is reloaded at the end,
 * because the state in memory — loaded lists, an open playback, the chosen
 * group — corresponds to nothing after the wipe, and a fresh load starts
 * from the welcome view.
 */
async function resetEverything() {
  playback.stop();
  await api.storage.local.clear();
  await wipeStorage();
  location.reload();
}

function readSetup() {
  const patch = {};
  for (const f of FIELDS) patch[f] = $(`f-${f}`).value.trim();
  return patch;
}

function wireSetup() {
  $('f-lang').replaceChildren(...Object.entries(LANGUAGES).map(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }));
  // The language changes at once rather than on save: the choice has to
  // show in the very dialog it was made in, or its effect is invisible.
  $('f-lang').addEventListener('change', () => applyLanguage($('f-lang').value));

  for (const radio of document.querySelectorAll('input[name="source"]')) {
    radio.addEventListener('change', () => showSourceMode(radio.value));
  }

  $('f-paste').addEventListener('input', (e) => {
    const parsed = parsePlaylistUrl(e.target.value);
    if (!parsed) return;
    for (const f of FIELDS) if (parsed[f] != null) $(`f-${f}`).value = parsed[f];
  });
  $('f-cancel').addEventListener('click', () => el.setup.close());
  $('f-save').addEventListener('click', async () => {
    // In M3U mode the fields are filled from the URL only here, so that a
    // pasted but unfinished address cannot overwrite the old credentials.
    if (sourceMode() === 'm3u') {
      const parsed = parsePlaylistUrl($('f-paste').value);
      if (!parsed) { toast(t('setup.m3u.bad')); return; }
      for (const f of FIELDS) if (parsed[f] != null) $(`f-${f}`).value = parsed[f];
    }
    const patch = { ...readSetup(), sourceMode: sourceMode() };
    // The host permission is asked for before the first await: the user
    // gesture is spent by it, and without a gesture Chrome rejects the
    // request without showing a dialog. For an origin already granted this
    // returns at once with no dialog.
    const granted = patch.host ? await requestAccess(baseUrl(patch)) : true;
    state.settings = await store.saveSettings({
      lang: $('f-lang').value,
      epgEnabled: $('f-epg').checked,
      resumeEnabled: $('f-resume').checked,
    });
    state.config = await store.saveConfig(patch);
    el.setup.close();
    if (!granted) toast(t('setup.nogrant'));
    await connect();
  });
  $('f-clear').addEventListener('click', async () => {
    await cacheClear();
    if (state.lib) await state.lib.reset();
    toast(t('setup.cleared'));
    el.setup.close();
    await connect({ silent: true });
  });

  // A reset cannot be undone, so the button asks for confirmation itself: a
  // second dialog opened on top of the settings dialog would end up beneath
  // it. The armed state lapses on its own, so the button is not left waiting
  // in confirmation mode for the next click that happens to land on it.
  let armed = null;
  const disarm = (button) => {
    clearTimeout(armed);
    armed = null;
    button.textContent = t('setup.reset');
    button.classList.remove('armed');
  };
  $('f-reset').addEventListener('click', (e) => {
    const button = e.currentTarget;
    if (!armed) {
      button.textContent = t('setup.reset.confirm');
      button.classList.add('armed');
      armed = setTimeout(() => disarm(button), 5000);
      return;
    }
    disarm(button);
    button.disabled = true;
    resetEverything().catch((err) => {
      button.disabled = false;
      console.error('[iptv] palautus epäonnistui', err);
      toast(t('setup.reset.failed'));
    });
  });

}

/* ============================================================== oddments */

let toastTimer = null;
function toast(text) {
  el.toast.textContent = text;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2800);
}

async function copyUrl() {
  if (!state.playingSpec) return;
  await navigator.clipboard.writeText(state.playingSpec.url);
  toast(t('player.copied'));
}

/* -------------------------------------------------- external player */

/**
 * Hands the current stream over to an external player.
 *
 * Playback is stopped first: the test account allows one concurrent
 * connection, so a stream the browser keeps open would leave the external
 * player silent. Everything here is deliberately synchronous — starting a
 * download requires a user gesture, which the first await would spend.
 */
function playExternal() {
  if (!state.playingSpec) { toast(t('ext.nothing')); return; }

  const name = state.playing ? state.playing.n : 'Stream';
  const spec = state.playingSpec;
  // The resume position is where the browser got to, not where playback
  // started.
  const startAt = spec.live ? 0 : Math.floor(el.video.currentTime || spec.startAt || 0);
  playback.stop();
  handOff({ ...spec, startAt }, name);

  el.overlay.hidden = false;
  el.overlay.classList.remove('loading');
  el.overlayTitle.textContent = t('ext.handed');
  el.overlayText.textContent = t('ext.handed.text');
  showOverlayActions([
    { label: t('ext.continue'), onClick: () => state.playing && playItem(state.playing, { startAt }) },
    { label: t('player.copyurl'), onClick: copyUrl },
  ]);
}

/* --------------------------------------------------------- Chromecast */

const cast = new Cast(el.video, renderCastState);

/**
 * The Cast button and the c key. A natively played file goes through the
 * Remote Playback API, which opens Chrome's device picker; the MediaSource
 * routes are outside its reach, and for them the overlay explains how
 * Chrome's own tab casting does the same once the player is full screen.
 * cast.js and CHROMECAST.md have the reasons.
 *
 * Synchronous up to prompt(): the picker needs the user gesture, and the
 * first await would spend it.
 */
function castCurrent() {
  if (!castSupported) return;
  if (!state.playingSpec) { toast(t('cast.nothing')); return; }
  // Already casting: the same dialog is where Chrome lets the viewer stop.
  if (cast.busy) { cast.prompt().catch(() => {}); return; }
  if (!playback.engineKey) { toast(t('cast.loading')); return; }
  if (playback.engineKey !== 'native') { showCastHint(); return; }
  cast.prompt().catch((err) => {
    const name = err && err.name;
    if (name === 'NotAllowedError') return;                    // the picker was closed
    if (name === 'NotFoundError') { toast(t('cast.nodevice')); return; }
    // NotSupportedError: this source will not remote after all. The tab
    // route still does.
    showCastHint();
  });
}

/** The tab route, over the picture; playback carries on beneath. */
function showCastHint() {
  el.overlay.hidden = false;
  el.overlay.classList.remove('loading');
  el.overlayTitle.textContent = t('cast.tab');
  el.overlayText.textContent = t('cast.tab.text');
  const close = () => { el.overlay.hidden = true; showOverlayActions(null); };
  showOverlayActions([
    { label: t('cast.fullscreen'), onClick: () => { close(); el.video.requestFullscreen().catch(() => {}); } },
    { label: t('cast.close'), onClick: close },
  ]);
}

/** The button: hidden without the API, lit while the device plays. */
function renderCastState() {
  el.cast.hidden = !castSupported;
  el.cast.classList.toggle('on', cast.connected);
  // The engine line carries the device; before anything plays it says "Not
  // connected", and that text is not this function's to change.
  if (state.playing) renderNowSub();
}

function moveCursor(delta) {
  if (state.rows.length === 0) return;
  state.cursor = Math.max(0, Math.min(state.rows.length - 1, state.cursor + delta));
  vlist.scrollToIndex(state.cursor);
  vlist.refresh();
}

function playRelative(delta) {
  if (!state.playing) return;
  const index = state.rowIndex.get(`${state.playing.k}:${state.playing.id}`);
  if (index == null) return;
  const next = index + delta;
  if (next < 0 || next >= state.rows.length) return;
  state.cursor = next;
  vlist.scrollToIndex(next);
  openItem(state.rows[next]);
}

function wireUi() {
  el.tabs.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-tab]');
    if (!button) return;
    closeGuide();
    activateTab(button.dataset.tab, { restore: true });
  });

  let searchTimer = null;
  el.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = el.search.value.trim();
      // The search covers the whole list: the category and type filters are
      // cleared visibly, so that an absence of matches is never left
      // unexplained.
      if (state.query && state.group != null) {
        state.group = null;
        state.sub = null;
        state.lastGroup[state.tab] = null;
        renderSidebar();
      }
      if (state.query && state.kind != null) {
        state.kind = null;
        state.lastKind[state.tab] = null;
        renderSidebar();
      }
      refreshRows();
    }, 180);
  });

  let filterTimer = null;
  el.categoryFilter.addEventListener('input', () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => { state.categoryFilter = el.categoryFilter.value; renderCategories(); }, 120);
  });

  $('btn-refresh').addEventListener('click', async () => {
    if (!state.lib) return connect();
    showProgress(t('progress.refresh'));
    try {
      await state.lib.loadCategories({ force: true });
      for (const type of ['live', 'movie', 'series']) {
        if (state.lib.isFull(type)) await state.lib.ensureFull(type, { force: true, onProgress: updateProgress });
      }
      if (state.epg) state.epg.clear();
      renderSidebar();
      await refreshRows({ keepScroll: true });
      toast(t('toast.refreshed'));
    } catch (err) { showConnectionError(err); } finally { hideProgress(); }
  });

  $('btn-settings').addEventListener('click', openSetup);
  // Loading a list cannot be interrupted, so Esc must not close the dialog
  // mid-work: a closed dialog would look as if the loading had finished.
  el.progress.addEventListener('cancel', (e) => e.preventDefault());

  el.mode.addEventListener('change', () => {
    store.saveConfig({ streamMode: el.mode.value });
    if (state.playing) playItem(state.playing);
  });
  el.subs.addEventListener('change', chooseSubtitle);
  el.subsize.addEventListener('change', chooseSubtitleSize);
  $('btn-reload').addEventListener('click', () => state.playing && playItem(state.playing));
  $('btn-guide').addEventListener('click', toggleGuide);
  $('epg-close').addEventListener('click', closeGuide);
  // A dead logo URL is ordinary in this library. The same approach as on a
  // list row and in the guide grid, but without the once flag: the element
  // is permanent and changes source with the channel.
  $('epgv-logo').addEventListener('error', (e) => e.target.classList.add('blank'));
  $('epg-now').addEventListener('click', () => { grid.goNow(); focusGrid(); });
  $('epg-prev').addEventListener('click', () => { grid.nudge(-30); focusGrid(); });
  $('epg-next').addEventListener('click', () => { grid.nudge(30); focusGrid(); });
  $('epg-in').addEventListener('click', () => { grid.zoomBy(1); focusGrid(); });
  $('epg-out').addEventListener('click', () => { grid.zoomBy(-1); focusGrid(); });
  $('epg-group').addEventListener('change', (e) => selectGroup(e.target.value || null));
  $('btn-fav').addEventListener('click', () => state.playing && toggleFavorite(state.playing));
  $('btn-copy').addEventListener('click', copyUrl);
  $('btn-ext').addEventListener('click', playExternal);
  el.cast.addEventListener('click', castCurrent);
  $('btn-pip').addEventListener('click', async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await el.video.requestPictureInPicture();
    } catch { toast(t('player.pip.unavailable')); }
  });

  document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON';
    if (e.key === '/' && !typing) { e.preventDefault(); el.search.focus(); el.search.select(); return; }
    if (e.target === el.search && e.key === 'Escape') {
      el.search.value = ''; state.query = ''; refreshRows(); el.search.blur(); return;
    }
    if (typing || e.target === el.video) return;
    if (el.setup.open || el.progress.open) return;
    if (guideOpen) {
      if (e.key === 'Escape') { closeGuide(); return; }
      if (grid.handleKey(e)) { e.preventDefault(); return; }
    }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); moveCursor(1); break;
      case 'ArrowUp': e.preventDefault(); moveCursor(-1); break;
      case 'PageDown': e.preventDefault(); moveCursor(10); break;
      case 'PageUp': e.preventDefault(); moveCursor(-10); break;
      case 'Enter': if (state.cursor >= 0) openItem(state.rows[state.cursor]); break;
      case 'Backspace': if (state.detail) closeDetail(); break;
      case ' ': e.preventDefault(); el.video.paused ? el.video.play().catch(() => {}) : el.video.pause(); break;
      case 'f': document.fullscreenElement ? document.exitFullscreen() : el.video.requestFullscreen().catch(() => {}); break;
      case 'm': el.video.muted = !el.video.muted; break;
      case 'n': playRelative(1); break;
      case 'p': playRelative(-1); break;
      case 'g': toggleGuide(); break;
      case 'x': playExternal(); break;
      case 'c': castCurrent(); break;
      default: break;
    }
  });
}

/* =============================================================== language */

/**
 * The language changes mid-session without reloading the page.
 *
 * Three layers have to be refreshed: the texts written into the markup,
 * Intl's formatters, and the views painted from state. The third is handled
 * by the same calls that produce the views anyway, so the language needs no
 * painting route of its own — only the call.
 */
async function applyLanguage(lang) {
  state.settings = await store.saveSettings({ lang: setLanguage(lang) });
  setLocale(localeTag());
  applyStatic();
  renderAccount();
  renderSidebar();
  renderNowSub();
  renderFavButton();
  renderInfoStrip();
  // The selector is rebuilt only when the list differs: clear it, so that
  // "No subtitles" is translated even when the tracks stay the same.
  const tracks = state.subtitles;
  const active = el.subs.value === 'off' || !el.subs.value ? null : Number(el.subs.value);
  state.subtitles = null;
  renderSubtitles(tracks, active);
  if (el.setup.open) renderAccountBox();
  if (guideOpen) { renderGuideGroups(); grid.invalidate(); }
  // Before a connection there is no list to repaint, and refreshRows would
  // set off to fetch it from a server that does not exist yet.
  if (state.lib) await refreshRows({ keepScroll: true });
  // An idle player shows the welcome text, which comes from no paint routine.
  if (!state.playing && !el.overlay.hidden && !el.overlay.classList.contains('loading')) renderIdleOverlay();
}

/** The player's idle state: either a welcome or a prompt to pick a channel. */
function renderIdleOverlay() {
  const welcome = !state.config.host;
  el.overlayTitle.textContent = welcome ? t('setup.welcome') : t('player.idle');
  el.overlayText.textContent = welcome ? t('setup.welcome.text') : t('player.idle.text');
}

/* ================================================================== start */

async function init() {
  state.config = await store.loadConfig();
  state.settings = await store.loadSettings();
  setLanguage(state.settings.lang);
  setLocale(localeTag());
  applyStatic();

  wireSetup();
  wireUi();
  wireSubcatsResize();
  state.favorites = await store.loadFavorites();
  state.recents = await store.loadRecents();
  state.resume = await store.loadResume();
  el.mode.value = state.config.streamMode || 'auto';
  applySubtitleSize(state.settings.subtitleSize);
  renderFavButton();
  renderCastState();

  const ui = await store.loadUiState();
  if (ui.tab) state.tab = ui.tab;
  if (typeof ui.subcatsHeight === 'number') state.subcatsHeight = ui.subcatsHeight;
  for (const button of el.tabs.children) button.classList.toggle('active', button.dataset.tab === state.tab);

  if (!state.config.host) {
    renderIdleOverlay();
    openSetup();
    return;
  }
  await connect();
}

init();
