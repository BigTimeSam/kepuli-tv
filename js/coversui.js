// Films and series as covers or as rows: the grid's geometry, the switch
// between the two views, a cover's card, and the favourite star on rows.
//
// Moved out of app.js. It takes the player's state, and the parts app.js
// builds, from js/state.js.

import { isNew } from './titlemeta.js';
import { clock, nf, stampFmt } from './format.js';
import { favCategoryRow, itemRow, markFavorite, posterCard, sectionHeader } from './rows.js';
import { nameCleaner, searchNameCleaner } from './name.js';
import { peek } from './probe.js';
import { renderInfoStrip } from './infostrip.js';
import { rowDomId } from './listnavigation.js';
import { streamUrl } from './xtream.js';
import { t } from './i18n.js';
import * as store from './config.js';
import { ROW_H, groupOfType, isCollection, listNavigation, liveGroupOf, openItemMenu, refreshRows, favouriteChanged, renderSidebar, same, showRows, state, tabType, vlist, mediaFilters } from './state.js';
import { favCategorySubtitle, openFavCategory, removeFromHistory, toggleFavCategory } from './collections.js';
import { el } from './dom.js';
import { pickIds, refreshIdleSoon } from './picksui.js';
import { grid, guideChannel, guideOpen, showGuideChannel } from './guideui.js';
import { openItem } from './seriesui.js';

// Films and series as covers rather than rows. A cover is what a film is
// recognised by, and at 30x44 in a row it was a thumbnail of one. The
// virtual list stands the covers side by side, as many as the column has
// room for, so a catalogue of 55,000 still paints only what is in sight.
const CARD_MIN = 108;     // the narrowest a cover may be, in pixels
const CARD_GAP = 10;
const CARD_TEXT = 48;     // the name and the line under it
let listView = 'grid';    // 'grid' | 'list', for films and series
export let gridColumns = 1;

/** The browsing lists of films and series; collections and episodes stay rows. */
export const usesGrid = () => listView === 'grid' && !isCollection() && !state.detail
  && (state.tab === 'movie' || state.tab === 'series');

/** How many covers fit across the list, and how tall a line of them is. */
function gridGeometry() {
  const width = el.list.clientWidth - 2 * CARD_GAP;
  const columns = Math.max(2, Math.floor((width + CARD_GAP) / (CARD_MIN + CARD_GAP)));
  const card = (width - (columns - 1) * CARD_GAP) / columns;
  return { columns, lineHeight: Math.round(card * 1.5 + CARD_TEXT + CARD_GAP) };
}

export function applyListLayout() {
  const grid = usesGrid();
  el.list.classList.toggle('covers', grid);
  if (!grid) {
    gridColumns = 1;
    vlist.setColumns(1, ROW_H);
    return;
  }
  const { columns, lineHeight } = gridGeometry();
  gridColumns = columns;
  el.list.style.setProperty('--grid-cols', String(columns));
  vlist.setColumns(columns, lineHeight);
}

/** A narrower or wider column takes a different number of covers. */
export function watchGridWidth() {
  let last = '';
  new ResizeObserver(() => {
    if (!usesGrid()) return;
    const { columns, lineHeight } = gridGeometry();
    const key = `${columns}:${lineHeight}`;
    if (key === last) return;
    last = key;
    applyListLayout();
    vlist.refresh();
  }).observe(el.list);
}

/** The covers-or-list choice as stored, at start-up. */
export function restoreListView(view) { if (view === 'list' || view === 'grid') listView = view; }

async function setListView(view) {
  if (view === listView) return;
  listView = view;
  store.saveUiState({ listView: view });
  const position = listNavigation.capture(vlist);
  showRows(state.rows, { keepScroll: true });
  listNavigation.restore(vlist, position);
}

/** List or covers: two marks at the foot of the films' and series' lists. */
export function viewToggle() {
  const box = document.createElement('span');
  box.className = 'view-toggle';
  box.setAttribute('role', 'group');
  // Named as the order marks beside it are: a group a screen reader enters
  // says what its two buttons choose between.
  box.setAttribute('aria-label', t('view.label'));
  for (const [view, paths] of [
    ['list', '<path d="M4 5.5h12M4 10h12M4 14.5h12"/>'],
    ['grid', '<rect x="3.5" y="3.5" width="5" height="5" rx="1"/><rect x="11.5" y="3.5" width="5" height="5" rx="1"/><rect x="3.5" y="11.5" width="5" height="5" rx="1"/><rect x="11.5" y="11.5" width="5" height="5" rx="1"/>'],
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.title = t(`view.${view}`);
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', String(listView === view));
    button.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true">${paths}</svg>`;
    button.addEventListener('click', () => setListView(view));
    box.appendChild(button);
  }
  return box;
}

// What the covers say beyond the name, worked out once per list rather than
// per painted row: which films the history has seen to the end.
let marks = { recents: null, resume: null, seen: new Set() };
function coverMarks() {
  if (marks.recents !== state.recents || marks.resume !== state.resume) {
    // A film the history marks seen: played past its last minutes
    // (js/nextepisode.js), and not started again since (a resume point).
    const seen = new Set();
    for (const entry of state.recents) if (entry.k === 1 && entry.seen) seen.add(`1:${entry.id}`);
    marks = { ...marks, recents: state.recents, resume: state.resume, seen };
  }
  return marks;
}

/** The marks of one film or series: seen, new. */
function coverFacts(item, key) {
  if (item.k !== 1 && item.k !== 2) return {};
  const { seen } = coverMarks();
  const watched = item.k === 1 && seen.has(key) && !state.resume.has(key);
  // A length chosen and this film's not known yet: the card says so (it is
  // in the list until its length is read, see filterMedia).
  const lengthUnknown = item.k === 1 && mediaFilters.byLength && !(item.details?.durationSec || item.durationSec);
  return { watched, isNew: !watched && isNew(item), lengthUnknown };
}

export function renderRow(index) {
  const item = state.rows[index];
  const key = `${item.k}:${item.id}`;
  if (usesGrid() && (item.k === 1 || item.k === 2)) {
    return posterCard(item, {
      label: state.cleanName ? state.cleanName(item.n, item) : null,
      playing: state.playing && `${state.playing.k}:${state.playing.id}` === key,
      selected: index === state.cursor,
      domId: rowDomId(index),
      favorite: state.favorites.has(key),
      resume: state.resume.get(key),
      ...coverFacts(item, key),
      onOpen: () => { state.cursor = index; openItem(item); },
      onFavorite: () => toggleFavorite(item),
    });
  }
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
    ...(isCollection() && !state.detail ? {} : coverFacts(item, key)),
    // The favourites and the history mix the kinds: one picture for all, the
    // facts under the name and the actions in the menu (compactLine in
    // js/rows.js). The time of day went: the day's heading says when.
    compact: isCollection() && !state.detail,
    tag: isCollection() && !state.detail ? null : tagFor(item),
    showEpisodeCover: state.tab === 'recent',
    probe: probeFor(item),
    onOpen: () => { state.cursor = index; openItem(item); },
    onFavorite: () => toggleFavorite(item),
    onRemove: state.tab === 'recent' ? () => removeFromHistory(item) : null,
    onMenu: item.k === 0 || (isCollection() && !state.detail) ? (at) => { state.cursor = index; openItemMenu(item, at); } : null,
    removeTitle: t('row.remove.history'),
  });

  const section = state.sections.get(index);
  if (!section) return row;
  // The heading travels with the row in the same node, which keeps the
  // virtualisation index-based and spares state.rows any heading entries.
  const group = document.createElement('div');
  group.className = 'rowgroup';
  group.append(sectionHeader(section.label, section.icon), row);
  return group;
}

/**
 * Once a country or a category is chosen, the sidebar says what every row
 * name repeats: "US: NHL Ice Center Pass 3 FHD" is, under NHL, merely "Ice
 * Center Pass 3 FHD". Movie and series search results use their own group
 * rules, since one search can contain titles from several countries.
 */
export function nameCleanerFor(rows) {
  if (state.detail?.view === 'series') return state.detail.cleanName;
  const type = tabType();
  // A search, and every channel at once, mix the countries: each row is
  // tidied by the rules of its own group, so "FI: Liiga 1" reads "Liiga 1"
  // in the results just as it does under Finland.
  const mixed = state.query || (type === 'live' && state.group == null && !isCollection());
  if (mixed && !state.detail && type && state.lib?.full[type]) {
    return searchNameCleaner(state.lib.groups[type], state.lib.full[type]);
  }
  // Inside a favourite category the filter is known even though the sidebar
  // does not show it, so the row names tidy up as in the browsing view.
  if (state.detail && state.detail.view === 'category') {
    const entry = state.detail.entry;
    return nameCleaner(entry.g && entry.g !== entry.n ? [entry.g, entry.n] : [entry.n], rows);
  }
  // The favourites and the history mix countries and kinds: each row by
  // its own group's rules, as in a search.
  if (isCollection() && !state.detail) return tidyName;
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
 * A name as the browsing shows it, wherever the item turns up outside its
 * own list — the favourites, the history, the empty player's page, the
 * player's title: "FI: MTV3 FHD" is "MTV3 FHD", by the rules of its own
 * group. With the type's whole list in memory those are the search's
 * rules; without it, the group's label alone, which is enough for the
 * country's own code.
 */
export const TYPE_OF_KIND = { 0: 'live', 1: 'movie', 2: 'series', 3: 'series' };
function tidyName(name, item) {
  const type = TYPE_OF_KIND[item?.k];
  if (!type || !state.lib || !name) return name;
  const full = state.lib.full[type];
  if (full) return searchNameCleaner(state.lib.groups[type], full)(name, item);
  const groupOf = type === 'live' ? liveGroupOf() : groupOfType(type);
  const group = (item.cats || []).map((id) => groupOf.get(id)).find(Boolean);
  const clean = group ? nameCleaner([group], [item]) : null;
  return clean ? clean(name) : name;
}

/** The name an item shows outside its list: its own tidied one, or tidied now. */
export const shownName = (item) => item.displayName && item.displayName !== item.n ? item.displayName : tidyName(item.n, item);

// The rows the list's tidier was made for, as a set, built again only when
// the list itself is a new one: the guide asks for a label on every frame
// it scrolls, and a search through an array of thousands each time would
// show.
let listRows = null, listRowSet = new Set();

/**
 * An item's name wherever it shows, by the rules of its own group. A row
 * of the list on screen reads as the list does, with the tidier made for
 * that list (which may know the topic as well as the country); anything
 * else — another country's channel in the guide's favourites or its
 * all-channels search, a related title, a favourite in the strip — is
 * tidied by its own group's rules, never by those of the list beside it,
 * which left "SE:" on a Swedish channel while "FI:" went from the Finnish.
 */
export function listName(item) {
  if (!item) return '';
  if (state.cleanName && state.rows) {
    if (listRows !== state.rows) { listRows = state.rows; listRowSet = new Set(state.rows); }
    if (listRowSet.has(item)) return state.cleanName(item.n, item) || item.n;
  }
  return shownName(item) || item.n;
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
export function probeFor(item) {
  if (item.k !== 1 && item.k !== 3) return null;
  if (!state.config || state.config.type === 'stalker') return null;
  const url = streamUrl(state.config, item, 'ts');
  return url ? peek(url) : null;
}

export function onEpgUpdated(ids) {
  if (pickIds.size && ids.some((id) => pickIds.has(String(id)))) refreshIdleSoon();
  for (const id of ids) {
    const index = state.rowIndex.get(`0:${id}`);
    if (index != null) vlist.refreshRow(index);
  }
  if (state.playing && state.playing.k === 0 && ids.includes(String(state.playing.id))) renderInfoStrip();
  if (guideOpen) grid.invalidate();
  // The clicked channel's list fills in as its programmes arrive.
  if (guideOpen && guideChannel && ids.includes(guideChannel)) {
    const channel = grid.channels.find((c) => String(c.id) === guideChannel);
    if (channel) showGuideChannel(channel);
  }
}

export function toggleFavorite(item) {
  const key = `${item.k}:${item.id}`;
  if (state.favorites.has(key)) state.favorites.delete(key);
  else state.favorites.set(key, { ...stripItem(item), addedAt: Date.now() });
  store.setFavorite(key, state.favorites.get(key) || null);
  if (state.tab === 'fav') { renderSidebar(); refreshRows({ keepScroll: true }); }
  else markFavorite(vlist.nodes.get(state.rowIndex.get(key)), state.favorites.has(key));
  favouriteChanged(item);
}

/**
 * What a stored copy says about where and how its stream is fetched, and
 * what the guide reads for it. A favourite and a history entry are copies
 * made when they were saved, and the provider moves on: a film re-encoded
 * from .mkv to .mp4, a channel given another guide id or catch-up window.
 */
const ADDRESS_FIELDS = ['ext', 'direct', 'epgId', 'archive', 'cu', 'cmd'];

/**
 * The item as the library holds it now, when the library has it in memory:
 * a whole list loaded, a category or group opened this session, a series'
 * episodes. Nothing is fetched for it — playing from the favourites must
 * not wait on a list — so null means "not known", not "gone".
 */
export function freshItem(item) {
  const lib = state.lib;
  if (!lib) return null;
  const id = String(item.id);
  if (item.k === 3) {
    const info = item.seriesId != null ? lib.details.get(`series:v2:${item.seriesId}`) : null;
    return info?.episodes?.find((episode) => String(episode.id) === id) || null;
  }
  const type = ITEM_TYPES[item.k];
  if (!type) return null;
  const same = (it) => it.k === item.k && String(it.id) === id;
  if (lib.full[type]) return lib.full[type].find(same) || null;
  // A playlist's whole catalogue is in memory from the start: a favourite
  // that came through sync without its address (js/sync.js) finds it here.
  const playlist = state.source?.catalogue?.items?.[type];
  if (playlist) { const hit = playlist.find(same); if (hit) return hit; }
  for (const [key, items] of lib.byCategory) {
    if (!key.startsWith(`${type}:`) && !key.startsWith(`group:${type}:`)) continue;
    const hit = items.find(same);
    if (hit) return hit;
  }
  return null;
}
const ITEM_TYPES = { 0: 'live', 1: 'movie', 2: 'series' };

/** The address fields in which `fresh` differs from `item`, or null when none does. */
export function addressChanges(item, fresh) {
  if (!fresh || fresh === item) return null;
  const patch = {};
  for (const field of ADDRESS_FIELDS) {
    if (!(field in fresh) || fresh[field] === undefined) continue;
    if ((fresh[field] ?? null) !== (item[field] ?? null)) patch[field] = fresh[field];
  }
  return Object.keys(patch).length ? patch : null;
}

/**
 * The item to play: the stored copy with the library's current address
 * fields over it, when the library knows better, and the stored favourite
 * and history entry brought up to date with them — so that the next play
 * from the favourites or Continue watching is right even before anything
 * is loaded. The stored copy stands as it is when the library does not
 * have the item in memory.
 */
export function withCurrentAddress(item) {
  const patch = addressChanges(item, freshItem(item));
  if (!patch) return item;
  updateStoredItem(item, patch);
  return { ...item, ...patch };
}

/** A favourite's and a history entry's address fields brought up to date. */
export async function updateStoredItem(item, patch) {
  const key = `${item.k}:${item.id}`;
  const favorite = state.favorites.get(key);
  if (favorite && addressChanges(favorite, { ...favorite, ...patch })) {
    const updated = { ...favorite, ...patch };
    state.favorites.set(key, updated);
    store.setFavorite(key, updated);
  }
  if (state.recents.some((entry) => `${entry.k}:${entry.id}` === key)) {
    const recents = await store.patchRecent(key, patch);
    if (recents) state.recents = recents;
  }
}

/** Only the fields the list needs for painting are kept. */
export function stripItem(item) {
  // cu, tvgName and shift are a playlist channel's (js/m3usource.js): its
  // archive's address and what its guide is found by.
  // cmd and part are a Stalker portal's (js/stalker.js): what its address
  // is asked for by when the item is played.
  const { id, k, n, logo, ext, season, episode, archive, epgId, direct, cats, durationSec, seriesCover, seriesName, seriesId, displayName, rating, ratingScale, cu, tvgName, shift, cmd, part } = item;
  return { id, k, n, logo, ext, season, episode, archive, epgId, direct, cats, durationSec, seriesCover, seriesName, seriesId, displayName, rating, ratingScale, cu, tvgName, shift, cmd, part };
}
