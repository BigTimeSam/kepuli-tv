// @ts-check
// Where we are, as an address.
//
// The player is one page, and nothing outside it used to say which list was
// open: a reload came back through the stored view alone — the tab, the
// group and the topic — and dropped whatever had been drilled into. The
// hash names the place instead. It is written as each list settles, so the
// address bar always shows where the player stands, and a reload — or the
// address pasted into another window — opens exactly there.
//
// The grammar is one segment per step of the sidebar:
//
//   #/live                          the tab alone
//   #/live/Finland                  a group within it
//   #/live/Finland/312              a topic within the group (the category id)
//   #/live/-                        All: the whole type, chosen rather than
//                                   merely not chosen yet — see app.js
//   #/favorites?kind=movie          a collection narrowed to one type
//   #/history?kind=channel          the history, the same way
//   #/series/Drama/77?series=1234   a series opened from that list
//   #/favorites?cat=live:312&series=1234  a series inside a favourite category
//
// Words rather than the code's own short names: the favourites are
// "favorites" in the address, the history "history" (the tab's name, not
// the code's "recent") and the types "category", "channel", "movie" and
// "series", which a person reading or sharing an address understands.
// The older "#/fav", "#/recent" and "kind=1" are still read, for the
// bookmarks made with them.
//   #/live/Finland?channel=4321     a channel in its country's list: the
//                                   one playing there, or a link to it
//   #/movie/Action?movie=5000       a film in its list: the one playing
//                                   there, whose details the strip shows
//                                   (opened from elsewhere, the start
//                                   page or a tile, it is named in its
//                                   own list all the same: ownRoute in
//                                   app.js)
//   #/guide                         the programme guide, open over the
//   #/guide/Finland/312             channel list it shows: "guide" stands
//                                   in the place of "live", group and
//                                   topic and channel as they are there
//
// What is deliberately left out of it:
//   - the search, which is a detour rather than a place: clearing it
//     returns to the group it took over from, and so does a reload;
//   - what is playing, because an address that starts a stream by itself
//     would play something the viewer did not ask for on every reload. A
//     channel's or a film's address finds it and stands on it; Enter plays.

export const TABS = ['live', 'movie', 'series', 'fav', 'recent'];

// Where each drill-down can be made, see parseRoute.
const CATEGORY_TABS = ['fav'];
const SERIES_TABS = ['series', 'fav', 'recent'];
const CHANNEL_TABS = ['live'];
const MOVIE_TABS = ['movie'];

// A collection's type filter: the same values as KIND_ORDER in app.js, and
// the word each has in the address.
// 'r' is the history's reminders ("Upcoming"), see upcomingRows in js/collections.js.
const KINDS = ['c', 0, 1, 2, 'r'];
/** @type {Map<string|number, string>} */
const KIND_WORDS = new Map(/** @type {[string|number, string][]} */ ([['c', 'category'], [0, 'channel'], [1, 'movie'], [2, 'series'], ['r', 'upcoming']]));
// A tab's word in the address, where it is not the tab's own id.
const TAB_WORDS = new Map([['fav', 'favorites'], ['recent', 'history']]);
// The guide is the channel list's, so its word stands for the channels' tab.
const GUIDE_WORD = 'guide';
const TAB_OF_WORD = new Map([...TAB_WORDS].map(([tab, word]) => [word, tab]));

// "All" as a segment of its own, so that the whole type — a choice that
// costs a full list — is told apart from a group not yet picked. A group
// really named "-" is escaped on the way out and so never reaches this.
const ALL = '-';

const encode = (value) => (String(value) === ALL ? '%2D' : encodeURIComponent(value));

const decode = (value) => {
  try { return decodeURIComponent(value); } catch { return value; }
};

/**
 * The address for a view. Absent keys are absent from the address: a
 * `group` of null is All, a `group` left out has not been chosen.
 *
 * @param {{tab: string, group?: string|null, sub?: string|null,
 *          kind?: string|number|null, series?: string|null, cat?: string|null,
 *          channel?: string|null, movie?: string|null, guide?: boolean}} view
 */
export function formatRoute(view) {
  const word = view.guide && view.tab === 'live' ? GUIDE_WORD : TAB_WORDS.get(view.tab) || view.tab;
  const parts = ['#', encodeURIComponent(word)];
  if (view.group !== undefined) {
    parts.push(view.group == null ? ALL : encode(view.group));
    if (view.sub != null) parts.push(encode(view.sub));
  }
  const params = new URLSearchParams();
  if (view.kind != null) params.set('kind', KIND_WORDS.get(view.kind) ?? String(view.kind));
  if (view.cat != null) params.set('cat', String(view.cat));
  if (view.series != null) params.set('series', String(view.series));
  if (view.channel != null) params.set('channel', String(view.channel));
  if (view.movie != null) params.set('movie', String(view.movie));
  const query = params.toString();
  return parts.join('/') + (query ? `?${query}` : '');
}

/**
 * The view an address names, or null when it names none: an empty hash, a
 * shape from another version, a tab that no longer exists. Everything the
 * player cannot honour — a group the account has dropped, a series that is
 * gone — is left to the restore in app.js, which has the library to check
 * it against; here only the address itself is read.
 */
export function parseRoute(hash) {
  const text = String(hash || '').replace(/^#/, '');
  if (!text.startsWith('/')) return null;
  const [path, query] = text.split('?');
  const parts = path.split('/').slice(1);
  const word = decode(parts[0] || '');
  const guide = word === GUIDE_WORD;
  const tab = guide ? 'live' : TAB_OF_WORD.get(word) || word;
  if (!TABS.includes(tab)) return null;

  const view = { tab };
  if (guide) view.guide = true;
  if (parts[1]) view.group = parts[1] === ALL ? null : decode(parts[1]);
  if (parts[2]) view.sub = decode(parts[2]);

  const params = new URLSearchParams(query || '');
  const kind = params.get('kind');
  if (kind != null) {
    const value = KINDS.find((k) => KIND_WORDS.get(k) === kind || String(k) === kind);
    if (value !== undefined) view.kind = value;
  }
  // A drill-down belongs to the tabs it can be made in: a favourite
  // category to the favourites, a series to the series and the two
  // collections that hold them. Anywhere else it is an address put
  // together by hand or by an older version, and following it would open
  // a page over a list it was never part of.
  const cat = params.get('cat');
  if (cat && CATEGORY_TABS.includes(tab)) view.cat = cat;
  const series = params.get('series');
  if (series && SERIES_TABS.includes(tab)) view.series = series;
  const channel = params.get('channel');
  if (channel && CHANNEL_TABS.includes(tab)) view.channel = channel;
  const movie = params.get('movie');
  if (movie && MOVIE_TABS.includes(tab)) view.movie = movie;
  return view;
}
