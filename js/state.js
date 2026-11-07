// @ts-check
// The player's shared state and the parts every module of it reaches.
//
// app.js puts the player together: it builds the list, the sidebar, the
// address and the connection, and hands them out through provide() below.
// The feature modules (js/*ui.js and the rest) import them from here, so
// that nothing imports app.js: they used to, and app.js imported them back,
// a cycle that held only as long as no module touched app.js while the
// modules loaded. What app.js provides is filled in before anything runs,
// as its body runs before any event can reach a module; until then the
// bindings below are undefined.

import { t } from './i18n.js';
import { nf } from './format.js';
import { el } from './dom.js';
import { ListNavigation } from './listnavigation.js';
import { channelPreferences } from './channelprefs.js';

const TYPE_OF_TAB = { live: 'live', movie: 'movie', series: 'series' };
export const TYPE_KIND = { live: 0, movie: 1, series: 2 };

/** "3 channels" — the type picks the key, the number picks the plural. */
export const unit = (type, count) => t(`unit.${type || 'generic'}`, { count, n: nf.format(count) });

// Favourites and history are not the server's lists but the user's own
// collections: they are always in memory, mix all four types, and are
// organised in the sidebar by type rather than by country.
const COLLECTIONS = new Set(['fav', 'recent']);
// 'c' = a favourite category: not a playable item but a door into a list,
// see favCategoryEntry. In a collection it is a type of its own and comes
// first, because one category row covers dozens of channels.
export const kindLabel = (kind) => t(`kind.${kind}`);
export const KIND_ORDER = ['c', 0, 1, 2];
export const KIND_INDEX = new Map(KIND_ORDER.map((kind, i) => [kind, i]));
// In a collection an episode is only part of a series, so it is counted and
// labelled as a series — otherwise history would show a type that does not
// exist among the tabs.
export const kindGroup = (k) => (k === 3 ? 2 : k);
// The row heights are --row-h and --sep-h in player.css, written in rem so
// that they grow with the reader's own font setting. What they come to in
// pixels is therefore the browser's answer rather than a number written here,
// and it is asked again when the setting changes under a running page.
export let ROW_H = 50;
/** The row height in pixels, measured again when the reader's font changes. */
export function setRowHeight(px) { ROW_H = px; }

export const listNavigation = new ListNavigation(el.list);

export const state = {
  config: null, settings: null, account: null,
  source: null, lib: null, epg: null,
  tab: 'live',
  group: null,            // the chosen country/subject, null = all
  sub: null,              // a topic within the group (category_id)
  groupItems: [],         // every item of the chosen group, in memory
  categoryFilter: '', query: '',
  searchAll: null,        // `${tab}\n${query}` of a search run past the groups' filter ("Search all")
  cleanName: null,        // the row-name tidier, null = the name as it is
  listLoading: false,
  listError: null,
  listRequest: 0,
  kind: null,             // a collection's type filter, null = all
  // titleRows: the films or series before one card a title was kept, where
  // a film's page finds its copies when the catalogue is not in memory.
  rows: [], titleRows: [], rowIndex: new Map(), sections: new Map(),
  get cursor() { return listNavigation.index; },
  set cursor(index) { listNavigation.select(index); },
  groupCursor: null,      // where the arrows stand in the sidebar, null = on whatever is chosen
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
  accounts: [],           // every account added, see loadAccounts() in js/config.js
  interests: {},          // the programmes watched, by title, for the picks (js/picks.js)
  channelPrefs: channelPreferences(),
  lastGroup: {}, lastKind: {},
  // The channel the live list's address names: the one played last from it,
  // or the one an address arrived with (see currentRoute).
  routeChannel: null,
  // The film the address names in its list (?movie=), as routeChannel
  // does the channel: the one playing, or the one a reload stood on.
  routeMovie: null,
  subcatsHeight: null,    // the topic bar's height when dragged, null = automatic
};

export const isCollection = () => COLLECTIONS.has(state.tab);

export function tabType() { return TYPE_OF_TAB[state.tab] || null; }
export const isAbort = (err) => Boolean(err && err.name === 'AbortError');
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Set while this tab wipes everything, or reloads because another tab did.
export let resetting = false;
/** This tab is about to wipe everything: nothing it holds may be written back meanwhile. */
export function startReset() { resetting = true; }

// A connection is under way (app.js's connect()).
export let connecting = false;
export function setConnecting(value) { connecting = value; }

// What app.js builds and the modules use: the list and its parts, the
// sidebar, the address, the connection, playback's neighbours.
export let vlist, mediaFilters, catalogueSearch, playerLayout, cast;
export let refreshRows, showRows, renderSidebar, renderCategories, refreshFavouriteFilter, updateAddress, goToRoute, activateTab;
export let visibleRows, visibleGroups, withoutInternational, groupOfType, liveGroupOf, chosenCountries, selectGroup;
export let searchLimit, searchesEveryGroup, beginListLoad, showListError, showListCancelled, openItemMenu, openHiddenList;
export let connect, adoptAccount, accountAddress, offerLists, offerAccess, browserTags;
export let goToChannel, playRelative, noteChannel, updatePlayerLayout;

/** app.js hands over what it built, once, before the player starts. */
export function provide(parts) {
  ({
    vlist, mediaFilters, catalogueSearch, playerLayout, cast,
    refreshRows, showRows, renderSidebar, renderCategories, refreshFavouriteFilter, updateAddress, goToRoute, activateTab,
    visibleRows, visibleGroups, withoutInternational, groupOfType, liveGroupOf, chosenCountries, selectGroup,
    searchLimit, searchesEveryGroup, beginListLoad, showListError, showListCancelled, openItemMenu, openHiddenList,
    connect, adoptAccount, accountAddress, offerLists, offerAccess, browserTags,
    goToChannel, playRelative, noteChannel, updatePlayerLayout,
  } = parts);
}
