import { XtreamApi, ApiError } from './api.js';
import { Library, sortItems } from './library.js';
import { Epg } from './epg.js';
import { Playback } from './playback.js';
import { VirtualList } from './vlist.js';
import { itemRow, categoryRow, chipRow, favCategoryRow, sectionHeader, emptyState } from './rows.js';
import { nameCleaner, searchNameCleaner } from './name.js';
import { poster } from './poster.js';
import { wireModal } from './modal.js';
import { MediaFilters } from './mediafilters.js';
import { titleFacts, externalLinks, playbackFacts } from './titleinfo.js';
import { EpgGrid, catchupAvailable } from './epggrid.js';
import { ChannelEditor } from './channeleditor.js';
import { channelPreferences, visibilityFilter, ordered } from './channelprefs.js';
import { ProgrammeSearch } from './programmesearch.js';
import { cacheClear, wipeStorage, storageEstimate } from './db.js';
import { parsePlaylistUrl, streamUrl, timeshiftUrl, baseUrl, parseServer } from './xtream.js';
import { api } from './browser.js';
import { requestAccess, hasAccess } from './permissions.js';
import { externalLabel, handOff } from './external.js';
import { Cast, supported as castSupported } from './cast.js';
import { warmCache, peek, badge as probeBadge, subtitleSummary, audioDetails } from './probe.js';
import { shortLanguage } from './lang.js';
import { label as audioLabel } from './audio.js';
import { SubtitleDisplay, subtitleLook } from './subdisplay.js';
import { pickEncoder } from './transcode.js';
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
  video: $('video'), videowrap: $('videowrap'), subdisplay: $('subdisplay'),
  overlay: $('overlay'), overlayTitle: $('overlay-title'),
  overlayText: $('overlay-text'), overlayActions: $('overlay-actions'), statbadge: $('statbadge'),
  infostrip: $('infostrip'), nowTitle: $('now-title'), nowSub: $('now-sub'), mode: $('mode'),
  subs: $('subs'), audio: $('audio'), cast: $('btn-cast'),
  setup: $('setup'), setupTabs: $('setup-tabs'), setupNote: $('setup-note'),
  sublook: $('btn-sublook'), sublookPop: $('sublook-pop'),
  progress: $('progress'),
  epg: $('epg'), epgPreview: $('epg-preview'),
  pTitle: $('p-title'), pFill: $('p-fill'), pText: $('p-text'), pPercent: $('p-percent'), toast: $('toast'),
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
  listLoading: false,
  listError: null,
  listRequest: 0,
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
  audioTracks: [],        // the audio tracks of the file being played, see js/audio.js
  activeAudio: null,      // the track confirmed by the playback engine
  playbackInfoLoading: false,
  subtitleInfo: null,     // what the file being played holds, once the player has looked: { tracks, bitmap }
  favorites: new Map(), recents: [], resume: new Map(),
  channelPrefs: channelPreferences(),
  lastGroup: {}, lastKind: {},
  searchReturn: null,     // the group a search took over from, restored when the search ends
  subcatsHeight: null,    // the topic bar's height when dragged, null = automatic
};

const isCollection = () => COLLECTIONS.has(state.tab);

/* ============================================================ connection */

async function connect({ silent = false } = {}) {
  programmeSearch.clear();
  if (guideOpen) closeGuide();
  const config = state.config;
  try {
    if (!config.host || !config.username || !config.password) { openSetup(); return false; }
    state.source = new XtreamApi(config);

    if (!silent) showProgress(t('progress.connecting'), config.host);
    state.account = await state.source.account({ signal: progressSignal() });
    state.lib = new Library(state.source);
    // Which audio encoder the browser has is asked now, so that the answer
    // is in by the time the first list paints: a row whose AC-3 track the
    // player can decode is marked playable only where the decoded audio
    // has somewhere to go (probe.js). A browser without an encoder is no
    // reason to stop connecting.
    pickEncoder().catch(() => {});
    // File headers read earlier into memory, so that list rows can show the
    // result without a network request while painting.
    await warmCache();
    state.epg = new Epg(state.source, onEpgUpdated);
    state.epg.enabled = state.settings.epgEnabled;
    await state.lib.loadCategories({ signal: progressSignal() });
    hideProgress();

    renderAccount();
    renderNowSub();
    renderSidebar();
    await activateTab(state.tab, { restore: true });
    return true;
  } catch (err) {
    hideProgress();
    if (isAbort(err)) showCancelled(); else showConnectionError(err);
    return false;
  }
}

const isAbort = (err) => Boolean(err && err.name === 'AbortError');

/**
 * A list that could not be fetched — a group, a series, the whole list —
 * is the list's business, not the player's: the overlay would cover a
 * picture that is playing perfectly well. Over rows a toast says what
 * happened; where there are no rows, the message takes their place with a
 * way to try again.
 */
function showListError(err, retry) {
  finishListLoad();
  const message = err instanceof ApiError ? err.message : t('error.unexpected', { message: err.message });
  state.listError = message;
  console.error('[iptv] the list could not be loaded', err);
  if (state.rows.length) { toast(message, { long: true }); return; }
  const existing = el.list.querySelector('.empty');
  if (existing) existing.remove();
  el.list.appendChild(emptyState(t('error.list'), message, retry ? { label: t('player.retry'), onClick: retry } : null));
}

function finishListLoad() {
  state.listLoading = false;
  el.list.setAttribute('aria-busy', 'false');
  el.list.querySelector('.list-loading')?.remove();
  renderListInfo();
}

function showListCancelled(retry) {
  finishListLoad();
  if (state.rows.length) { toast(t('progress.cancelled')); return; }
  el.list.querySelector('.empty')?.remove();
  el.list.appendChild(emptyState(t('progress.cancelled'), '', { label: t('player.retry'), onClick: retry }));
}

function beginListLoad({ keepScroll = false } = {}) {
  const request = ++state.listRequest;
  state.listError = null;
  showRows(keepScroll ? state.rows : [], { keepScroll, loading: true });
  return request;
}

/** The viewer cancelled connecting: nothing is wrong, and the way on is the same. */
function showCancelled() {
  el.overlay.hidden = false;
  el.overlay.classList.remove('loading');
  el.overlayTitle.textContent = t('progress.cancelled');
  el.overlayText.textContent = t('error.connect.cancelled');
  showOverlayActions([
    { label: t('player.retry'), onClick: () => connect() },
    { label: t('btn.settings'), onClick: openSetup },
  ]);
}

function showConnectionError(err) {
  const apiError = err instanceof ApiError;
  el.overlay.hidden = false;
  el.overlay.classList.remove('loading');
  el.overlayTitle.textContent = t('error.connect.title');
  el.overlayText.textContent = apiError
    ? err.message
    : t('error.unexpected', { message: err.message });
  const actions = [
    { label: t('player.retry'), onClick: () => connect() },
    { label: t('btn.settings'), onClick: openSetup },
  ];
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
  $('channel-tools').hidden = tab !== 'live';
  for (const button of el.tabs.children) {
    button.classList.toggle('active', button.dataset.tab === tab);
    button.setAttribute('aria-selected', String(button.dataset.tab === tab));
  }
  state.detail = null;
  state.cursor = -1;
  state.sub = null;
  state.group = restore ? (state.lastGroup[tab] ?? null) : null;
  state.kind = restore ? (state.lastKind[tab] ?? null) : null;

  const type = tabType();

  if (type === 'live' && state.group && !visibleGroups(type).some((g) => g.name === state.group)) state.group = null;
  // First open: pick a group, so the list fills from a few kilobytes rather
  // than by loading the type's whole list straight away.
  if (type && state.group == null && !state.lib.isFull(type)) {
    const groups = visibleGroups(type);
    if (groups.length) state.group = groups[0].name;
  }

  store.saveUiState({ tab });
  renderSidebar();
  // The rows on screen belong to the tab that was open, and refreshRows
  // waits for the network before it can replace them. Left there they sit
  // clickable under the new tab's heading, and a click in that moment
  // opens an item from the tab the viewer has just left — measured, a
  // click on Channels followed by a click on the top row opened a series.
  // The list is therefore emptied with the tab, and fills a moment later.
  mediaFilters.apply([], null);
  await refreshRows();
}

async function refreshRows({ keepScroll = false } = {}) {
  const type = tabType();
  const library = state.lib;
  const request = beginListLoad({ keepScroll });
  const current = () => state.listRequest === request && state.lib === library;
  let rows = [];
  renderDetail();   // the detail panel follows the state on a tab change too
  if (state.detail?.loading) return;

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
      if (!(await ensureFull(type, t('progress.reason.search'), current)) || !current()) return false;
      rows = state.lib.search(type, state.query, null);
    } else if (state.group == null) {
      if (!(await ensureFull(type, t('progress.reason.all'), current)) || !current()) return false;
      rows = state.lib.full[type];
    } else {
      const items = await loadGroupItems(type, state.group, current);
      if (!current()) return false;
      state.groupItems = items;
      rows = state.sub
        ? state.groupItems.filter((it) => it.cats.includes(state.sub))
        : state.groupItems;
    }
  } catch (err) {
    if (!current()) return false;
    hideProgress();
    if (isAbort(err)) showListCancelled(() => refreshRows()); else showListError(err, () => refreshRows());
    return false;
  }

  if (state.query && isCollection()) {
    const q = state.query.toLowerCase();
    rows = rows.filter((it) => it.n.toLowerCase().includes(q));
  }

  // The visible name decides the order: once a prefix has been stripped
  // from a row, the library's sorting no longer matches what the list
  // shows.
  state.cleanName = nameCleanerFor(rows);
  // Episode order comes from season/episode numbers, even when names are tidied.
  if (state.cleanName && !state.query && state.detail?.view !== 'series') rows = sortItems(rows, item => state.cleanName(item.n, item));
  rows = visibleRows(rows);
  if ((type === 'live' || state.detail?.entry?.t === 'live') && !state.query) {
    rows = ordered(rows, state.channelPrefs.channelOrder);
  }
  const filterType = !isCollection() && !state.detail && (type === 'movie' || type === 'series') ? type : null;
  rows = mediaFilters.apply(rows, filterType);
  showRows(rows, { keepScroll });
}

const mediaFilters = new MediaFilters($('media-filters'), () => {
  state.cursor = -1;
  refreshRows();
}, item => item.details || state.lib?.details.get(`${item.k === 1 ? 'vod' : 'series'}:v2:${item.id}`));

/**
 * The rows on screen. Everything painted from them follows in one call, so
 * that nothing on screen can belong to a list that is no longer shown.
 */
function showRows(rows, { keepScroll = false, loading = false } = {}) {
  state.listLoading = loading;
  el.list.setAttribute('aria-busy', String(loading));
  programmeSearch.clear();
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
  return visibleRows(state.tab === 'fav' ? favoritesNewestFirst() : state.recents);
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
  state.detail = { view: 'category', entry, items: [], back, loading: true };
  state.cursor = -1;
  renderDetail();
  beginListLoad();
  const open = state.detail;
  try {
    const items = entry.c == null
      ? await loadGroupItems(entry.t, entry.g)
      : await state.lib.categoryItems(entry.t, entry.c);
    if (state.detail !== open) return;
    state.detail.items = items;
    state.detail.loading = false;
    await refreshRows();
  } catch (err) {
    if (state.detail !== open) return;
    if (state.detail === open) { state.detail = back; renderDetail(); await refreshRows(); }
    showListError(err, () => openFavCategory(entry));
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
async function loadGroupItems(type, groupName, current = () => true) {
  const group = state.lib.group(type, groupName);
  const heavy = group && group.cats.length > 3 && !state.lib.isFull(type);
  if (heavy) showProgress(t('progress.group', { group: groupName }), t('progress.categories', { done: 0, total: group.cats.length }), 0);
  try {
    return await state.lib.groupItems(type, groupName, {
      signal: progressSignal(),
      onProgress: (done, total) => {
        if (!heavy || !current()) return;
        fillBar(done / total);
        el.pText.textContent = t('progress.categories', { done, total });
      },
    });
  } finally {
    if (heavy && current()) hideProgress();
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
  const visibleItems = type === 'live' ? visibleRows(state.groupItems) : state.groupItems;
  for (const item of visibleItems) {
    for (const cat of item.cats) counts.set(cat, (counts.get(cat) || 0) + 1);
  }
  // The buttons in alphabetical order, but the group's own general
  // category ("Sweden" with no topic) right after the All button: it is not
  // a topic among topics but the country's main channels.
  let cats = [...group.cats].sort((a, b) => {
    if (!a.sub !== !b.sub) return a.sub ? 1 : -1;
    return (a.sub || '').localeCompare(b.sub || '', 'fi');
  });
  if (type === 'live') cats = ordered(cats.filter((c) => !state.channelPrefs.hiddenCategories.includes(c.id)), state.channelPrefs.categoryOrder);

  const frag = document.createDocumentFragment();
  // "All" is the whole group, and its star is on the sidebar row — two
  // buttons for the same favourite would blur both.
  frag.appendChild(chipRow({
    label: t('subcats.all'), count: nf.format(visibleItems.length), active: state.sub == null,
  }, () => selectSub(null)));
  for (const cat of cats) {
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

async function ensureFull(type, reason, current = () => true) {
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

function renderEmptyState() {
  const existing = el.list.querySelector('.empty');
  if (existing) existing.remove();
  if (state.rows.length > 0) return;
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
  const type = tabType();
  const browse = { label: t('empty.browse'), onClick: () => activateTab('live') };
  let node;
  if (mediaFilters.filtering) node = emptyState(t('filters.nohits'), t('filters.nohits.text'), { label: t('filters.reset'), onClick: () => mediaFilters.clear() });
  else if (state.query) node = emptyState(t('empty.nohits'), t('empty.nohits.text', { query: state.query }));
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
  if (state.listLoading) {
    el.listinfo.textContent = t('progress.loading');
    return;
  }
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

  el.listinfo.replaceChildren(document.createTextNode(parts.join(' · ')));
  if (state.tab === 'live' && state.lib) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'btn-organize';
    button.textContent = t('organize.title');
    button.addEventListener('click', openChannelEditor);
    el.listinfo.append(button);
  }
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

  let counts = state.lib.groupCounts(type);
  const full = state.lib.full[type];
  const visible = type === 'live' && full ? visibleRows(full) : full;
  if (type === 'live' && full) {
    const groupOf = new Map(visibleGroups(type).flatMap((g) => g.cats.map((c) => [c.id, g.name])));
    counts = new Map();
    for (const item of visible) {
      for (const group of new Set(item.cats.map((id) => groupOf.get(id)).filter(Boolean))) counts.set(group, (counts.get(group) || 0) + 1);
    }
  }
  const filter = state.categoryFilter.trim().toLowerCase();
  // The filter matches sub-categories too, so that "sport" finds the
  // countries that have one even when the country's name lacks the word.
  const groups = visibleGroups(type).filter((g) => !filter
    || g.name.toLowerCase().includes(filter)
    || g.cats.some((c) => c.name.toLowerCase().includes(filter)));

  const frag = document.createDocumentFragment();
  if (!filter) {
    const total = visible ? visible.length : null;
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
  programmeSearch.clear();
  const before = { group: state.group, sub: state.sub, rows: state.rows, groupItems: state.groupItems };
  state.group = name;
  state.sub = null;
  state.detail = null;
  state.cursor = -1;
  state.lastGroup[state.tab] = name;
  renderSidebar();
  const pending = refreshRows();
  const request = state.listRequest;
  if (await pending === false && request === state.listRequest) {
    // Loading clears the rows. Restore the previous view on cancellation
    // or failure, unless a newer navigation already owns the list.
    state.group = before.group;
    state.sub = before.sub;
    state.groupItems = before.groupItems;
    state.lastGroup[state.tab] = before.group;
    renderSidebar();
    showRows(before.rows);
    if (state.listError) toast(state.listError, { long: true });
  }
}

function visibleGroups(type) {
  const groups = state.lib?.groups[type] || [];
  if (type !== 'live') return groups;
  const hidden = new Set(state.channelPrefs.hiddenCategories);
  const rank = new Map(state.channelPrefs.categoryOrder.map((id, i) => [id, i]));
  return groups.map((g) => ({ ...g, cats: g.cats.filter((c) => !hidden.has(c.id)) }))
    .filter((g) => g.cats.length)
    .sort((a, b) => Math.min(...a.cats.map((c) => rank.get(c.id) ?? Infinity))
      - Math.min(...b.cats.map((c) => rank.get(c.id) ?? Infinity)));
}

function visibleRows(rows) {
  const prefs = state.channelPrefs;
  const visible = visibilityFilter(prefs);
  const groups = new Set(visibleGroups('live').map((g) => g.name));
  return rows.filter((item) => {
    if (!visible(item)) return false;
    if (item.k !== 'c' || item.t !== 'live' || !prefs.hiddenCategories.length) return true;
    if (item.c != null) return !prefs.hiddenCategories.includes(item.c);
    return groups.has(item.g);
  });
}

const channelEditor = new ChannelEditor(async (prefs) => {
  await store.saveChannelPreferences(prefs);
  state.channelPrefs = channelPreferences(prefs);
  if (state.group && !visibleGroups('live').some((g) => g.name === state.group)) {
    state.group = visibleGroups('live')[0]?.name ?? null;
    state.sub = null;
  }
  if (state.channelPrefs.hiddenCategories.includes(state.sub)) state.sub = null;
  state.lastGroup.live = state.group;
  renderSidebar();
  renderGuideGroups();
  await refreshRows();
});

async function openChannelEditor() {
  if (!state.lib || !await ensureFull('live', t('organize.loading'))) return;
  channelEditor.show(state.lib.full.live, state.lib.groups.live, state.channelPrefs, state.group);
}

/**
 * The group a search took over from, back in place once the search is
 * over — cleared or cancelled. Without this, a search from "Finland" ends
 * in the whole list with "All" lit.
 */
function returnFromSearch() {
  const back = state.searchReturn;
  state.searchReturn = null;
  if (!back || back.tab !== state.tab || state.group != null) return;
  state.group = back.group;
  state.sub = back.sub;
  state.lastGroup[state.tab] = back.group;
  renderSidebar();
}

/** Ends the search: the field emptied, the group restored, the rows refreshed. */
function clearSearch() {
  el.search.value = '';
  state.query = '';
  returnFromSearch();
  refreshRows();
}

/* ================================================================== rows */

const vlist = new VirtualList(el.list, ROW_H, renderRow, {
  onVisible: (first, last) => {
    // In guide mode the list is hidden, and its visible rows would take the
    // programme-data queue away from the grid.
    if (state.epg && !guideOpen) state.epg.setVisible(state.rows.slice(first, last));
    const lib = state.lib;
    if (lib) lib.warmMovieDurations(guideOpen ? [] : state.rows.slice(first, last), (id, info) => {
      if (state.lib !== lib) return;
      mediaFilters.metadataChanged();
      const index = state.rowIndex.get(`1:${id}`);
      if (index != null) {
        state.rows[index].details = info;
        state.rows[index].durationSec = info.durationSec;
        vlist.refreshRow(index);
      }
      if (state.playing?.k === 1 && state.playing.id === id) {
        state.playing.details = info;
        renderInfoStrip();
      }
    });
  },
});

function renderRow(index) {
  const item = state.rows[index];
  const key = `${item.k}:${item.id}`;
  const row = item.k === 'c' ? favCategoryRow(item, {
    subtitle: favCategorySubtitle(item),
    count: state.catCounts && state.catCounts.has(key) ? nf.format(state.catCounts.get(key)) : null,
    selected: index === state.cursor,
    domId: rowDomId(index),
    onOpen: () => { state.cursor = index; openFavCategory(item); },
    onFavorite: () => toggleFavCategory(item),
  }) : itemRow(item, {
    label: state.cleanName ? state.cleanName(item.n, item) : null,
    playing: state.playing && `${state.playing.k}:${state.playing.id}` === key,
    selected: index === state.cursor,
    domId: rowDomId(index),
    favorite: state.favorites.has(key),
    epg: item.k === 0 && state.epg ? state.epg.nowNext(item.id) : null,
    resume: state.resume.get(key),
    tag: tagFor(item),
    showEpisodeCover: state.tab === 'recent',
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
 * Center Pass 3 FHD". Movie and series search results use their own group
 * rules, since one search can contain titles from several countries.
 */
function nameCleanerFor(rows) {
  if (state.detail?.view === 'series') return state.detail.cleanName;
  const type = tabType();
  if (state.query && !state.detail && (type === 'movie' || type === 'series') && state.lib?.full[type]) {
    return searchNameCleaner(state.lib.groups[type], state.lib.full[type]);
  }
  // Inside a favourite category the filter is known even though the sidebar
  // does not show it, so the row names tidy up as in the browsing view.
  if (state.detail && state.detail.view === 'category') {
    const entry = state.detail.entry;
    return nameCleaner(entry.g && entry.g !== entry.n ? [entry.g, entry.n] : [entry.n], rows);
  }
  if (isCollection() || state.detail || state.query || state.group == null) return null;
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
  return { text: clock(item.watchedAt).replace(/^0(?=\d)/, ''), icon: 'clock', title: t('row.watched', { stamp: stampFmt.format(new Date(item.watchedAt)) }) };
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
  const { id, k, n, logo, ext, season, episode, archive, epgId, direct, cats, durationSec, seriesCover, seriesName, displayName, rating, ratingScale } = item;
  return { id, k, n, logo, ext, season, episode, archive, epgId, direct, cats, durationSec, seriesCover, seriesName, displayName, rating, ratingScale };
}

/* ================================================================ series */

async function openItem(item) {
  if (item.k === 'c') return openFavCategory(item);
  if (item.k === 2) return openSeries(item);
  await playItem(item);
}

async function openSeries(item) {
  mediaFilters.apply([], null);
  // A series opened from a favourite category stays inside the category:
  // going back returns to the list it was chosen from.
  const back = state.detail && state.detail.view === 'category' ? state.detail : null;
  // Keep the parent list's rules: the episode list is a different set and
  // must not infer new prefixes from its repeated series title.
  const sourceItem = item;
  const parentCleaner = state.cleanName;
  const cleanName = parentCleaner ? name => parentCleaner(name, sourceItem) : null;
  item = { ...item, displayName: cleanName ? cleanName(item.n) : item.displayName || item.n };
  state.detail = { view: 'series', item, info: null, season: null, back, cleanName, loading: true };
  const open = state.detail;
  renderDetail();
  beginListLoad();
  try {
    const info = await state.lib.seriesEpisodes(item.id);
    if (state.detail !== open) return;
    state.detail.loading = false;
    // Episodes often have no artwork of their own. Carry the parent cover
    // with each episode so playback keeps it even after leaving this view
    // or reopening the episode from history or favourites. Also enrich
    // cached responses, without changing the shared cache object.
    state.detail.info = {
      ...info,
      episodes: info.episodes.map(episode => ({
        ...episode,
        displayName: cleanName ? cleanName(episode.n) : episode.n,
        seriesCover: info.cover || item.logo || '',
        seriesName: cleanName ? cleanName(item.n) : item.displayName || item.n,
      })),
    };
    const seasons = seasonNumbers(info.episodes);
    state.detail.season = seasons[0] ?? null;
    renderDetail();
    await refreshRows();
  } catch (err) {
    if (state.detail !== open) return;
    state.detail.loading = false;
    showListError(err, () => openSeries(item));
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
  const displayTitle = detail.view === 'series' ? (detail.cleanName ? detail.cleanName(detail.item.n) : detail.item.displayName || detail.item.n) : '';
  label.textContent = detail.view === 'category' ? crumbLabel(detail.entry) : displayTitle;
  if (detail.view === 'series') label.title = detail.item.n;
  el.crumbs.append(back, label);

  if (detail.view === 'category') { el.detail.replaceChildren(); return; }

  const info = detail.info;
  const main = document.createElement('div');
  main.className = 'detail-main';

  const cover = poster('detail-cover', (info && info.cover) || detail.item.logo, 'series', { expand: true, title: displayTitle });
  main.appendChild(cover);

  const body = document.createElement('div');
  body.className = 'detail-body';
  const heading = document.createElement('div');
  heading.className = 'detail-heading';
  const title = document.createElement('div');
  title.className = 'detail-title';
  title.textContent = displayTitle;
  title.title = detail.item.n;
  const favorite = document.createElement('button');
  favorite.type = 'button';
  favorite.id = 'detail-fav';
  favorite.className = 'ghost series-favorite';
  favorite.addEventListener('click', () => toggleFavorite(detail.item));
  heading.append(title, favorite);
  body.appendChild(heading);

  body.appendChild(titleFacts(info || detail.item, {
    episodes: info?.episodes.length,
    seasons: info ? seasonNumbers(info.episodes).filter(season => season > 0).length : undefined,
  }));

  if (info && (info.plot || detail.item.plot)) {
    const plot = document.createElement('div');
    plot.className = 'detail-plot';
    plot.textContent = info.plot || detail.item.plot;
    body.appendChild(plot);
  }
  body.appendChild(externalLinks(detail.item, info));
  main.appendChild(body);
  el.detail.replaceChildren(main);
  renderSeriesFavorite();

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
    state.playbackInfoLoading = false;
    el.overlay.hidden = true;
    el.overlay.classList.remove('loading');
    showOverlayActions(null);
    renderNowSub(s.engine);
    // Only the unpacking route reports its subtitles; on the others there
    // are none the player could show, and the details say so.
    if (!state.subtitleInfo && playback.engineKey !== 'remux') {
      state.subtitleInfo = { tracks: [], bitmap: 0 };
    }
    renderInfoStrip();
  } else if (s.status === 'loading') {
    state.playbackInfoLoading = true;
    renderInfoStrip();
    el.overlay.hidden = false;
    el.overlay.classList.add('loading');
    el.overlayTitle.textContent = t('progress.connecting');
    el.overlayText.textContent = `${state.playing ? state.playing.displayName || state.playing.n : ''} · ${s.engine}`;
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
    // The same list comes with every change of track; the details are
    // repainted for a new list only.
    if (!state.subtitleInfo || state.subtitleInfo.tracks !== s.tracks) {
      state.subtitleInfo = { tracks: s.tracks || [], bitmap: s.bitmap || 0 };
      renderInfoStrip();
    }
    renderSubtitles(s.tracks, s.active);
    // The change came from the browser's own subtitle menu: the same choice
    // as from the selector, so the language is remembered the same way.
    if (s.external) rememberSubtitleLanguage(s.active);
  } else if (s.status === 'audio') {
    renderAudio(s.tracks, s.active);
    renderInfoStrip();
  } else if (s.status === 'metadata') {
    renderInfoStrip();
  } else if (s.status === 'probing') {
    state.playbackInfoLoading = true;
    renderInfoStrip();
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
    state.playbackInfoLoading = false;
    renderInfoStrip();
    el.overlay.hidden = false;
    el.overlay.classList.remove('loading');
    el.overlayTitle.textContent = t('player.failed');
    el.overlayText.textContent = s.message;
    // Right here an external player is worth the most: the browser has
    // already given up.
    const actions = [
      { label: t('player.retry'), onClick: retryPlayback },
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
                  retryPlayback);
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
  // Snapshot the visible name so later browsing cannot rename playback.
  const displayName = item.displayName || (state.rows.includes(item) && state.cleanName ? state.cleanName(item.n, item) : item.n);
  item = { ...item, displayName };
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
    audioLang: state.settings.audioLang,
    startAt: startAt ?? (state.settings.resumeEnabled && !live && saved ? saved.position : 0),
  };

  state.playing = item;
  state.playingSpec = spec;
  state.playbackInfoLoading = !live;
  item.detailsLoading = item.k === 1 && !item.details;
  state.catchup = null;
  $('btn-live').hidden = true;
  el.mode.disabled = false;
  // Clear the previous file's tracks: the new ones arrive only once the
  // header has been read.
  renderSubtitles([], null);
  renderAudio([], null);
  state.subtitleInfo = null;
  el.nowTitle.textContent = displayName;
  el.nowTitle.title = item.n;
  renderNowSub();
  renderFavButton();
  document.title = t('player.title', { name: displayName });
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
    el.sublook.hidden = !list.length;
    if (!list.length) toggleSubtitleLook(false);
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

/* ---------------------------------------------------------- audio track */

/**
 * The audio selector. Shown only when there is a choice to make: one track
 * is not a decision, and a file with nothing playable has no selector
 * either — the details say what it holds instead.
 *
 * The name is built here rather than in the engine, so that a change of
 * interface language relabels the tracks without touching playback.
 *
 * @param {object[]} tracks the playable audio tracks, in the file's order
 * @param {number|null} active the number of the track in play
 */
function renderAudio(tracks, active) {
  const list = tracks || [];
  state.activeAudio = list.find((track) => track.number === active) || null;
  const select = el.audio;
  if (list !== state.audioTracks) {
    state.audioTracks = list;
    select.hidden = list.length < 2;
    select.replaceChildren(...list.map((track) => {
      const option = document.createElement('option');
      option.value = String(track.number);
      option.textContent = audioLabel(track);
      option.title = `${track.language} · ${track.codec || '?'}`;
      return option;
    }));
  }
  if (active != null) select.value = String(active);
}

/** The viewer's choice from the selector: play the track, keep the language. */
function chooseAudio() {
  const number = Number(el.audio.value);
  playback.selectAudio(number);
  rememberAudioLanguage(number);
}

/**
 * The a key steps to the next track. The eye is on the picture rather than
 * on the selector then, so the name is said out loud.
 */
function cycleAudio() {
  const list = state.audioTracks;
  if (list.length < 2) return;
  const at = list.findIndex((track) => String(track.number) === el.audio.value);
  const next = list[(at + 1) % list.length];
  el.audio.value = String(next.number);
  chooseAudio();
  toast(audioLabel(next));
}

/**
 * The language is kept for the coming episodes, as it is for the
 * subtitles. A track whose language the file does not state answers no
 * choice in the next file, so the setting is left as it was.
 */
async function rememberAudioLanguage(number) {
  const track = state.audioTracks.find((t) => t.number === number);
  if (!track) return;
  const language = shortLanguage(track.language);
  if (language === 'und' || state.settings.audioLang === language) return;
  state.settings = await store.saveSettings({ audioLang: language });
}

/** The viewer's choice from the selector: show the track, keep the language. */
function chooseSubtitle() {
  const value = el.subs.value;
  const number = value === 'off' ? null : Number(value);
  playback.selectSubtitle(number);
  rememberSubtitleLanguage(number);
}

/**
 * The look of the subtitles — the style and the size. The CSS reads both
 * from the body attributes (see player.css), and the settings dialog shows
 * the same choice, preview included.
 */
// The same two controls exist twice: in the settings, where a preview
// stands in for the picture, and over the picture itself under the
// player's Aa button. The dialog renders its draft in a separate preview.
const LOOK_FORMS = ['f', 'p'];

function applySubtitleLook(settings) {
  const look = subtitleLook(settings);
  document.body.dataset.substyle = look.style;
  document.body.style.setProperty('--sub-size', `${look.size}px`);
  for (const form of LOOK_FORMS) {
    $(`${form}-substyle`).value = look.style;
    $(`${form}-subsize`).value = String(look.size);
    $(`${form}-subsize-value`).textContent = `${look.size} px`;
  }
}

/**
 * The player's Aa adjustment applies immediately. Dialog adjustments
 * use previewSetupLook and wait for Save.
 */
async function chooseSubtitleLook(form) {
  const patch = { subtitleStyle: $(`${form}-substyle`).value, subtitleSize: Number($(`${form}-subsize`).value) };
  applySubtitleLook(patch);
  state.settings = await store.saveSettings(patch);
}

/**
 * The look over the picture. Opened from the player's row, closed by a
 * click outside it, by Esc, or by the button again — the same ways the
 * settings dialog closes.
 */
function toggleSubtitleLook(open) {
  const show = open ?? el.sublookPop.hidden;
  el.sublookPop.hidden = !show;
  el.sublook.setAttribute('aria-expanded', String(show));
  // The subtitles rise out of its way, as they do for the browser's own
  // controls: a popover that covered the text it is there to size would be
  // no use at all.
  el.videowrap.classList.toggle('looking', show);
  if (show) $('p-substyle').focus();
}

/* ----------------------------------------------------------- full screen */

/**
 * Full screen for the wrapper — the picture with the subtitle layer and the
 * overlay — rather than for the bare video element, which would leave both
 * behind, see js/subdisplay.js. Chrome's tab casting still recognises the
 * video as the dominant content: it fills the fullscreen element.
 */
function enterFullscreen() {
  if (document.fullscreenElement) return;
  el.videowrap.requestFullscreen().catch(() => {});
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else enterFullscreen();
}

/** The same control enters and leaves full screen, including after Esc. */
function renderFullscreenButton() {
  const full = document.fullscreenElement === el.videowrap;
  const button = $('btn-fullscreen');
  const hasVideo = el.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    && el.video.videoWidth > 0 && !el.video.error;
  // Pausing keeps the picture available. An empty player has no action,
  // but full screen must always retain its exit button if playback fails.
  button.hidden = !full && !hasVideo;
  const label = full ? 'player.fullscreen.exit' : 'player.fullscreen.title';
  button.dataset.i18nTitle = label;
  button.dataset.i18nLabel = label;
  button.title = t(label);
  button.setAttribute('aria-label', t(label));
  button.querySelector('path').setAttribute('d', full
    ? 'M3 8h5V3M12 3v5h5M17 12h-5v5M8 17v-5H3'
    : 'M3 8V3h5M12 3h5v5M17 12v5h-5M8 17H3v-5');
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

function renderSeriesFavorite() {
  const button = $('detail-fav');
  if (!button || state.detail?.view !== 'series') return;
  const on = isFavorite(state.detail.item);
  button.textContent = on ? '★' : '☆';
  button.classList.toggle('on', on);
  button.setAttribute('aria-pressed', String(on));
  button.title = t(on ? 'fav.series.remove' : 'fav.series.add');
  button.setAttribute('aria-label', button.title);
}

function renderFavButton() {
  renderSeriesFavorite();
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
    const entry = state.catchup ? { now: state.catchup, next: null } : state.epg ? state.epg.nowNext(item.id) : null;
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
      if (!state.catchup && catchupAvailable(item, entry.now)) {
        const start = document.createElement('button');
        start.type = 'button';
        start.className = 'ghost';
        start.textContent = t('guide.startover');
        start.addEventListener('click', () => playCatchup(item, entry.now));
        head.append(start);
      }
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
  const cover = item.k === 3 ? item.seriesCover || item.logo : info?.cover || item.logo;
  box.appendChild(poster('info-cover', cover, item.k === 1 ? 'movie' : 'series', { expand: true, title: item.seriesName || item.displayName || item.n }));
  const body = document.createElement('div');
  body.className = 'vodinfo-body';
  if (item.k === 1) {
    body.appendChild(titleFacts(info || item, { movie: true }));
    body.appendChild(externalLinks(item, info));
  }
  // A header that has been read is more precise than the API's data: it
  // knows the audio track and the subtitles, neither of which the API
  // reports.
  const probed = probeFor(item);
  const header = probed && !probed.error ? probed : null;
  const video = header?.video || info?.video;
  const audio = audioDetails(header, { active: state.activeAudio, language: state.settings.audioLang });
  const subtitles = subtitleDetails(item, probed);
  body.appendChild(playbackFacts({
    ext: item.ext,
    video,
    audio,
    subtitles,
    loading: {
      video: !video && ((!header && state.playbackInfoLoading) || Boolean(item.detailsLoading)),
      audio: !audio && !header && state.playbackInfoLoading,
      subtitles: !subtitles && state.playbackInfoLoading,
    },
    durationSec: item.k !== 1 ? info?.durationSec : undefined,
  }));
  if (info && info.plot) {
    const plot = document.createElement('div');
    plot.className = 'plot';
    plot.textContent = info.plot;
    body.appendChild(plot);
  }
  box.appendChild(body);
  el.infostrip.replaceChildren(box);
}

/**
 * The subtitles of the file, for the details: what the player found once it
 * opened the file — or, before that, what an earlier reading of the header
 * found, if there was one. A file without any says so, rather than leaving
 * the viewer to notice that the selector never appeared; a file with only
 * bitmap tracks has subtitles the player cannot show, and says that.
 */
function subtitleDetails(item, probed) {
  const known = state.playing === item ? state.subtitleInfo : null;
  if (known) {
    const languages = [...new Set(known.tracks.map((track) => shortLanguage(track.language)))].filter((l) => l !== 'und');
    return { total: known.tracks.length + known.bitmap, shown: known.tracks.length, languages };
  }
  if (!probed || probed.error) return null;
  const subs = subtitleSummary(probed);
  if (subs) return { total: subs.total, shown: subs.text, languages: subs.languages };
  // A header cut short may hold tracks that were not reached.
  return probed.truncated ? null : { total: 0, shown: 0, languages: [] };
}

async function loadVodDetails(item) {
  if (item.k !== 1 || item.details) return;
  item.detailsLoading = true;
  try {
    const info = await state.lib.movieDetails(item.id);
    item.details = info;
    item.durationSec = info.durationSec;
    const index = state.rowIndex.get(`1:${item.id}`);
    if (index != null) vlist.refreshRow(index);
  } catch { /* the extra details are optional */ }
  finally {
    item.detailsLoading = false;
    if (state.playing === item) renderInfoStrip();
  }
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

const programmeSearch = new ProgrammeSearch({
  getEpg: () => state.epg,
  getChannels: async (scope, signal) => {
    if (scope === 'all') {
      const library = state.lib;
      const channels = await library.ensureFull('live', { signal });
      if (signal.aborted || library !== state.lib) throw new DOMException('Cancelled', 'AbortError');
      return visibleRows(channels);
    }
    return state.rows.filter((c) => c.k === 0);
  },
  onSelect: renderGuidePreview,
  onActivate: activateProgramme,
  onMode: (searching) => {
    $('epg-body').hidden = searching;
    if (searching) grid.hide();
    else if (guideOpen && !grid.open) grid.show();
  },
});

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
  $('btn-guide').setAttribute('aria-expanded', 'true');

  renderGuideGroups();
  grid.epg = state.epg;
  grid.setPlaying(state.playing && state.playing.k === 0 ? state.playing.id : null);
  grid.setChannels(channels);
  grid.show();
  if (state.playing && state.playing.k === 0) grid.focusChannel(state.playing.id);
  focusGrid();
}

function closeGuide() {
  if (!guideOpen) return;
  const restoreFocus = el.epg.contains(document.activeElement) || el.epgPreview.contains(document.activeElement)
    || document.activeElement === $('epg-close');
  guideOpen = false;
  programmeSearch.clear();
  grid.hide();
  el.main.classList.remove('guide');
  el.epg.hidden = true;
  el.epgPreview.hidden = true;
  $('btn-guide').setAttribute('aria-expanded', 'false');
  if (restoreFocus) $('btn-guide').focus();
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
  for (const group of visibleGroups('live')) {
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
  const logo = poster('epgv-logo', channel.logo, 'channel');
  logo.id = 'epgv-logo';
  $('epgv-logo').replaceWith(logo);

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
    buttons.unshift({ label: t(programme.stop > now ? 'guide.startover' : 'guide.watch.recording'), primary: true, onClick: () => playCatchup(channel, programme) });
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
  if (!catchupAvailable(item, programme)) { toast(t('guide.norecording')); return; }
  const minutes = Math.max(1, Math.ceil((programme.stop - programme.start) / 60000));
  const url = timeshiftUrl(state.config, item.id, programme.start, minutes, state.account.serverUtcOffsetMs || 0);
  state.playing = item;
  state.playingSpec = { url, live: false, catchup: true, ext: 'ts', mode: 'ts' };
  state.catchup = { ...programme, channel: item };
  renderSubtitles([], null);
  renderAudio([], null);
  state.subtitleInfo = null;
  el.mode.disabled = true;
  $('btn-live').hidden = false;
  el.nowTitle.textContent = `${item.n} — ${programme.title}`;
  el.nowTitle.title = item.n;
  document.title = t('player.title', { name: el.nowTitle.textContent });
  renderNowSub();
  renderFavButton();
  renderInfoStrip();
  vlist.refresh();
  if (guideOpen) grid.setPlaying(item.id);
  playback.play(state.playingSpec);
  if (programme.stop > Date.now()) toast(t('guide.startover.note'), { long: true });
}

function retryPlayback() {
  if (state.catchup) playCatchup(state.catchup.channel, state.catchup);
  else if (state.playing) playItem(state.playing);
}

/* ------------------------------------------------- katselukohta & stats */

let lastResumeSave = 0;
el.video.addEventListener('ended', () => {
  if (state.catchup) toast(t('guide.archiveended'), { long: true });
});
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

/** A known fraction (0…1), or null while the total is unknown. */
function fillBar(ratio) {
  const bar = el.pFill.parentElement;
  const known = Number.isFinite(ratio);
  bar.classList.toggle('indeterminate', !known);
  el.pPercent.hidden = !known;
  if (!known) {
    bar.removeAttribute('aria-valuenow');
    el.pPercent.textContent = '';
    el.pFill.style.removeProperty('transform');
    return;
  }
  const clamped = Math.min(1, Math.max(0, ratio || 0));
  const percent = Math.round(clamped * 100);
  el.pFill.style.transform = `scaleX(${clamped.toFixed(4)})`;
  el.pPercent.textContent = `${nf.format(percent)} %`;
  bar.setAttribute('aria-valuenow', String(percent));
}

// The load behind the dialog is cancellable: every request made while it
// is open carries this controller's signal, and Cancel or Esc aborts them.
let progressCtrl = null;
const progressSignal = () => (progressCtrl ? progressCtrl.signal : undefined);

function showProgress(title, text, ratio = null) {
  el.pTitle.textContent = title;
  el.pText.textContent = text || '';
  fillBar(ratio);
  if (!el.progress.open) {
    progressCtrl = new AbortController();
    el.progress.showModal();
  }
}

function cancelProgress() {
  if (progressCtrl) progressCtrl.abort();
}

function updateProgress(received, total) {
  if (total > 0) {
    fillBar(received / total);
    el.pText.textContent = t('progress.bytes', { received: megabytes(received), total: megabytes(total) });
  } else {
    fillBar(null);
    el.pText.textContent = t('progress.received', { received: megabytes(received) });
  }
}

function hideProgress() {
  progressCtrl = null;
  if (el.progress.open) el.progress.close();
}

/* ============================================================== settings */

const FIELDS = ['scheme', 'host', 'port', 'username', 'password'];

/** Whether there is anything to connect with yet. */
const configured = () => Boolean(state.config.host && state.config.username && state.config.password);

/**
 * The settings, or — before there are any credentials — the one thing
 * that matters then. With nothing to connect with, sections would offer a
 * choice of rooms in a house with no door: the rail is left out, the title
 * says what the dialog is for, and Connection is all there is.
 *
 * Every open reads a fresh draft from saved values. Tab changes retain
 * it; Save commits it and Cancel discards it.
 */
function openSetup({ section } = {}) {
  for (const f of FIELDS) $(`f-${f}`).value = state.config[f] ?? '';
  $('f-paste').value = '';
  $('playlist-feedback').hidden = true;
  $('f-show-fields').hidden = true;
  $('f-paste').removeAttribute('aria-invalid');
  $('f-lang').value = state.settings.lang;
  $('f-epg').checked = state.settings.epgEnabled;
  $('f-resume').checked = state.settings.resumeEnabled;
  setupInitial = { ...state.settings, subtitleStyle: subtitleLook(state.settings).style, subtitleSize: subtitleLook(state.settings).size };
  applySubtitleLook(state.settings);
  previewSetupLook();
  $('setup-error').hidden = true;
  $('setup-discard').hidden = true;
  document.querySelector('.setup-maintenance').open = false;
  showSourceMode(state.config.sourceMode);
  renderAccountBox();
  const first = !configured();
  el.setup.classList.toggle('firstrun', first);
  el.setupTabs.hidden = first;
  $('setup-title').textContent = t(first ? 'setup.title.connect' : 'setup.title');
  showSetupSection(first ? 'connection' : (section || 'connection'));
  if (!el.setup.open) el.setup.showModal();
  focusSetupSection();
}

// Every open starts with the connection; edits survive tab changes only.
let setupSection = 'connection';
let setupInitial = null;
let setupSaving = false;

function readSetupSettings() {
  return {
    lang: $('f-lang').value,
    epgEnabled: $('f-epg').checked,
    resumeEnabled: $('f-resume').checked,
    subtitleStyle: $('f-substyle').value,
    subtitleSize: Number($('f-subsize').value),
  };
}

function setupSettingsPatch() {
  return Object.fromEntries(Object.entries(readSetupSettings()).filter(([key, value]) => value !== setupInitial?.[key]));
}

function setupConnectionChanged() {
  return FIELDS.some((key) => $(`f-${key}`).value.trim() !== String(state.config[key] ?? ''))
    || sourceMode() !== state.config.sourceMode || Boolean($('f-paste').value.trim());
}

function setupDirty() {
  return setupConnectionChanged() || Object.keys(setupSettingsPatch()).length > 0;
}

function updateSetupActions() {
  const dirty = setupDirty();
  const first = !configured();
  const connection = readSetup();
  const reconnect = FIELDS.some((key) => connection[key] !== state.config[key]);
  $('f-save').disabled = setupSaving || (!first && !dirty);
  $('f-save').textContent = t(setupSaving ? 'setup.saving' : first ? 'setup.connect' : 'setup.save');
  el.setupNote.textContent = t(dirty ? (reconnect && !first ? 'setup.reconnect' : 'setup.pending') : 'setup.unchanged');
  if (!dirty) $('setup-discard').hidden = true;
}

function previewSetupLook() {
  const look = subtitleLook(readSetupSettings());
  const preview = document.querySelector('#panel-subs .sublook');
  preview.dataset.substyle = look.style;
  preview.style.setProperty('--sub-size', `${look.size}px`);
  $('f-subsize-value').textContent = `${look.size} px`;
  fitSubtitlePreview();
}

/** Keep the two-line sample intact even at 72 px or in a narrow dialog.
 * Only this decorative preview is scaled; stored and playback sizes stay put. */
function fitSubtitlePreview() {
  const frame = document.querySelector('#panel-subs .sublook-preview');
  const sample = frame.querySelector('.subdisplay');
  if (!frame.clientWidth || !frame.clientHeight || !sample.offsetWidth) return;
  const scale = Math.min(1, Math.max(0, frame.clientWidth - 32) / sample.offsetWidth,
    Math.max(0, frame.clientHeight - 32) / sample.offsetHeight);
  frame.style.setProperty('--sub-preview-scale', String(scale));
}

function closeSetup() {
  if (setupSaving) return;
  if (setupDirty()) {
    $('setup-discard').hidden = false;
    $('f-keep').focus();
    return;
  }
  el.setup.close();
}

function setupError(key, field) {
  $('setup-error').textContent = t(key);
  $('setup-error').hidden = false;
  if (field) { showSetupSection('connection'); $(field).focus(); }
}

function showSetupSection(name) {
  setupSection = name;
  for (const button of el.setupTabs.children) {
    const on = button.dataset.panel === name;
    button.classList.toggle('active', on);
    button.setAttribute('aria-selected', String(on));
    button.tabIndex = on ? 0 : -1;
  }
  for (const panel of document.querySelectorAll('.setup-panel')) {
    panel.hidden = panel.id !== `panel-${name}`;
  }
  updateSetupActions();
}

/**
 * The first field of the section on show, so the keyboard starts where the
 * eye does. Buttons are not fields: the Account section's are the two that
 * throw things away, and focus does not belong on those.
 */
function focusSetupSection() {
  const panel = document.querySelector('.setup-panel:not([hidden])');
  const field = panel && [...panel.querySelectorAll('input:not([type="radio"]), select')].find((node) => node.getClientRects().length);
  if (field) field.focus();
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
  $('playlist-feedback').hidden = !m3u || !$('f-paste').value.trim();
}

const sourceMode = () => (document.querySelector('input[name="source"]:checked') || {}).value || 'xtream';

async function renderAccountBox() {
  const box = $('account-box');
  const a = state.account;
  // A section that is simply empty tells the viewer nothing about why.
  $('account-none').hidden = Boolean(a);
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
  // A whole address in the Server field is split into its parts here as
  // well as on leaving the field, so that Connect never sees one.
  Object.assign(patch, parseServer(patch.host) || {});
  return patch;
}

/** An address pasted into the Server field lands in the fields it belongs in. */
function splitServerField() {
  const parsed = parseServer($('f-host').value);
  if (!parsed) return;
  for (const f of FIELDS) if (parsed[f] != null) $(`f-${f}`).value = parsed[f];
}

function wireSetup() {
  new ResizeObserver(fitSubtitlePreview).observe(document.querySelector('#panel-subs .sublook-preview'));
  $('f-lang').replaceChildren(...Object.entries(LANGUAGES).map(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }));
  // Dialog controls edit a draft. Only the local subtitle sample previews it.
  for (const event of ['input', 'change']) {
    el.setup.querySelector('form').addEventListener(event, () => {
      $('setup-error').hidden = true;
      previewSetupLook();
      updateSetupActions();
    });
  }
  // The player's Aa popover remains a direct adjustment during playback.
  $('p-substyle').addEventListener('change', () => chooseSubtitleLook('p'));
  $('p-subsize').addEventListener('input', () => applySubtitleLook({
    subtitleStyle: $('p-substyle').value, subtitleSize: Number($('p-subsize').value),
  }));
  $('p-subsize').addEventListener('change', () => chooseSubtitleLook('p'));
  el.sublook.addEventListener('click', () => toggleSubtitleLook());
  // Outside the popover closes it, as it does the dialog. The button is
  // excluded, or its own click would reopen what it just closed.
  document.addEventListener('pointerdown', (e) => {
    if (el.sublookPop.hidden) return;
    if (el.sublookPop.contains(e.target) || el.sublook.contains(e.target)) return;
    toggleSubtitleLook(false);
  });

  for (const radio of document.querySelectorAll('input[name="source"]')) {
    radio.addEventListener('change', () => showSourceMode(radio.value));
  }

  $('f-paste').addEventListener('input', (e) => {
    const parsed = parsePlaylistUrl(e.target.value);
    const status = $('playlist-status');
    $('playlist-feedback').hidden = !e.target.value.trim();
    $('f-show-fields').hidden = !parsed;
    status.textContent = t(parsed ? 'setup.m3u.ok' : 'setup.m3u.bad');
    status.classList.toggle('invalid', !parsed);
    e.target.setAttribute('aria-invalid', String(!parsed && Boolean(e.target.value.trim())));
    if (!parsed) return;
    for (const f of FIELDS) if (parsed[f] != null) $(`f-${f}`).value = parsed[f];
  });
  $('f-show-fields').addEventListener('click', () => {
    showSourceMode('xtream');
    updateSetupActions();
    $('f-host').focus();
  });
  $('f-host').addEventListener('change', splitServerField);
  wireModal(el.setup, closeSetup);
  $('f-done').addEventListener('click', () => { if (!setupSaving) el.setup.close(); });
  $('f-keep').addEventListener('click', () => { $('setup-discard').hidden = true; focusSetupSection(); });
  $('f-discard').addEventListener('click', () => el.setup.close());
  el.setup.addEventListener('close', () => { $('setup-discard').hidden = true; });
  el.setupTabs.addEventListener('keydown', (event) => {
    const tabs = [...el.setupTabs.querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(event.target);
    if (index < 0) return;
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    showSetupSection(tabs[next].dataset.panel);
    tabs[next].focus();
  });
  el.setupTabs.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-panel]');
    if (!button) return;
    showSetupSection(button.dataset.panel);
  });
  el.setup.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (setupSaving || (configured() && !setupDirty())) return;
    const connectionEdited = setupConnectionChanged() || !configured();
    // An existing M3U account can save other preferences without pasting
    // its address again. Any newly entered address must be complete.
    if (sourceMode() === 'm3u' && (connectionEdited || $('f-paste').value.trim())) {
      const parsed = parsePlaylistUrl($('f-paste').value);
      if (!parsed) { setupError('setup.m3u.bad', 'f-paste'); return; }
      for (const f of FIELDS) if (parsed[f] != null) $(`f-${f}`).value = parsed[f];
    }
    const patch = { ...readSetup(), sourceMode: sourceMode() };
    const changed = FIELDS.some((key) => patch[key] !== state.config[key]);
    if (connectionEdited && (!patch.host || !patch.username || !patch.password)) {
      setupError('setup.incomplete', !patch.host ? 'f-host' : !patch.username ? 'f-username' : 'f-password');
      return;
    }
    const settingsPatch = setupSettingsPatch();
    $('setup-error').hidden = true;
    setupSaving = true;
    updateSetupActions();
    el.setup.querySelector('form').inert = true;
    el.setup.setAttribute('aria-busy', 'true');
    let saved = false;
    try {
      // Permission must be requested before the first await, while the
      // submit still carries the user's gesture. Denial leaves the draft.
      if (changed && !(await requestAccess(baseUrl(patch)))) {
        setupError('setup.nogrant');
        return;
      }
      const next = await store.saveSetup(connectionEdited ? patch : null, settingsPatch);
      state.config = next.config;
      state.settings = next.settings;
      saved = true;
      el.setup.close();
      if (state.epg) state.epg.enabled = state.settings.epgEnabled;
      applySubtitleLook(state.settings);
      if (settingsPatch.lang) await applyLanguage(state.settings.lang);
      if (changed) {
        state.favorites = await store.loadFavorites();
        state.recents = await store.loadRecents();
        state.resume = await store.loadResume();
        state.channelPrefs = await store.loadChannelPreferences();
        renderFavButton();
        await connect();
      } else {
        toast(t('setup.saved'));
      }
    } catch (err) {
      console.error('[iptv] settings save failed', err);
      if (!saved) setupError('setup.failed');
      else toast(err.message);
    } finally {
      setupSaving = false;
      el.setup.querySelector('form').inert = false;
      el.setup.removeAttribute('aria-busy');
      updateSetupActions();
    }
  });
  $('f-clear').addEventListener('click', async () => {
    if (setupDirty()) { setupError('setup.maintenance.pending'); return; }
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
    if (setupDirty()) { setupError('setup.maintenance.pending'); return; }
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
function toast(text, { long = false } = {}) {
  el.toast.textContent = text;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  // An error deserves the time it takes to read it.
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, long ? 7000 : 2800);
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

  const name = state.playing ? state.playing.displayName || state.playing.n : 'Stream';
  const spec = state.playingSpec;
  // The resume position is where the browser got to, not where playback
  // started.
  const startAt = spec.live ? 0 : Math.floor(el.video.currentTime || spec.startAt || 0);
  playback.stop();
  state.playbackInfoLoading = false;
  renderInfoStrip();
  handOff({ ...spec, startAt }, name);

  el.overlay.hidden = false;
  el.overlay.classList.remove('loading');
  el.overlayTitle.textContent = t('ext.handed');
  el.overlayText.textContent = t('ext.handed.text');
  showOverlayActions([
    { label: t('ext.continue'), onClick: () => state.catchup ? retryPlayback() : state.playing && playItem(state.playing, { startAt }) },
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
    { label: t('cast.fullscreen'), onClick: () => { close(); enterFullscreen(); } },
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
  el.list.setAttribute('aria-activedescendant', rowDomId(state.cursor));
}

/** The id of a row's node, for the list box to point at. */
const rowDomId = (index) => `row-${index}`;

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
      // unexplained. The group comes back when the search ends.
      if (state.query && state.group != null) {
        state.searchReturn = { tab: state.tab, group: state.group, sub: state.sub };
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
      if (!state.query) returnFromSearch();
      refreshRows().then((ok) => {
        // The list the search needs did not arrive: the search is over.
        if (ok === false && state.query) clearSearch();
      });
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
      await state.lib.loadCategories({ force: true, signal: progressSignal() });
      for (const type of ['live', 'movie', 'series']) {
        if (state.lib.isFull(type)) await state.lib.ensureFull(type, { force: true, onProgress: updateProgress, signal: progressSignal() });
      }
      if (state.epg) state.epg.clear();
      renderSidebar();
      await refreshRows({ keepScroll: true });
      toast(t('toast.refreshed'));
    } catch (err) {
      if (isAbort(err)) toast(t('progress.cancelled')); else showListError(err, null);
    } finally { hideProgress(); }
  });

  $('btn-settings').addEventListener('click', openSetup);
  // Esc does not close the dialog by itself — a closed dialog would look as
  // if the loading had finished — it cancels the load, and the dialog goes
  // once the load has stopped.
  wireModal(el.progress, cancelProgress);
  $('p-cancel').addEventListener('click', cancelProgress);

  el.mode.addEventListener('change', () => {
    store.saveConfig({ streamMode: el.mode.value });
    if (state.playing) playItem(state.playing);
  });
  el.subs.addEventListener('change', chooseSubtitle);
  el.audio.addEventListener('change', chooseAudio);
  $('btn-fullscreen').addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', renderFullscreenButton);
  for (const event of ['loadeddata', 'playing', 'resize', 'emptied', 'error']) {
    el.video.addEventListener(event, renderFullscreenButton);
  }
  renderFullscreenButton();
  // The double click that the browser's controls used to take for the bare
  // video; preventDefault keeps the browser from acting on it as well.
  el.video.addEventListener('dblclick', (e) => { e.preventDefault(); toggleFullscreen(); });
  $('btn-reload').addEventListener('click', retryPlayback);
  $('btn-live').addEventListener('click', () => state.catchup && playItem(state.catchup.channel));
  $('btn-guide').addEventListener('click', toggleGuide);
  $('epg-close').addEventListener('click', closeGuide);
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

  // A mouse click leaves the focus on the button or the select it landed
  // on, and from then on the keys would go there: Space would press the
  // button again — reload the stream, say — and an arrow would change the
  // select. So the focus is given back after the click. A keyboard user's
  // click carries no detail and keeps the focus, and the dialogs keep
  // theirs as well.
  document.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button || e.detail === 0 || button.closest('dialog')) return;
    setTimeout(() => { if (document.activeElement === button) button.blur(); }, 0);
  });
  const mousedSelects = new WeakSet();
  document.addEventListener('mousedown', (e) => { if (e.target.tagName === 'SELECT') mousedSelects.add(e.target); });
  document.addEventListener('change', (e) => {
    const select = e.target;
    if (select.tagName !== 'SELECT' || !mousedSelects.has(select) || select.closest('dialog')) return;
    mousedSelects.delete(select);
    select.blur();
  });

  document.addEventListener('keydown', (e) => {
    if ($('channel-editor').open) return;
    const tag = e.target.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    // A key pressed with Ctrl, Cmd or Alt down belongs to the browser or to
    // the system, not to the app: Cmd+F and Ctrl+F open the browser's search
    // box and must not throw the picture to full screen the way a bare f
    // does. So every shortcut below answers to the plain key alone.
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (e.key === 'Escape' && !el.sublookPop.hidden) { toggleSubtitleLook(false); el.sublook.focus(); return; }
    if (e.key === '/' && !typing && plain) { e.preventDefault(); el.search.focus(); el.search.select(); return; }
    if (e.target === el.search && e.key === 'Escape') {
      clearSearch(); el.search.blur(); return;
    }
    // The video's own controls take the keys while the video has the
    // focus — after a click on the picture — except f, which used to be
    // the browser's full-screen key there and is now the app's.
    if (e.target === el.video && e.key === 'f' && plain) { toggleFullscreen(); return; }
    if (typing || e.target === el.video) return;
    if (el.setup.open || el.progress.open || $('channel-editor').open) return;
    if (!plain) return;
    // A focused button takes Space and Enter itself; every other key is the player's.
    if (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
    if (guideOpen) {
      if (e.key === 'Escape') { closeGuide(); return; }
      if (!$('programme-panel').hidden && e.key !== 'g') return;
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
      case 'f': toggleFullscreen(); break;
      case 'm': el.video.muted = !el.video.muted; break;
      case 'a': cycleAudio(); break;
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
  setLanguage(lang);
  setLocale(localeTag());
  applyStatic();
  renderAccount();
  renderSidebar();
  renderNowSub();
  renderFavButton();
  renderDetail();
  renderInfoStrip();
  // The selector is rebuilt only when the list differs: clear it, so that
  // "No subtitles" is translated even when the tracks stay the same.
  const tracks = state.subtitles;
  const active = el.subs.value === 'off' || !el.subs.value ? null : Number(el.subs.value);
  state.subtitles = null;
  renderSubtitles(tracks, active);
  const audio = state.audioTracks;
  const playing = state.activeAudio?.number ?? null;
  state.audioTracks = null;
  renderAudio(audio, playing);
  // applyStatic has just written every data-i18n node, the dialog's title
  // and section note among them: both depend on where the dialog stands,
  // so they are set again from that.
  if (el.setup.open) {
    renderAccountBox();
    $('setup-title').textContent = t(configured() ? 'setup.title' : 'setup.title.connect');
    showSetupSection(setupSection);
  }
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
  state.channelPrefs = await store.loadChannelPreferences();
  el.mode.value = state.config.streamMode || 'auto';
  applySubtitleLook(state.settings);
  new SubtitleDisplay(el.video, el.subdisplay, el.videowrap);
  renderFavButton();
  renderCastState();

  const ui = await store.loadUiState();
  if (ui.tab) state.tab = ui.tab;
  $('channel-tools').hidden = state.tab !== 'live';
  if (typeof ui.subcatsHeight === 'number') state.subcatsHeight = ui.subcatsHeight;
  for (const button of el.tabs.children) {
    button.classList.toggle('active', button.dataset.tab === state.tab);
    button.setAttribute('aria-selected', String(button.dataset.tab === state.tab));
  }

  if (!state.config.host) {
    renderIdleOverlay();
    openSetup();
    return;
  }
  await connect();
}

init();
