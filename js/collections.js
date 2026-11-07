// Favourites and History as the player's own collections, mixing the four
// kinds, and a whole category kept as a favourite: its row, opening it, and
// its place in the address.
//
// Moved out of app.js. It takes the player's state, and the parts app.js
// builds, from js/state.js.

import { HISTORY_ICONS, KIND_ICONS, chipRow } from './rows.js';
import { applySubcatsHeight, selectSub } from './topicbar.js';
import { dayLabel, nf } from './format.js';
import { el } from './dom.js';
import { renderDetail } from './seriesui.js';
import { t } from './i18n.js';
import * as store from './config.js';
import { KIND_INDEX, KIND_ORDER, TYPE_KIND, beginListLoad, catalogueSearch, connecting, isAbort, isCollection, kindGroup, kindLabel, listNavigation, refreshRows, renderCategories, renderSidebar, showListError, state, tabType, updateAddress, visibleRows, vlist, withoutInternational } from './state.js';
import { renderIdleOverlay } from './languageui.js';
import { toast } from './toast.js';
import { listOrder } from './listorder.js';
import { fillBar, hideProgress, progressSignal, showProgress, updateProgress } from './progressdialog.js';

/** The whole set of favourites or history, before any filters. */
export function collectionItems() {
  return visibleRows(state.tab === 'fav' ? favoritesInOrder() : historyInOrder());
}

/** The favourites in the order chosen at the foot of their list: by name either way, or the latest added first. */
function favoritesInOrder() {
  const order = listOrder(state.settings, 'fav');
  if (order === 'added') return favoritesNewestFirst();
  const byName = byNameOf([...state.favorites.values()]);
  return order === 'za' ? byName.reverse() : byName;
}

/** The history as it was watched, the latest first, or by name either way. */
function historyInOrder() {
  const order = listOrder(state.settings, 'recent');
  if (order === 'watched') return state.recents;
  const byName = byNameOf(state.recents);
  return order === 'za' ? byName.reverse() : byName;
}

// The name a favourite is sorted by: what its row says, without a
// provider's country prefix ("FI: Yle TV1"), an episode under its series.
const sortName = (item) => (item.k === 3 ? `${item.seriesName || ''} ${item.season} ${item.episode}` : item.displayName || item.n || '')
  .replace(/^[A-Z]{2,4}\s*[:|]\s*/, '');
let collator = null;
function byNameOf(items) {
  const lang = document.documentElement.lang || undefined;
  if (!collator || collator.lang !== lang) collator = { lang, compare: new Intl.Collator(lang, { numeric: true, sensitivity: 'base' }).compare };
  return [...items].sort((a, b) => collator.compare(sortName(a), sortName(b)));
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

export const kindIndex = (item) => KIND_INDEX.get(kindGroup(item.k)) ?? KIND_ORDER.length;

/** A film or an episode with a resume point: started, and not yet watched to the end. */
export const isUnfinished = (item) => state.settings.resumeEnabled && (item.k === 1 || item.k === 3)
  && state.resume.has(`${item.k}:${item.id}`);

/* Favourite categories. */

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
export function favCategoryEntry(type, groupName, cat) {
  return cat
    ? { k: 'c', id: `${type}:${cat.id}`, t: type, c: cat.id, g: groupName, n: cat.sub || groupName, full: cat.name }
    : { k: 'c', id: `${type}:g:${groupName}`, t: type, c: null, g: groupName, n: groupName, full: null };
}

export const isFavorite = (entry) => state.favorites.has(`${entry.k}:${entry.id}`);

/** A topic's name on its chip and wherever it is named: its part after the country, or General. */
export const topicLabel = (cat) => cat.sub || t('subcats.general');

/**
 * A row's subtitle: what and from where. The type is needed because a
 * collection mixes channel, movie and series categories; the group because
 * the same topic ("Sport") repeats from one country to the next.
 */
export function favCategorySubtitle(entry) {
  const bits = [kindLabel(TYPE_KIND[entry.t])];
  if (entry.c == null) {
    const group = state.lib ? state.lib.group(entry.t, entry.g) : null;
    if (group && group.cats.length > 1) bits.push(t('list.topics', { n: nf.format(group.cats.length) }));
  } else if (entry.g && entry.g !== entry.n) bits.push(entry.g);
  return bits.join(', ');
}

/**
 * The category sizes once per paint rather than per row: the count walks the
 * type's whole list, and the rows are repainted on every scroll frame. The
 * number is known only when the list has already been loaded — the point of
 * a favourite category being precisely that it need not be loaded to see
 * one's favourites.
 */
export function categoryCountsFor(rows) {
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
export async function openFavCategory(entry) {
  if (!state.lib) { toast(t('error.noserver'), { kind: 'warn' }); return; }
  const back = state.detail;
  const returnPosition = listNavigation.capture(vlist);
  const returnSearch = catalogueSearch.snapshot();
  catalogueSearch.reset({ restore: false });
  state.detail = { view: 'category', entry, items: [], back, returnPosition, returnSearch, loading: true };
  state.cursor = -1;
  renderDetail();
  updateAddress();
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
    if (state.detail === open) {
      state.detail = back;
      catalogueSearch.restore(returnSearch);
      renderDetail();
      await refreshRows({ returnPosition });
    }
    showListError(err, () => openFavCategory(entry));
  }
}

/**
 * A category's star in the browsing views. The favourites list is the
 * collection's own view, so the sidebar and the topic chips are repainted
 * only when we are elsewhere — in the favourites the whole list changes.
 */
export function toggleFavCategory(entry) {
  const key = `${entry.k}:${entry.id}`;
  if (state.favorites.has(key)) state.favorites.delete(key);
  else state.favorites.set(key, { ...entry, addedAt: Date.now() });
  store.setFavorite(key, state.favorites.get(key) || null);
  if (state.tab === 'fav') { renderSidebar(); refreshRows({ keepScroll: true }); }
  else { renderCategories(); renderSubcats(); }
}

/**
 * Section headings: row index → the heading above it. History splits into
 * what was left unfinished and then days, favourites into types — in both, the heading says what the rows do
 * not show themselves. A type filter makes the favourites' headings
 * pointless.
 */
export function sectionsFor(rows) {
  const sections = new Map();
  if (!isCollection() || state.detail) return sections;
  // The history by name is headed by type, as the favourites are: days
  // say nothing about a list in the alphabet's order.
  const byDay = state.tab === 'recent' && listOrder(state.settings, 'recent') === 'watched';
  if (!byDay && state.kind != null) return sections;

  let previous = null;
  for (let i = 0; i < rows.length; i++) {
    const unfinished = byDay && isUnfinished(rows[i]);
    const label = !byDay ? kindLabel(kindGroup(rows[i].k))
      : unfinished ? t('history.continue') : dayLabel(rows[i].watchedAt);
    const icon = !byDay ? KIND_ICONS[kindGroup(rows[i].k)]
      : unfinished ? HISTORY_ICONS.continue : HISTORY_ICONS.day;
    if (label && label !== previous) sections.set(i, { label, icon });
    previous = label;
  }
  // A single type heading atop the whole list organises nothing, and the
  // sidebar says the same. A day heading, on the other hand, also says
  // when — that one stays.
  if (!byDay && sections.size < 2) return new Map();
  return sections;
}

export async function removeFromHistory(item) {
  const recents = await store.removeRecent(`${item.k}:${item.id}`);
  if (!recents) return;
  state.recents = recents;
  if (!state.playing && !el.idleHome.hidden) renderIdleOverlay();
  renderSidebar();
  await refreshRows({ keepScroll: true });
}

/**
 * A card taken off Continue watching: where it was left forgotten, so it
 * is no longer unfinished anywhere — not on the page, not as a bar in the
 * lists — and its entries out of the history, which is what the row is
 * made from. A series goes as a whole: forgetting only its latest episode
 * would put an earlier one in the card's place.
 */
export async function forgetUnfinished(item, label) {
  const keys = item.k === 3 && item.seriesId
    ? state.recents.filter((r) => r.k === 3 && r.seriesId === item.seriesId).map((r) => `3:${r.id}`)
    : [];
  keys.push(`${item.k}:${item.id}`);
  for (const key of keys) state.resume.delete(key);
  await store.forgetResume([...new Set(keys)]);
  const recents = await store.removeRecents(keys);
  if (recents) state.recents = recents;
  if (!state.playing) renderIdleOverlay();
  renderSidebar();
  toast(t('player.idle.forgotten', { title: label }));
  await refreshRows({ keepScroll: true });
}

export async function clearHistory() {
  if (!(await store.clearRecents())) return;
  state.recents = [];
  if (!state.playing && !el.idleHome.hidden) renderIdleOverlay();
  state.kind = null;
  state.lastKind.recent = null;
  renderSidebar();
  await refreshRows();
  toast(t('history.cleared'));
}

/**
 * The catalogue fetched again, and the view on screen repainted from it
 * where it stands: the same scroll, the same row chosen, the same page
 * opened from the list. The library drops the categories and groups it
 * kept from earlier in the session (js/library.js, refresh), and the one on
 * screen is asked for again here before the list is repainted, so that the
 * repaint finds it in memory rather than emptying the list to wait for it.
 *
 * Quiet is the refresh nobody asked for — a tab come back to after its
 * lists went stale. It shows no strip and says nothing, keeps the
 * programme data the rows are showing (it goes stale by itself, see
 * js/epg.js), and leaves a failure to the next time.
 */
let refreshing = null;
export async function refreshCatalogue({ quiet = false } = {}) {
  // One at a time. A quiet one already running is enough for another quiet
  // one; Refresh pressed meanwhile waits for it and then does its own, with
  // the strip and the word at the end that the viewer is owed.
  if (refreshing) {
    if (quiet) return refreshing;
    await refreshing;
  }
  const lib = state.lib;
  if (!lib) return false;
  const run = (async () => {
    if (!quiet) showProgress(t('progress.refresh'));
    const signal = quiet ? undefined : progressSignal();
    try {
      await lib.refresh({ signal, onProgress: quiet ? undefined : updateProgress });
      const type = tabType();
      if (type && state.group && !state.query && !isCollection() && !lib.isFull(type)) {
        state.groupItems = await lib.groupItems(type, state.group, { signal });
      }
      // A favourite category opened from the list holds its own copy of the
      // category's contents, and so does one further back in the chain.
      for (let detail = state.detail; detail; detail = detail.back) {
        if (detail.view !== 'category') continue;
        const { entry } = detail;
        detail.items = entry.c == null ? await lib.groupItems(entry.t, entry.g, { signal })
          : await lib.categoryItems(entry.t, entry.c, { signal });
      }
      if (state.lib !== lib) return false;
      if (state.epg && !quiet) state.epg.clear();
      renderSidebar();
      await refreshRows({ keepScroll: true });
      if (!quiet) toast(t('toast.refreshed'));
      return true;
    } catch (err) {
      if (state.lib !== lib) return false;
      if (quiet) console.warn('[iptv] refreshing the stale lists failed', err);
      else if (isAbort(err)) toast(t('progress.cancelled'));
      else showListError(err, null);
      return false;
    } finally {
      if (!quiet) hideProgress();
    }
  })();
  refreshing = run;
  try { return await run; } finally { refreshing = null; }
}

/**
 * A tab left open never asked about its lists again: the categories and
 * channels fetched in the morning were the ones shown at night, whatever
 * the provider had changed. Coming back to the tab is the moment to look —
 * nothing on screen is being read while the tab is hidden — and only when
 * what is in memory is older than the cache would have kept it.
 */
export function refreshWhenStale() {
  if (document.visibilityState !== 'visible' || !state.lib || connecting) return;
  if (state.lib.isStale()) refreshCatalogue({ quiet: true });
}

/**
 * A group's contents are fetched one sub-category at a time. Sweden = 31
 * categories at ~2 kB each is still a fraction of the whole list's 634
 * kilobytes, and after this, switching between topics needs no network at
 * all.
 */
export async function loadGroupItems(type, groupName, current = () => true) {
  const group = state.lib.group(type, groupName);
  const heavy = group && group.cats.length > 3 && !state.lib.isFull(type);
  if (heavy) showProgress(t('progress.group', { group: groupName }), t('progress.categories', { done: nf.format(0), total: nf.format(group.cats.length) }), 0);
  try {
    return await state.lib.groupItems(type, groupName, {
      signal: progressSignal(),
      onProgress: (done, total) => {
        if (!heavy || !current()) return;
        fillBar(done / total);
        el.lpText.textContent = t('progress.categories', { done: nf.format(done), total: nf.format(total) });
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
export function renderSubcats() {
  const type = tabType();
  const group = type && state.group ? state.lib?.group(type, state.group) : null;
  if (!group || group.cats.length < 2 || state.detail || state.query) {
    showSubcats(false);
    el.subcats.replaceChildren();
    return;
  }
  const counts = new Map();
  const visibleItems = type === 'live' ? withoutInternational(visibleRows(state.groupItems)) : state.groupItems;
  // Nothing in the group yet — its list still on the way — is no reason
  // for a bar reading "All 0": it appears with the first rows.
  if (!visibleItems.length) {
    showSubcats(false);
    el.subcats.replaceChildren();
    return;
  }
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
  if (type === 'live') cats = cats.filter((c) => !state.channelPrefs.hiddenCategories.includes(c.id));

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
      label: topicLabel(cat), count: nf.format(count), active: state.sub === cat.id, title: cat.name,
      favorite: isFavorite(entry),
      onFavorite: () => toggleFavCategory(entry),
    }, () => selectSub(cat.id)));
  }
  el.subcats.replaceChildren(frag);
  // One Tab stop for the whole bar, on the chosen chip (wireSubcatsKeys).
  const chips = [...el.subcats.querySelectorAll('.chip-main')];
  const chosen = el.subcats.querySelector('.chip.active .chip-main') || chips[0];
  for (const chip of chips) chip.tabIndex = chip === chosen ? 0 : -1;
  showSubcats(true);
  applySubcatsHeight();
}
