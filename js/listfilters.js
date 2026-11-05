// What narrows the list, gathered under one fold above it.
//
// The list column used to stack up to three bands above the rows: the
// topic chips, the films' filters and the favourites strip, each taking
// height of its own. Now the films and the series keep their favourites
// inside "Filter titles", and the channels have "Filter channels" holding
// the country's topics, at their full height, as the fold itself is what
// gives the list its room back. The channels have no favourites strip:
// the Favourites tab holds them. Folded, the list starts one row below the
// column's head.
//
// The parts are the same elements wherever they stand, moved rather than
// rebuilt, so their listeners and their keys go with them; on the other
// tabs (the favourites, the history, a series' page) they return to where
// the page first had them.

import { $, el } from './dom.js';
import { t } from './i18n.js';
import { foldOpen, foldSummary } from './mediafilters.js';
import * as store from './config.js';
import { isCollection, state, visibleRows, withoutInternational } from './app.js';

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
  for (const node of [el.subcats, el.subcatsGrip, $('fav-strip')]) remember(node);
  // Open the first time, as "Filter titles": the topics were always in
  // sight, and a viewer who has not folded them away should find them
  // where they were.
  panel.open = foldOpen(ui.channelFiltersOpen);
  panel.addEventListener('toggle', () => store.saveUiState({ channelFiltersOpen: panel.open }));
}

/** Each part where the tab on show wants it, and the channels' fold's heading. */
export function placeListFilters(rows) {
  if (!panel) return;
  const strip = $('fav-strip');
  const channels = state.tab === 'live' && !state.detail && !state.query && Boolean(state.lib) && !isCollection();
  panel.hidden = !channels;
  if (channels) {
    // The grip goes in too, where the stylesheet hides it: the bar takes
    // its whole height inside the fold.
    moveInto(el.subcats, body);
    moveInto(el.subcatsGrip, body);
    sendHome(strip);
    // A topic narrows the country's channels as a film filter narrows
    // the films: how many of the country's are left, and the dot.
    const total = state.sub ? withoutInternational(visibleRows(state.groupItems)).length : rows.length;
    foldSummary(caption, count, { label: t('filters.channels'), shown: rows.length, total, active: Boolean(state.sub) });
    return;
  }
  sendHome(el.subcats);
  sendHome(el.subcatsGrip);
  const films = (state.tab === 'movie' || state.tab === 'series') && !$('media-filters').hidden;
  if (films) moveInto(strip, $('media-filters'));
  else sendHome(strip);
}
