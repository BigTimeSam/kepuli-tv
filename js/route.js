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
//   #/fav?kind=1                    a collection narrowed to one type
//   #/series/Drama/77?series=1234   a series opened from that list
//   #/fav?cat=live:312&series=1234  a series inside a favourite category
//
// What is deliberately left out of it:
//   - the search, which is a detour rather than a place: clearing it
//     returns to the group it took over from, and so does a reload;
//   - the programme guide, which is a mode over the channel list;
//   - what is playing, because an address that starts a stream by itself
//     would play something the viewer did not ask for on every reload.

export const TABS = ['live', 'movie', 'series', 'fav', 'recent'];

// A collection's type filter: the same values as KIND_ORDER in app.js.
const KINDS = ['c', 0, 1, 2];

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
 *          kind?: string|number|null, series?: string|null, cat?: string|null}} view
 */
export function formatRoute(view) {
  const parts = ['#', encodeURIComponent(view.tab)];
  if (view.group !== undefined) {
    parts.push(view.group == null ? ALL : encode(view.group));
    if (view.sub != null) parts.push(encode(view.sub));
  }
  const params = new URLSearchParams();
  if (view.kind != null) params.set('kind', String(view.kind));
  if (view.cat != null) params.set('cat', String(view.cat));
  if (view.series != null) params.set('series', String(view.series));
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
  const tab = decode(parts[0] || '');
  if (!TABS.includes(tab)) return null;

  const view = { tab };
  if (parts[1]) view.group = parts[1] === ALL ? null : decode(parts[1]);
  if (parts[2]) view.sub = decode(parts[2]);

  const params = new URLSearchParams(query || '');
  const kind = params.get('kind');
  if (kind != null) {
    const value = KINDS.find((k) => String(k) === kind);
    if (value !== undefined) view.kind = value;
  }
  const cat = params.get('cat');
  if (cat) view.cat = cat;
  const series = params.get('series');
  if (series) view.series = series;
  return view;
}
