// What narrows the list, gathered under one fold above it.
//
// The list column used to stack up to three bands above the rows: the
// topic chips, the films' filters and the favourites strip, each taking
// height of its own. Now the films and the series have "Filter titles"
// (with "Show only favourites" in it, js/mediafilters.js), and the
// channels "Filter channels" holding the country's topics, at their full
// height, as the fold itself is what gives the list its room back.
// Folded, the list starts one row below the column's head.
//
// The parts are the same elements wherever they stand, moved rather than
// rebuilt, so their listeners and their keys go with them; on the other
// tabs (the favourites, the history, a series' page) they return to where
// the page first had them.

import { $, el } from './dom.js';
import { t } from './i18n.js';
import { filterChip, foldOpen, foldSummary, resetButton } from './mediafilters.js';
import * as store from './config.js';
import { isCollection, refreshRows, state, visibleRows, withoutInternational } from './state.js';
import { selectSub } from './topicbar.js';
import { isFavorite, topicLabel } from './collections.js';

// "Show only favourites" in "Filter channels", kept across reloads as the
// films' filters are (js/mediafilters.js).
// The channels' fold is markup in player.html, the films' is built by
// MediaFilters: the channels' holds the topic bar, moved in whole (it is the
// same element on every tab), the films' only its own fields. The chips,
// Reset and "Show only favourites" are the same in both.
let channelFavsOnly = false;

/** A country's channels as "Filter channels" narrows them beyond its topic. */
export function filterChannels(rows) {
  return channelFavsOnly ? rows.filter(isFavorite) : rows;
}

/** Whether a star changes what "Filter channels" shows. */
export const channelsByFavourite = () => channelFavsOnly;

/**
 * "Show only favourites" off without a repaint, for the logo's start and
 * Reset, which draw the list themselves.
 * @returns {boolean} whether it was on, and the list wants drawing again
 */
export function resetChannelFilters() {
  if (!channelFavsOnly) return false;
  setChannelFavs(false);
  return true;
}

function setChannelFavs(on) {
  channelFavsOnly = on;
  $('channel-favs').checked = on;
  store.saveUiState({ channelFavsOnly: on });
}

function showChannelFavs(on) {
  setChannelFavs(on);
  return refreshRows();
}

/** Reset: the topic and "Show only favourites" both, the list drawn once. */
export function clearChannelFilters() {
  resetChannelFilters();
  return state.sub != null ? selectSub(null) : refreshRows();
}

let panel;
let body;
let count;
let caption;
// Where each moved part stood when the page loaded: its parent and the
// node after it.
const homes = new Map();

function remember(node) {
  homes.set(node, { parent: node.parentElement, next: node.nextSibling });
}

function sendHome(node) {
  const home = homes.get(node);
  if (!home || node.parentElement === home.parent) return;
  home.parent.insertBefore(node, home.next && home.next.parentElement === home.parent ? home.next : null);
}

function moveInto(node, parent) {
  if (node.parentElement !== parent) parent.append(node);
}

/**
 * Both folds wired from what was stored: open or folded, and their choices
 * ("Filter titles"' through its MediaFilters, js/mediafilters.js).
 * @param {Record<string, any>} ui
 * @param {import('./mediafilters.js').MediaFilters} mediaFilters
 */
export function wireListFilters(ui, mediaFilters) {
  // The films' fold used to open itself on every visit to Movies and Series
  // and take about 140 px off the top of the list, whether or not anyone
  // was filtering. It stays however it was left (foldOpen).
  const titles = $('media-filters');
  const narrow = matchMedia('(max-width: 600px)').matches;
  titles.open = foldOpen(ui.filtersOpen, narrow);
  titles.addEventListener('toggle', () => store.saveUiState({ filtersOpen: titles.open }));
  mediaFilters.restore(ui.mediaFilters);
  mediaFilters.persist = (values) => store.saveUiState({ mediaFilters: values });
  panel = $('channel-filters');
  body = $('channel-filters-body');
  count = $('channel-filters-count');
  caption = $('channel-filters-label');
  for (const node of [el.subcats, el.subcatsGrip]) remember(node);
  // Open the first time, as "Filter titles": the topics were always in
  // sight, and a viewer who has not folded them away should find them
  // where they were.
  panel.open = foldOpen(ui.channelFiltersOpen, narrow);
  panel.addEventListener('toggle', () => store.saveUiState({ channelFiltersOpen: panel.open }));
  channelFavsOnly = ui.channelFavsOnly === true;
  $('channel-favs').checked = channelFavsOnly;
  $('channel-favs').addEventListener('change', (event) => showChannelFavs(/** @type {HTMLInputElement} */ (event.target).checked));
}

/** Each part where the tab on show wants it, and the channels' fold's heading. */
export function placeListFilters(rows) {
  if (!panel) return;
  // Not while the country's channels are still loading: "0 / 0" and a
  // switch for favourites over a list that is not there yet said nothing.
  // A reload that keeps its rows keeps the fold too.
  const channels = state.tab === 'live' && !state.detail && !state.query && Boolean(state.lib) && !isCollection()
    && !(state.listLoading && !rows.length);
  panel.hidden = !channels;
  if (channels) {
    // The grip goes in too, where the stylesheet hides it: the bar takes
    // its whole height inside the fold.
    moveInto(el.subcats, body);
    moveInto(el.subcatsGrip, body);
    // A topic narrows the country's channels as a film filter narrows
    // the films: how many of the country's are left, and the dot.
    const active = state.sub != null || channelFavsOnly;
    const total = active ? withoutInternational(visibleRows(state.groupItems)).length : rows.length;
    foldSummary(caption, count, { label: t('filters.channels'), shown: rows.length, total, active });
    renderChannelChips();
    return;
  }
  $('active-channel-filters').hidden = true;
  sendHome(el.subcats);
  sendHome(el.subcatsGrip);
}

/**
 * What narrows the channels as chips under the fold, "Sport ×", "Show only
 * favourites ×", and Reset after them, as the films' filters show theirs:
 * the dot after the fold's name was all there was to see with the fold
 * closed. A topic's name is its chip's in the bar.
 */
function renderChannelChips() {
  const host = $('active-channel-filters');
  const cat = state.sub == null ? null : state.lib?.group('live', state.group)?.cats.find((c) => c.id === state.sub);
  const topic = state.sub == null ? '' : cat ? topicLabel(cat) : state.lib?.categoryName('live', state.sub) || '';
  // A chip taken away with the keyboard hands the focus to the fold's
  // heading, as the films' chips do: the chips are built again under it.
  const back = (act) => async () => {
    const held = host.contains(document.activeElement);
    await act();
    if (held && (!document.activeElement || document.activeElement === document.body)) panel.querySelector('summary')?.focus();
  };
  const chips = [
    ...(topic ? [filterChip(topic, back(() => selectSub(null)))] : []),
    ...(channelFavsOnly ? [filterChip(t('filters.favs'), back(() => showChannelFavs(false)))] : []),
  ];
  host.hidden = !chips.length;
  host.replaceChildren(...chips, ...(chips.length ? [resetButton(back(clearChannelFilters))] : []));
}
