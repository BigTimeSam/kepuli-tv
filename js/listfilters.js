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
import { foldOpen, foldSummary } from './mediafilters.js';
import * as store from './config.js';
import { isCollection, refreshRows, state, visibleRows, withoutInternational } from './state.js';
import { selectSub } from './topicbar.js';

// "Show only favourites" in "Filter channels", kept across reloads as the
// films' filters are (js/mediafilters.js).
export let channelFavsOnly = false;

function setChannelFavs(on) {
  channelFavsOnly = on;
  $('channel-favs').checked = on;
  store.saveUiState({ channelFavsOnly: on });
}

function showChannelFavs(on) {
  setChannelFavs(on);
  refreshRows();
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

export function wireListFilters(ui) {
  panel = $('channel-filters');
  body = $('channel-filters-body');
  count = $('channel-filters-count');
  caption = $('channel-filters-label');
  for (const node of [el.subcats, el.subcatsGrip]) remember(node);
  // Open the first time, as "Filter titles": the topics were always in
  // sight, and a viewer who has not folded them away should find them
  // where they were.
  panel.open = foldOpen(ui.channelFiltersOpen);
  panel.addEventListener('toggle', () => store.saveUiState({ channelFiltersOpen: panel.open }));
  channelFavsOnly = ui.channelFavsOnly === true;
  $('channel-favs').checked = channelFavsOnly;
  $('channel-favs').addEventListener('change', (event) => showChannelFavs(/** @type {HTMLInputElement} */ (event.target).checked));
}

/** Each part where the tab on show wants it, and the channels' fold's heading. */
export function placeListFilters(rows) {
  if (!panel) return;
  const channels = state.tab === 'live' && !state.detail && !state.query && Boolean(state.lib) && !isCollection();
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
  const topic = state.sub == null ? ''
    : (el.subcats.querySelector('.chip.active .chip-main')?.firstChild?.textContent || state.lib?.categoryName('live', state.sub) || '').trim();
  const chip = (label, onClick) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'filter-chip';
    button.textContent = label;
    button.setAttribute('aria-label', t('filters.remove', { filter: label }));
    button.addEventListener('click', onClick);
    return button;
  };
  const chips = [
    ...(topic ? [chip(topic, () => selectSub(null))] : []),
    ...(channelFavsOnly ? [chip(t('filters.favs'), () => showChannelFavs(false))] : []),
  ];
  host.hidden = !chips.length;
  if (!chips.length) { host.replaceChildren(); return; }
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'media-filter-reset';
  reset.textContent = t('filters.reset');
  reset.addEventListener('click', () => { setChannelFavs(false); if (state.sub != null) selectSub(null); else refreshRows(); });
  host.replaceChildren(...chips, reset);
}
